import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import runtime from '../src/runtime/magpie.cjs'

test('existing gateway is reused without installing or taking ownership', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-magpie-reuse-'))
  const server = createServer((_req, res) => res.end(JSON.stringify({ name: 'magpie', version: 'fixture' })))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(root, { recursive: true, force: true }) })
  const result = await runtime.prepareMagpie(root, {}, server.address().port)
  assert.equal(result.reused, true)
  await assert.rejects(readFile(join(root, 'magpie-runtime.json')), { code: 'ENOENT' })
})
test('disabled deployment and invalid ports never launch a process', async () => {
  assert.deepEqual(await runtime.prepareMagpie('/unused', { magpie: false }), { status: 'disabled' })
  for (const port of [0, -1, 65536, NaN]) await assert.rejects(runtime.configuredPort(port))
})
test('occupied non-Magpie port is not taken over', async t => {
  const server = createServer((_req, res) => res.end('{}'))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  await assert.rejects(runtime.prepareMagpie('/unused', {}, server.address().port), /其他服务/)
})
test('Magpie provisions its executable, starts and reuses the gateway', {
  skip: !process.env.DSH_E2E_MAGPIE_BIN && 'Set DSH_E2E_MAGPIE_BIN', timeout: 120000,
}, async t => {
  const { mkdir, copyFile, chmod } = await import('node:fs/promises')
  const home = await mkdtemp(join(tmpdir(), 'dsh-magpie-install-'))
  const root = join(home, '.local/share/dsh-remote')
  const directory = join(root, 'magpie-' + runtime.version)
  await mkdir(directory, { recursive: true })
  if (process.env.DSH_E2E_MAGPIE_DOWNLOAD !== '1') {
    await copyFile(process.env.DSH_E2E_MAGPIE_BIN, join(directory, 'magpie'))
    await chmod(join(directory, 'magpie'), 0o700)
  }
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port; await new Promise(resolve => server.close(resolve))
  let pid
  t.after(async () => { if (pid) { try { process.kill(pid, 'SIGTERM') } catch {} }
    await rm(home, { recursive: true, force: true }) })
  const script = `const r=require(${JSON.stringify(new URL('../src/runtime/magpie.cjs', import.meta.url).pathname)});
    r.prepareMagpie(${JSON.stringify(root)}, {}, ${port}).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1})`
  const env = { ...process.env, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent-dsh-test-bus', NODE_USE_ENV_PROXY: '1', HOME: home, PATH: '/usr/bin:/bin', XDG_CONFIG_HOME: join(home, '.config'), XDG_RUNTIME_DIR: join(home, 'run'), MAGPIE_NO_ACCOUNTS: '1' }
  async function run() {
    const child = spawn(process.execPath, ['-e', script], { env })
    const done = once(child, 'close'); let out = '', err = ''
    child.stdout.on('data', x => { out += x }); child.stderr.on('data', x => { err += x })
    assert.equal((await done)[0], 0, err)
    return JSON.parse(out)
  }
  const first = await run()
  const status = spawn(join(directory, 'magpie'), ['status', '--json', '--addr', '127.0.0.1:' + port], { env })
  const done = once(status, 'close'); let output = ''
  status.stdout.on('data', x => { output += x }); await done
  pid = JSON.parse(output).pid
  assert.ok(pid)
  assert.equal(first.status, 'ready'); assert.equal(first.reused, false)
  assert.equal((await run()).reused, true)
})

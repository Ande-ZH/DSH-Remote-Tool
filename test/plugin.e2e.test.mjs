import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import test from 'node:test'

const dsh = process.env.DSH_E2E_BIN
const archive = process.env.DSH_E2E_PLUGIN

test('the packaged bundle activates through the published DSH plugin loader', {
  skip: (!dsh || !archive) && 'Set DSH_E2E_BIN and DSH_E2E_PLUGIN',
  timeout: 45_000,
}, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-addon-package-'))
  const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
  t.after(() => rm(home, { recursive: true, force: true }))
  execFileSync(resolve(dsh), ['plugin', '--profile', 'web', 'add', resolve(archive)], {
    env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  })
  const host = spawn(resolve(dsh), ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    env, stdio: ['ignore', 'pipe', 'ignore'],
  })
  const closed = once(host, 'close')
  t.after(async () => { host.kill(); await closed })
  const startup = createInterface({ input: host.stdout })
  let entry
  for await (const line of startup) {
    if (line.startsWith('dsh web: http://127.0.0.1:')) {
      entry = new URL(line.slice('dsh web: '.length))
      break
    }
  }
  assert.ok(entry, 'published DSH Web Host starts with the installed bundle')
  const login = await fetch(entry, { redirect: 'manual' })
  assert.equal(login.status, 303)
  const headers = { cookie: login.headers.getSetCookie()[0].split(';')[0] }
  const devicePath = entry.origin + '/api/dsh-shared-remote/devices'
  assert.equal((await fetch(devicePath)).status, 401)
  assert.deepEqual(await (await fetch(devicePath, { headers })).json(), { devices: [] })
  const saved = await fetch(devicePath, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'save', label: '测试设备', host: 'fixture-alias' }),
  })
  assert.equal(saved.status, 200)
  const { id } = await saved.json()
  assert.deepEqual((await (await fetch(devicePath, { headers })).json()).devices, [
    { id, label: '测试设备', host: 'fixture-alias', status: 'disconnected' },
  ])

  const html = await (await fetch(entry.origin + '/', { headers })).text()
  const combos = html.match(/(?:\.\/)?plugins\/\?\?[^"'<>\s]+/g) ?? []
  const advertised = combos.find((url) => url.includes('dsh-shared-remote/client.js'))
  assert.ok(advertised, 'DSH registers the addon client in the real web module graph')
  const bundle = await fetch(new URL(advertised.replaceAll('\\u0026', '&').replaceAll('&amp;', '&'), entry.origin), { headers })
  assert.equal(bundle.status, 200)
  assert.match(await bundle.text(), /SSH 远程工作区/)
})

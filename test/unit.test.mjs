import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { parseEndpoint, sshArguments } from '../src/client.mjs'
import { magpieRequest } from '../src/magpie/service.mjs'

const endpoint = {
  protocol: 1, port: 38081, token: 'launch-token_1234567890',
  instance: 'b8c8b686-b218-4e4a-a9e2-f042ee1801cd', dshVersion: '0.2.2-rc.1',
}
const record = (entry) => 'DSH_REMOTE_V1 ' + JSON.stringify(entry)

test('validates the SSH destination and forces host key verification', () => {
  const args = sshArguments({ host: 'agent@2001:db8::1', port: 2244, batch: true })
  assert.ok(args.includes('StrictHostKeyChecking=yes'))
  assert.ok(args.includes('BatchMode=yes'))
  assert.deepEqual(args.slice(-2), ['-p', '2244'])
  for (const host of ['-oProxyCommand=foo', 'a b', 'a@-host', 'user@hostname;cmd', 'user@@host', undefined]) {
    assert.throws(() => sshArguments({ host }))
  }
  assert.throws(() => sshArguments({ host: 'target', port: 65536 }))
})

test('uses only a single valid remote handshake record', () => {
  assert.deepEqual(parseEndpoint('Welcome!\n' + record(endpoint) + '\r\n'), endpoint)
  for (const value of [
    '', record(endpoint) + '\n' + record(endpoint), record({ ...endpoint, protocol: 2 }),
    record({ ...endpoint, port: 22 }), record({ ...endpoint, token: 'secret?invalid' }),
  ]) {
    assert.throws(() => parseEndpoint(value), /^Error: 远端握手无效/)
  }
})

test('persists device settings and releases only the local tunnel', async (t) => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { deviceService } = await import('../src/plugin-host.mjs')
  const root = await mkdtemp(join(tmpdir(), 'dsh-remote-device-test-'))
  const tunnelEnd = Promise.withResolvers()
  let calls = 0
  let closes = 0
  const service = deviceService(root, async () => {
    calls += 1
    return {
      browserUrl: 'http://127.0.0.1:12345/?token=test-token',
      instance: 'remote-test',
      ended: tunnelEnd.promise,
      close() { closes += 1; tunnelEnd.resolve() },
    }
  })
  t.after(async () => {
    await service.close()
    await rm(root, { recursive: true, force: true })
  })
  const [saved, duplicate] = await Promise.allSettled([
    service.run({ type: 'save', label: 'dev', host: 'dev-ssh' }),
    service.run({ type: 'save', label: 'duplicate', host: 'dev-ssh' }),
  ])
  assert.equal(saved.status, 'fulfilled')
  const { id } = saved.value
  assert.equal(duplicate.status, 'rejected')
  const persisted = JSON.parse(await readFile(join(root, 'devices.json'), 'utf8'))
  assert.deepEqual(persisted, [{ id, label: 'dev', host: 'dev-ssh' }])
  await assert.rejects(service.run({ type: 'target', id }), /未知设备操作/)
  const action = { type: 'connect', id }
  await Promise.all([service.run(action), service.run(action)])
  assert.equal(calls, 1)
  assert.equal((await service.run({ type: 'entry', id })).instance, 'remote-test')
  assert.equal((await service.run()).devices[0].status, 'connected')
  await service.run({ type: 'disconnect', id })
  assert.equal(closes, 1)
  assert.equal((await service.run()).devices[0].status, 'disconnected')
  await assert.rejects(service.run({ type: 'entry', id }), /请先连接/)
  const reloaded = deviceService(root)
  assert.equal((await reloaded.run()).devices[0].id, id)
  await reloaded.close()
})

test('the client entry registers the device panel and remote model settings', async () => {
  const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
  let client
  runInNewContext(source, { setTimeout: () => ({ unref() {} }), document: { createElement: () => ({}) }, window: { addEventListener: () => {}, __ModuleLoader__: { load: (entry) => { client = entry } } } })
  assert.equal(client.id, 'dsh-remote-tool')
  const registered = new Map()
  const plugin = client.factory((request) => {
    assert.ok(['react', 'react-dom', 'react/jsx-runtime'].includes(request))
    return { createContext: () => ({}), forwardRef: value => value, memo: value => value, jsx: () => ({}), jsxs: () => ({}) }
  })
  plugin.apply({ effect: () => {}, slots: {
    inject: (_name, register) => register(),
    register: (metadata, component) => registered.set(metadata.name, { metadata, component }),
  } })
  const sidebar = registered.get('sidebar.panellist')
  const panel = registered.get('main')
  assert.equal(sidebar.metadata.id, panel.metadata.key)
  assert.equal(sidebar.metadata.label(), 'SSH 远程')
  assert.equal(typeof panel.component, 'function')
  const settings = registered.get('settings.section')
  assert.equal(settings.metadata.label(), '远程模型')
  assert.equal(typeof settings.component, 'function')
})

test('Magpie request uses the saved device port and the current DSH instance', () => {
  const device = { host: 'fixture', port: 2222, magpiePort: 3428 }
  assert.deepEqual(magpieRequest({ operation: 'list', port: 1 }, device), {
    operation: 'list', port: 3428, instance: undefined,
  })
  assert.deepEqual(magpieRequest({ operation: 'sync', models: ['vendor/chat', 'vendor/chat'] }, device, 'current'), {
    operation: 'sync', port: 3428, instance: 'current', models: ['vendor/chat'],
  })
  assert.throws(() => magpieRequest({ operation: 'sync', models: [] }, device), /先连接/)
  assert.throws(() => magpieRequest({ operation: 'setEnabled', model: '', enabled: false }, device), /无效/)
})

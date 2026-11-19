import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createSocketServer, connect as socketConnect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import test from 'node:test'
import ssh2 from 'ssh2'
import WebSocket from 'ws'
import { connect } from '../src/client.mjs'
import { manageMagpie } from '../src/magpie/service.mjs'

const dsh = process.env.DSH_E2E_BIN
const magpie = process.env.DSH_E2E_MAGPIE_BIN

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

async function waitFor(read, accepts, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const value = await read()
    if (accepts(value)) return value
    await pause(125)
  }
  assert.fail(label)
}

function fixtureModel(gate, seen) {
  let fileStep = 0
  return createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(404).end()
      return
    }
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    const answer = body.model === 'dsh-remote-fixture'
      ? 'fixture-magpie-answer'
      : text.includes('second-user-prompt') ? 'fixture-answer-two' : 'fixture-answer-one'
    if (text.includes('first-user-prompt') && answer.endsWith('one')) {
      seen.resolve()
      await gate.promise
    }
    if (request.url.includes('/messages')) {
      const canWrite = body.tools?.some((tool) => tool.name === 'write')
      let tool
      if (text.includes('first-user-prompt') && answer.endsWith('one') && canWrite && fileStep < 2) {
        fileStep += 1
        tool = fileStep === 1
          ? { type: 'tool_use', id: 'fixture-write', name: 'write', input: { file_path: 'shared.txt', content: 'from the remote agent\n' } }
          : { type: 'tool_use', id: 'fixture-read', name: 'read', input: { file_path: 'shared.txt' } }
      }
      const frames = [
        { type: 'message_start', message: {
          id: randomUUID(), model: body.model, type: 'message', role: 'assistant', content: [],
          stop_reason: null, usage: { input_tokens: 3, output_tokens: 0 },
        } },
        { type: 'content_block_start', index: 0, content_block: tool ?? { type: 'text', text: '' } },
        ...tool ? [] : [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer } }],
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(frames.map((frame) => 'event: ' + frame.type + '\ndata: ' + JSON.stringify(frame) + '\n\n').join(''))
      return
    }
    if (request.url.includes('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const [delta, finish_reason] of [[{ role: 'assistant', content: answer }, null], [{}, 'stop']]) {
        response.write('data: ' + JSON.stringify({
          id: 'fixture', object: 'chat.completion.chunk', created: 123, model: body.model,
          choices: [{ index: 0, delta, finish_reason }],
        }) + '\n\n')
      }
      response.end('data: [DONE]\n\n')
      return
    }
    response.writeHead(404).end()
  })
}

function fixtureSsh(home, modelPort, keys) {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const clients = new Set()
  const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
    clients.add(client)
    client.on('error', () => {})
    client.on('close', () => clients.delete(client))
    client.on('authentication', (context) => {
      if (context.username !== 'fixture' || context.method !== 'publickey') {
        context.reject(['publickey'])
        return
      }
      const key = keys.find((candidate) => candidate.getPublicSSH().equals(context.key.data))
      if (!key || (context.signature && key.verify(context.blob, context.signature, context.hashAlgo) !== true)) {
        context.reject(['publickey'])
        return
      }
      context.accept()
    })
    client.on('session', (accept) => {
      const session = accept()
      session.on('exec', (acceptExec, _reject, { command }) => {
        const stream = acceptExec()
        const child = spawn('sh', ['-c', command], {
          cwd: home,
          env: {
            ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
            PATH: dirname(process.execPath) + ':' + process.env.PATH,
            DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent-dsh-test-bus',
            DSH_TELEMETRY_DISABLED: '1', DSH_PERMISSION_MODE: 'workspace-write',
            DEEPSEEK_API_KEY: 'local-fixture-key', DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + modelPort,
          },
        })
        stream.pipe(child.stdin).on('error', () => {})
        child.stdout.pipe(stream, { end: false })
        child.stderr.pipe(stream.stderr, { end: false })
        child.on('close', (code) => { stream.exit(code ?? 1); stream.end() })
      })
    })
    client.on('tcpip', (accept, reject, { destIP, destPort }) => {
      if (destIP !== '127.0.0.1') { reject(); return }
      const socket = socketConnect({ host: destIP, port: destPort })
      socket.once('connect', () => {
        const stream = accept()
        stream.pipe(socket).pipe(stream)
        stream.on('error', () => socket.destroy())
        stream.on('close', () => socket.destroy())
        socket.on('error', () => stream.destroy())
        socket.on('close', () => stream.destroy())
      })
      socket.once('error', () => reject())
    })
  })
  return { server, clients }
}

async function authenticate(connection) {
  const response = await fetch(connection.browserUrl, { redirect: 'manual' })
  assert.equal(response.status, 303)
  const cookie = response.headers.getSetCookie()[0].split(';')[0]
  await response.body?.cancel()
  return { origin: connection.origin, cookie }
}

async function rpc(client, name, args = {}, expectedStatus = 200, timeout = 6000) {
  const response = await fetch(client.origin + '/api/' + name, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(client.cookie ? { cookie: client.cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: name, payload: { args } }),
    signal: AbortSignal.timeout(timeout),
  })
  assert.equal(response.status, expectedStatus, name)
  if (expectedStatus !== 200) { await response.body?.cancel(); return }
  const { result } = await response.json()
  assert.equal(result?.ok, true, name + ' ' + JSON.stringify(result))
  return result.value
}

async function startMagpie(t, home, bin, modelPort) {
  await symlink(resolve(magpie), join(bin, 'magpie'))
  const reservation = createSocketServer()
  const port = await listen(reservation)
  await new Promise(resolve => reservation.close(resolve))
  const env = {
    ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    MAGPIE_ADDR: '127.0.0.1:' + port, MAGPIE_NO_ACCOUNTS: '1',
  }
  execFileSync(resolve(magpie), [
    'provider', 'add', 'DSH fixture', 'id=fixture', 'url=http://127.0.0.1:' + modelPort + '/v1',
    'key=test-fixture', 'list=off', 'models=dsh-remote-fixture',
  ], { env, timeout: 10_000 })
  const child = spawn(resolve(magpie), ['serve'], { env, stdio: 'ignore' })
  const closed = once(child, 'exit')
  t.after(async () => { child.kill(); await closed })
  await waitFor(
    () => fetch('http://127.0.0.1:' + port + '/api/hello').then(response => response.json()).catch(() => null),
    value => value?.name === 'magpie', 'real Magpie is listening',
  )
  return port
}

async function checkMagpie(t, { home, bin, modelPort, port, restarted, afterRestart, workspaceId }) {
  const magpiePort = await startMagpie(t, home, bin, modelPort)
  const model = 'fixture/dsh-remote-fixture'
  const target = { device: { host: 'device-a', port, magpiePort }, instance: restarted.instance }
  const operation = (request) => manageMagpie(target, request)
  const detected = await operation({ operation: 'list' })
  assert.equal(detected.canManage, true)
  assert.deepEqual(detected.models.map(item => item.id), [model])
  assert.equal(detected.dsh.available, true, detected.dsh.error)
  assert.deepEqual(detected.dsh.selected, [])
  const disabled = await operation({ operation: 'setEnabled', model, enabled: false })
  assert.equal(disabled.models.length, 0)
  assert.deepEqual(disabled.disabled, [{ id: model, canToggle: true }])
  const restored = await operation({ operation: 'setEnabled', model, enabled: true })
  assert.deepEqual(restored.models.map(item => item.id), [model])
  assert.deepEqual(restored.disabled, [])

  const provider = 'dsh-remote-magpie'
  await assert.rejects(manageMagpie({ ...target, instance: 'old-instance' }, { operation: 'sync', models: [model] }), /Host 已更换/)
  const synchronized = await operation({ operation: 'sync', models: [model] })
  assert.deepEqual(synchronized.dsh.selected, [model])
  const catalog = await rpc(afterRestart, 'session/modelCatalog', {})
  assert.ok(catalog.groups.some(group => group.id === provider && group.models.some(item => item.id === model)))
  assert.ok(catalog.groups.some(group => group.id === 'deepseek-official'), 'existing provider remains in catalog')
  const { sessionId } = await rpc(afterRestart, 'session/create', { request: { workspaceId } })
  await rpc(afterRestart, 'session/selectModel', { request: { sessionId, provider, model } })
  await rpc(afterRestart, 'session/prompt', prompt(sessionId, 'magpie-route-prompt'))
  await waitFor(
    () => history(afterRestart, sessionId),
    value => JSON.stringify(value).includes('fixture-magpie-answer'),
    'DSH sends the turn through the real Magpie gateway',
  )
  const cleared = await operation({ operation: 'sync', models: [] })
  assert.deepEqual(cleared.dsh.selected, [])
}

const prompt = (sessionId, text, requestId = randomUUID()) => ({
  request: { requestId, sessionId, mode: 'queue', content: [{ type: 'text', text }] },
})
const summary = async (client, sessionId) => (await rpc(client, 'session/list', { _request: {} }))
  .items.find((item) => item.sessionId === sessionId)
const history = (client, sessionId) => rpc(client, 'session/page', {
  request: { address: { kind: 'session', sessionId }, maxMessages: 100 },
})

async function follow(client, endpoint, args, t) {
  const url = new URL('/api/remote.mux', client.origin)
  url.protocol = 'ws:'
  const socket = new WebSocket(url, { headers: { cookie: client.cookie }, handshakeTimeout: 6000 })
  t.after(() => socket.terminate())
  const streamId = randomUUID()
  const output = { items: [], error: undefined }
  socket.on('message', (data) => {
    const frame = JSON.parse(data.toString())
    if (frame.streamId !== streamId) return
    if (frame.type === 'item') output.items.push(frame.value)
    if (frame.type === 'error') output.error = frame.error
  })
  await once(socket, 'open')
  socket.on('error', (error) => { output.error = error.message })
  socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }))
  return output
}

test('two OpenSSH clients share a real DSH workspace, one running agent and persisted history', {
  skip: !dsh && process.env.DSH_E2E_INSTALL !== '1' && 'Set DSH_E2E_BIN or DSH_E2E_INSTALL=1',
  timeout: 180_000,
}, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-remote-e2e-'))
  const base = join(home, '.local/share/dsh-remote')
  const workspace = join(home, 'project')
  const extension = join(home, 'extension')
  const extensionName = 'dsh-remote-e2e-extension'
  const gate = Promise.withResolvers()
  const seen = Promise.withResolvers()
  const model = fixtureModel(gate, seen)
  const modelPort = await listen(model)
  const localKeys = ['device-a', 'device-b'].map((name) => {
    const path = join(home, name)
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path])
    return path
  })
  const publicKeys = await Promise.all(localKeys.map(async (path) => ssh2.utils.parseKey(await readFile(path + '.pub'))))
  const { server, clients } = fixtureSsh(home, modelPort, publicKeys)
  const port = await listen(server)
  const knownHosts = join(home, 'known_hosts')
  const connections = []
  t.after(async () => {
    gate.resolve()
    for (const c of connections) c.close()
    for (const client of clients) client.end()
    server.close()
    model.close()
    model.closeAllConnections()
    try {
      const ready = JSON.parse(await readFile(join(base, 'ready.json'), 'utf8'))
      process.kill(ready.pid, 'SIGTERM')
      await waitFor(() => readFile(join(base, 'ready.json')).catch(() => null), (file) => !file, 'fixture process shutdown')
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
    }
    await rm(home, { recursive: true, force: true })
  })
  await mkdir(base, { recursive: true, mode: 0o700 })
  await mkdir(workspace)
  await mkdir(extension)
  await writeFile(join(extension, 'package.json'), JSON.stringify({
    name: extensionName, version: '1.0.0', type: 'module',
    exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
    dsh: { bundle: { patch: './patch.yml' }, client: { platform: 'web' } },
  }))
  await writeFile(join(extension, 'patch.yml'), '- insert:\n    - id: ' + extensionName + '\n      name: ' + extensionName + '\n')
  await writeFile(join(extension, 'index.js'), [
    'export const name = "' + extensionName + '"',
    'export const inject = ["connection"]',
    'export function apply(ctx) {',
    '  ctx.connection.fetch.register({path: "/api/remote-e2e-extension", methods: ["GET"], requestBody: "buffered",',
    '    async fetch() { return Response.json({ loaded: true }) } })',
    '}',
  ].join('\n'))
  await writeFile(join(extension, 'client.js'),
    'window.__ModuleLoader__.load({id:"' + extensionName +
    '",factory:()=>({name:"' + extensionName + '",apply(){}})})\n')
  await writeFile(join(base, 'config.json'), JSON.stringify({
    ...(dsh ? { dshBin: resolve(dsh) } : {}),
    ...(process.env.DSH_E2E_PNPM ? { pnpmBin: resolve(process.env.DSH_E2E_PNPM) } : {}),
    magpie: false,
  }), { mode: 0o600 })

  // Provide an isolated OpenSSH config via a test-only PATH wrapper.
  const ssh = spawn('ssh-keyscan', ['-T', '5', '-t', 'rsa', '-p', String(port), '127.0.0.1'], { stdio: ['ignore', 'pipe', 'ignore'] })
  const chunks = []
  for await (const chunk of ssh.stdout) chunks.push(chunk)
  const publicKey = Buffer.concat(chunks)
  assert.match(publicKey.toString(), /ssh-rsa /)
  await writeFile(knownHosts, publicKey, { mode: 0o600 })
  const bin = join(home, 'bin')
  const config = join(home, 'ssh.config')
  await mkdir(bin)
  await writeFile(join(bin, 'systemctl'), '#!/bin/sh\nexit 1\n', { mode: 0o700 })
  await writeFile(config, [
    'Host device-a', '  IdentityFile ' + localKeys[0],
    'Host device-b', '  IdentityFile ' + localKeys[1],
    'Host *', '  HostName 127.0.0.1', '  User fixture', '  IdentitiesOnly yes',
    '  UserKnownHostsFile ' + knownHosts, '  GlobalKnownHostsFile /dev/null', '',
  ].join('\n'))
  await writeFile(join(bin, 'ssh'), '#!/bin/sh\nexec /usr/bin/ssh -F "' + config + '" "$@"\n', { mode: 0o700 })
  const originalPath = process.env.PATH
  process.env.PATH = bin + ':' + originalPath
  t.after(() => { process.env.PATH = originalPath })

  const connectClient = async (host = 'device-a') => {
    const connection = await connect({ host, port, batch: true })
    connections.push(connection)
    return connection
  }
  // Concurrent first connections start one Host for both clients.
  const [a, b] = await Promise.all([connectClient(), connectClient('device-b')])
  assert.equal(a.instance, b.instance)
  assert.notEqual(a.origin, b.origin)
  await rpc({ origin: b.origin }, 'session/list', { _request: {} }, 401)
  const [clientA, clientB] = await Promise.all([authenticate(a), authenticate(b)])
  const appearance = (await rpc(clientA, 'settings/describe')).namespaces.find(row => row.ns === 'ui-theme')
  assert.ok(appearance, 'Host serves shared appearance')
  await rpc(clientA, 'settings/mutate', { ns: 'ui-theme', expectedRevision: appearance.revision,
    ops: [{ op: 'set', path: ['preference'], value: 'dark' }, { op: 'set', path: ['fontSize'], value: 16 }] })
  const shared = (await rpc(clientB, 'settings/describe')).namespaces.find(row => row.ns === 'ui-theme')
  assert.equal(shared.value.preference, 'dark')
  assert.equal(shared.value.fontSize, 16)
  const web = await fetch(clientB.origin + '/', { headers: { cookie: clientB.cookie } })
  assert.equal(web.status, 200)
  assert.match(await web.text(), /<!doctype html>/i)
  const remoteBundle = async (client) => (await rpc(client, 'pluginManager/listBundles', {}))
    .find((item) => item.name === extensionName)
  const extensionRoute = (client) => fetch(client.origin + '/api/remote-e2e-extension', { headers: { cookie: client.cookie } })
  const installed = await rpc(clientA, 'pluginManager/installBundle', { spec: extension, options: { enabled: true } }, 200, 30_000)
  assert.equal(installed.application, 'applied', JSON.stringify(installed))
  assert.equal((await remoteBundle(clientB)).enabled, true)
  assert.deepEqual(await (await extensionRoute(clientB)).json(), { loaded: true })
  const extensionUi = await fetch(clientB.origin + '/', { headers: { cookie: clientB.cookie } })
  assert.match(await extensionUi.text(), new RegExp(extensionName + '/client.js'))
  const disabled = await rpc(clientA, 'pluginManager/setBundleEnabled', { name: extensionName, enabled: false })
  assert.equal(disabled.application, 'applied')
  assert.equal((await extensionRoute(clientB)).status, 404)
  const enabled = await rpc(clientB, 'pluginManager/setBundleEnabled', { name: extensionName, enabled: true })
  assert.equal(enabled.application, 'applied')
  const created = await rpc(clientA, 'workspace/create', { request: { path: workspace } })
  const workspaceId = created.workspace.workspaceId
  const existing = await rpc(clientB, 'workspace/create', { request: { path: workspace } })
  assert.equal(existing.created, false)
  assert.equal(existing.workspace.workspaceId, workspaceId)
  const { sessionId } = await rpc(clientA, 'session/create', { request: { workspaceId } })
  const firstStream = await follow(clientB, 'session/follow', {
    request: { address: { kind: 'session', sessionId }, maxMessages: 100 },
  }, t)
  await waitFor(() => firstStream.items, (items) => items[0]?.type === 'snapshot', 'B sees live history baseline')
  const first = await rpc(clientA, 'session/prompt', prompt(sessionId, 'first-user-prompt'))
  assert.equal(first.accepted, true)
  await Promise.race([
    seen.promise,
    pause(10_000, undefined, { ref: false }).then(async () => assert.fail('DSH never submitted to the test model: ' +
      JSON.stringify(await history(clientB, sessionId)).slice(-5000))),
  ])
  assert.equal((await summary(clientB, sessionId)).running, true)
  a.close()
  await a.ended
  assert.equal((await summary(clientB, sessionId)).running, true)
  gate.resolve()
  await waitFor(() => firstStream.items, (items) => JSON.stringify(items.slice(1)).includes('fixture-answer-one'), 'B receives first turn live after A disconnected')
  assert.equal(await readFile(join(workspace, 'shared.txt'), 'utf8'), 'from the remote agent\n')
  assert.match(JSON.stringify(await history(clientB, sessionId)), /fixture-read/)

  const followUp = await rpc(clientB, 'session/prompt', prompt(sessionId, 'second-user-prompt'))
  assert.equal(followUp.accepted, true)
  await waitFor(() => history(clientB, sessionId), (value) => JSON.stringify(value).includes('fixture-answer-two'), 'B can continue the original session')
  const returningA = await connectClient()
  assert.equal(returningA.instance, b.instance)
  const resumedA = await authenticate(returningA)
  const fromA = await history(resumedA, sessionId)
  assert.match(JSON.stringify(fromA), /fixture-answer-one/)
  assert.match(JSON.stringify(fromA), /fixture-answer-two/)
  assert.equal((await summary(resumedA, sessionId)).cwd, workspace)
  const workspaceFeed = await follow(resumedA, 'workspace/follow', {}, t)
  const baseline = await waitFor(() => workspaceFeed.items, (items) => items[0]?.type === 'baseline', 'A sees shared workspaces')
  assert.ok(baseline[0].value.items.some((item) => item.workspaceId === workspaceId && item.sessionIds.includes(sessionId)))

  const streamArgs = { request: { address: { kind: 'session', sessionId }, maxMessages: 100 } }
  const [liveA, liveB] = await Promise.all([
    follow(resumedA, 'session/follow', streamArgs, t),
    follow(clientB, 'session/follow', streamArgs, t),
  ])
  await waitFor(() => [liveA, liveB], (streams) => streams.every((stream) => stream.items[0]?.type === 'snapshot'), 'both clients subscribe at the same cut')
  const bothTurns = (stream) => stream.items.filter((item) => item.type === 'event' && item.event?.type === 'turn/end')
  const [queuedA, queuedB] = await Promise.all([
    rpc(resumedA, 'session/prompt', prompt(sessionId, 'parallel-client-A')),
    rpc(clientB, 'session/prompt', prompt(sessionId, 'parallel-client-B')),
  ])
  assert.ok(queuedA.accepted && queuedB.accepted)
  await waitFor(() => [liveA, liveB], (streams) => streams.every((stream) => bothTurns(stream).length === 2), 'both clients receive two serialized turns')
  assert.deepEqual(liveA.items.slice(1), liveB.items.slice(1))

  // A service exit changes the runtime generation. Durable history and the workspace survive.
  b.close()
  returningA.close()
  const readyPath = join(base, 'ready.json')
  const ready = JSON.parse(await readFile(readyPath, 'utf8'))
  process.kill(ready.pid, 'SIGTERM')
  await waitFor(() => readFile(readyPath).catch(() => null), (file) => !file, 'old Host exited')
  const restarted = await connectClient()
  assert.notEqual(restarted.instance, b.instance)
  const afterRestart = await authenticate(restarted)
  const restoredTheme = (await rpc(afterRestart, 'settings/describe')).namespaces.find(row => row.ns === 'ui-theme')
  assert.equal(restoredTheme.value.preference, 'dark')
  assert.equal(restoredTheme.value.fontSize, 16)
  assert.match(JSON.stringify(await history(afterRestart, sessionId)), /fixture-answer-two/)
  assert.equal((await remoteBundle(afterRestart)).enabled, true)
  assert.deepEqual(await (await extensionRoute(afterRestart)).json(), { loaded: true })
  const removed = await rpc(afterRestart, 'pluginManager/removeBundle', { name: extensionName }, 200, 30_000)
  assert.equal(removed.application, 'applied')
  assert.equal((await extensionRoute(afterRestart)).status, 404)
  if (magpie) {
    await t.test('native Magpie model controls and DSH routing', async (scenario) => {
      await checkMagpie(scenario, { home, bin, modelPort, port, restarted, afterRestart, workspaceId })
    })
  }
})

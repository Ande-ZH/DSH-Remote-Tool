import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer, isIP } from 'node:net'
import { createInterface } from 'node:readline'

const hostProgram = new URL('./host.cjs', import.meta.url)
const upload = [
  'umask 077',
  'base="$HOME/.local/share/dsh-remote"',
  'mkdir -p "$base" || exit 1',
  'tmp=$(mktemp "$base/host.XXXXXX") || exit 1',
  'trap \'rm -f "$tmp"\' EXIT',
  'cat > "$tmp" || exit 1',
  'path="$base/host-v1.cjs"',
  'if ! cmp -s "$tmp" "$path"; then mv -f "$tmp" "$path" || exit 1; fi',
  'rm -f "$tmp" || exit 1',
  'if ! command -v node >/dev/null 2>&1; then echo "远端需要 Node.js 24.9 或更新版本" >&2; exit 1; fi',
  'exec node "$path" connect',
].join('\n')

/** @typedef {{protocol: number, dshVersion: string, port: number, token: string, instance: string}} Endpoint */
/** @typedef {{host: string, port?: number, batch?: boolean, signal?: AbortSignal}} ConnectionOptions */

export function sshArguments({ host, port, batch }) {
  const parts = typeof host === 'string' ? host.split('@') : []
  const address = parts.at(-1)
  const hostIsValid = typeof address === 'string' &&
    (/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(address) || isIP(address) === 6)
  if (parts.length > 2 || !hostIsValid ||
      (parts.length === 2 && !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(parts[0]))) {
    throw new Error('设备地址须为 OpenSSH 别名、主机名或 user@host')
  }
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('SSH 端口须为 1–65535')
  }
  return [
    '-T', '-S', 'none',
    '-o', 'ControlMaster=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ForwardAgent=no',
    '-o', 'ForwardX11=no',
    '-o', 'PermitLocalCommand=no',
    '-o', 'RemoteCommand=none',
    '-o', 'ForkAfterAuthentication=no',
    '-o', 'ConnectTimeout=12',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=3',
    ...(batch ? ['-o', 'BatchMode=yes'] : []),
    ...(port !== undefined ? ['-p', String(port)] : []),
  ]
}

function completion(child) {
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }))
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
}

async function bootstrap(options, args) {
  const bytes = await readFile(hostProgram)
  const output = await runSshCommand(options, 'sh -c ' + shellQuote(upload), bytes, {
    timeoutMs: 240_000, outputLimit: 64 * 1024, stderr: 'inherit', args,
    failure: 'SSH 引导失败。请先用 ssh 确认已信任主机指纹、身份可登录，且远端 Node.js 可用。',
  })
  return parseEndpoint(output)
}

export async function runSshCommand(options, command, input, {
  timeoutMs, outputLimit, failure, stderr = 'ignore', args = sshArguments(options),
}) {
  options.signal?.throwIfAborted()
  const child = spawn('ssh', [
    ...args, '-o', 'ClearAllForwardings=yes', options.host, command,
  ], { stdio: ['pipe', 'pipe', stderr], windowsHide: true })
  const ended = completion(child)
  const abort = () => child.kill()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, timeoutMs)
  try {
    child.stdin.on('error', () => {})
    child.stdin.end(input)
    let size = 0
    const chunks = []
    for await (const chunk of child.stdout) {
      size += chunk.length
      if (size > outputLimit) {
        child.kill()
        throw new Error('远端响应超过大小限制')
      }
      chunks.push(chunk)
    }
    const { code, error } = await ended
    options.signal?.throwIfAborted()
    if (error?.code === 'ENOENT') throw new Error('本机找不到 OpenSSH 客户端 ssh')
    if (code !== 0) throw new Error(failure)
    return Buffer.concat(chunks, size).toString('utf8')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}

function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

export function parseEndpoint(output) {
  const records = output.split(/\r?\n/u).filter((line) => line.startsWith('DSH_REMOTE_V1 '))
  try {
    if (records.length !== 1) throw new Error()
    const record = JSON.parse(records[0].slice('DSH_REMOTE_V1 '.length))
    if (record.protocol !== 1 || !Number.isInteger(record.port) || record.port < 1024 ||
        record.port > 65535 || !/^[a-zA-Z0-9_-]{16,256}$/.test(record.token) ||
        !/^[0-9a-f-]{36}$/.test(record.instance) || typeof record.dshVersion !== 'string') throw new Error()
    return /** @type {Endpoint} */ (record)
  } catch {
    throw new Error('远端握手无效或协议版本不兼容')
  }
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function startTunnel(options, args, remotePort) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    options.signal?.throwIfAborted()
    const port = await freePort()
    options.signal?.throwIfAborted()
    const child = spawn('ssh', [
      ...args, '-N', '-v', '-o', 'ExitOnForwardFailure=yes', '-o', 'GatewayPorts=no',
      '-L', '127.0.0.1:' + port + ':127.0.0.1:' + remotePort, options.host,
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: { ...process.env, LC_ALL: 'C' } })
    const ended = completion(child)
    let collision = false
    let lastError = ''
    let ready = false
    const abort = () => child.kill()
    options.signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 90_000)
    const listening = new Promise((resolve) => {
      const messages = createInterface({ input: child.stderr })
      messages.on('line', (line) => {
        if (line.includes('Local forwarding listening on 127.0.0.1 port ' + port + '.')) ready = true
        if (line.includes('Entering interactive session')) resolve(ready)
        if (line.includes('Address already in use')) collision = true
        if (/^(ssh: |Permission denied|.*Host key verification failed)/.test(line)) lastError = line
      })
      void ended.then(() => resolve(false))
    })
    void ended.then(() => options.signal?.removeEventListener('abort', abort))
    const ok = await listening
    clearTimeout(timeout)
    if (ok && !options.signal?.aborted) return { port, ended, close: abort }
    abort()
    await ended
    options.signal?.throwIfAborted()
    if (!collision) throw new Error('SSH 转发建立失败' + (lastError ? '。' + lastError : ''))
  }
  throw new Error('本地 SSH 转发端口正在被占用')
}

/** Opens an authenticated DSH entry URL. The owner must close the tunnel when finished.
 * @param {ConnectionOptions} options
 */
export async function connect(options) {
  const args = sshArguments(options)
  const endpoint = await bootstrap(options, args)
  // Bind the tunnel and forward over the very same resolved SSH target.
  const tunnel = await startTunnel(options, args, endpoint.port)
  const browserUrl = new URL('http://127.0.0.1:' + tunnel.port + '/')
  browserUrl.searchParams.set('token', endpoint.token)
  try {
    const signal = AbortSignal.timeout(6000)
    const response = await fetch(browserUrl, {
      redirect: 'manual',
      signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
    })
    await response.body?.cancel()
    if (response.status !== 303 || !response.headers.has('set-cookie')) throw new Error()
  } catch {
    tunnel.close()
    options.signal?.throwIfAborted()
    throw new Error('SSH 隧道无法访问远端 DSH Host，请检查 sshd 的 TCP 转发权限')
  }
  return {
    origin: browserUrl.origin, browserUrl: browserUrl.href, instance: endpoint.instance,
    dshVersion: endpoint.dshVersion, close: tunnel.close, ended: tunnel.ended,
  }
}

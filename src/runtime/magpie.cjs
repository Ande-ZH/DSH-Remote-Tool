const { spawn, spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { mkdir, readFile, writeFile, rename, rm, chmod, stat } = require('node:fs/promises')
const { homedir } = require('node:os')
const { join, isAbsolute } = require('node:path')
const { setTimeout: pause } = require('node:timers/promises')
const { loopback } = require('../magpie/loopback.cjs')

const version = '0.1.4539'
const releases = {
  x64: 'amd64',
  arm64: 'arm64',
}
async function json(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error; return {} }
}
function validPort(value) { return Number.isInteger(value) && value > 0 && value <= 65535 }
async function configuredPort(override, fallback = 3425) {
  if (override !== undefined) {
    if (!validPort(override)) throw new Error('Magpie 端口须为 1–65535')
    return override
  }
  const xdg = process.env.XDG_CONFIG_HOME
  const directory = isAbsolute(xdg || '') ? xdg : join(homedir(), '.config')
  const settings = await json(join(directory, 'magpie', 'settings.json'))
  return validPort(settings.port) ? settings.port : validPort(fallback) ? fallback : 3425
}
async function probe(port) {
  try {
    const { status, data } = await loopback(new URL('http://127.0.0.1:' + port + '/api/hello'), { timeoutMs: 1500 })
    if (status !== 200 || data?.name !== 'magpie' || typeof data.version !== 'string') {
      throw new Error('Magpie 端口被其他服务占用')
    }
    return data
  } catch (error) {
    if (error.code === 'ECONNREFUSED') return null
    throw error
  }
}
function execute(bin, args, env = process.env) {
  return spawnSync(bin, args, { env, encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'pipe'] })
}
async function install(root) {
  const release = releases[process.arch]
  if (!release) throw new Error('Magpie 自动安装支持 Linux amd64 和 arm64')
  const directory = join(root, 'magpie-' + version)
  const bin = join(directory, 'magpie')
  try {
    await stat(bin)
    if (execute(bin, ['--version']).status === 0) return bin
    throw new Error('Magpie 已安装文件无法运行，请配置 magpieBin 或修复运行时后重试')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const response = await fetch('https://github.com/yetone/magpie-releases/releases/download/v' + version + '/magpie-cli-linux-' + release, {
    signal: AbortSignal.timeout(90_000),
  })
  if (!response.ok) throw new Error('Magpie 下载失败（HTTP ' + response.status + '），可配置 magpieBin 使用预装文件')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 160 * 1024 * 1024) throw new Error('Magpie 下载超过大小限制')
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = bin + '.' + randomUUID()
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o700 })
    await chmod(temporary, 0o700)
    await rename(temporary, bin)
  } finally { await rm(temporary, { force: true }) }
  return bin
}
// Called while the Host bootstrap lock is held. Never takes ownership of an existing gateway.
async function prepareMagpie(root, settings, override) {
  if (settings.magpie === false) return { status: 'disabled' }
  const previous = await json(join(root, 'magpie-runtime.json'))
  const port = await configuredPort(override ?? settings.magpiePort, previous.port)
  const running = await probe(port)
  if (running) return { status: 'ready', port, version: running.version, reused: true }
  const env = { ...process.env, PATH: [process.env.PATH, join(homedir(), '.local/bin')].filter(Boolean).join(':') }
  let bin = settings.magpieBin
  if (bin !== undefined && (typeof bin !== 'string' || !isAbsolute(bin))) throw new Error('magpieBin 须为绝对路径')
  if (!bin) {
    const existing = execute('magpie', ['--version'], env)
    bin = existing.status === 0 ? execute('sh', ['-c', 'command -v magpie'], env).stdout.trim() : await install(root)
  }
  if (execute(bin, ['--version'], env).status !== 0) throw new Error('Magpie 可执行文件无法运行')
  // The same executable is used for model controls; credentials remain in Magpie's own config.
  const state = join(root, 'magpie-runtime.json')
  const temporary = state + '.' + randomUUID()
  try {
    await writeFile(temporary, JSON.stringify({ bin, port }) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, state)
  } finally { await rm(temporary, { force: true }) }
  env.MAGPIE_ADDR = '127.0.0.1:' + port
  const args = ['-n', '-F', join(root, 'magpie.lock'), bin, 'serve']
  let started = false
  if (execute('systemctl', ['--user', 'show-environment']).status === 0) {
    started = execute('systemd-run', ['--user', '--quiet', '--collect', '--unit=dsh-remote-magpie',
      '--property=Restart=on-failure', '--property=RestartSec=3',
      '--setenv=HOME=' + homedir(),
      '--setenv=MAGPIE_ADDR=' + env.MAGPIE_ADDR,
      '--setenv=PATH=' + env.PATH,
      ...(process.env.XDG_CONFIG_HOME ? ['--setenv=XDG_CONFIG_HOME=' + process.env.XDG_CONFIG_HOME] : []),
      'flock', ...args], env).status === 0
  }
  if (!started) {
    const child = spawn('flock', args, { env, detached: true, stdio: 'ignore' })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref()
  }
  for (let i = 0; i < 40; i++) {
    const ready = await probe(port)
    if (ready) return { status: 'ready', port, version: ready.version, reused: false }
    await pause(250)
  }
  throw new Error('Magpie 未就绪，请检查服务状态后重新连接')
}
module.exports = { prepareMagpie, configuredPort, probe, releases, version }

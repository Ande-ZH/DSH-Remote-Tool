'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { createInterface } = require('node:readline')
const { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { basename, dirname, join } = require('node:path')
const { randomUUID } = require('node:crypto')
const { setTimeout: pause } = require('node:timers/promises')

const { loopback } = require('./magpie/loopback.cjs')
const { prepareMagpie } = require('./runtime/magpie.cjs')

const protocol = 1
const dshVersion = '0.2.2-rc.1'
const pnpmVersion = '11.25.0'
const root = join(homedir(), '.local', 'share', 'dsh-remote')
const dshHome = join(root, 'data')
const readyFile = join(root, 'ready.json')
const runLock = join(root, 'runtime.lock')
const dshLock = join(root, 'dsh.lock')
const bootstrapLock = join(root, 'bootstrap.lock')
const configFile = join(root, 'config.json')
const unit = 'dsh-remote-v1.service'

function writePrivate(path, value) {
  const temporary = path + '.' + randomUUID()
  try {
    writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function processStart(pid) {
  try {
    const stat = readFileSync('/proc/' + pid + '/stat', 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    if (fields[0] !== 'Z') return fields[19]
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error
  }
}

function execute(file, args, timeout) {
  return spawnSync(file, args, { timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function verifiedVersion(bin, version) {
  const result = execute(bin, ['--version'], 20_000)
  return result.status === 0 && result.stdout.trim() === version
}

function configuredExecutable(bin, label, version) {
  if (typeof bin !== 'string' || !bin.startsWith('/') || !verifiedVersion(bin, version) ||
      (label === 'pnpm' && basename(bin) !== 'pnpm')) {
    throw new Error('config.json 的 ' + label + 'Bin 须指向可执行的 ' + label + ' ' + version)
  }
  return bin
}

function installTools(directory, packages) {
  const binPath = (prefix, bin) => join(prefix, 'node_modules', '.bin', bin)
  const verified = (prefix) => packages.every(({ bin, version }) => verifiedVersion(binPath(prefix, bin), version))
  if (verified(directory)) return
  if (statSync(directory, { throwIfNoEntry: false })) {
    throw new Error('运行时目录已存在但版本检查失败，请检查 ' + directory)
  }

  const staging = join(root, 'install-' + randomUUID())
  mkdirSync(staging, { mode: 0o700 })
  try {
    const result = execute('npm', [
      'install', '--prefix', staging, '--no-audit', '--no-fund',
      '--fetch-retries=0', '--fetch-timeout=25000',
      ...packages.map(({ name, version }) => name + '@' + version),
    ], 600_000)
    if (result.status !== 0 || !verified(staging)) {
      throw new Error('无法准备远端 DSH 或 pnpm，请检查 npm、网络和磁盘空间，或配置离线运行时路径')
    }
    renameSync(staging, directory)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function prepareRuntime() {
  const settings = readJson(configFile) ?? {}
  const dshPackage = { name: '@deepseek-ai/dsh', bin: 'dsh', version: dshVersion }
  const pnpmPackage = { name: 'pnpm', bin: 'pnpm', version: pnpmVersion }
  const parts = [
    ...(settings.dshBin === undefined ? ['dsh-' + dshVersion] : []),
    ...(settings.pnpmBin === undefined ? ['pnpm-' + pnpmVersion] : []),
  ]
  const directory = join(root, 'runtime-' + parts.join('-'))
  const dshBin = settings.dshBin === undefined
    ? join(directory, 'node_modules', '.bin', 'dsh')
    : configuredExecutable(settings.dshBin, 'dsh', dshVersion)
  const pnpmBin = settings.pnpmBin === undefined
    ? join(directory, 'node_modules', '.bin', 'pnpm')
    : configuredExecutable(settings.pnpmBin, 'pnpm', pnpmVersion)
  const missing = [
    ...(settings.dshBin === undefined ? [dshPackage] : []),
    ...(settings.pnpmBin === undefined ? [pnpmPackage] : []),
  ]
  if (missing.length) installTools(directory, missing)
  return { dshBin, pnpmBin }
}

function isLocked(path) {
  const result = execute('flock', ['-n', '-E', '73', path, 'true'], 4000)
  if (result.status === 0) return false
  if (result.status === 73) return true
  throw new Error('远端无法获取运行锁，请检查 util-linux/flock 和数据目录权限')
}

function serve(bin, pnpmBin) {
  const instance = randomUUID()
  // The DSH process owns this separate lock even if its supervisor crashes.
  const child = spawn('flock', [
    '-n', '-F', dshLock, bin, '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open',
  ], {
    cwd: homedir(),
    env: {
      ...process.env,
      PATH: [dirname(process.execPath), dirname(pnpmBin), process.env.PATH || ''].join(':'),
      DSH_HOME: dshHome,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const output = createInterface({ input: child.stdout })
  let stopping = false
  let ready = false
  let killTimer
  function stop() {
    if (stopping) return
    stopping = true
    child.kill('SIGTERM')
    killTimer = setTimeout(() => child.kill('SIGKILL'), 8000)
    killTimer.unref()
  }
  const startupTimer = setTimeout(stop, 40_000)
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  output.on('line', (line) => {
    if (ready || stopping || !line.startsWith('dsh web: http://127.0.0.1:')) return
    try {
      const url = new URL(line.slice('dsh web: '.length))
      const token = url.searchParams.get('token')
      const childStart = processStart(child.pid)
      if (url.hostname !== '127.0.0.1' || !url.port || !token || !childStart) return
      writePrivate(readyFile, {
        protocol, dshVersion, port: Number(url.port), token, instance,
        pid: process.pid, childPid: child.pid, childStart,
      })
      ready = true
      clearTimeout(startupTimer)
    } catch {
      stop()
    }
  })
  child.on('error', () => {
    clearTimeout(startupTimer)
    process.exitCode = 1
  })
  child.on('close', () => {
    clearTimeout(startupTimer)
    clearTimeout(killTimer)
    if (readJson(readyFile)?.instance === instance) rmSync(readyFile, { force: true })
    process.exitCode = ready && stopping ? 0 : 1
  })
}

async function currentEndpoint() {
  const record = readJson(readyFile)
  if (!record || record.protocol !== protocol || record.dshVersion !== dshVersion ||
      typeof record.childStart !== 'string' ||
      processStart(record.childPid) !== record.childStart) return
  const url = new URL('http://127.0.0.1:' + record.port + '/')
  url.searchParams.set('token', record.token)
  const response = await loopback(url, { timeoutMs: 1000 }).catch(() => null)
  if (!response) return
  if (response.status === 303 && response.headers['set-cookie']) {
    const { port, token, instance } = record
    return { protocol, dshVersion, port, token, instance }
  }
}

async function waitUntilReady() {
  const started = Date.now()
  while (Date.now() - started < 45_000) {
    const record = await currentEndpoint()
    if (record) return record
    if (Date.now() - started > 6000 && !isLocked(runLock) && !isLocked(dshLock)) break
    await pause(250)
  }
  throw new Error('远端 DSH Host 未就绪，请检查远端 DSH Web 配置、Node 版本及用户服务状态')
}

function start({ dshBin, pnpmBin }) {
  const args = ['-n', '-F', runLock, process.execPath, __filename, 'serve', dshBin, pnpmBin]
  // Only create the transient user service when it is usable. Keep SSH and
  // model credentials out of the service arguments and obtain model keys in DSH.
  if (execute('systemctl', ['--user', 'show-environment'], 3000).status === 0) {
    const service = execute('systemd-run', [
      '--user', '--quiet', '--collect', '--unit=' + unit,
      '--setenv=HOME=' + homedir(),
      ...(process.env.XDG_CONFIG_HOME ? ['--setenv=XDG_CONFIG_HOME=' + process.env.XDG_CONFIG_HOME] : []),
      '--property=Type=exec', '--property=Restart=on-failure', '--property=RestartSec=3',
      'flock', ...args,
    ], 6000)
    if (service.status === 0) return
    const active = execute('systemctl', ['--user', 'show', '-p', 'ActiveState', '--value', unit], 3000)
    if (['active', 'activating'].includes(active.stdout?.trim())) return
  }
  const child = spawn('flock', args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (process.platform !== 'linux' || major < 24 || (major === 24 && minor < 9)) {
    throw new Error('远程主机需要 Linux 与 Node.js 24.9 或更新版本')
  }
  process.umask(0o077)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  const mode = process.argv[2]
  if (mode === 'serve') return serve(process.argv[3], process.argv[4])
  if (mode === 'connect') {
    const child = spawn('flock', [
      '-w', '1200', '-F', bootstrapLock, process.execPath, __filename, 'locked-connect', ...process.argv.slice(3),
    ], { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', () => {
      console.error('远端需要 util-linux 的 flock')
      process.exitCode = 1
    })
    child.on('exit', (code) => { process.exitCode = code ?? 1 })
    return
  }
  if (mode !== 'locked-connect') throw new Error('未知远程操作')

  if (!isLocked(runLock) && !isLocked(dshLock)) {
    rmSync(readyFile, { force: true })
    mkdirSync(dshHome, { mode: 0o700, recursive: true })
    start(prepareRuntime())
  }
  const endpoint = await waitUntilReady()
  try {
    endpoint.magpie = await prepareMagpie(root, readJson(configFile) ?? {}, process.argv[3] ? Number(process.argv[3]) : undefined)
  } catch (error) {
    endpoint.magpie = { status: 'error', error: error.code ? 'Magpie 安装或启动失败，请检查网络和权限后重新连接' : error.message }
  }
  process.stdout.write('DSH_REMOTE_V1 ' + JSON.stringify(endpoint) + '\n')
}

main().catch((error) => {
  console.error('dsh-remote: ' + error.message)
  process.exitCode = 1
})

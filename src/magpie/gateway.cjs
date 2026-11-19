const { execFile } = require('node:child_process')
const { readFile, stat } = require('node:fs/promises')
const { homedir, userInfo } = require('node:os')
const { dirname, isAbsolute, join } = require('node:path')
const { promisify } = require('node:util')
const { loopback } = require('./loopback.cjs')

const run = promisify(execFile)
const levels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const defaultKey = 'magpie-dsh-remote-tool'
const { configuredPort } = require('../runtime/magpie.cjs')

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    if (error instanceof SyntaxError) throw new Error('远端 Magpie 设置文件格式无效')
    throw error
  }
}

function integer(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function exactModelId(id) {
  return typeof id === 'string' && id.length <= 512 && /^[^/\s*?\x00-\x1f]+\/[^\s*?\x00-\x1f]+$/u.test(id)
}

function parseModel(row) {
  const { id, kind, owned_by, display_name, reasoning, reasoning_levels, context_window, max_output_tokens, modalities } = row ?? {}
  if (typeof id !== 'string' || !id.trim() || id.length > 512 || /[\x00-\x1f\x7f]/u.test(id) ||
      (kind && kind !== 'chat')) return
  return {
    id,
    name: typeof display_name === 'string' ? display_name : id,
    provider: typeof owned_by === 'string' ? owned_by : 'Magpie',
    contextWindow: integer(context_window),
    maxTokens: integer(max_output_tokens),
    input: ['text', ...(Array.isArray(modalities) && modalities.includes('image') ? ['image'] : [])],
    reasoning: typeof reasoning === 'boolean' ? reasoning : undefined,
    reasoningLevels: Array.isArray(reasoning_levels) ? [...new Set(reasoning_levels.filter(level => levels.has(level)))] : [],
    canToggle: exactModelId(id) && !id.startsWith('-'),
  }
}

async function fetchJson(url, options = {}) {
  const { status, data } = await loopback(url, options)
  if (status === 401 || status === 403) throw new Error('Magpie 拒绝访问。请在远端配置可用的网关密钥。')
  if (status < 200 || status >= 300) throw new Error('Magpie HTTP ' + status)
  if (!data || typeof data !== 'object') throw new Error('Magpie 返回的响应格式无效')
  return data
}

async function openGateway(portOverride, keyPath) {
  const root = join(homedir(), '.local/share/dsh-remote')
  const runtime = await readJsonFile(join(root, 'magpie-runtime.json'))
  const settings = await readJsonFile(join(root, 'config.json'))
  const port = await configuredPort(portOverride ?? settings.magpiePort, runtime.port)

  const origin = new URL('http://127.0.0.1:' + port)
  const hello = await fetchJson(new URL('/api/hello', origin)).catch(() => {
    throw new Error('未找到远端 Magpie。请确认网关正在运行并监听回环端口 ' + port + '。')
  })
  if (hello.name !== 'magpie' || typeof hello.version !== 'string') {
    throw new Error('远端端口 ' + port + ' 返回的服务不是 Magpie')
  }

  let key = defaultKey
  try {
    const details = await stat(keyPath)
    if (!details.isFile() || (details.mode & 0o077) !== 0 || details.uid !== userInfo().uid) {
      throw new Error('远端 magpie-key 必须仅由当前 SSH 用户读取')
    }
    key = (await readFile(keyPath, 'utf8')).trim()
    if (!key || !/^[!-~]{1,512}$/.test(key)) throw new Error('远端 magpie-key 格式无效')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  return {
    origin, port, version: hello.version, key,
    async models() {
      const result = await fetchJson(new URL('/v1/models', origin), { headers: { Authorization: 'Bearer ' + key } })
      if (!Array.isArray(result.data)) throw new Error('Magpie 模型目录格式无效')
      const models = new Map()
      for (const row of result.data) {
        const model = parseModel(row)
        if (model && !models.has(model.id)) models.set(model.id, model)
      }
      return [...models.values()]
    },
  }
}

async function magpie(args) {
  const env = { ...process.env, PATH: [process.env.PATH, join(homedir(), '.local', 'bin')].filter(Boolean).join(':') }
  const runtime = await readJsonFile(join(homedir(), '.local/share/dsh-remote/magpie-runtime.json'))
  return run(runtime.bin || 'magpie', args, { env, timeout: 5500, maxBuffer: 512 * 1024 })
}

async function nativeControls(gateway) {
  try {
    const { stdout } = await magpie(['status', '--json', '--addr', gateway.origin.host])
    const info = JSON.parse(stdout)
    // A Docker port can serve the catalog but its PID and config do not belong to the host CLI.
    if (!info.running || !info.started || info.version !== gateway.version || !integer(info.pid) || !isAbsolute(info.file)) return
    const proc = await stat('/proc/' + info.pid)
    if (proc.uid !== userInfo().uid) return
    const settingsPath = join(dirname(info.file), 'settings.json')
    return {
      async disabled() {
        const settings = await readJsonFile(settingsPath)
        if (!Array.isArray(settings.disabledModels)) return []
        return settings.disabledModels.filter(id => typeof id === 'string').map(id => ({
          id, canToggle: exactModelId(id) && !id.startsWith('-'),
        }))
      },
      async setEnabled(id, enabled) {
        try {
          await magpie(['model', enabled ? 'enable' : 'disable', id])
        } catch {
          throw new Error('远端 Magpie 拒绝修改模型状态。请确认当前版本支持 magpie model enable / disable。')
        }
      },
    }
  } catch {
    // The catalogue and DSH sync also work on installations without a matching native CLI.
  }
}

module.exports = { openGateway, nativeControls, exactModelId }

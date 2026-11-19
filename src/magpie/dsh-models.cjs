const { randomUUID } = require('node:crypto')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')
const { loopback } = require('./loopback.cjs')

const namespace = 'llm-pi-ai'
const routeId = 'dsh-remote-magpie'
const credential = 'DSH_REMOTE_MAGPIE_API_KEY'
const providerPath = ['providers', routeId]

async function openDsh(root, instance) {
  let ready
  try {
    ready = JSON.parse(await readFile(join(root, 'ready.json'), 'utf8'))
  } catch {
    throw new Error('远程 DSH Host 未就绪，请先连接工作区。')
  }
  if (!instance || ready.instance !== instance || ready.protocol !== 1 ||
      !Number.isInteger(ready.port) || ready.port < 1024 || ready.port > 65535 ||
      typeof ready.token !== 'string' || !/^[a-zA-Z0-9_-]{16,256}$/.test(ready.token)) {
    throw new Error('远程 DSH Host 已更换，请重新连接设备。')
  }
  const base = new URL('http://127.0.0.1:' + ready.port)
  const login = new URL('/', base)
  login.searchParams.set('token', ready.token)
  const response = await loopback(login, { timeoutMs: 3500 })
  const cookie = response.headers['set-cookie']?.map(value => value.split(';', 1)[0]).join('; ')
  if (response.status !== 303 || !cookie) throw new Error('远程 DSH Host 身份验证失败，请重新连接。')

  return async function call(method, args = {}) {
    const result = await loopback(new URL('/api/' + method, base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      timeoutMs: 4000,
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }),
    })
    if (result.status < 200 || result.status >= 300) {
      throw new Error('远程 DSH 设置接口不可用（HTTP ' + result.status + '）')
    }
    const reply = result.data?.result
    if (reply?.ok) return reply.value
    if (reply?.error?.code === 'settings/conflict') throw new Error('远程 DSH 设置已变更，请刷新后重试。')
    throw new Error('远程 DSH 无法执行 ' + method + '。请检查 Host 版本和模型设置。')
  }
}

async function snapshot(call) {
  const description = await call('settings/describe')
  const view = description?.namespaces?.find(entry => entry.ns === namespace)
  if (!description?.writable || !view || !Number.isInteger(view.revision)) {
    throw new Error('远程 DSH 的自定义模型设置不可写。')
  }
  const provider = view.value?.providers?.[routeId]
  if (view.base?.providers?.[routeId] !== undefined || (provider && provider.apiKeyEnv !== credential)) {
    throw new Error('远程 DSH 已有同名提供方，请先在模型设置中处理冲突。')
  }
  return { revision: view.revision, provider }
}

function dshModel(model) {
  const { id, name, contextWindow, maxTokens, input, reasoning, reasoningLevels } = model
  return {
    id, name, input,
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens: Math.min(maxTokens, contextWindow ?? maxTokens) } : {}),
    ...(reasoning === false ? { reasoningEfforts: false } : reasoningLevels.length ? {
      reasoningEfforts: Object.fromEntries(reasoningLevels.map(level => [level, level === 'off' ? null : level])),
    } : {}),
  }
}

async function listDshModels(root, instance) {
  if (!instance) return { available: false, selected: [] }
  try {
    const call = await openDsh(root, instance)
    const { provider } = await snapshot(call)
    return { available: true, selected: provider?.models?.map(model => model.id) ?? [] }
  } catch (error) {
    return { available: false, selected: [], error: error.message }
  }
}

async function syncDshModels(root, instance, gateway, models) {
  const call = await openDsh(root, instance)
  const { revision, provider } = await snapshot(call)
  if (!models.length && !provider) return
  const op = models.length ? {
    op: 'set', path: providerPath,
    value: {
      displayName: 'Magpie · 远程网关',
      api: 'openai-completions',
      baseURL: new URL('/v1', gateway.origin).href,
      apiKeyEnv: credential,
      models: models.map(dshModel),
    },
  } : { op: 'unset', path: providerPath }
  if (models.length) await call('credentials/set', { ref: credential, value: gateway.key })
  await call('settings/mutate', { ns: namespace, expectedRevision: revision, ops: [op] })
}

module.exports = { listDshModels, syncDshModels }

const { homedir } = require('node:os')
const { join } = require('node:path')
const { openGateway, nativeControls, exactModelId } = require('./gateway.cjs')
const { listDshModels, syncDshModels } = require('./dsh-models.cjs')

async function manage(request) {
  const root = join(homedir(), '.local', 'share', 'dsh-remote')
  const gateway = await openGateway(request.port, join(root, 'magpie-key'))
  const [models, controls] = await Promise.all([gateway.models(), nativeControls(gateway)])
  if (request.operation === 'sync') {
    const byId = new Map(models.map(model => [model.id, model]))
    const selection = request.models.map(id => byId.get(id))
    if (selection.some(model => !model)) throw new Error('部分模型已从 Magpie 目录移除，请刷新后重新选择。')
    await syncDshModels(root, request.instance, gateway, selection)
  }
  if (request.operation === 'setEnabled') {
    if (!controls) throw new Error('启停模型需要与网关共用配置的原生 Magpie CLI。')
    const { model, enabled } = request
    if (!exactModelId(model) || model.startsWith('-') || typeof enabled !== 'boolean') throw new Error('模型 ID 无效。')
    const disabled = await controls.disabled()
    const candidates = enabled ? disabled : models
    const match = candidates.find(candidate => candidate.id === model && candidate.canToggle)
    if (!match) {
      const effective = enabled ? models : disabled
      if (!effective.some(candidate => candidate.id === model && candidate.canToggle)) {
        throw new Error('模型已不在当前目录，请刷新后再操作。')
      }
    } else {
      await controls.setEnabled(model, enabled)
    }
    return catalog(gateway, controls, await gateway.models(), root, request.instance)
  }
  return catalog(gateway, controls, models, root, request.instance)
}

async function catalog(gateway, controls, models, root, instance) {
  const [disabled, dsh] = await Promise.all([
    controls?.disabled().catch(() => null) ?? null,
    listDshModels(root, instance),
  ])
  return {
    version: gateway.version, port: gateway.port, models, disabled: disabled ?? [],
    canManage: disabled !== null, dsh,
  }
}

async function replyToMagpie(request) {
  let reply
  try {
    reply = { ok: true, value: await manage(request) }
  } catch (error) {
    reply = { ok: false, error: error.code ? '远端 Magpie 或配置暂不可用。' : error.message }
  }
  process.stdout.write('DSH_REMOTE_MAGPIE_V1 ' + JSON.stringify(reply) + '\n')
}

module.exports = { replyToMagpie }

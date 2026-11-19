import { readFile } from 'node:fs/promises'
import { runSshCommand } from '../client.mjs'

const remoteProgram = new URL('../../dist/magpie-agent.cjs', import.meta.url)
const marker = 'DSH_REMOTE_MAGPIE_V1 '

function modelId(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512
}

export function magpieRequest(action, device, instance) {
  const request = { operation: action.operation, port: device.magpiePort, instance }
  if (action.operation === 'list') return request
  if (action.operation === 'setEnabled') {
    if (!modelId(action.model) || typeof action.enabled !== 'boolean') throw new Error('模型操作无效')
    return { ...request, model: action.model, enabled: action.enabled }
  }
  if (action.operation === 'sync') {
    if (!instance) throw new Error('请先连接远程 DSH Host')
    if (!Array.isArray(action.models) || action.models.length > 1000 || !action.models.every(modelId)) {
      throw new Error('模型选择无效')
    }
    return { ...request, models: [...new Set(action.models)] }
  }
  throw new Error('未知的 Magpie 操作')
}

export async function manageMagpie({ device, instance, signal }, action) {
  const request = magpieRequest(action, device, instance)
  const source = await readFile(remoteProgram, 'utf8')
  const input = source + '\nvoid module.exports.replyToMagpie(' + JSON.stringify(request) + ');\n'
  const output = await runSshCommand({ host: device.host, port: device.port, batch: true, signal }, 'node -', input, {
    timeoutMs: 32_000, outputLimit: 3 * 1024 * 1024,
    failure: '无法执行远端 Magpie 操作，请检查 SSH 登录和远端 Node.js。',
  })
  const lines = output.split(/\r?\n/u).filter(line => line.startsWith(marker))
  if (lines.length !== 1) throw new Error('远端 Magpie 返回的响应无法识别')
  const reply = JSON.parse(lines[0].slice(marker.length))
  if (!reply.ok) throw new Error(reply.error || '远端 Magpie 操作失败')
  return reply.value
}

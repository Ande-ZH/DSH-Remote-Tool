import { homedir } from 'node:os'
import { join } from 'node:path'
import { deviceService } from './services.mjs'

export { deviceService }
export const name = 'dsh-shared-remote'
export const inject = ['connection']
const route = '/api/dsh-shared-remote/devices'

export function apply(ctx) {
  const directory = join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), name)
  const service = deviceService(directory)
  ctx.effect(() => () => service.close(), name + ': tunnels')
  ctx.connection.fetch.register({
    path: route,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const action = request.method === 'GET' ? undefined : await request.json()
        if (request.method === 'POST' && (!action || typeof action !== 'object' || typeof action.type !== 'string')) {
          throw new Error('无效请求')
        }
        return Response.json(await service.run(action, request.signal), { headers: { 'Cache-Control': 'no-store' } })
      } catch (error) {
        const message = error.code ? '设备配置或 SSH 客户端暂不可用' : error.message
        return Response.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
      }
    },
  })
}

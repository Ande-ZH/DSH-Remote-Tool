import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect, sshArguments } from './client.mjs'
import { manageMagpie } from './magpie/service.mjs'

export function deviceService(directory, openConnection = connect, magpieOperation = manageMagpie) {
  const file = join(directory, 'devices.json')
  const connections = new Map()
  const lifetime = new AbortController()
  let operations = Promise.resolve()
  let closed = false

  async function load() {
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return []
    }
  }

  async function save(devices) {
    await mkdir(directory, { mode: 0o700, recursive: true })
    const temporary = file + '.' + randomUUID()
    try {
      await writeFile(temporary, JSON.stringify(devices, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      await rename(temporary, file)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  function disconnect(id) {
    const item = connections.get(id)
    connections.delete(id)
    item?.controller.abort()
    item?.connection?.close()
  }

  function start(device) {
    const current = connections.get(device.id)
    if (current && current.status !== 'error') return
    const item = { status: 'connecting', controller: new AbortController() }
    connections.set(device.id, item)
    const signal = item.controller.signal
    void openConnection({ host: device.host, port: device.port, batch: true, signal }).then((connection) => {
      if (signal.aborted) { connection.close(); return }
      item.status = 'connected'
      item.connection = connection
      void connection.ended.then(() => {
        if (connections.get(device.id) !== item) return
        item.status = 'error'
        item.error = 'SSH 隧道已断开。请重新连接同一设备。'
        item.connection = undefined
      })
    }).catch((error) => {
      if (signal.aborted) return
      item.status = 'error'
      item.error = error.message
    })
  }

  function display(devices) {
    return {
      devices: devices.map((device) => {
        const connection = connections.get(device.id)
        return { ...device, status: connection?.status ?? 'disconnected', error: connection?.error }
      }),
    }
  }

  async function handle(action) {
    if (closed) throw new Error('插件已停用')
    const devices = await load()
    if (closed) throw new Error('插件已停用')
    if (!action) return display(devices)
    if (action.type === 'save') {
      const label = typeof action.label === 'string' ? action.label.trim() : ''
      const host = typeof action.host === 'string' ? action.host.trim() : ''
      const port = action.port
      const magpiePort = action.magpiePort
      if (!label || label.length > 80 || host.length > 300) throw new Error('请填写有效的设备名称和 SSH 地址')
      sshArguments({ host, port, batch: true })
      if (magpiePort !== undefined && (!Number.isInteger(magpiePort) || magpiePort < 1 || magpiePort > 65535)) {
        throw new Error('Magpie 端口须为 1–65535')
      }
      const existing = action.id === undefined ? undefined : devices.find((item) => item.id === action.id)
      if (action.id !== undefined && !existing) throw new Error('设备不存在')
      if (!existing && devices.length >= 50) throw new Error('最多可保存 50 台设备')
      if (devices.some((item) => item.id !== existing?.id && item.host === host && item.port === port)) {
        throw new Error('同一 SSH 地址已经保存')
      }
      const device = {
        id: existing?.id ?? randomUUID(), label, host,
        ...(port === undefined ? {} : { port }),
        ...(magpiePort === undefined ? {} : { magpiePort }),
      }
      await save(existing ? devices.map((item) => item.id === device.id ? device : item) : [...devices, device])
      if (existing && (existing.host !== host || existing.port !== port)) disconnect(existing.id)
      return { id: device.id }
    }
    const device = devices.find((item) => item.id === action.id)
    if (!device) throw new Error('设备不存在')
    switch (action.type) {
      case 'connect':
        start(device)
        return display(devices)
      case 'disconnect':
        disconnect(device.id)
        return display(devices)
      case 'remove':
        await save(devices.filter((item) => item.id !== device.id))
        disconnect(device.id)
        return { ok: true }
      case 'entry': {
        const connection = connections.get(device.id)?.connection
        if (!connection) throw new Error('请先连接远端 Host')
        return { browserUrl: connection.browserUrl, instance: connection.instance }
      }
      case 'magpie':
        return { device, connection: connections.get(device.id) }
      default:
        throw new Error('未知设备操作')
    }
  }

  return {
    run(action, signal) {
      const result = operations.then(() => handle(action))
      operations = result.catch(() => {})
      if (action?.type === 'magpie') {
        return result.then(({ device, connection }) => {
          const signals = [lifetime.signal]
          if (signal) signals.push(signal)
          if (action.operation === 'sync' && connection) signals.push(connection.controller.signal)
          return magpieOperation({
            device, instance: connection?.connection?.instance, signal: AbortSignal.any(signals),
          }, action)
        })
      }
      return result
    },
    close() {
      closed = true
      lifetime.abort()
      for (const id of connections.keys()) disconnect(id)
      return operations
    },
  }
}

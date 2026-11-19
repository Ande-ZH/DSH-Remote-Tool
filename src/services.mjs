import { deviceService as createDevices } from './devices.mjs'
import { manageMagpie } from './magpie/service.mjs'

// Composition owns feature dispatch; device storage and transport do not depend on Magpie.
export function deviceService(directory, openConnection, magpieOperation = manageMagpie) {
  const devices = createDevices(directory, openConnection)
  return {
    run(action, signal) {
      if (action?.type === 'target') return Promise.reject(new Error('未知设备操作'))
      if (action?.type !== 'magpie') return devices.run(action)
      return devices.run({ type: 'target', id: action.id }).then(target => {
        const signals = [target.signal]
        if (signal) signals.push(signal)
        if (action.operation === 'sync' && target.connection) signals.push(target.connection.controller.signal)
        return magpieOperation({ device: target.device, instance: target.connection?.connection?.instance,
          signal: AbortSignal.any(signals) }, action)
      })
    },
    close: () => devices.close(),
  }
}

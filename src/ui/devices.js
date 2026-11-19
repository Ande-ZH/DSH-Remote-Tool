import { useEffect, useRef, useState } from 'react'
import { api } from './common.js'

export function useDevices() {
  const [devices, setDevices] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const revision = useRef(0)

  async function refresh(signal) {
    const at = revision.current
    try {
      const data = await api(undefined, signal)
      if (!signal.aborted && at === revision.current) setDevices(data.devices)
    } catch (failure) {
      if (!signal.aborted && at === revision.current) setError(failure.message)
    }
  }

  const polling = devices.some(device => device.status === 'connecting' || device.status === 'connected')
  useEffect(() => {
    const controller = new AbortController()
    let timer
    async function poll() {
      await refresh(controller.signal)
      if (polling && !controller.signal.aborted) timer = setTimeout(poll, 1700)
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [polling])

  async function update(action) {
    revision.current += 1
    setBusy(true)
    setError('')
    try {
      const data = await api(action)
      const next = data.devices ?? (await api()).devices
      revision.current += 1
      setDevices(next)
      return true
    } catch (failure) {
      setError(failure.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return { devices, busy, error, setError, update }
}

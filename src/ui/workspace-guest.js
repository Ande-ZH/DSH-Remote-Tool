import { createElement as h, useEffect, useRef } from 'react'
import { bar } from './common.js'

export function RemoteGuest({ entry, showError }) {
  const container = useRef(null)
  const bridge = window.dshDesktop?.browser
  useEffect(() => {
    if (!bridge) return
    const viewport = container.current
    let disposed = false
    let reservation
    let guest
    async function mount() {
      reservation = await bridge.acquire('dsh-shared-remote:' + entry.deviceId)
      if (disposed) { await bridge.release(reservation.lease); return }
      const url = new URL(entry.browserUrl)
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password ||
          url.pathname !== '/' || !url.searchParams.get('token')) throw new Error('远端入口地址无效')
      guest = document.createElement('webview')
      guest.style.cssText = 'width:100%;height:100%;display:flex;'
      guest.setAttribute('aria-label', '远程 DSH 工作区')
      guest.setAttribute('partition', reservation.partition)
      guest.setAttribute('src', 'about:blank#' + reservation.lease)
      guest.addEventListener('dom-ready', () => {
        if (!disposed) Promise.resolve(guest.loadURL(url.href)).catch(() => {
          if (!disposed) showError('远端页面加载失败，请返回设备后重新打开')
        })
      }, { once: true })
      guest.addEventListener('did-fail-load', (event) => {
        if (!disposed && event.isMainFrame && event.errorCode !== -3) showError('远端页面加载失败，请检查 SSH 隧道')
      })
      viewport.append(guest)
    }
    void mount().catch(() => {
      if (!disposed) showError('无法在 Desktop 内打开远端工作区')
    })
    return () => {
      disposed = true
      guest?.remove()
      if (reservation) void bridge.release(reservation.lease).catch(() => {})
    }
  }, [entry, bridge, showError])

  if (!bridge) {
    return h('div', { style: bar },
      h('a', { href: entry.browserUrl, target: '_blank', rel: 'noreferrer noopener' }, '使用浏览器打开远端工作区'))
  }
  return h('div', { ref: container, style: { flex: 1, minHeight: 0, position: 'relative' } })
}

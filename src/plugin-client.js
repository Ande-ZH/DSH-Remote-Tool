window.__ModuleLoader__.load({
  id: 'dsh-shared-remote',
  factory(require) {
    const { createElement: h, useEffect, useRef, useState } = require('react')
    const id = 'dsh-shared-remote'
    const endpoint = '/api/dsh-shared-remote/devices'
    const empty = { label: '', host: '', port: '' }
    const statusText = { disconnected: '未连接', connecting: '连接中', connected: '已连接', error: '连接失败' }
    const pane = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }
    const bar = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 16px' }
    const buttonStyle = { cursor: 'pointer', border: '1px solid currentColor', borderRadius: 6,
      padding: '5px 10px', background: 'transparent', color: 'inherit' }

    async function api(action) {
      const response = await fetch(endpoint, {
        ...(action === undefined ? {} : {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
        }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '无法访问远程工作区插件')
      return data
    }

    function Button({ children, ...props }) {
      return h('button', {
        type: 'button', style: { ...buttonStyle, opacity: props.disabled ? 0.5 : 1 }, ...props,
      }, children)
    }

    function RemoteGuest({ entry, showError }) {
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

    function Panel() {
      const [devices, setDevices] = useState([])
      const [form, setForm] = useState(null)
      const [opening, setOpening] = useState(null)
      const [entry, setEntry] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const mounted = useRef(false)
      const pendingRefresh = useRef(false)
      const byId = (deviceId) => devices.find((device) => device.id === deviceId)
      const polling = devices.some((device) => device.status === 'connecting' || device.status === 'connected')
      const openingStatus = byId(opening)?.status
      const entryStatus = byId(entry?.deviceId)?.status

      async function refresh() {
        if (pendingRefresh.current) return
        pendingRefresh.current = true
        try {
          const data = await api()
          if (mounted.current) setDevices(data.devices)
        } catch (failure) {
          if (mounted.current) setError(failure.message)
        } finally {
          pendingRefresh.current = false
        }
      }
      useEffect(() => {
        mounted.current = true
        void refresh()
        return () => { mounted.current = false }
      }, [])
      useEffect(() => {
        if (!polling) return
        const timer = setInterval(() => void refresh(), 1700)
        return () => clearInterval(timer)
      }, [polling])
      useEffect(() => {
        if (!opening || !openingStatus || openingStatus === 'connecting') return
        if (openingStatus !== 'connected') { setOpening(null); return }
        let active = true
        void api({ type: 'entry', id: opening }).then((result) => {
          if (active) setEntry({ ...result, deviceId: opening })
        }).catch((failure) => {
          if (active) setError(failure.message)
        }).finally(() => {
          if (active) setOpening(null)
        })
        return () => { active = false }
      }, [opening, openingStatus])
      useEffect(() => {
        if (entry && entryStatus && entryStatus !== 'connected') {
          setEntry(null)
          setError(byId(entry.deviceId)?.error || 'SSH 隧道已断开，请重新连接')
        }
      }, [entry, entryStatus])

      async function update(action) {
        setBusy(true)
        setError('')
        try {
          const data = await api(action)
          if (data.devices) setDevices(data.devices)
          else setDevices((await api()).devices)
          return true
        } catch (failure) {
          setError(failure.message)
          return false
        } finally {
          setBusy(false)
        }
      }

      async function connectDevice(device) {
        if (await update({ type: 'connect', id: device.id })) setOpening(device.id)
      }

      async function saveDevice(event) {
        event.preventDefault()
        const { port, ...rest } = form
        const changed = await update({ type: 'save', ...rest, ...(port === '' ? {} : { port: Number(port) }) })
        if (changed) setForm(null)
      }

      if (entry) {
        return h('section', { style: pane },
          h('div', { style: bar },
            h(Button, { onClick: () => { setEntry(null); setError('') } }, '返回设备'),
            h('strong', null, byId(entry.deviceId)?.label),
            h(Button, { onClick: () => void update({ type: 'disconnect', id: entry.deviceId }).then((ok) => {
              if (ok) { setEntry(null); setError('') }
            }), disabled: busy }, '断开本机'),
            error && h('span', { role: 'alert' }, error)),
          h(RemoteGuest, { entry, showError: setError }))
      }

      return h('section', { style: { ...pane, overflow: 'auto', padding: 'max(18px, 2vw)', boxSizing: 'border-box' } },
        h('div', { style: { ...bar, padding: 0, justifyContent: 'space-between', maxWidth: 760 } },
          h('h2', { style: { margin: 0 } }, 'SSH 远程工作区'),
          h(Button, { onClick: () => { setForm({ ...empty }); setError('') }, disabled: busy }, '添加设备')),
        error && h('p', { role: 'alert' }, error),
        form && h('form', { onSubmit: saveDevice, style: { display: 'grid', gap: 10, maxWidth: 440, marginTop: 16 } },
          ...[
            ['label', '设备名称', '德国服务器'],
            ['host', 'SSH 别名或 user@host', 'de-vps'],
            ['port', 'SSH 端口（留空使用 SSH 配置）', '22'],
          ].map(([key, label, placeholder]) => h('label', { key, style: { display: 'grid', gap: 4 } },
            label, h('input', {
              type: key === 'port' ? 'number' : 'text',
              min: key === 'port' ? 1 : undefined, max: key === 'port' ? 65535 : undefined,
              required: key !== 'port', placeholder, value: form[key],
              onChange: (event) => setForm({ ...form, [key]: event.target.value }),
            }))),
          h('div', { style: { ...bar, padding: 0 } },
            h(Button, { type: 'submit', disabled: busy }, '保存'),
            h(Button, { onClick: () => setForm(null), disabled: busy }, '取消'))),
        !form && devices.length === 0 && h('p', null, '添加已配置密钥并验证过主机指纹的 SSH 设备。'),
        h('ul', { style: { listStyle: 'none', padding: 0, maxWidth: 760 } },
          ...devices.map((device) => h('li', { key: device.id, style: { borderBottom: '1px solid #8884', padding: '12px 0' } },
            h('div', { style: { ...bar, padding: 0 } },
              h('strong', null, device.label),
              h('code', null, device.host + (device.port ? ' · ' + device.port : '')),
              h('span', null, statusText[device.status]),
              device.status === 'connected'
                ? h(Button, { onClick: () => setOpening(device.id), disabled: busy }, '打开工作区')
                : h(Button, { onClick: () => void connectDevice(device), disabled: busy || device.status === 'connecting' }, '连接'),
              ['connected', 'connecting'].includes(device.status) &&
                h(Button, { onClick: () => { setOpening(null); void update({ type: 'disconnect', id: device.id }) }, disabled: busy }, '断开'),
              h(Button, { onClick: () => setForm({ ...device, port: String(device.port ?? '') }), disabled: busy }, '编辑'),
              h(Button, {
                onClick: () => {
                  if (window.confirm('移除这条设备配置？')) void update({ type: 'remove', id: device.id })
                }, disabled: busy,
              }, '移除')),
            device.error && h('p', { role: 'status', style: { margin: '6px 0 0' } }, device.error)))))
    }

    function Icon() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.7, 'aria-hidden': true },
      h('rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
      h('path', { d: 'M8 21h8m-4-4v4M7 8l3 3-3 3m6 0h4' }))
    }

    return {
      name: id,
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.slots ?? ctx.get('slots')
        slots.inject('sidebar.panellist', () => slots.register({
          name: 'sidebar.panellist', id, order: 45, label: () => 'SSH 远程',
        }, Icon))
        slots.inject('main', () => slots.register({ name: 'main', key: id }, Panel))
      },
    }
  },
})

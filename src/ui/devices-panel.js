import { createElement as h, useEffect, useState } from 'react'
import { api, bar, Button, pane, statusText } from './common.js'
import { useDevices } from './devices.js'
import { MagpiePanel } from './magpie-panel.js'
import { RemoteGuest } from './workspace-guest.js'

const empty = { label: '', host: '', port: '', magpiePort: '' }

export function DevicesPanel() {
  const { devices, busy, error, setError, update } = useDevices()
  const [form, setForm] = useState(null)
  const [opening, setOpening] = useState(null)
  const [entry, setEntry] = useState(null)
  const [magpieId, setMagpieId] = useState(null)
  const byId = (deviceId) => devices.find(device => device.id === deviceId)
  const openingStatus = byId(opening)?.status
  const entryStatus = byId(entry?.deviceId)?.status

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

  async function connectDevice(device) {
    if (await update({ type: 'connect', id: device.id })) setOpening(device.id)
  }

  async function saveDevice(event) {
    event.preventDefault()
    const { port, magpiePort, ...rest } = form
    const changed = await update({
      type: 'save', ...rest,
      ...(port === '' ? {} : { port: Number(port) }),
      ...(magpiePort === '' ? {} : { magpiePort: Number(magpiePort) }),
    })
    if (changed) setForm(null)
  }

  const magpieDevice = byId(magpieId)
  if (magpieDevice) {
    return h(MagpiePanel, {
      key: magpieDevice.id,
      device: magpieDevice,
      connect: () => update({ type: 'connect', id: magpieDevice.id }),
      back: () => setMagpieId(null),
    })
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
        ['magpiePort', 'Magpie 端口（留空自动检测）', '3425'],
      ].map(([key, label, placeholder]) => h('label', { key, style: { display: 'grid', gap: 4 } },
        label, h('input', {
          type: key === 'port' || key === 'magpiePort' ? 'number' : 'text',
          min: 1, max: 65535,
          required: key === 'label' || key === 'host', placeholder, value: form[key],
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
          h(Button, { onClick: () => setMagpieId(device.id) }, 'Magpie 模型'),
        h(Button, {
          onClick: () => setForm({ ...device, port: String(device.port ?? ''), magpiePort: String(device.magpiePort ?? '') }),
          disabled: busy,
        }, '编辑'),
          h(Button, {
            onClick: () => {
              if (window.confirm('移除这条设备配置？')) void update({ type: 'remove', id: device.id })
            }, disabled: busy,
          }, '移除')),
        device.error && h('p', { role: 'status', style: { margin: '6px 0 0' } }, device.error)))))
}

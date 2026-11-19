import { createElement as h, useEffect, useRef, useState } from 'react'
import { api, bar, Button, statusText } from './common.js'
import { useDevices } from './devices.js'

const header = { ...bar, padding: 0, justifyContent: 'space-between' }
const controls = { ...bar, padding: 0, margin: '12px 0' }
const list = { listStyle: 'none', padding: 0 }
const row = { ...bar, padding: '8px 0', borderBottom: '1px solid #8884' }

function useMagpie(device) {
  const [catalog, setCatalog] = useState(null)
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const active = useRef()
  const connected = device.status === 'connected'

  async function load(operation, fields, preserveSelection, message) {
    active.current?.abort()
    const request = new AbortController()
    active.current = request
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api({ type: 'magpie', id: device.id, operation, ...fields }, request.signal)
      if (active.current !== request || request.signal.aborted) return
      setCatalog(result)
      const available = new Set(result.models.map(model => model.id))
      setSelected(current => (preserveSelection ? current : result.dsh.selected).filter(id => available.has(id)))
      if (message) setNotice(message)
    } catch (failure) {
      if (active.current === request && !request.signal.aborted) setError(failure.message)
    } finally {
      if (active.current === request) setBusy(false)
    }
  }

  useEffect(() => {
    void load('list')
    return () => active.current?.abort()
  }, [device.id, device.host, device.port, device.magpiePort, connected])

  return { catalog, selected, setSelected, busy, error, notice, load }
}

function ModelRow({ model, selected, editable, busy, onSelect, onChangeState }) {
  const capabilities = [
    model.provider,
    model.contextWindow ? '上下文 ' + model.contextWindow.toLocaleString() : '',
    model.input.includes('image') ? '可读图' : '',
  ].filter(Boolean)
  return h('li', { style: row },
    h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      h('input', { type: 'checkbox', checked: selected, disabled: busy || !editable, onChange: onSelect }),
      h('strong', null, model.name)),
    h('code', null, model.id),
    h('span', null, capabilities.join(' · ')),
    onChangeState && h(Button, { disabled: busy, onClick: onChangeState }, '停用'))
}

export function MagpiePanel({ device, connect, back, connectError }) {
  const { catalog, selected, setSelected, busy, error, notice, load } = useMagpie(device)
  const [query, setQuery] = useState('')
  const isReady = catalog?.dsh.available && device.status === 'connected'
  const excluded = catalog?.dsh.selected.filter(id => !catalog.models.some(model => model.id === id)) ?? []
  const syncLabel = selected.length
    ? '同步 ' + selected.length + ' 个模型到 DSH'
    : catalog?.dsh.selected.length ? '移除 DSH 提供方' : '同步到远程 DSH'
  const needle = query.trim().toLowerCase()
  const models = catalog?.models.filter(model => [model.id, model.name, model.provider].some(value => value.toLowerCase().includes(needle)))

  const changeState = (model, enabled) => {
    const verb = enabled ? '恢复' : '停用'
    if (!enabled && !window.confirm('停用 ' + model + '？这会影响该 Magpie 网关的所有使用方。')) return
    void load('setEnabled', { model, enabled }, true, '已提交' + verb + '操作。')
  }

  function sync() {
    if (!selected.length && !window.confirm('移除远程 DSH 中由本插件管理的 Magpie 提供方？')) return
    void load('sync', { models: selected }, false, selected.length ? '模型已同步到远程 DSH 的模型选择器。' : '已移除远程 DSH 的 Magpie 提供方。')
  }

  return h('section', { style: { padding: '16px', overflow: 'auto' } },
    h('div', { style: header },
      h('h2', { style: { margin: 0 } }, 'Magpie 模型 · ' + device.label),
      back && h(Button, { onClick: back }, '返回设备')),
    h('div', { style: controls },
      h(Button, { disabled: busy, onClick: () => void load('list') }, '刷新'),
      device.status !== 'connected' && h(Button, {
        disabled: device.status === 'connecting', onClick: () => void connect(),
      }, device.status === 'connecting' ? '正在连接远程 DSH' : '连接远程 DSH'),
      h(Button, {
        disabled: busy || !isReady || (!selected.length && !catalog.dsh.selected.length),
        onClick: sync,
      }, syncLabel),
      catalog && h('span', null, '网关 · ' + catalog.version + ' · 端口 ' + catalog.port)),
    busy && h('p', { role: 'status' }, '正在联系远端主机…'),
    (error || connectError || device.error || catalog?.dsh.error) &&
      h('p', { role: 'alert' }, error || connectError || device.error || catalog.dsh.error),
    notice && h('p', { role: 'status' }, notice),
    catalog && h('div', null,
      excluded.length > 0 && h('p', null, excluded.length + ' 个已同步模型不在当前目录，重新同步可移除这些条目。'),
      h('label', null, '搜索模型 ', h('input', {
        type: 'search', value: query, onChange: event => setQuery(event.target.value), placeholder: '名称、ID 或提供方',
      })),
      models.length === 0 && h('p', null, catalog.models.length ? '没有匹配的模型。' : 'Magpie 未返回对话模型。'),
      h('ul', { style: list },
        ...models.map(model => h(ModelRow, {
          key: model.id, model, busy, editable: isReady, selected: selected.includes(model.id),
          onSelect: event => setSelected(ids => event.target.checked ? [...ids, model.id] : ids.filter(id => id !== model.id)),
          onChangeState: catalog.canManage && model.canToggle ? () => changeState(model.id, false) : null,
        }))),
      catalog.disabled.length > 0 && h('section', null,
        h('h3', null, '已停用'),
        h('ul', { style: list }, ...catalog.disabled.map(model => h('li', { key: model.id, style: row },
          h('code', null, model.id),
          model.canToggle ? h(Button, { disabled: busy, onClick: () => changeState(model.id, true) }, '恢复') : h('span', null, '在 Magpie 中管理此规则'))))),
      !catalog.canManage && h('p', null, '启停模型需要远端网关与 SSH 用户的 Magpie CLI 使用同一份配置。')))
}

export function MagpieSettings() {
  const { devices, update, error } = useDevices()
  const [deviceId, setDeviceId] = useState('')
  const device = devices.find(item => item.id === deviceId) ?? devices[0]
  if (!device) return h('p', null, error || '在「SSH 远程」添加设备后，可在这里查看和同步 Magpie 模型。')

  return h('div', null,
    h('label', null, '远程设备 ', h('select', { value: device.id, onChange: event => setDeviceId(event.target.value) },
      ...devices.map(item => h('option', { key: item.id, value: item.id }, item.label + ' · ' + statusText[item.status])))),
    h(MagpiePanel, {
      key: device.id, device, connectError: error, connect: () => update({ type: 'connect', id: device.id }),
    }))
}

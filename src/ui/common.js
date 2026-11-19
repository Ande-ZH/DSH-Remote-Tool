import { createElement as h, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
const endpoint = '/api/dsh-shared-remote/devices'

export const statusText = {
  disconnected: '未连接', connecting: '连接中', connected: '已连接', error: '连接失败',
}
export const pane = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }
export const bar = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 16px' }

export async function api(action, signal) {
  const timeout = AbortSignal.timeout(action?.type === 'magpie' ? 34_000 : 8000)
  const response = await fetch(endpoint, {
    ...(action === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '无法访问远程工作区插件')
  return data
}

export { Button, Input, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'

export function ConfirmButton({ children, title, description, onConfirm, ...props }) {
  const [open, setOpen] = useState(false)
  return h('span', null,
    h(Button, { ...props, onClick: () => setOpen(true) }, children),
    h(Modal, { open, title, description, closeLabel: '关闭', onClose: () => setOpen(false),
      footer: h('div', { style: bar },
        h(Button, { onClick: () => setOpen(false) }, '取消'),
        h(Button, { variant: 'primary', onClick: () => { setOpen(false); void onConfirm() } }, '确认')) }))
}

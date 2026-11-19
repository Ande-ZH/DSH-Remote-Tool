import { createElement as h } from 'react'
import { DevicesPanel } from './devices-panel.js'
import { MagpieSettings } from './magpie-panel.js'

const id = 'dsh-shared-remote'

function Icon() {
  return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.7, 'aria-hidden': true },
  h('rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
  h('path', { d: 'M8 21h8m-4-4v4M7 8l3 3-3 3m6 0h4' }))
}

export const name = 'dsh-remote-tool'
export const inject = ['slots']

export function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = __dshRemoteCss
    document.head.append(style)
    return () => style.remove()
  }, id + ': styles')
  const slots = ctx.slots ?? ctx.get('slots')
  slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist', id, order: 45, label: () => 'SSH 远程',
  }, Icon))
  slots.inject('main', () => slots.register({ name: 'main', key: id }, DevicesPanel))
  slots.inject('settings.section', () => slots.register({
    name: 'settings.section', id: id + '-models', order: 12, label: () => '远程模型',
  }, MagpieSettings))
}

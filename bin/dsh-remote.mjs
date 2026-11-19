#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from '../src/client.mjs'
import { install } from '../src/install.mjs'

const usage = `dsh-remote-tool install [--dsh <Desktop 自带的 dsh 路径>] [--profile desktop|web]
dsh-remote-tool connect <SSH 别名或 user@host> [--port 22] [--no-open]

安装前请先运行一次 DSH Desktop，并完全退出应用。默认使用 PATH 中的 dsh。
npm 版 DSH CLI 仅支持 web 等非 Desktop profile。`

function parse(args) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) return
  if (args[0] === 'install') {
    const result = { command: 'install' }
    for (let i = 1; i < args.length; i += 1) {
      const flag = args[i]
      if (!['--dsh', '--profile'].includes(flag)) throw new Error('未知参数 ' + flag)
      const value = args[++i]
      if (!value || value.startsWith('-')) throw new Error(flag + ' 需要参数')
      result[flag === '--dsh' ? 'dsh' : 'profile'] = value
    }
    return result
  }
  if (args[0] !== 'connect') throw new Error('用法为 dsh-remote-tool connect <SSH 别名或 user@host>')
  const result = { host: args[1] }
  for (let i = 2; i < args.length; i += 1) {
    switch (args[i]) {
      case '--port': result.port = Number(args[++i]); break
      case '--no-open': result.noOpen = true; break
      default: throw new Error('未知参数 ' + args[i])
    }
  }
  return result
}

async function handoff(connection) {
  const path = '/connect/' + randomBytes(32).toString('base64url')
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== path ||
        request.headers.host !== '127.0.0.1:' + server.address()?.port) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(302, {
      Location: connection.browserUrl, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    }).end()
    server.close()
  })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const expire = setTimeout(() => { server.close(); server.closeAllConnections() }, 120_000)
    expire.unref()
    server.once('close', () => clearTimeout(expire))
    void connection.ended.then(() => { server.closeAllConnections(); server.close() })
    return 'http://127.0.0.1:' + server.address().port + path
  } catch (error) {
    server.close()
    throw error
  }
}

function openBrowser(url) {
  const commands = {
    win32: ['rundll32.exe', 'url.dll,FileProtocolHandler'],
    darwin: ['open'],
    linux: ['xdg-open'],
  }
  const [command, ...args] = commands[process.platform] ?? []
  if (!command) return
  const child = spawn(command, [...args, url], { stdio: 'ignore', windowsHide: true })
  child.on('error', () => {})
}

async function main() {
  const options = parse(process.argv.slice(2))
  if (!options) {
    console.log(usage)
    return
  }
  if (options.command === 'install') {
    await install(options)
    return
  }

  const controller = new AbortController()
  const stop = () => controller.abort(new Error('连接已关闭'))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  let connection
  try {
    connection = await connect({ ...options, signal: controller.signal })
    if (connection.magpie?.status === 'error') console.error('Magpie: ' + connection.magpie.error)
    const url = await handoff(connection)
    console.log('远端 DSH 已连接。两分钟内打开此一次性链接，按 Ctrl+C 断开本机。\n' + url)
    if (!options.noOpen) openBrowser(url)
    await connection.ended
    if (!controller.signal.aborted) throw new Error('SSH 隧道已断开，请重新连接同一设备以继续会话')
  } catch (error) {
    if (!controller.signal.aborted) throw error
  } finally {
    connection?.close()
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

main().catch((error) => {
  console.error('dsh-remote-tool: ' + error.message)
  process.exitCode = 1
})

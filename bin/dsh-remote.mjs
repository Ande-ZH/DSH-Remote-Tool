#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from '../src/client.mjs'

function parse(args) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) return
  if (args[0] !== 'connect') throw new Error('用法为 dsh-remote connect <SSH 别名或 user@host>')
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
    console.log('dsh-remote connect <SSH 别名或 user@host> [--port 22] [--no-open]')
    return
  }

  const controller = new AbortController()
  const stop = () => controller.abort(new Error('连接已关闭'))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  let connection
  try {
    connection = await connect({ ...options, signal: controller.signal })
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
  console.error('dsh-remote: ' + error.message)
  process.exitCode = 1
})

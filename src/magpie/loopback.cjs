const { request } = require('node:http')

const responseLimit = 8 * 1024 * 1024

// Use a dedicated HTTP connection so ambient proxies cannot receive loopback credentials.
function loopback(url, { method = 'GET', headers, body, timeoutMs = 4500 } = {}) {
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) {
    throw new Error('远端操作只能访问 HTTP 回环服务')
  }
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      method, headers, agent: false, signal: AbortSignal.timeout(timeoutMs),
    }, async (incoming) => {
      try {
        if (incoming.statusCode < 200 || incoming.statusCode >= 300) {
          incoming.resume()
          resolve({ status: incoming.statusCode, headers: incoming.headers })
          return
        }
        let size = 0
        const chunks = []
        for await (const chunk of incoming) {
          size += chunk.length
          if (size > responseLimit) throw new Error('远端 HTTP 响应超过大小限制')
          chunks.push(chunk)
        }
        const text = Buffer.concat(chunks, size).toString('utf8')
        let data
        if (text) {
          try { data = JSON.parse(text) } catch { throw new Error('远端 HTTP 服务未返回有效的 JSON') }
        }
        resolve({ status: incoming.statusCode, headers: incoming.headers, data })
      } catch (error) {
        reject(error)
      }
    })
    outgoing.once('error', reject)
    outgoing.end(body)
  })
}

module.exports = { loopback }

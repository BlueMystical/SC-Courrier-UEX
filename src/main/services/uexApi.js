// src/main/services/uexApi.js
const { net } = require('electron')

const BASE_URL = 'https://api.uexcorp.uk/2.0'
const MAX_RETRIES = 3

function request(method, endpoint, body = null, headers = {}, attempt = 1) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${endpoint}`

    console.log('[UEX] Calling:', url)

    const req = net.request({
      method,
      url
    })

    // Browser-like headers
    req.setHeader(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    )
    req.setHeader('Accept', 'application/json')
    req.setHeader('Referer', 'https://uexcorp.space/')
    req.setHeader('Origin', 'https://uexcorp.space')

    Object.entries(headers).forEach(([key, value]) => {
      req.setHeader(key, value)
    })

    let data = ''

    req.on('response', (res) => {
      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data))
          } catch {
            resolve(data)
          }
        } else if (attempt < MAX_RETRIES) {
          console.warn(`[UEX] Retry ${attempt} for ${endpoint}`)
          resolve(request(method, endpoint, body, headers, attempt + 1))
        } else {
          let parsed = null
          try { parsed = JSON.parse(data) } catch { /* not JSON */ }
          const err = new Error(parsed?.status ?? `Request failed with status ${res.statusCode}`)
          err.statusCode = res.statusCode
          err.apiResponse = parsed ?? data
          reject(err)
        }
      })

    })

    req.on('error', reject)

    if (body) {
      req.setHeader('Content-Type', 'application/json')
      req.write(JSON.stringify(body))
    }

    req.end()
  })
}

function get(endpoint) {
  return request('GET', endpoint)
}

function post(endpoint, body, headers = {}) {
  return request('POST', endpoint, body, headers)
}

module.exports = { get, post, request }
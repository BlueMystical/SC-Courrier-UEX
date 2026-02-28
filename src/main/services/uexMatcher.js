const { getCache } = require('./uexSync')

function normalize(str) {
  return str
    ?.toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .trim()
}

function matchTerminalByName(ocrName) {
  const cache = getCache()
  if (!cache?.terminals) return null

  const normalizedOCR = normalize(ocrName)

  const candidates = cache.terminals.filter(
    t => t.type === 'commodity' && t.is_available_live === 1
  )

  for (const terminal of candidates) {
    const display = normalize(terminal.displayname)
    const nickname = normalize(terminal.nickname)
    const code = normalize(terminal.code)

    if (
      display === normalizedOCR ||
      nickname === normalizedOCR ||
      code === normalizedOCR
    ) {
      return terminal
    }
  }

  // Fallback contains
  for (const terminal of candidates) {
    const display = normalize(terminal.displayname)
    if (display.includes(normalizedOCR)) {
      return terminal
    }
  }

  return null
}

function matchCommodityByName(name) {
  const cache = getCache()
  if (!cache?.commodities) return null

  const normalized = normalize(name)

  return cache.commodities.find(
    c => normalize(c.name) === normalized
  )
}

module.exports = {
  matchTerminalByName,
  matchCommodityByName
}
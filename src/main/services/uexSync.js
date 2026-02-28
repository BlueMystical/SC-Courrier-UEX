const fs = require('fs')
const path = require('path')
const uexApi = require('./uexApi')

const CACHE_PATH = path.join(__dirname, '../cache/uexCache.json')

async function syncStaticData() {
    console.log('[UEX] 🔄 Starting static sync...')

    try {
        const terminals = await uexApi.get('/terminals')
        await new Promise(r => setTimeout(r, 800))

        const commodities = await uexApi.get('/commodities')
        await new Promise(r => setTimeout(r, 800))

        const items = await uexApi.get('/items')
        await new Promise(r => setTimeout(r, 800))

        const vehicles = await uexApi.get('/vehicles')

        const cacheData = {
            syncedAt: Date.now(),
            terminals,
            commodities,
            items,
            vehicles
        }

        fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
        fs.writeFileSync(CACHE_PATH, JSON.stringify(cacheData, null, 2))

        console.log('[UEX] ✅ Static sync complete')
        return true

    } catch (err) {
        console.error('[UEX] ❌ Static sync failed:', err.message)
        return false
    }
}

function getCache() {
    if (!fs.existsSync(CACHE_PATH)) return null
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'))
}

module.exports = {
    syncStaticData,
    getCache
}
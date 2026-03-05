// src/main/services/itemCacheService.js
//
// Cache manager for UEX items catalogue.
// Fetching is done in the RENDERER (to bypass API protection) and sent here via IPC.
// This service only manages the cache state and notifies the renderer of status.
//
// Flow:
//   1. main.js calls startBackgroundSync(win) after did-finish-load
//   2. This emits 'items-cache:request-sync' to the renderer
//   3. Renderer fetches categories + items, calls window.api.invoke('uex:cacheItems', data)
//   4. main.js IPC handler calls receiveSyncData(data) here
//   5. ocrService reads uexCache.get('items') as usual

'use strict'

const uexCache = require('../helpers/uexCache')

const CACHE_KEY_ITEMS      = 'items'
const CACHE_KEY_CATEGORIES = 'item_categories'
const CACHE_KEY_LAST_SYNC  = 'items_last_sync'
const TTL_MS               = 24 * 60 * 60 * 1000

let _win       = null
let _syncTimer = null

const _state = {
  state:    'idle',
  progress: 0,
  total:    0,
  done:     0,
  cached:   0,
  lastSync: null,
  error:    null
}

function emit(event, data) {
  try {
    if (_win && !_win.isDestroyed()) _win.webContents.send(event, data)
  } catch (_) {}
}

function isCacheFresh() {
  const lastSync = uexCache.get(CACHE_KEY_LAST_SYNC)
  if (!lastSync) return false
  return (Date.now() - lastSync) < TTL_MS
}

// Called by main.js IPC handler when renderer delivers fetched data.
function receiveSyncData({ categories, items }) {
  console.log(`[ItemCache] ✅ Received from renderer: ${categories?.length} categories, ${items?.length} items`)
  uexCache.set(CACHE_KEY_CATEGORIES, categories || [])
  uexCache.set(CACHE_KEY_ITEMS, items || [])
  uexCache.set(CACHE_KEY_LAST_SYNC, Date.now())
  _state.state    = 'done'
  _state.cached   = items?.length ?? 0
  _state.lastSync = Date.now()
  _state.progress = 100
  _state.error    = null
  emit('items-cache:sync-complete', { total: _state.cached, errors: 0, lastSync: _state.lastSync })
}

// Called by main.js IPC handler when renderer reports a sync error.
function receiveSyncError(errorMsg) {
  console.error(`[ItemCache] ❌ Renderer sync failed: ${errorMsg}`)
  _state.state = 'error'
  _state.error = errorMsg
  emit('items-cache:sync-error', { error: errorMsg })
}

// Tells the renderer to start fetching.
function requestSync() {
  console.log('[ItemCache] 📡 Requesting renderer to fetch items...')
  _state.state    = 'syncing'
  _state.progress = 0
  _state.error    = null
  emit('items-cache:request-sync', {})
}

function startBackgroundSync(win, delayMs = 8000) {
  _win = win

  if (isCacheFresh()) {
    const items = uexCache.get(CACHE_KEY_ITEMS) || []
    _state.state    = 'done'
    _state.cached   = items.length
    _state.lastSync = uexCache.get(CACHE_KEY_LAST_SYNC)
    _state.progress = 100
    console.log(`[ItemCache] ✅ Cache fresh (${items.length} items) — skipping sync`)
    setTimeout(() => emit('items-cache:sync-complete', {
      total: items.length, errors: 0, lastSync: _state.lastSync, fromCache: true
    }), 500)
    scheduleAutoRefresh()
    return
  }

  console.log(`[ItemCache] 🕐 Initial sync scheduled in ${delayMs / 1000}s...`)
  setTimeout(() => requestSync(), delayMs)
  scheduleAutoRefresh()
}

function scheduleAutoRefresh() {
  if (_syncTimer) clearInterval(_syncTimer)
  _syncTimer = setInterval(() => {
    console.log('[ItemCache] ⏰ 24h auto-refresh triggered')
    requestSync()
  }, TTL_MS)
}

function forceSync()     { requestSync() }
function getItems()      { return uexCache.get(CACHE_KEY_ITEMS)      || [] }
function getCategories() { return uexCache.get(CACHE_KEY_CATEGORIES) || [] }
function getStatus()     { return { ..._state } }
function destroy() {
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null }
  _win = null
}

module.exports = { startBackgroundSync, receiveSyncData, receiveSyncError, forceSync, getItems, getCategories, getStatus, destroy, isCacheFresh }
// src/main/helpers/uexCache.js
//
// In-memory key-value cache with optional per-key TTL.
// Keys are persisted across the session in memory only — not to disk.
//
// API:
//   uexCache.set(key, value, ttlMs?)   — store a value, optionally with TTL
//   uexCache.get(key)                  — returns value or null (if expired/missing)
//   uexCache.isExpired(key)            — true if key is missing or TTL has elapsed
//   uexCache.getAge(key)               — ms since last set, or null
//   uexCache.delete(key)               — remove a key
//   uexCache.clear()                   — wipe everything
//   uexCache.keys()                    — list all non-expired keys

'use strict'

// Default TTLs for known keys (ms)
// Override by passing ttlMs to set()
const DEFAULT_TTLS = {
  terminals:       24 * 60 * 60 * 1000,   // 24 hours
  commodities:     24 * 60 * 60 * 1000,   // 24 hours
  items:           24 * 60 * 60 * 1000,   // 24 hours
  item_categories: 24 * 60 * 60 * 1000,   // 24 hours
  stations:        24 * 60 * 60 * 1000,   // 24 hours
  items_last_sync: Infinity,               // never expires (timestamp is checked externally)
}

// Internal store: { [key]: { value, setAt, ttlMs } }
const _store = {}

/**
 * Store a value.
 * @param {string} key
 * @param {*} value
 * @param {number} [ttlMs]  - optional TTL override in ms. 0 = no expiry.
 */
function set(key, value, ttlMs) {
  const resolvedTtl = ttlMs !== undefined
    ? ttlMs
    : (DEFAULT_TTLS[key] ?? 0)   // 0 = no expiry

  _store[key] = {
    value,
    setAt: Date.now(),
    ttlMs: resolvedTtl
  }
}

/**
 * Get a value. Returns null if key doesn't exist or is expired.
 */
function get(key) {
  const entry = _store[key]
  if (!entry) return null

  // Check TTL
  if (entry.ttlMs > 0 && (Date.now() - entry.setAt) > entry.ttlMs) {
    console.log(`[uexCache] 🕐 Key "${key}" has expired (TTL: ${entry.ttlMs / 3600000}h)`)
    delete _store[key]
    return null
  }

  return entry.value
}

/**
 * Returns true if the key is missing or has expired.
 */
function isExpired(key) {
  return get(key) === null
}

/**
 * Returns ms since the key was last set, or null if key doesn't exist.
 */
function getAge(key) {
  const entry = _store[key]
  if (!entry) return null
  return Date.now() - entry.setAt
}

/**
 * Returns the TTL remaining for a key in ms.
 * Returns Infinity if no TTL, 0 if expired.
 */
function getTtlRemaining(key) {
  const entry = _store[key]
  if (!entry) return 0
  if (!entry.ttlMs) return Infinity
  const remaining = entry.ttlMs - (Date.now() - entry.setAt)
  return Math.max(0, remaining)
}

/**
 * Delete a key.
 */
function del(key) {
  delete _store[key]
}

/**
 * Clear all keys.
 */
function clear() {
  Object.keys(_store).forEach(k => delete _store[k])
}

/**
 * Returns all non-expired key names.
 */
function keys() {
  return Object.keys(_store).filter(k => get(k) !== null)
}

/**
 * Returns a summary of all keys with their age and TTL info.
 * Useful for debug/settings UI.
 */
function getStats() {
  return Object.entries(_store).map(([key, entry]) => {
    const ageMs     = Date.now() - entry.setAt
    const remaining = entry.ttlMs ? Math.max(0, entry.ttlMs - ageMs) : null
    const isArr     = Array.isArray(entry.value)

    return {
      key,
      count:          isArr ? entry.value.length : null,
      ageMinutes:     Math.round(ageMs / 60000),
      ttlHours:       entry.ttlMs ? (entry.ttlMs / 3600000).toFixed(1) : 'none',
      remainingHours: remaining !== null ? (remaining / 3600000).toFixed(1) : 'none',
      expired:        entry.ttlMs > 0 && ageMs > entry.ttlMs
    }
  })
}

module.exports = { set, get, isExpired, getAge, getTtlRemaining, delete: del, clear, keys, getStats }
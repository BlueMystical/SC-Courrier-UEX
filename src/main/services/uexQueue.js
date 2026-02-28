// src/main/services/uexQueue.js

const axios = require('axios')
const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const settingsHelper = require('../helpers/settingsHelper')

const BASE_URL = 'https://api.uexcorp.uk/v2'
const FLUSH_INTERVAL = 4000        // 4 segundos
const MAX_BATCH_SIZE = 40
const MAX_RETRIES = 5

const queueFile = path.join(app.getPath('userData'), 'uexUploadQueue.json')

let buffer = []
let processing = false
let flushTimer = null

// ─────────────────────────────
// INIT
// ─────────────────────────────

function loadQueue() {
  if (fs.existsSync(queueFile)) {
    buffer = JSON.parse(fs.readFileSync(queueFile))
    console.log(`[UEX] Restored ${buffer.length} pending jobs`)
  }
}

function saveQueue() {
  fs.writeFileSync(queueFile, JSON.stringify(buffer, null, 2))
}

loadQueue()

// ─────────────────────────────
// AXIOS CLIENT
// ─────────────────────────────

function getClient() {
  return axios.create({
    baseURL: BASE_URL,
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${settingsHelper.getSetting('settings/app/bearerToken')}`,
      'Content-Type': 'application/json'
    }
  })
}

// ─────────────────────────────
// ENQUEUE
// ─────────────────────────────

function enqueue(job) {
  job.retries = 0
  job.timestamp = Date.now()

  // Anti-duplicate (5 min window)
  const exists = buffer.find(j =>
    j.stationId === job.stationId &&
    j.payload.id === job.payload.id &&
    j.payload.price === job.payload.price &&
    j.payload.scu === job.payload.scu &&
    Date.now() - j.timestamp < 300000
  )

  if (exists) {
    console.log('[UEX] Skipping duplicate')
    return
  }

  buffer.push(job)
  saveQueue()

  if (buffer.length >= MAX_BATCH_SIZE) {
    flush()
  } else {
    scheduleFlush()
  }
}

// ─────────────────────────────
// FLUSH CONTROL
// ─────────────────────────────

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_INTERVAL)
}

async function flush() {
  if (processing || buffer.length === 0) return

  processing = true
  const client = getClient()

  const batch = buffer.splice(0, MAX_BATCH_SIZE)
  saveQueue()

  const commodities = batch.filter(j => j.type === 'commodity')
  const items = batch.filter(j => j.type === 'item')

  try {
    if (commodities.length > 0) {
      await sendBatch(client, '/market/commodity/batch', commodities)
    }

    if (items.length > 0) {
      await sendBatch(client, '/market/item/batch', items)
    }

    console.log(`[UEX] ✅ Uploaded batch (${batch.length})`)
  } catch (err) {
    console.error('[UEX] Batch failed:', err.message)

    for (const job of batch) {
      if (job.retries < MAX_RETRIES) {
        job.retries++
        buffer.push(job)
      } else {
        console.error('[UEX] Dropped permanently:', job.payload.id)
      }
    }

    saveQueue()
    await backoffDelay(batch[0]?.retries || 1)
  }

  processing = false

  if (buffer.length > 0) {
    scheduleFlush()
  }
}

// ─────────────────────────────
// BATCH SEND
// ─────────────────────────────

async function sendBatch(client, endpoint, jobs) {
  const payload = jobs.map(j => ({
    station_id: j.stationId,
    ...j.payload
  }))

  await client.post(endpoint, payload)
}

// ─────────────────────────────
// BACKOFF
// ─────────────────────────────

async function backoffDelay(retryCount) {
  const delay = Math.min(1000 * Math.pow(2, retryCount), 30000)
  console.log(`[UEX] Backoff ${delay}ms`)
  return new Promise(res => setTimeout(res, delay))
}

module.exports = { enqueue, flush }
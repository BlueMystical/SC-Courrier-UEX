// src/main/services/uexDelta.js

const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const deltaFile = path.join(app.getPath('userData'), 'uexMarketState.json')

let state = {}

function load() {
  if (fs.existsSync(deltaFile)) {
    state = JSON.parse(fs.readFileSync(deltaFile))
  }
}

function save() {
  fs.writeFileSync(deltaFile, JSON.stringify(state, null, 2))
}

load()

// Genera clave única por estación + item
function buildKey(stationId, itemId, operation) {
  return `${stationId}_${itemId}_${operation}`
}

// Genera snapshot del estado actual
function buildSnapshot(payload) {
  return {
    price: payload.price,
    scu: payload.scu ?? null,
    status: payload.status ?? null,
    is_missing: payload.is_missing ?? 0
  }
}

function hasChanged(stationId, itemId, operation, payload) {
  const key = buildKey(stationId, itemId, operation)
  const newSnapshot = buildSnapshot(payload)

  const previous = state[key]

  if (!previous) {
    state[key] = newSnapshot
    save()
    return true
  }

  const changed =
    previous.price !== newSnapshot.price ||
    previous.scu !== newSnapshot.scu ||
    previous.status !== newSnapshot.status ||
    previous.is_missing !== newSnapshot.is_missing

  if (changed) {
    state[key] = newSnapshot
    save()
  }

  return changed
}

module.exports = { hasChanged }
// src/main/helpers/uexCache.js

const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const cachePath = path.join(app.getPath('userData'), 'uexCache.json')

let cache = {}

function load() {
  if (fs.existsSync(cachePath)) {
    cache = JSON.parse(fs.readFileSync(cachePath))
  }
}

function save() {
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2))
}

function set(key, value) {
  cache[key] = value
  save()
}

function get(key) {
  return cache[key] || []
}

load()

module.exports = { set, get }
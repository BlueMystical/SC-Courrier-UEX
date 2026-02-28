// src/main/helpers/screenshotWatcher.js
// Monitors the Star Citizen screenshots folder for new captures.
// When a new .jpg/.png appears, reads it and notifies the renderer via IPC.

const fs   = require('fs')
const path = require('path')

// Default SC screenshots path on Windows
const DEFAULT_SC_SCREENSHOTS_PATH =
  'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\screenshots'

let watcher       = null   // fs.FSWatcher instance
let watchedFolder = null   // currently watched path
let mainWindow    = null   // BrowserWindow reference to send events to

// Debounce map — fs.watch fires 'rename' twice on Windows for a single file
const pendingFiles = new Map()

/**
 * Start watching a folder for new screenshot files.
 * Safe to call multiple times — stops the previous watcher first.
 *
 * @param {string}        folderPath - Absolute path to watch
 * @param {BrowserWindow} win        - Main window to receive IPC events
 */
function startWatcher(folderPath, win) {
  stopWatcher()

  mainWindow    = win
  watchedFolder = folderPath

  if (!fs.existsSync(folderPath)) {
    console.warn(`[Watcher] Folder does not exist: ${folderPath}`)
    win.webContents.send('screenshot:folder-missing', { path: folderPath })
    return
  }

  console.log(`[Watcher] 👁 Watching: ${folderPath}`)

  watcher = fs.watch(folderPath, { persistent: true }, (eventType, filename) => {
    if (eventType !== 'rename' || !filename) return

    const ext = path.extname(filename).toLowerCase()
    if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') return

    const fullPath = path.join(folderPath, filename)

    // Debounce: fs.watch fires the event twice on Windows
    if (pendingFiles.has(fullPath)) return
    pendingFiles.set(fullPath, true)

    // Small delay to ensure the game has finished writing the file
    setTimeout(() => {
      pendingFiles.delete(fullPath)
      processNewScreenshot(fullPath)
    }, 800)
  })

  watcher.on('error', (err) => {
    console.error('[Watcher] Error:', err)
    mainWindow?.webContents.send('screenshot:watcher-error', { error: err.message })
  })
}

/**
 * Stop the active watcher, if any.
 */
function stopWatcher() {
  if (watcher) {
    watcher.close()
    watcher = null
    console.log('[Watcher] 🛑 Stopped')
  }
  pendingFiles.clear()
}

/**
 * Read the file and send it to the renderer as base64.
 * Skips files that don't exist yet (race condition) or are too large (> 15 MB).
 */
function processNewScreenshot(filePath) {
  if (!fs.existsSync(filePath)) return

  try {
    const stats = fs.statSync(filePath)
    const MAX_SIZE = 15 * 1024 * 1024  // 15 MB

    if (stats.size === 0) {
      console.warn(`[Watcher] Empty file, skipping: ${filePath}`)
      return
    }

    if (stats.size > MAX_SIZE) {
      console.warn(`[Watcher] File too large (${(stats.size / 1024 / 1024).toFixed(1)} MB), skipping: ${filePath}`)
      mainWindow?.webContents.send('screenshot:too-large', {
        filename: path.basename(filePath),
        size: stats.size
      })
      return
    }

    const buffer   = fs.readFileSync(filePath)
    const ext      = path.extname(filePath).toLowerCase().replace('.', '')
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg'
    const base64   = buffer.toString('base64')
    const dataUrl  = `data:${mimeType};base64,${base64}`

    console.log(`[Watcher] 📸 New screenshot: ${path.basename(filePath)} (${(stats.size / 1024).toFixed(0)} KB)`)

    mainWindow?.webContents.send('screenshot:new', {
      filename:  path.basename(filePath),
      filePath,
      dataUrl,
      base64,
      mimeType,
      size:      stats.size,
      timestamp: stats.mtimeMs,
    })

  } catch (err) {
    console.error(`[Watcher] Failed to read file ${filePath}:`, err)
    mainWindow?.webContents.send('screenshot:read-error', {
      filename: path.basename(filePath),
      error:    err.message
    })
  }
}

/**
 * Return the default SC screenshots path.
 * Caller can check if it exists with fs.existsSync.
 */
function getDefaultPath() {
  return DEFAULT_SC_SCREENSHOTS_PATH
}

/**
 * Return the currently watched folder path (or null).
 */
function getWatchedFolder() {
  return watchedFolder
}

module.exports = { startWatcher, stopWatcher, getDefaultPath, getWatchedFolder }

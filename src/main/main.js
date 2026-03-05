// src/main/main.js
const { app, ipcMain, BrowserWindow, globalShortcut, Tray, Menu, nativeImage } = require('electron')
require('dotenv').config()
const path = require('path')
const packageJson = require('../../package.json')
const uexService = require('./services/uexService')
const { processOCR } = require('./services/ocrService')
const itemCacheService = require('./services/itemCacheService')


// 1. Identity configuration
const appName = packageJson.productName || 'SC-Courrier-UEX';
app.name = appName;

if (process.env.VITE_DEV_SERVER_URL) {
  const userDataPath = path.join(app.getPath('appData'), appName);
  app.setPath('userData', userDataPath);
}

// 2. Own modules
const windowManager = require('./windowManager')
const settingsHelper = require('./helpers/settingsHelper')
const fileHelper = require('./helpers/fileHelper')
const { routeMap } = require('../shared/shortcutsConfig.cjs')
const { session, dialog } = require('electron')
const screenshotWatcher = require('./helpers/screenshotWatcher')
const ocrHelper = require('./helpers/ocrHelper')
const fs = require('fs')

// --- SYSTEM TRAY ---
let tray = null

function getTrayIconPath() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return path.join(__dirname, '../../resources/LogoCutcsa.ico')
  } else if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources/LogoCutcsa.ico')
  } else {
    return path.join(__dirname, '../../resources/LogoCutcsa.ico')
  }
}

function createTray() {
  if (tray) return // already created

  const icon = nativeImage.createFromPath(getTrayIconPath())
  tray = new Tray(icon)
  tray.setToolTip(appName)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        const win = windowManager.getWindow('main')
        if (win) { win.show(); win.focus() }
      }
    },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // Double-click on tray icon → show window
  tray.on('double-click', () => {
    const win = windowManager.getWindow('main')
    if (win) { win.show(); win.focus() }
  })
}

function destroyTray() {
  if (tray) { tray.destroy(); tray = null }
}

// --- SHORTCUTS ---
function registerShortcuts() {
  globalShortcut.unregisterAll()

  const shortcuts = settingsHelper.getSetting('settings/shortcuts') || {}

  Object.entries(shortcuts).forEach(([key, shortcut]) => {
    if (!shortcut || !routeMap[key]) return

    const registered = globalShortcut.register(shortcut, () => {
      const mainWin = windowManager.getWindow('main')
      if (!mainWin) return
      if (mainWin.isMinimized()) mainWin.restore()
      if (!mainWin.isVisible()) mainWin.show()
      mainWin.focus()
      mainWin.webContents.send('navigate-to', routeMap[key])
    })

    if (!registered) {
      console.warn(`⚠️ Shortcut "${shortcut}" for "${key}" could not be registered (system conflict)`)
    }
  })
}

// 3. App lifecycle
app.whenReady().then(async () => {
  try {

    console.log('🚀 App ready...')

    // ─────────────────────────────
    // UEX INITIAL SYNC (safe)
    // ─────────────────────────────
    //const hasToken = uexService.hasToken()

    /*if (hasToken) {
      const result = await uexService.initialSync()

      if (!result.success) {
        console.warn('[UEX] Sync skipped or failed:', result.reason)
      }
    } else {
      console.warn('[UEX] No user token configured — sync skipped')
    }

    await syncStaticData()*/

    // ─────────────────────────────
    // NETWORK HEADER SPOOF (unchanged)
    // ─────────────────────────────
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['https://*.uexcorp.space/*', 'https://*.uexcorp.uk/*', 'https://*.robertsspaceindustries.com/*', 'https://robertsspaceindustries.com/*'] },
      (details, callback) => {
        const headers = { ...details.requestHeaders }
        headers['User-Agent'] =
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

        const url = details.url

        if (url.includes('cdn.uexcorp.space') && url.includes('/account/')) {
          return callback({ requestHeaders: details.requestHeaders })
        }

        if (url.includes('.robertsspaceindustries.com')) {
          headers['Referer'] = 'https://robertsspaceindustries.com/'
          headers['Origin'] = 'https://robertsspaceindustries.com'
        } else {
          headers['Referer'] = 'https://uexcorp.space/'
          headers['Origin'] = 'https://uexcorp.space'
        }

        callback({ requestHeaders: headers })
      }
    )

    // ─────────────────────────────
    // WINDOW + TRAY
    // ─────────────────────────────

    const startMinimized = settingsHelper.getSetting('settings/tray/startMinimized') ?? false
    const minimizeToTray = settingsHelper.getSetting('settings/tray/minimizeToTray') ?? false

    if (startMinimized || minimizeToTray) createTray()

    const win = windowManager.createWindow('main', '/', { width: 961, height: 650 })

    win.on('close', (event) => {
      const shouldMinimize = settingsHelper.getSetting('settings/tray/minimizeToTray') ?? false
      if (shouldMinimize && !app.isQuitting) {
        event.preventDefault()
        win.hide()
        createTray()
      }
    })

    if (startMinimized) {
      win.once('ready-to-show', () => win.hide())
    }

    registerShortcuts()

    // ─────────────────────────────
    // SCREENSHOT WATCHER
    // ─────────────────────────────
    win.webContents.once('did-finish-load', () => {
      initScreenshotWatcher(win)
    })

  } catch (err) {
    console.error('[APP] Fatal startup error:', err)
  }
})





app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  destroyTray()
})

app.on('window-all-closed', () => {
  const minimizeToTray = settingsHelper.getSetting('settings/tray/minimizeToTray') ?? false
  // On non-mac, only quit if not using tray
  if (process.platform !== 'darwin' && !minimizeToTray) app.quit()
})

app.on('activate', () => {
  if (!windowManager.getWindow('main')) {
    windowManager.createWindow('main', '/', { width: 961, height: 650 })
  }
})

// 4. IPC
ipcMain.on('open-window', (event, { route, options }) => {
  windowManager.createWindow(route, route, options)
})

ipcMain.on('navigate-main', (event, route) => {
  const mainWin = windowManager.getWindow('main')
  if (mainWin) {
    if (process.env.VITE_DEV_SERVER_URL) {
      mainWin.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${route}`)
    } else {
      mainWin.loadFile(path.join(__dirname, '../../dist/renderer/index.html'), { hash: route })
    }
  }
})


ipcMain.handle('uex:getCache', async () => {
  const uexCache = require('./helpers/uexCache')
  return {
    terminals: uexCache.get('terminals') || [],
    stations: uexCache.get('stations') || [],
    commodities: uexCache.get('commodities') || [],
    items: uexCache.get('items') || []
  }
})
ipcMain.handle('uex:cacheTerminals', async (_, data) => {
  const uexCache = require('./helpers/uexCache')
  uexCache.set('terminals', data)
  console.log('[UEX] ✅ Terminals cached from renderer', data?.data?.length ?? data, 'items')
  return true
})

ipcMain.handle('uex:cacheCommodities', async (_, data) => {
  const uexCache = require('./helpers/uexCache')
  uexCache.set('commodities', data)
  console.log('[UEX] ✅ Commodities cached from renderer', data?.data?.length ?? 0, 'items')
  return true
})

// Renderer delivers fetched items catalogue → store in cache
ipcMain.handle('uex:cacheItems', async (_, { categories, items }) => {
  itemCacheService.receiveSyncData({ categories, items })
  return true
})

// Renderer reports items fetch error
ipcMain.handle('uex:cacheItemsError', async (_, errorMsg) => {
  itemCacheService.receiveSyncError(errorMsg)
  return true
})
ipcMain.handle('uex:getTerminals', async () => {
  try {
    const uexCache = require('./helpers/uexCache')
    const terminals = uexCache.get('terminals') || []

    return {
      success: true,
      terminals
    }

  } catch (err) {
    console.error('[uex:getTerminals] ERROR:', err)
    return {
      success: false,
      error: err.message
    }
  }
})

// ─────────────────────────────
// TOKEN CHECK
// ─────────────────────────────

ipcMain.handle('uex:checkToken', () => {
  return uexService.hasToken()
})

ipcMain.handle('uex:saveToken', async (event, token) => {
  settingsHelper.setSetting('settings/security/user/token', token)
  return true
})

// ─────────────────────────────
// INITIAL SYNC
// ─────────────────────────────

ipcMain.handle('uex:initialSync', async () => {
  return await uexService.initialSync()
})


// ─────────────────────────────
// SUBMIT DATA
// ─────────────────────────────
ipcMain.handle('uex:submitData', async (event, payload) => {
  return await uexService.submitData(payload)
})



ipcMain.handle('ocr:process', async (_, payload) => {
  return await processOCR(payload)
})


ipcMain.handle('shortcuts:get', () => settingsHelper.getSetting('settings/shortcuts'))

ipcMain.handle('shortcuts:update', (event, shortcuts) => {
  settingsHelper.setSetting('settings/shortcuts', shortcuts)
  registerShortcuts()
  return { success: true }
})

ipcMain.handle('settings:get', (event, keyPath) => settingsHelper.getSetting(keyPath))

ipcMain.handle('settings:set', (event, { keyPath, value }) => {
  settingsHelper.setSetting(keyPath, value)

  // When tray settings change, update tray state immediately
  if (keyPath.startsWith('settings/tray/')) {
    const minimizeToTray = settingsHelper.getSetting('settings/tray/minimizeToTray') ?? false
    const startMinimized = settingsHelper.getSetting('settings/tray/startMinimized') ?? false
    if (minimizeToTray || startMinimized) createTray()
    else destroyTray()
  }

  console.log(`📡 Broadcasting settings change: ${keyPath} = ${value}`)
  BrowserWindow.getAllWindows().forEach(win => {
    if (win && !win.isDestroyed()) win.webContents.send('settings-updated', { keyPath, value })
  })

  return true
})

ipcMain.handle('get-version', () => app.getVersion())

// ─────────────────────────────────────────────
// SCREENSHOT WATCHER — IPC handlers
// ─────────────────────────────────────────────

/**
 * Resolve the screenshots folder:
 * 1. Use saved setting if present and folder exists
 * 2. Fall back to SC default path if it exists
 * 3. Return null → renderer will ask the user to configure it
 */
function resolveScreenshotsFolder() {
  const saved = settingsHelper.getSetting('settings/paths/screenshotsFolder')
  if (saved && fs.existsSync(saved)) return saved

  const defaultPath = screenshotWatcher.getDefaultPath()
  if (fs.existsSync(defaultPath)) return defaultPath

  return null
}

function initScreenshotWatcher(win) {
  const folder = resolveScreenshotsFolder()
  if (folder) {
    screenshotWatcher.startWatcher(folder, win)
    win.webContents.send('screenshot:watcher-started', { path: folder })
  } else {
    win.webContents.send('screenshot:folder-missing', {
      path: screenshotWatcher.getDefaultPath()
    })
  }
}

// Renderer asks: what folder are we watching?
ipcMain.handle('screenshots:get-folder', () => ({
  folder: screenshotWatcher.getWatchedFolder(),
  default: screenshotWatcher.getDefaultPath(),
}))

// Renderer asks: open a folder picker dialog and save the result
ipcMain.handle('screenshots:pick-folder', async () => {
  const win = windowManager.getWindow('main')
  const result = await dialog.showOpenDialog(win, {
    title: 'Select Star Citizen Screenshots Folder',
    properties: ['openDirectory'],
    defaultPath: screenshotWatcher.getDefaultPath(),
  })

  if (result.canceled || !result.filePaths.length) return { canceled: true }

  const chosen = result.filePaths[0]
  settingsHelper.setSetting('settings/paths/screenshotsFolder', chosen)
  screenshotWatcher.startWatcher(chosen, win)
  return { canceled: false, path: chosen }
})

// Renderer asks: restart watcher (e.g. after settings change)
ipcMain.handle('screenshots:restart-watcher', () => {
  const win = windowManager.getWindow('main')
  if (win) initScreenshotWatcher(win)
  return { folder: screenshotWatcher.getWatchedFolder() }
})
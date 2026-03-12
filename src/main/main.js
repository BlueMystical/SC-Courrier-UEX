// src/main/main.js

// #region --- Dependencies ---

const { app, globalShortcut, Tray, Menu, nativeImage, session } = require('electron')
require('dotenv').config()
const path = require('path')
const fs = require('fs')
const { setupAutoUpdater, checkForUpdates } = require('./updater')

// #endregion

// #region --- Identity configuration ---

const packageJson = require(path.resolve(__dirname, '../../package.json'))
const appName = packageJson.productName || 'Courrier-UEX';
app.name = appName;

if (process.env.VITE_DEV_SERVER_URL) {
  const userDataPath = path.join(app.getPath('appData'), appName);
  app.setPath('userData', userDataPath);
}

// #endregion 

// #region --- Dependencies, Own modules ---

const windowManager = require('./windowManager')
const fileHelper = require('./helpers/FileHelper')
const { registerIpcHandlers } = require('./ipcHandlers')
const settingsHelper = require('./helpers/settingsHelper')
const { routeMap } = require('../shared/shortcutsConfig.cjs')
const itemCacheService = require('./services/itemCacheService')
const screenshotWatcher = require('./helpers/screenshotWatcher')

// #endregion

// #region --- SYSTEM TRAY ---

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

// #endregion

// #region --- SHORTCUTS ---

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

// #endregion

// #region --- SCREENSHOTS ---

/** Resolve the screenshots folder:
 * 1. Use saved setting if present and folder exists
 * 2. Fall back to SC default path if it exists
 * 3. Return null → renderer will ask the user to configure it  */
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

// #endregion

// #region --- App lifecycle ---

// Forzar instancia única
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.whenReady().then(async () => {
  try {

    console.log('🚀 App ready...')

    registerIpcHandlers({ createTray, destroyTray, registerShortcuts, initScreenshotWatcher });

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
      itemCacheService.startBackgroundSync(win)
    })

    // Buscar Actualizaciones
    setupAutoUpdater(win)

    // Verificar al arrancar, con un delay para que la app cargue primero
    setTimeout(() => checkForUpdates(), 5000)

  } catch (err) {
    console.error('[APP] Fatal startup error:', err)
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  destroyTray()
  itemCacheService.destroy()
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

// #endregion
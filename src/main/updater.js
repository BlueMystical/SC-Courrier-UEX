// src/main/updater.js

const { autoUpdater } = require('electron-updater')
const { dialog, BrowserWindow } = require('electron')

let mainWindow = null

function getWin() {
  return mainWindow || BrowserWindow.getAllWindows()[0] || null
}

function sendToRenderer(event, data) {
  getWin()?.webContents.send(event, data)
}

function setupAutoUpdater(win) {
  mainWindow = win

  if (!require('electron').app.isPackaged) {
    console.log('[Updater] Dev mode — updates disabled')
    return
  }

  const log = require('electron-log')
  autoUpdater.logger = log
  autoUpdater.logger.transports.file.level = 'debug'
  log.info('[Updater] Logger initialized')

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'BlueMystical',
    repo: 'Courrier-UEX',
    releaseType: 'release'
  })
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.disableWebInstaller = true

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...')
    sendToRenderer('update-status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] Update available: ${info.version}`)
    sendToRenderer('update-status', { status: 'available', version: info.version })

    dialog.showMessageBox(getWin(), {
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} is available.`,
      detail: `Current version: ${require('electron').app.getVersion()}\n\nWould you like to download it now?`,
      buttons: ['Download', 'Later'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        console.log('[Updater] Starting download...')
        sendToRenderer('update-status', { status: 'downloading', percent: 0 })
        // ── Barra de progreso en taskbar ──
        getWin()?.setProgressBar(0)
        autoUpdater.downloadUpdate().catch(err => {
          console.error('[Updater] Download failed:', err.message)
          getWin()?.setProgressBar(-1) // limpiar barra
          sendToRenderer('update-status', { status: 'error', message: err.message })
          dialog.showMessageBox(getWin(), {
            type: 'error',
            title: 'Download Failed',
            message: 'Could not download the update.',
            detail: err.message,
            buttons: ['OK']
          })
        })
      }
    })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] App is up to date.')
    sendToRenderer('update-status', { status: 'up-to-date' })
  })

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent)
    const speed   = Math.round(progress.bytesPerSecond / 1024)
    console.log(`[Updater] Downloading: ${percent}% at ${speed} KB/s`)
    // ── Actualizar barra de taskbar (0.0 a 1.0) ──
    getWin()?.setProgressBar(progress.percent / 100)
    sendToRenderer('update-status', { status: 'downloading', percent, speed })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Updater] Version ${info.version} ready to install`)
    getWin()?.setProgressBar(-1) // limpiar barra
    sendToRenderer('update-status', { status: 'downloaded', version: info.version })

    dialog.showMessageBox(getWin(), {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Restart now to apply the update, or it will be installed automatically when you close the app.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message)
    getWin()?.setProgressBar(-1) // limpiar barra en error
    sendToRenderer('update-status', { status: 'error', message: err.message })
    dialog.showMessageBox(getWin(), {
      type: 'error',
      title: 'Update Error',
      message: 'An error occurred while checking for updates.',
      detail: err.message,
      buttons: ['OK']
    })
  })
}

function checkForUpdates() {
  if (!require('electron').app.isPackaged) return
  autoUpdater.checkForUpdates()
}

module.exports = { setupAutoUpdater, checkForUpdates }
// src/main/updater.js

const { autoUpdater } = require('electron-updater')
const { dialog, BrowserWindow } = require('electron')

function setupAutoUpdater() {
  // En desarrollo no verificar
  if (!require('electron').app.isPackaged) {
    console.log('[Updater] Modo desarrollo — actualizaciones desactivadas')
    return
  }

  autoUpdater.autoDownload = false        // preguntar antes de descargar
  autoUpdater.autoInstallOnAppQuit = true // instalar al cerrar la app

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Verificando actualizaciones...')
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] Nueva versión disponible: ${info.version}`)
    dialog.showMessageBox({
      type: 'info',
      title: 'Actualización disponible',
      message: `Versión ${info.version} disponible.\n¿Descargar ahora?`,
      detail: `Versión actual: ${require('electron').app.getVersion()}`,
      buttons: ['Descargar', 'Más tarde'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate()
      }
    })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] App actualizada.')
  })

  autoUpdater.on('download-progress', (progress) => {
    const msg = `Descargando: ${Math.round(progress.percent)}% (${Math.round(progress.bytesPerSecond / 1024)} KB/s)`
    console.log(`[Updater] ${msg}`)
    // Opcional: enviar al renderer para mostrar progreso
    BrowserWindow.getAllWindows()[0]?.webContents.send('update-progress', progress)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Updater] Versión ${info.version} descargada`)
    dialog.showMessageBox({
      type: 'info',
      title: 'Lista para instalar',
      message: `Versión ${info.version} descargada.\n¿Instalar y reiniciar ahora?`,
      buttons: ['Instalar ahora', 'Al cerrar la app'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message)
  })
}

function checkForUpdates() {
  if (!require('electron').app.isPackaged) return
  autoUpdater.checkForUpdates()
}

module.exports = { setupAutoUpdater, checkForUpdates }
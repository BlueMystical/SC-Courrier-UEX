// src/shared/preload.js
const { contextBridge, ipcRenderer } = require('electron')

// Extraer la ruta inicial de la URL (del hash)
const getInitialRoute = () => {
  const hash = window.location.hash
  return hash.replace('#', '') || '/'
}

contextBridge.exposeInMainWorld('api', {
  getInitialRoute, // Exponer función para obtener ruta inicial

  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, callback) => ipcRenderer.on(channel, (_, ...args) => callback(...args)),

  Windows: {  //<- winodw.api.Windows..
    openWindow: (route, options) => ipcRenderer.send('open-window', { route, options }),
    navigateMain: (route) => ipcRenderer.send('navigate-main', route)
  },
  Settings: { //<- winodw.api.Settings..
    get: (keyPath) => ipcRenderer.invoke('settings:get', keyPath),
    set: (keyPath, value) => ipcRenderer.invoke('settings:set', { keyPath, value }),
    onSettingsChanged: (callback) => ipcRenderer.on('settings-updated', (_, data) => callback(data))
  },
  System: { //<- winodw.api.System..
    getVersion: () => ipcRenderer.invoke('get-version'),

    showOpenDialog: (options) => ipcRenderer.invoke('file:showOpenDialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('file:showSaveDialog', options),
    ShowMessageBox: (options) => ipcRenderer.invoke('ShowMessageBox', options),

    openUrlInBrowser: (url) => ipcRenderer.invoke('file:openUrlInBrowser', url),
    openPathInExplorer: (filePath) => ipcRenderer.invoke('file:openPathInExplorer', filePath),
    openFile: (filePath) => ipcRenderer.invoke('file:openFile', filePath),

    detectProgram: (exeName) => ipcRenderer.invoke('file:detectProgram', exeName),
    terminateProgram: (exeName, options) => ipcRenderer.invoke('file:terminateProgram', exeName, options),
    runScriptOrProgram: (filePath, args) => ipcRenderer.invoke('file:runScriptOrProgram', filePath, args),
  },
  Navigation: {
    onNavigateTo: (callback) => {
      ipcRenderer.on('navigate-to', (event, route) => callback(route))
    },
    offNavigateTo: () => {
      ipcRenderer.removeAllListeners('navigate-to')
    }
  },
  Shortcuts: {
    get: () => ipcRenderer.invoke('shortcuts:get'),
    update: (shortcuts) => ipcRenderer.invoke('shortcuts:update', shortcuts),
  },
  Paths: {
    getAll: () => ipcRenderer.invoke('paths:getAll'),
    get: (name) => ipcRenderer.invoke('paths:get', name),
    join: (...segments) => ipcRenderer.invoke('paths:join', ...segments),
    resolveEnv: (inputPath) => ipcRenderer.invoke('paths:resolveEnv', inputPath),

    /** Obtiene la carpeta padre de una ruta dada.
     * @param {string} givenPath - Ruta absoluta o relativa.
     * @returns {Promise<string>} Carpeta padre de la ruta.
     * @example
     * const parent = await window.api.paths.getParent('C:/foo/bar/file.txt');
     * // parent: 'C:/foo/bar'     */
    getParent: (givenPath) => ipcRenderer.invoke('paths:getParent', givenPath),

    /** Obtiene el nombre base de un archivo, con o sin extensión.
     * @param {string} filePath - Ruta completa al archivo.
     * @param {string} [extension] - Extensión a eliminar (opcional).
     * @returns {Promise<string>} Nombre base del archivo.
     * @example
     * const base = await window.api.paths.getBaseName('C:/foo/bar/file.txt');
     * // base: 'file.txt'
     * const baseNoExt = await window.api.paths.getBaseName('C:/foo/bar/file.txt', '.txt');
     * // baseNoExt: 'file'     */
    getBaseName: (filePath, extension) => ipcRenderer.invoke('paths:getBaseName', filePath, extension),

    getAssetPath: (assetPath) => ipcRenderer.invoke('paths:getAssetPath', assetPath),
    getAssetUrl: (assetPath) => ipcRenderer.invoke('paths:getAssetUrl', assetPath),

    ShowOpenDialog: (options) => ipcRenderer.invoke('file:showOpenDialog', options),
    ShowSaveDialog: (options) => ipcRenderer.invoke('file:showSaveDialog', options),
  },
  Files: {
    copy: (srcDir, destDir, ext) => ipcRenderer.invoke('file:copy', srcDir, destDir, ext),
    move: (srcDir, destDir, ext) => ipcRenderer.invoke('file:move', srcDir, destDir, ext),
    delete: (srcDir, ext) => ipcRenderer.invoke('file:delete', srcDir, ext),
    deleteDir: (dirPath) => ipcRenderer.invoke('file:deleteDir', dirPath),

    list: (dir, extFilter) => ipcRenderer.invoke('file:list', dir, extFilter),
    findFile: (folderPath, pattern) => ipcRenderer.invoke('file:findFile', folderPath, pattern),

    readJSON: (filePath) => ipcRenderer.invoke('file:readJSON', filePath),
    writeJSON: (filePath, obj) => ipcRenderer.invoke('file:writeJSON', filePath, obj),

    checkExists: (filePath) => ipcRenderer.invoke('file:checkExists', filePath),
    ensureDir: (dirPath) => ipcRenderer.invoke('file:ensureDir', dirPath),

    downloadAsset: (url, destination) => ipcRenderer.invoke('file:downloadAsset', url, destination),

    /** Descarga un archivo desde una URL y lo guarda en la ruta especificada.
     * Puedes escuchar el progreso de la descarga usando `onDownloadProgress`.
     *
     * @param {string} url - URL completa del archivo a descargar.
     * @param {string} filePath - Ruta local donde guardar el archivo descargado.
     * @returns {Promise<void>} - Promesa que se resuelve cuando la descarga finaliza.
     *
     * @example
     * // Inicia la descarga y escucha el progreso:
     * window.api.files.onDownloadProgress((event, data) => {
     *   // data.progress: porcentaje (0-100)
     *   // data.speed: velocidad en bytes/segundo
     *   console.log(`Progreso: ${data.progress}% - Velocidad: ${data.speed} B/s`);
     * });
     *
     * await window.api.files.downloadFile(
     *   'https://servidor.com/archivo.zip',
     *   'C:/descargas/archivo.zip'
     * );      */
    downloadFile: (url, filePath) => ipcRenderer.invoke('download-file', url, filePath),
    onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
    removeDownloadProgress: (callback) => ipcRenderer.removeListener('download-progress', callback),

  },

  // ── SCREENSHOT WATCHER ──────────────────────────────────────────
  // window.api.Screenshots.*
  Screenshots: {
    // Get current watched folder and the SC default path
    getFolder: () => ipcRenderer.invoke('screenshots:get-folder'),

    // Open a native folder picker and save the result
    pickFolder: () => ipcRenderer.invoke('screenshots:pick-folder'),

    // Restart the watcher (call after changing the folder in Settings)
    restartWatcher: () => ipcRenderer.invoke('screenshots:restart-watcher'),

    // Called when a new screenshot is detected — { filename, filePath, dataUrl, base64, mimeType, size, timestamp }
    onNew: (callback) => ipcRenderer.on('screenshot:new', (_, data) => callback(data)),
    offNew: () => ipcRenderer.removeAllListeners('screenshot:new'),

    // Called when the watched folder doesn't exist
    onFolderMissing: (callback) => ipcRenderer.on('screenshot:folder-missing', (_, data) => callback(data)),
    offFolderMissing: () => ipcRenderer.removeAllListeners('screenshot:folder-missing'),

    // Called when a file is too large to process
    onTooLarge: (callback) => ipcRenderer.on('screenshot:too-large', (_, data) => callback(data)),

    // Called when watcher starts successfully
    onWatcherStarted: (callback) => ipcRenderer.on('screenshot:watcher-started', (_, data) => callback(data)),

    // Called on watcher error
    onWatcherError: (callback) => ipcRenderer.on('screenshot:watcher-error', (_, data) => callback(data)),
  },

  // ── OCR ─────────────────────────────────────────────────────────
  // window.api.OCR.*
  OCR: {
    // Process a screenshot: { base64, mimeType } → { success, rawText, type, items, processedImageBase64 }
    process: (data) => ipcRenderer.invoke('ocr:process', data),
  },

  UEX: {
    checkToken: () => ipcRenderer.invoke('uex:checkToken'),
    saveToken: (token) => ipcRenderer.invoke('uex:saveToken', token),
    initialSync: () => ipcRenderer.invoke('uex:initialSync'),
    validateToken: () => ipcRenderer.invoke('uex:validateToken'),
    submitCommodity: (data) => ipcRenderer.invoke('uex:submitCommodity', data),
    submitItem: (data) => ipcRenderer.invoke('uex:submitItem', data),
    getCache: () => ipcRenderer.invoke('uex:getCache'),
  },

  // ── ITEM CACHE ─────────────────────────────────────────────────────────────
  // window.api.Items.*
  Items: {
    /** Get flat array of all cached items (for fuzzy-match / dropdowns).
     *  Returns [] if background sync hasn't completed yet.
     *  @returns {Promise<Array>}  */
    getAll: () => ipcRenderer.invoke('items:getAll'),

    /** Get cached item categories.
     *  @returns {Promise<Array>}  */
    getCategories: () => ipcRenderer.invoke('items:getCategories'),

    /** Get current sync status.
     *  @returns {Promise<{state, progress, total, done, cached, lastSync, error}>}  */
    getSyncStatus: () => ipcRenderer.invoke('items:getSyncStatus'),

    /** Force an immediate full re-sync. Progress events will fire on the events below.
     *  @returns {Promise<object>} final status  */
    forceSync: () => ipcRenderer.invoke('items:forceSync'),

    /** Returns whether the item cache is fresh (< 24h old).
     *  @returns {Promise<boolean>}  */
    isCacheFresh: () => ipcRenderer.invoke('items:isCacheFresh'),

    // ── Progress events (subscribe in your Vue component) ──────────────────
    // Fired when background sync starts
    onSyncStart: (cb) => ipcRenderer.on('items-cache:sync-start', (_, d) => cb(d)),
    // Fired after categories are loaded: { count, categories[] }
    onCategoriesLoaded: (cb) => ipcRenderer.on('items-cache:categories-loaded', (_, d) => cb(d)),
    // Fired per category: { done, total, progress, category, section, count }
    onProgress: (cb) => ipcRenderer.on('items-cache:progress', (_, d) => cb(d)),
    // Fired when sync finishes: { total, errors, lastSync, fromCache? }
    onSyncComplete: (cb) => ipcRenderer.on('items-cache:sync-complete', (_, d) => cb(d)),
    // Fired on sync error: { error }
    onSyncError: (cb) => ipcRenderer.on('items-cache:sync-error', (_, d) => cb(d)),

    // Cleanup helpers
    offAll: () => {
      ipcRenderer.removeAllListeners('items-cache:sync-start')
      ipcRenderer.removeAllListeners('items-cache:categories-loaded')
      ipcRenderer.removeAllListeners('items-cache:progress')
      ipcRenderer.removeAllListeners('items-cache:sync-complete')
      ipcRenderer.removeAllListeners('items-cache:sync-error')
    },
  },

  // ── CACHE MANAGEMENT ───────────────────────────────────────────────────────
  // window.api.Cache.*  (for Settings/Debug UI)
  Cache: {
    /** Get stats for all cache keys.
     *  @returns {Promise<Array<{key, count, ageMinutes, ttlHours, remainingHours, expired}>>}  */
    getStats: () => ipcRenderer.invoke('cache:getStats'),

    /** Invalidate a specific cache key (forces re-fetch on next use).
     *  Valid keys: 'terminals', 'commodities', 'items', 'item_categories', 'stations'
     *  @param {string} key
     *  @returns {Promise<{success, key}>}  */
    invalidate: (key) => ipcRenderer.invoke('cache:invalidate', key),
  },
})
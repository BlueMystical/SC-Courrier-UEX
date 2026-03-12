// src/main/windowManager.js
const { BrowserWindow, app, shell, Menu } = require('electron')
const path = require('path')
const windows = {}
const packageJson = require('../../package.json'); //<- Importamos el package.json para leer sus propiedades

function createWindow(id, route = '/', options = {}) {
    if (windows[id]) {
        windows[id].focus()
        return windows[id]
    }

    // Detectar el path correcto del icono según el entorno
    let iconPath;

    if (process.env.VITE_DEV_SERVER_URL) {
        // Modo desarrollo: desde src/main hacia resources
        iconPath = path.join(__dirname, '../../resources/SC-Courrier-UEX_Logo_01.ico');
    } else if (app.isPackaged) {
        // Modo producción empaquetado (electron-builder)
        iconPath = path.join(process.resourcesPath, 'resources/SC-Courrier-UEX_Logo_01.ico');
    } else {
        // Modo producción sin empaquetar (npm run prod)
        iconPath = path.join(__dirname, '../../resources/SC-Courrier-UEX_Logo_01.ico');
    }

    // Definimos valores por defecto y los mezclamos con las opciones recibidas
    const win = new BrowserWindow({
        width: options.width || 961,
        height: options.height || 650,
        useContentSize: true, // <--- IMPORTANTE: Hace que el área de Vue mida exactamente 961x650
        show: false,
        icon: iconPath,
        title: `${packageJson.productName || 'Courrier-UEX'} v${packageJson.version}`,
        backgroundColor: '#ffffff',
        webPreferences: {
            preload: path.join(__dirname, '../shared/preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        ...options // Las opciones pasadas por parámetro tienen la última palabra
    });
    win.setMenu(null); // ← Elimina la barra de menú completamente en esta ventana

    // Efecto "Ready to Show": Evita ver la ventana vacía o cargando
    win.once('ready-to-show', () => {
        win.show()
        win.focus()
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${route}`)
        // DevTools en desarrollo
        win.webContents.openDevTools({ mode: 'detach' })
    } else {
        win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'), {
            hash: route
        })
    }

    // Atajo local para DevTools 
    win.webContents.on('before-input-event', (event, input) => {
        // Ctrl+Shift+I o Shift+F1 → DevTools (dev)
        // F1 → DevTools (dev Y prod)
        const isDevToolsShortcut =
            (input.control && input.shift && input.key.toLowerCase() === 'i') ||
            (input.shift && input.key.toLowerCase() === 'f1') ||
            (input.key === 'F1')  // ← F1 solo, funciona en prod también

        if (isDevToolsShortcut) {
            if (win.webContents.isDevToolsOpened()) {
                win.webContents.closeDevTools()
            } else {
                win.webContents.openDevTools({ mode: 'detach' })
            }
            event.preventDefault()
        }
    })

    // Interceptar navegación de links (cuando el usuario hace click)
    win.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith('http')) {
            event.preventDefault()
            shell.openExternal(url)
        }
    })

    // Interceptar apertura de nuevas ventanas (target="_blank")
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            shell.openExternal(url)
        }
        return { action: 'deny' }
    })

    // 
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self';" +
                    "img-src 'self' data: https://*.uexcorp.space https://media.robertsspaceindustries.com https://robertsspaceindustries.com;" +
                    "script-src 'self';" +
                    "style-src 'self' 'unsafe-inline';" +
                    "connect-src 'self' https://api.uexcorp.uk;"
                ]
            }
        })
    })

    windows[id] = win

    win.on('closed', () => {
        delete windows[id]
    })

    return win
}

function getWindow(id) {
    return windows[id]
}

module.exports = { createWindow, getWindow }
// src/shared/shortcutsConfig.cjs
// This file defines the configuration for the application's shortcuts, including their labels, routes, icons, and default key combinations.

// FUENTE DE VERDAD — edita solo este archivo, luego copia los datos al .js
const shortcutsConfig = [
  { key: 'home',              label: 'Home',                route: '/',                   icon: 'pi pi-home',      defaultShortcut: 'Ctrl+Alt+H' },
  { key: 'commodities',       label: 'Commodities',         route: '/buysell/comodities', icon: 'pi pi-chart-bar', defaultShortcut: 'Ctrl+Alt+C' },
  { key: 'items',             label: 'Items',               route: '/buysell/items',      icon: 'pi pi-tag',       defaultShortcut: 'Ctrl+Alt+I' },
  { key: 'vehicles',          label: 'Vehicles',            route: '/buysell/vehicles',   icon: 'pi pi-car',       defaultShortcut: 'Ctrl+Alt+V' },
  { key: 'settings',          label: 'Settings',            route: '/settings',           icon: 'pi pi-cog',       defaultShortcut: 'Ctrl+Alt+S' },
  { key: 'datarunnerCapture', label: 'Data Runner Capture', route: '/datarunner-capture', icon: 'pi pi-camera',    defaultShortcut: 'Ctrl+Alt+D' },
]
const routeMap = Object.fromEntries(shortcutsConfig.map(s => [s.key, s.route]))
const defaultShortcuts = Object.fromEntries(shortcutsConfig.map(s => [s.key, s.defaultShortcut]))
module.exports = { shortcutsConfig, routeMap, defaultShortcuts }
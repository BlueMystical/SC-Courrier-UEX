// src/shared/shortcutsConfig.js
// ESPEJO del .cjs — si agregas rutas allá, cópialas aquí también
export const shortcutsConfig = [
  { key: 'home',              label: 'Home',                route: '/',                   icon: 'pi pi-home',      defaultShortcut: 'Ctrl+Alt+H' },
  { key: 'commodities',       label: 'Commodities',         route: '/buysell/comodities', icon: 'pi pi-chart-bar', defaultShortcut: 'Ctrl+Alt+C' },
  { key: 'items',             label: 'Items',               route: '/buysell/items',      icon: 'pi pi-tag',       defaultShortcut: 'Ctrl+Alt+I' },
  { key: 'vehicles',          label: 'Vehicles',            route: '/buysell/vehicles',   icon: 'pi pi-car',       defaultShortcut: 'Ctrl+Alt+V' },
  { key: 'settings',          label: 'Settings',            route: '/settings',           icon: 'pi pi-cog',       defaultShortcut: 'Ctrl+Alt+S' },
  { key: 'datarunnerCapture', label: 'Data Runner Capture', route: '/datarunner-capture', icon: 'pi pi-camera',    defaultShortcut: 'Ctrl+Alt+D' },
]
export const routeMap = Object.fromEntries(shortcutsConfig.map(s => [s.key, s.route]))
export const defaultShortcuts = Object.fromEntries(shortcutsConfig.map(s => [s.key, s.defaultShortcut]))
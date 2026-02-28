// src/shared/shortcutsConfig.js
// Used by Settings.vue via import (Vite/ESM)
// To add a new route, edit ONLY this file (and the .cjs twin below it)

export const shortcutsConfig = [
  {
    key: 'home',
    label: 'Home',
    route: '/',
    icon: 'pi pi-home',
    defaultShortcut: 'Alt+1',
  },
  {
    key: 'commodities',
    label: 'Commodities',
    route: '/buysell/comodities',
    icon: 'pi pi-chart-bar',
    defaultShortcut: 'Alt+2',
  },
  {
    key: 'items',
    label: 'Items',
    route: '/buysell/items',
    icon: 'pi pi-tag',
    defaultShortcut: 'Alt+3',
  },
  {
    key: 'vehicles',
    label: 'Vehicles',
    route: '/buysell/vehicles',
    icon: 'pi pi-car',
    defaultShortcut: 'Alt+4',
  },
  {
    key: 'settings',
    label: 'Settings',
    route: '/settings',
    icon: 'pi pi-cog',
    defaultShortcut: 'Alt+S',
  },
  {
    key: 'datarunnerCapture',
    label: 'Data Runner Capture',
    route: '/datarunner-capture',
    icon: 'pi pi-camera',
    defaultShortcut: 'Alt+D',
  },
]

export const routeMap = Object.fromEntries(
  shortcutsConfig.map(s => [s.key, s.route])
)

export const defaultShortcuts = Object.fromEntries(
  shortcutsConfig.map(s => [s.key, s.defaultShortcut])
)

// src/renderer/router.js
import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/Home.vue'
import SettingsView from './views/Settings.vue'
import NotFound from './views/NotFound.vue'

const routes = [
  { path: '/', component: HomeView, meta: { title: 'Home' } },
  { path: '/settings', component: SettingsView, meta: { title: 'Settings', hideMenubar: true } }, //<- Muestra en ventana nueva sin menubar
  {
    path: '/buysell/comodities', name: 'Commodities',
    component: () => import('./views/BuySell/Commodities.vue'),
    meta: { title: 'Commodity Prices' }
  },
  {
    path: '/buysell/items', name: 'Items',
    component: () => import('./views/BuySell/Items.vue'),
    meta: { title: 'Item Prices' }
  },
  {
    path: '/buysell/vehicles', name: 'Vehicles',
    component: () => import('./views/BuySell/Vehicles.vue'),
    meta: { title: 'Vehicle Market' }
  },
  { path: '/buysell/marketplace', component: () => import('@/views/BuySell/Marketplace.vue') },
  {
    path: '/datarunner-capture',
    name: 'DatarunnerCaptures',
    component: () => import('./views/Datarunner/DatarunnerCaptures.vue'),
    meta: { title: 'Datarunner Captures' }
  },
  {
    path: '/uex-notifications', name: 'UexNotifications', component: () => import('./views/UexNotifications.vue'),
    meta: { title: 'UEX Notifications' }
  },
  // otras rutas aquí
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: NotFound,
    meta: { title: '404 - No Encontrada' }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// Variable para saber si es la primera navegación
let isInitialNavigation = true

//- Antes de cada navegación:
router.beforeEach((to, from, next) => {
  // Si es la navegación inicial, permitirla siempre
  if (isInitialNavigation) {
    isInitialNavigation = false
    next()
    return
  }

  // Si la ruta tiene hideMenubar y NO es la navegación inicial, abrir en ventana nueva
  if (to.meta.hideMenubar && window.api?.Windows?.openWindow) {
    window.api.Windows.openWindow(to.path, {
      width: 961,
      height: 650,
      title: to.meta.title || 'Material App'
    })
    // Cancelar la navegación en la ventana actual
    next(false)
  } else {
    // Navegación normal
    next()
  }
})

export default router
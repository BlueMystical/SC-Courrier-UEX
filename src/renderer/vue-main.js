// src/renderer/vue-main.js
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

// --- CONFIGURACIÓN DE PINIA ---
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
// ---------------------------------

import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'

import Aura from '@primeuix/themes/aura'
import Material from '@primeuix/themes/material'
import Lara from '@primeuix/themes/lara'
import Nora from '@primeuix/themes/nora'
import { definePreset } from '@primeuix/themes'
import 'primeicons/primeicons.css'

// Función para crear preset personalizado con color primario
function createCustomPreset(basePreset, colorName, customHex = null) {
  if (colorName === 'custom' && customHex) {
    return definePreset(basePreset, {
      semantic: {
        primary: generateColorScale(customHex)
      }
    })
  }

  return definePreset(basePreset, {
    semantic: {
      primary: {
        50: `{${colorName}.50}`,
        100: `{${colorName}.100}`,
        200: `{${colorName}.200}`,
        300: `{${colorName}.300}`,
        400: `{${colorName}.400}`,
        500: `{${colorName}.500}`,
        600: `{${colorName}.600}`,
        700: `{${colorName}.700}`,
        800: `{${colorName}.800}`,
        900: `{${colorName}.900}`,
        950: `{${colorName}.950}`
      }
    }
  })
}

function generateColorScale(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)

  const scale = {}
  const steps = [
    { key: '50', lightness: 0.95 },
    { key: '100', lightness: 0.9 },
    { key: '200', lightness: 0.8 },
    { key: '300', lightness: 0.7 },
    { key: '400', lightness: 0.6 },
    { key: '500', lightness: 0.5 },
    { key: '600', lightness: 0.4 },
    { key: '700', lightness: 0.3 },
    { key: '800', lightness: 0.2 },
    { key: '900', lightness: 0.1 },
    { key: '950', lightness: 0.05 }
  ]

  steps.forEach(({ key, lightness }) => {
    if (lightness > 0.5) {
      const factor = (lightness - 0.5) * 2
      scale[key] = `rgb(${Math.round(r + (255 - r) * factor)}, ${Math.round(g + (255 - g) * factor)}, ${Math.round(b + (255 - b) * factor)})`
    } else {
      const factor = 1 - (lightness * 2)
      scale[key] = `rgb(${Math.round(r * (1 - factor))}, ${Math.round(g * (1 - factor))}, ${Math.round(b * (1 - factor))})`
    }
  })

  return scale
}

const BASE_PRESETS = { aura: Aura, material: Material, lara: Lara, nora: Nora }

;(async () => {
  try {
    const currentColorMode = await window.api.Settings.get('settings/theme/color')
    const currentPreset = await window.api.Settings.get('settings/theme/preset')
    const currentPrimaryColor = await window.api.Settings.get('settings/theme/primaryColor')

    console.log('🎨 Loading theme configuration:')
    console.log('  - Color mode:', currentColorMode || 'light')
    console.log('  - Preset:', currentPreset || 'aura')
    console.log('  - Primary color:', currentPrimaryColor || 'emerald')

    const root = document.documentElement
    if (currentColorMode === 'dark') {
      root.classList.add('app-dark')
      console.log('  ✓ Dark mode applied')
    } else {
      root.classList.remove('app-dark')
      console.log('  ✓ Light mode applied')
    }

    const basePreset = BASE_PRESETS[currentPreset] || Aura
    const primaryColor = currentPrimaryColor || 'emerald'

    let customPreset
    if (primaryColor === 'custom') {
      const customHex = await window.api.Settings.get('settings/theme/customColor')
      customPreset = createCustomPreset(basePreset, 'custom', customHex || '#10b981')
      console.log('  ✓ Custom preset with hex:', customHex || '#10b981')
    } else {
      customPreset = createCustomPreset(basePreset, primaryColor)
      console.log('  ✓ Custom preset with color:', primaryColor)
    }

    const app = createApp(App)

    const pinia = createPinia()
    pinia.use(piniaPluginPersistedstate)
    app.use(pinia)
    console.log('  ✓ Pinia & Persistence configured')

    app.use(PrimeVue, {
      theme: {
        preset: customPreset,
        options: {
          darkModeSelector: '.app-dark',
          cssLayer: {
            name: 'primevue',
            order: 'tailwind-base, primevue, tailwind-utilities'
          },
          prefix: 'p'
        }
      }
    })

    app.use(ToastService)
    app.use(ConfirmationService)
    app.use(router)

    //  DETECTAR RUTA INICIAL Y NAVEGAR
    const initialRoute = window.api?.getInitialRoute ? window.api.getInitialRoute() : '/'
    console.log('🔗 Initial route detected:', initialRoute)

    // Esperar a que el router esté listo
    await router.isReady()
    
    // Si hay una ruta inicial diferente a '/', navegar a ella
    if (initialRoute && initialRoute !== '/') {
      console.log('🔗 Navigating to:', initialRoute)
      await router.push(initialRoute)
    }

    // Montar la aplicación
    app.mount('#app')

    async function syncTerminalsFromRenderer() {
      try {
        console.log('[UEX] 🔄 Fetching terminals from renderer...')

        const response = await fetch('https://api.uexcorp.uk/2.0/terminals')
        const data = await response.json()

        await window.api.invoke('uex:cacheTerminals', data)

        console.log('[UEX] ✅ Terminals synced successfully')
      } catch (err) {
        console.error('[UEX] ❌ Renderer sync failed:', err)
      }
    }

    syncTerminalsFromRenderer()

    // ── Item catalogue sync ───────────────────────────────────────────────────
    // Fetch all items from UEX API and send to main process cache.
    // Called on startup AND whenever main sends 'items-cache:request-sync' (force/24h refresh).
    async function syncItemsFromRenderer() {
      try {
        console.log('[ItemCache] 🔄 Fetching item categories from renderer...')
        const BASE = 'https://api.uexcorp.uk/2.0'

        // 1. Fetch categories
        const catRes = await fetch(`${BASE}/categories?type=item`)
        const catData = await catRes.json()
        if (catData.status !== 'ok') throw new Error(`categories API: ${catData.status}`)
        const categories = catData.data || []
        console.log(`[ItemCache] Found ${categories.length} categories — fetching items...`)

        // 2. Fetch items per category (sequential, polite)
        const allItems = []
        for (let i = 0; i < categories.length; i++) {
          const cat = categories[i]
          try {
            const res = await fetch(`${BASE}/items?id_category=${cat.id}`)
            const data = await res.json()
            if (data.status === 'ok') allItems.push(...(data.data || []))
            console.log(`[ItemCache]  ✓ [${i+1}/${categories.length}] ${cat.name}: ${data.data?.length ?? 0} items`)
          } catch (e) {
            console.warn(`[ItemCache] ⚠️  Category ${cat.id} (${cat.name}) failed: ${e.message}`)
          }
          // Small delay between requests
          if (i < categories.length - 1) await new Promise(r => setTimeout(r, 200))
        }

        // 3. Send to main process to cache
        await window.api.invoke('uex:cacheItems', { categories, items: allItems })
        console.log(`[ItemCache] ✅ ${allItems.length} items synced to main cache`)

      } catch (err) {
        console.error('[ItemCache] ❌ Renderer sync failed:', err)
        await window.api.invoke('uex:cacheItemsError', err.message)
      }
    }

    syncItemsFromRenderer()

    // Listen for re-sync requests from main (force sync / 24h refresh)
    window.api.on('items-cache:request-sync', () => {
      console.log('[ItemCache] 📡 Re-sync requested by main process')
      syncItemsFromRenderer()
    })

    console.log('  ✓ App mounted successfully')
  } catch (error) {
    console.error('❌ Error initializing app:', error)
  }
})()
<!-- src/renderer/App.vue -->
<template>
    <div class="layout-wrapper">
        <!-- Menubar condicional -->
        <div v-if="!hideMenubar" class="card p-0">
            <Menubar :model="menubarItems" class="custom-menubar">

                <template #item="{ item, props, hasSubmenu }">
                    <router-link v-if="item.route" v-slot="{ href, navigate }" :to="item.route" custom>
                        <a v-ripple :href="href" v-bind="props.action" @click="navigate"
                            class="flex align-items-center">
                            <img v-if="item.image" :src="item.image" :alt="item.label" class="menu-item-image" />
                            <span v-else-if="item.icon" :class="item.icon" />
                            <span class="ml-2">{{ item.label }}</span>
                            <span v-if="item.shortcut" class="menu-shortcut-badge">
                                {{ item.shortcut }}
                            </span>
                        </a>
                    </router-link>

                    <a v-else v-ripple :href="item.url" :target="item.target" v-bind="props.action"
                        class="flex align-items-center">
                        <img v-if="item.image" :src="item.image" :alt="item.label" class="menu-item-image" />
                        <span v-else-if="item.icon" :class="item.icon" />
                        <span class="ml-2">{{ item.label }}</span>
                        <span v-if="item.shortcut" class="menu-shortcut-badge">
                            {{ item.shortcut }}
                        </span>

                        <span v-if="hasSubmenu" class="pi pi-fw pi-angle-down ml-2" />
                    </a>
                </template>

                <template #end>
                    <div class="flex items-center">
                        <Breadcrumb :home="home" :model="breadcrumbItems" class="custom-breadcrumb">
                            <template #item="{ item }">
                                <router-link v-if="item.route" :to="item.route" class="breadcrumb-link">
                                    <span v-if="item.icon" :class="[item.icon, 'mr-1']"></span>
                                    <span>{{ item.label }}</span>
                                </router-link>
                                <span v-else class="breadcrumb-text">{{ item.label }}</span>
                            </template>
                        </Breadcrumb>
                        <UserMenu />
                    </div>
                </template>
            </Menubar>
        </div>

        <Toast position="bottom-right" />
        <Alert position="top-right" />
        <ErrorNotification position="top-right" />
        <ConfirmDialog>
            <template #message="slotProps">
                <div class="custom-confirm-message" v-html="slotProps.message.message"></div>
            </template>
        </ConfirmDialog>
        <GroupedNotifications position="bottom-right" />
        <ProgressNotifications />

        <div class="card mt-2">
            <router-view />
        </div>

        <!-- Barra de progreso de actualización -->
        <Transition name="slide-down">
            <div v-if="updateStatus.visible" class="update-progress-bar">
                <div class="update-progress-inner">
                    <span class="update-progress-icon pi pi-download"></span>
                    <span class="update-progress-text">
                        {{ updateStatus.message }}
                    </span>
                    <div v-if="updateStatus.percent > 0" class="update-progress-track">
                        <div class="update-progress-fill" :style="{ width: updateStatus.percent + '%' }"></div>
                    </div>
                    <span v-if="updateStatus.percent > 0" class="update-progress-pct">
                        {{ updateStatus.percent }}%
                    </span>
                </div>
            </div>
        </Transition>

    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue"; // Añadido ref
import { useRoute, useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import { PrimeIcons } from '@primevue/core/api';

// PrimeVue Components
import Menubar from 'primevue/menubar';
import Breadcrumb from 'primevue/breadcrumb';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';

// Custom Components & Store
import { useAppStore } from './AppStore';
import { initNetworkMonitor } from '@/helpers/network';
import UserMenu from './components/Login/UserMenu.vue';
import Alert from './components/Notificaciones/Alert.vue';

import { useNotify, toastBus } from '@/components/Notificaciones/Notify';
import ErrorNotification from './components/Notificaciones/ErrorNotification.vue';
import GroupedNotifications from './components/Notificaciones/GroupedNotifications.vue';
import ProgressNotifications from './components/Notificaciones/ProgressNotifications.vue';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const store = useAppStore();
const notify = useNotify();

// --- SEGURIDAD ---
const idleMinutes = ref(15); // <--- DECLARACIÓN FALTANTE REPARADA
let intervaloInactividad = null;

// Convertimos los minutos a milisegundos de forma reactiva
const TIEMPO_LIMITE_MS = computed(() => idleMinutes.value * 60 * 1000);

// ── UPDATE PROGRESS ──────────────────────────────────────
const updateStatus = ref({ visible: false, message: '', percent: 0 })

const registrarInteraccion = () => {
    if (store.currentUser) {
        store.updateActivity();
    }
};

const verificarInactividad = () => {
    // Si no hay usuario o el timeout es 0, desactivamos
    if (!store.currentUser || idleMinutes.value === 0) return;

    const ahora = Date.now();
    const tiempoTranscurrido = ahora - (store.lastActivity || ahora);

    if (tiempoTranscurrido > TIEMPO_LIMITE_MS.value) {
        store.logout();
        notify.sticky(
            `Sesión cerrada por inactividad (${idleMinutes.value} min).`,
            'Seguridad',
            'info'
        );
    }
};

async function checkUEXToken() {
    const hasToken = await window.api.UEX.checkToken()

    if (!hasToken) {
        notify.sticky(
            'Debes configurar tu UEX API Token para habilitar la subida de datos.',
            'UEX no configurado',
            'warn'
        )
    }
}

// Computed para ocultar/mostrar menubar
const hideMenubar = computed(() => route.meta.hideMenubar || false);

// --- CONFIGURACIÓN DEL MENUBAR ---
const menubarItems = computed(() => {
    const s = store.shortcuts || {};

    return [
        {
            label: 'Courrier-UEX',
            image: new URL('@/assets/SC-Courrier-UEX_Logo_01.ico', import.meta.url).href,
            items: [
                {
                    label: 'Features',
                    icon: PrimeIcons.BARS,
                    items: store.funcionalidades && store.funcionalidades.length > 0
                        ? store.funcionalidades
                        : [{ label: 'Login to access', disabled: true }]
                },
                { separator: true },
                // Añadimos la propiedad shortcut aquí:
                { label: 'Home', icon: PrimeIcons.HOME, route: '/', shortcut: 'Ctrl+1' },
                { label: 'Settings', icon: PrimeIcons.COG, route: '/settings', shortcut: 'Alt+S' },
            ]
        }
    ];
});

// --- BREADCRUMB ---
const breadcrumbItems = computed(() => {
    return route.matched.map(r => ({
        label: r.meta?.title || r.path.split('/').pop() || 'Home',
        route: r.path
    }));
});

const home = { icon: PrimeIcons.HOME, route: '/' };

// --- NOTIFICACIONES ---
watch(() => toastBus.data, (newData) => {
    if (newData?.clear) {
        toast.removeAllGroups();
    } else if (newData && newData.severity !== 'custom-orange' && newData.severity !== 'error-notification') {
        toast.add(newData);
    }
});

function applyDarkClass(mode) {
    const root = document.documentElement;
    if (mode === 'dark') {
        root.classList.add('app-dark');
    } else {
        root.classList.remove('app-dark');
    }
}

// Mostrar las últimas 3 notificaciones no leídas al arrancar
async function checkUEXNotifications() {
    if (!store.currentUser) return
    try {
        const result = await window.api.UEX.getNotifications()
        if (!result.success || !result.data?.length) return

        // Leer IDs ya vistos
        const savedIds = await window.api.Settings.get('settings/uex/readNotifications') || []
        const readSet = new Set(savedIds)

        const unread = result.data
            .filter(n => !readSet.has(n.id) && !(n.date_read > 0))
            .sort((a, b) => b.date_added - a.date_added)
            .slice(0, 3)

        if (unread.length === 0) return

        // Pequeño delay para que la app cargue primero
        setTimeout(() => {
            unread.forEach((n, i) => {
                setTimeout(() => {
                    const link = n.redir
                        ? ` <a href="https://uexcorp.space/${n.redir}" target="_blank" style="color:white;text-decoration:underline;">View on UEX</a>`
                        : ''
                    notify.alert(`${n.message}${link}`, 'UEX Notification')
                }, i * 400)
            })
        }, 2000)

    } catch (e) {
        console.warn('[Notifications] Could not load UEX notifications:', e.message)
    }
}

onMounted(async () => {
    initNetworkMonitor();

    // 1. AUTO-LOGIN
    const savedUser = await window.api.Settings.get('settings/security/user');
    const rememberMe = await window.api.Settings.get('settings/security/rememberMe');

    if (savedUser && rememberMe) {
        store.login(savedUser);
    }

    // 2. CARGAR VALOR INICIAL TIMEOUT
    const savedIdle = await window.api.Settings.get('settings/security/idleMinutesTimeout');
    if (savedIdle !== undefined) {
        idleMinutes.value = Number(savedIdle);
    }

    // 3. REGISTRAR EVENTOS
    const eventosInteraccion = ['mousedown', 'mousemove', 'keypress', 'touchstart', 'click'];
    eventosInteraccion.forEach(ev => window.addEventListener(ev, registrarInteraccion));

    // 4. INTERVALO (Cada 30 segundos)
    intervaloInactividad = setInterval(verificarInactividad, 30000);

    // 5. LISTENER DE CAMBIOS EN SETTINGS
    if (window.api?.Settings?.onSettingsChanged) {
        window.api.Settings.onSettingsChanged(({ keyPath, value }) => {
            if (keyPath === 'settings/security/idleMinutesTimeout') {
                idleMinutes.value = Number(value);
                console.log(`⏱️ Timeout actualizado: ${value} min`);
            }

            if (keyPath === 'settings/theme/color') {
                applyDarkClass(value);
            }
        });
    }

    await checkUEXToken()
    await checkUEXNotifications()

    window.api?.Navigation?.onNavigateTo((ruta) => {
        router.push(ruta)
    })

    // Escuchar estado del updater
    window.api.on('update-status', (data) => {
        switch (data.status) {
            case 'checking':
                // silencioso, no mostrar nada
                break
            case 'downloading':
                updateStatus.value = {
                    visible: true,
                    message: `Downloading update... ${data.speed ? data.speed + ' KB/s' : ''}`,
                    percent: data.percent || 0
                }
                break
            case 'downloaded':
                updateStatus.value = {
                    visible: true,
                    message: `v${data.version} ready — restart to install`,
                    percent: 100
                }
                break
            case 'error':
                updateStatus.value = { visible: false, message: '', percent: 0 }
                break
            default:
                updateStatus.value = { visible: false, message: '', percent: 0 }
        }
    })

});

onUnmounted(() => {
    const eventosInteraccion = ['mousedown', 'mousemove', 'keypress', 'touchstart', 'click'];
    eventosInteraccion.forEach(ev => window.removeEventListener(ev, registrarInteraccion));
    if (intervaloInactividad) clearInterval(intervaloInactividad);
    window.api?.Navigation?.offNavigateTo();
});
</script>

<style>
/* Estilos Globales */
* {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

body,
#app {
    font-family: 'Segoe UI', sans-serif;
}

.p-component {
    font-family: 'Segoe UI', sans-serif !important;
}
</style>

<style scoped>
.menu-item-image {
    height: 16px;
    width: 16px;
    object-fit: contain;
    vertical-align: middle;
}

.card.p-0 {
    padding: 2px !important;
    border-radius: 6px;
}

.custom-menubar {
    padding: 0 1rem;
    height: 36px;
    border: none;
    border-radius: 4px;
}

:deep(.p-menubar) {
    height: 36px;
    padding: 0 1rem;
}

.custom-breadcrumb {
    background: transparent !important;
    border: none !important;
    padding: 0 !important;
    height: 36px;
    display: flex;
    align-items: center;
}

:deep(.custom-breadcrumb .p-breadcrumb-list) {
    margin: 0 !important;
    height: 36px;
    display: flex;
    align-items: center;
}

:deep(.custom-breadcrumb .p-breadcrumb-list li .breadcrumb-link) {
    color: var(--p-text-color) !important;
    text-decoration: none !important;
    font-size: 0.875rem;
}

:deep(.custom-breadcrumb .p-breadcrumb-list li .breadcrumb-link:hover) {
    color: var(--p-primary-color) !important;
}

.flex.items-center {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.layout-wrapper {
    font-family: 'Segoe UI', sans-serif;
}

.menu-shortcut-badge {
    margin-left: auto;
    /* Empuja el atajo a la derecha */
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;

    /* Usando variables de PrimeVue para coherencia de color */
    color: var(--p-primary-color);
    background: var(--p-secondary-100);
    /* Un fondo suave del color secundario */
    border: 1px solid var(--p-secondary-200);

    /* En modo oscuro, ajustamos un poco */
    transition: background 0.2s;
}

/* Estilo para que el contenedor de la fila use Flexbox */
:deep(.p-menubar-item-link) {
    display: flex !important;
    align-items: center;
}

/* Si el item está hovered, podemos resaltar el badge */
:deep(.p-menubar-item-link:hover) .menu-shortcut-badge {
    background: var(--p-primary-color);
    color: white;
}

.update-progress-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    background: var(--p-primary-color);
    color: white;
    padding: 0.4rem 1rem;
}

.update-progress-inner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: 100%;
}

.update-progress-track {
    flex: 1;
    height: 6px;
    background: rgba(255, 255, 255, 0.3);
    border-radius: 3px;
    overflow: hidden;
}

.update-progress-fill {
    height: 100%;
    background: white;
    border-radius: 3px;
    transition: width 0.3s ease;
}

.update-progress-text {
    font-size: 0.8rem;
    white-space: nowrap;
}

.update-progress-pct {
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
}

.slide-down-enter-active,
.slide-down-leave-active {
    transition: transform 0.3s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
    transform: translateY(100%);
}
</style>
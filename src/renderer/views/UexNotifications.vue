<!-- src/renderer/views/UexNotifications.vue -->
<template>
    <div class="notifications-container">

        <!-- Header -->
        <div class="notifications-header">
            <div class="header-left">
                <i class="pi pi-bell header-icon"></i>
                <div>
                    <h2 class="header-title">UEX Notifications</h2>
                    <p class="header-subtitle">{{ unreadCount }} unread · {{ notifications.length }} total</p>
                </div>
            </div>
            <div class="header-actions">
                <Button label="Mark all as read" icon="pi pi-check-square" outlined size="small"
                    :disabled="unreadCount === 0 || loading" @click="markAllAsRead" />
                <Button icon="pi pi-refresh" outlined size="small" :loading="loading" v-tooltip="'Refresh'"
                    @click="loadNotifications" />
            </div>
        </div>

        <!-- Loading -->
        <div v-if="loading && notifications.length === 0" class="state-container">
            <ProgressSpinner style="width:40px;height:40px" />
            <p class="state-text">Loading notifications...</p>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="state-container">
            <i class="pi pi-exclamation-circle state-icon error-icon"></i>
            <p class="state-text">{{ error }}</p>
            <Button label="Retry" icon="pi pi-refresh" size="small" @click="loadNotifications" />
        </div>

        <!-- Empty -->
        <div v-else-if="notifications.length === 0" class="state-container">
            <i class="pi pi-bell-slash state-icon"></i>
            <p class="state-text">No notifications</p>
        </div>

        <!-- List -->
        <div v-else class="notifications-list">
            <TransitionGroup name="notif">
                <div v-for="notif in sortedNotifications" :key="notif.id"
                    :class="['notif-card', { 'notif-unread': !isRead(notif), 'notif-read': isRead(notif) }]">

                    <!-- Unread indicator -->
                    <div class="notif-dot-col">
                        <span v-if="!isRead(notif)" class="notif-dot"></span>
                    </div>

                    <!-- Content -->
                    <div class="notif-content">
                        <p class="notif-message">{{ notif.message }}</p>
                        <div class="notif-meta">
                            <span class="notif-date">
                                <i class="pi pi-calendar"></i>
                                {{ formatDate(notif.date_added) }}
                            </span>
                            <span v-if="isRead(notif)" class="notif-read-date">
                                <i class="pi pi-eye"></i>
                                Read {{ formatDate(notif.date_read) }}
                            </span>
                            <a v-if="notif.redir" :href="buildUrl(notif.redir)" target="_blank" class="notif-link" @click.prevent="openUrl(notif.redir)">
                                <i class="pi pi-external-link"></i>
                                View on UEX
                            </a>
                        </div>
                    </div>

                    <!-- Action -->
                    <div class="notif-action-col">
                        <Button
                            v-if="!isRead(notif)"
                            label="Mark read"
                            icon="pi pi-check"
                            size="small"
                            outlined
                            v-tooltip="'Mark as read'"
                            @click="markAsRead(notif.id)"
                        />
                    </div>
                </div>
            </TransitionGroup>
        </div>

    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'

const notifications = ref([])
const loading = ref(false)
const error = ref(null)

const localReadIds = ref(new Set())

const SETTINGS_KEY = 'settings/uex/readNotifications'

async function loadReadIds() {
    try {
        const saved = await window.api.Settings.get(SETTINGS_KEY)
        if (Array.isArray(saved)) {
            localReadIds.value = new Set(saved)
        }
    } catch { /* primera vez, no existe */ }
}

async function saveReadIds() {
    await window.api.Settings.set(SETTINGS_KEY, [...localReadIds.value])
}

function isRead(notif) {
    return (notif.date_read && notif.date_read > 0) || localReadIds.value.has(notif.id)
}

function buildUrl(redir) {
    return `https://uexcorp.space/${redir}`
}

function openUrl(redir) {
    window.api.System.openUrlInBrowser(buildUrl(redir))
}

function formatDate(timestamp) {
    if (!timestamp || timestamp === 0) return '—'
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    })
}

const unreadCount = computed(() =>
    notifications.value.filter(n => !isRead(n)).length
)

const sortedNotifications = computed(() => {
    return [...notifications.value].sort((a, b) => {
        const aRead = isRead(a) ? 1 : 0
        const bRead = isRead(b) ? 1 : 0
        if (aRead !== bRead) return aRead - bRead
        return b.date_added - a.date_added
    })
})

async function loadNotifications() {
    loading.value = true
    error.value = null
    try {
        const result = await window.api.UEX.getNotifications()
        if (result.success) {
            notifications.value = result.data
        } else {
            error.value = result.error || 'Failed to load notifications'
        }
    } catch (e) {
        error.value = e.message
    } finally {
        loading.value = false
    }
}

async function markAsRead(id) {
    localReadIds.value.add(id)
    localReadIds.value = new Set(localReadIds.value)
    await saveReadIds()
}

async function markAllAsRead() {
    notifications.value.forEach(n => localReadIds.value.add(n.id))
    localReadIds.value = new Set(localReadIds.value)
    await saveReadIds()
}

onMounted(async () => {
    await loadReadIds()
    await loadNotifications()
})
</script>

<style scoped>
.notifications-container {
    max-width: 760px;
    margin: 0 auto;
    padding: 1.5rem;
}

.notifications-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
    gap: 1rem;
}

.header-left {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.header-icon {
    font-size: 1.75rem;
    color: var(--p-primary-color);
}

.header-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--p-text-color);
    margin: 0;
}

.header-subtitle {
    font-size: 0.8rem;
    color: var(--p-text-muted-color);
    margin: 0;
}

.header-actions {
    display: flex;
    gap: 0.5rem;
}

.state-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    gap: 1rem;
    color: var(--p-text-muted-color);
}

.state-icon {
    font-size: 2.5rem;
}

.error-icon {
    color: var(--p-red-500);
}

.state-text {
    font-size: 0.95rem;
    margin: 0;
}

.notifications-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.notif-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1rem 0.875rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--p-content-border-color);
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.notif-card:hover {
    background: var(--p-content-hover-background) !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

/* Unread: borde izquierdo de acento + fondo usando color-mix para evitar el problema de --p-primary-50 */
.notif-unread {
    border-left: 3px solid var(--p-primary-color);
    background: color-mix(in srgb, var(--p-primary-color) 8%, var(--p-content-background));
}

/* Read: sin énfasis */
.notif-read {
    background: transparent;
    opacity: 0.6;
}

.notif-read:hover {
    opacity: 1;
}

.notif-dot-col {
    width: 12px;
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-self: flex-start;
    padding-top: 4px;
}

.notif-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--p-primary-color);
    flex-shrink: 0;
}

.notif-content {
    flex: 1;
    min-width: 0;
}

.notif-message {
    font-size: 0.9rem;
    color: var(--p-text-color);
    margin: 0 0 0.4rem 0;
    line-height: 1.5;
}

.notif-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
}

.notif-date,
.notif-read-date {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--p-text-muted-color);
}

.notif-link {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--p-primary-color);
    text-decoration: none;
    cursor: pointer;
    transition: opacity 0.15s;
}

.notif-link:hover {
    opacity: 0.75;
    text-decoration: underline;
}

.notif-action-col {
    flex-shrink: 0;
    min-width: 100px;
    display: flex;
    justify-content: flex-end;
}

.notif-enter-active,
.notif-leave-active {
    transition: all 0.25s ease;
}

.notif-enter-from {
    opacity: 0;
    transform: translateY(-8px);
}

.notif-leave-to {
    opacity: 0;
    transform: translateX(20px);
}
</style>
<!-- src/renderer/views/Home.vue -->
<template>
  <div class="home-container">

    <!-- Panel izquierdo: Logo + Usuario -->
    <div class="left-panel">
      <div class="logo-section">
        <div class="logo-wrapper">
          <img src="@/assets/SC-Courrier-UEX_Logo_01.png" alt="Logo" class="logo-image" />
        </div>
      </div>

      <div class="user-info-section">
        <template v-if="store.currentUser">
          <h2 class="user-name">{{ store.currentUser.fullName || store.currentUser.username }}</h2>
          <p class="user-role"><i class="pi pi-shield"></i>{{ store.currentUser.role || 'Usuario' }}</p>

          <div class="user-details">
            <a href="https://uexcorp.space/data/home/type/commodity/?only_my_reports=1" target="_blank" class="detail-item link-item">
              <i class="pi pi-external-link"></i>
              UEX Corp Terminal
            </a>
            <span class="detail-item">
              <i class="pi pi-check-circle"></i>
              Online
            </span>
          </div>

          <Button label="Logout" icon="pi pi-sign-out" outlined size="small" @click="handleLogout" class="logout-btn" />
        </template>

        <template v-else>
          <h2 class="welcome-title">Welcome</h2>
          <p class="welcome-subtitle">Please Login to continue</p>
          <Button label="Login" icon="pi pi-user" @click="showLoginDialog = true" class="login-btn" />
        </template>
      </div>
    </div>

    <!-- Divisor vertical -->
    <div class="home-divider-vertical"></div>

    <!-- Panel derecho: Navegación -->
    <div class="right-panel" v-if="store.currentUser">
      <p class="nav-title"><i class="pi pi-th-large"></i> Features</p>
      <PanelMenu :model="navItems" multiple class="home-panelmenu">
        <template #item="{ item }">
          <!-- Item con ruta interna -->
          <router-link v-if="item.route" v-slot="{ href, navigate }" :to="item.route" custom>
            <a v-ripple class="panel-item" :href="href" @click="navigate">
              <span :class="[item.icon, 'panel-item-icon']" />
              <span class="panel-item-label">{{ item.label }}</span>
              <span v-if="item.shortcut" class="panel-item-shortcut">{{ item.shortcut }}</span>
            </a>
          </router-link>

          <!-- Item con subitems (header de grupo) -->
          <a v-else v-ripple class="panel-item panel-item-group">
            <span :class="[item.icon, 'panel-item-icon']" />
            <span class="panel-item-label font-semibold">{{ item.label }}</span>
          </a>
        </template>
      </PanelMenu>
    </div>

    <!-- Si no hay usuario, panel derecho vacío con mensaje -->
    <div class="right-panel right-panel--empty" v-else>
      <i class="pi pi-lock empty-lock-icon"></i>
      <p class="empty-message">Login to access all features</p>
    </div>

    <LoginDialog v-model:visible="showLoginDialog" @login="handleLogin" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useAppStore } from '@/AppStore';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import PanelMenu from 'primevue/panelmenu';
import LoginDialog from '@/components/Login/LoginDialog.vue';
import { useNotify } from '@/components/Notificaciones/Notify';

const store = useAppStore();
const router = useRouter();
const notify = useNotify();
const showLoginDialog = ref(false);

// Construir el modelo del PanelMenu desde las funcionalidades del store
// (las mismas que aparecen en el Menubar)
const navItems = computed(() => {
  if (!store.funcionalidades || store.funcionalidades.length === 0) return []

  // store.funcionalidades ya tiene la estructura de menuitems con label, icon, route, items
  // PanelMenu acepta exactamente el mismo formato
  return store.funcionalidades
})

function handleLogin(userData) {
  showLoginDialog.value = false
  const displayName = userData.fullName || userData.username
  notify.success(`Welcome back, ${displayName}`, 'Access Granted')
}

function handleLogout() {
  const displayName = store.currentUser?.fullName || store.currentUser?.username
  store.logout()
  notify.info(`¡Goodbye ${displayName || ''}!`, 'Session closed')
}

onMounted(() => {
  //notify.alert('Welcome to SC-Courrier-UEX <a href="https://www.youtube.com/shorts/_0roBvhNkBc" target="_blank">Watch the demo</a>', 'Home')
});
onUnmounted(() => {
  // Limpieza si es necesario
});
</script>

<style scoped>
/* ── Layout principal ───────────────────────────────── */
.home-container {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 80px); /* ← resta la altura del menubar */
  padding: 2rem;
  gap: 0;
}
.home-divider-vertical {
  width: 1px;
  background: var(--p-content-border-color);
  margin: 0 0.5rem;
  align-self: stretch;  /* ← esto ya lo tenías, queda bien */
}

/* ── Panel izquierdo ────────────────────────────────── */
.left-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding-right: 1.5rem;
}

/* ── Divisor ────────────────────────────────────────── */
.home-divider {
  margin: 0 !important;
}

/* ── Panel derecho ──────────────────────────────────── */
.right-panel {
  flex: 1;
  padding-left: 1.5rem;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.right-panel--empty {
  align-items: center;
  justify-content: center;
  opacity: 0.4;
}

.nav-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--p-text-muted-color);
  margin: 0 0 0.75rem 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.empty-lock-icon {
  font-size: 3rem;
  color: var(--p-text-muted-color);
  margin-bottom: 1rem;
}

.empty-message {
  font-size: 0.9rem;
  color: var(--p-text-muted-color);
}

/* ── PanelMenu items ────────────────────────────────── */
.home-panelmenu {
  border: none !important;
  background: transparent !important;
}

:deep(.home-panelmenu .p-panelmenu-panel) {
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  margin-bottom: 0.5rem;
  overflow: hidden;
}

.panel-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 1rem;
  width: 100%;
  text-decoration: none;
  color: var(--p-text-color);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  border-radius: 4px;
}

.panel-item:hover {
  background: var(--p-content-hover-background);
  color: var(--p-primary-color);
}

.panel-item-group {
  font-weight: 600;
}

.panel-item-icon {
  color: var(--p-primary-color);
  font-size: 0.9rem;
  flex-shrink: 0;
}

.panel-item-label {
  flex: 1;
  font-size: 0.875rem;
}

.panel-item-shortcut {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  color: var(--p-primary-color);
  border: 1px solid var(--p-primary-color);
  opacity: 0.7;
}

/* ── Logo (sin cambios) ─────────────────────────────── */
.logo-section { margin-bottom: 2rem; }

.logo-wrapper {
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.2);
  border: 2px solid var(--p-primary-color);
  box-shadow: 0 0 20px -5px var(--p-primary-color);
  overflow: hidden;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-wrapper:hover {
  transform: scale(1.05);
  box-shadow: 0 0 30px -2px var(--p-primary-color);
  border-color: var(--p-primary-400);
}

.logo-image { width: 100%; height: 100%; object-fit: contain; }

.user-info-section { text-align: center; max-width: 280px; }

.user-name {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--p-text-color);
  margin: 0 0 0.5rem 0;
}

.user-role {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--p-text-muted-color);
  margin: 0 0 1.25rem 0;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.user-role i { color: var(--p-primary-color); font-size: 0.9rem; }

.user-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 1.5rem;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
  text-decoration: none;
  transition: color 0.2s ease;
}

.detail-item i { color: var(--p-primary-color); font-size: 0.875rem; }

.link-item { cursor: pointer; }
.link-item:hover { color: var(--p-primary-color); text-decoration: underline; }

.logout-btn, .login-btn { min-width: 140px; }

.welcome-title {
  font-size: 2rem;
  font-weight: 600;
  color: var(--p-text-color);
  margin: 0 0 0.5rem 0;
}

.welcome-subtitle {
  font-size: 1rem;
  color: var(--p-text-muted-color);
  margin: 0 0 2rem 0;
}



/* ── Responsive ─────────────────────────────────────── */
@media (max-width: 768px) {
  .home-container {
    flex-direction: column;
    align-items: center;
  }
  .left-panel { flex: none; padding-right: 0; padding-bottom: 1.5rem; }
  .home-divider { display: none; }
  .right-panel { padding-left: 0; width: 100%; }
  .logo-wrapper { width: 140px; height: 140px; }
}
</style>
<!-- src/renderer/components/Login/LoginDialog.vue -->
<template>
  <Dialog v-model:visible="visible" modal :closable="false" :draggable="false" :showHeader="false"
    class="custom-login-dialog" :pt="{
      mask: { style: 'backdrop-filter: blur(8px); background: rgba(0,0,0,0.4)' },
      root: { style: 'background: transparent; border: none; box-shadow: none;' }
    }">
    <template #container="{ closeCallback }">
      <div class="login-card">
        <Button v-if="!loading" icon="pi pi-times" rounded text class="close-corner-btn" @click="closeCallback" />
        <Button icon="pi pi-question-circle" rounded text class="help-btn" @click="toggleHelp" />
        <Popover ref="helpPopover">
          <div class="help-content">
            <p><strong>UEX Corp Access</strong></p>
            <ul class="help-list">
              <li>Use your corporate username.</li>
              <li>The Secret-Key is your personal API key.</li>
              <li>If you lost your key, go to the UEX Dashboard.</li>
            </ul>
          </div>
        </Popover>

        <div class="login-header">
          <img src="@/assets/UEX_LOGO.png" alt="Logo" class="login-logo-img" />
          <h2>Welcome</h2>
          <p>Please provide your UEX Corp User Info</p>
          <p>Don't have an account?
            <a href="https://uexcorp.space/login" target="_blank" class="signup-link">Sign Up Here</a>
          </p>
        </div>

        <div class="login-form">
          <div class="field">
            <IconField>
              <InputIcon class="pi pi-user" />
              <InputText ref="usernameInput" v-model="credentials.username" class="login-input" placeholder="Username"
                :disabled="loading" autocomplete="off" @keyup.enter="focusPassword" />
            </IconField>
          </div>

          <div class="field">
            <IconField>
              <InputIcon class="pi pi-lock" />
              <Password ref="passwordInput" v-model="credentials.password" placeholder="Secret-Key" :feedback="false"
                toggleMask class="login-password-input" :disabled="loading" @keyup.enter="handleLogin(closeCallback)" />
            </IconField>
          </div>

          <div class="remember-me-section">
            <Checkbox v-model="rememberMe" :binary="true" inputId="rememberMe" class="custom-checkbox" />
            <label for="rememberMe" class="remember-label">Remember my access</label>
          </div>

          <div class="button-container">
            <Button type="button" :label="loading ? 'Validating...' : 'Sign-In'"
              :icon="loading ? 'pi pi-spin pi-spinner' : 'pi pi-sign-in'" class="login-submit-btn" :disabled="loading"
              @click="handleLogin(closeCallback)" />
          </div>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import Password from 'primevue/password';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import Popover from 'primevue/popover';
import Checkbox from 'primevue/checkbox';

import { useAppStore } from '@/AppStore';
import { useNotify } from '@/components/Notificaciones/Notify';

const store = useAppStore();
const notify = useNotify();
const props = defineProps({
  visible: { type: Boolean, default: false }
});
const helpPopover = ref(null);
const toggleHelp = (event) => {
  helpPopover.value.toggle(event);
};

const emit = defineEmits(['update:visible', 'login']);
const rememberMe = ref(true); // Por defecto 'on'
const visible = ref(props.visible);
const loading = ref(false); // Estado de carga para la API
const credentials = ref({ username: '', password: '' });

// Referencias de UI para control de foco
const usernameInput = ref(null);
const passwordInput = ref(null);

// Sincronización del estado visible y disparador de foco inicial
watch(() => props.visible, async (newVal) => {
  visible.value = newVal;
  if (newVal) {
    // 1. Cargar preferencia del Checkbox
    const savedRemember = await window.api.Settings.get('settings/security/rememberMe');
    rememberMe.value = savedRemember !== false; // true por defecto si es undefined

    // 2. Cargar datos si procede
    if (rememberMe.value) {
      const savedUser = await window.api.Settings.get('settings/security/user');
      if (savedUser) {
        credentials.value.username = savedUser.username || '';
        credentials.value.password = savedUser.token || '';
      }
    } else {
      resetForm();
    }

    await nextTick();

    // 3. Foco Dinámico mejorado
    if (credentials.value.username && credentials.value.password) {
      // Si ambos están llenos (auto-fill), ponemos el foco en el botón de login
      // o dejamos que el usuario elija. Por defecto, al password:
      focusPassword();
    } else if (credentials.value.username) {
      focusPassword();
    } else {
      usernameInput.value?.$el.focus();
    }
  }
});

/** * Si el usuario borra el username manualmente, 
 * limpiamos automáticamente el password por seguridad y comodidad. */
watch(() => credentials.value.username, (newUsername) => {
  if (!newUsername || newUsername.trim() === '') {
    credentials.value.password = '';
  }
});

watch(visible, (newVal) => emit('update:visible', newVal));

/** Mueve el foco del teclado al campo de contraseña  */
function focusPassword() {
  const inputEl = passwordInput.value?.$el.querySelector('input');
  if (inputEl) inputEl.focus();
}

// Descarga el avatar y lo convierte a base64 para evitar requests externas posteriores
// que podrían ser bloqueadas por el interceptor de headers de Electron.
async function fetchAvatarAsBase64(url) {
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// 3. LÓGICA DE VALIDACIÓN (MODO DESARROLLO / MOCK)
async function handleLogin(closeCallback) {
  if (!credentials.value.username || !credentials.value.password) {
    notify.warn('Por favor, completa todos los campos', 'Datos incompletos');
    return;
  }

  loading.value = true;

  try {
    // --- BLOQUE DE DESARROLLO (MOCK CON PROBABILIDAD DE ERROR) ---
    /* // Simulamos un retraso de red para ver el spinner
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Generamos un número entre 0 y 1. Si es menor a 0.3, simulamos error (30% de probabilidad)
    const simulateError = Math.random() < 0.3;

    if (simulateError) {
      notify.error('Usuario o contraseña incorrectos', 'Error de Acceso');
    } else {
      // Simulamos lo que devolvería una API de seguridad profesional
      const mockUserData = {
        id: 123,
        username: credentials.value.username,
        fullName: 'Usuario de Pruebas',
        photo: 'https://i.pravatar.cc/150?u=' + credentials.value.username, //<- Avatar aleatorio de 150px
        role: 'Dpto. Informatico', //<- Seccion o rol del usuario
        gender: 'm', //<- 'm' o 'f'
        permissions: ['read:all', 'write:settings', 'delete:records'],
        token: 'key...token_de_seguridad_simulado',
        funcionalidades: [
          {
            label: 'Buy or Sell',
            icon: 'pi pi-caret-right', //<- https://primevue.org/icons/
            items: [
              { label: 'Comodities', icon: 'pi pi-angle-right', route: '/buysell/comodities' }, //<- Ruta como esta declarada en router.js
              { label: 'Items', icon: 'pi pi-angle-right', route: '/buysell/items' },
              { label: 'Vehicles', icon: 'pi pi-angle-right', route: '/buysell/vehicles' }
            ]
          },
          {
            label: 'Data Courrier',
            icon: 'pi pi-caret-right',
            items: [
              { label: 'Contracts', icon: 'pi pi-angle-right', route: '/contracts' },
              { label: 'OCR Captures', icon: 'pi pi-angle-right', route: '/ocr-captures' }
            ]
          }
        ]
      };

      console.log('Login Exitoso. Perfil cargado:', mockUserData);

      // Enviamos TODO el objeto al store (incluyendo funcionalidades)
      store.login(mockUserData);

      emit('login', mockUserData);
      closeCallback();
    }*/
    // --- FIN BLOQUE DE DESARROLLO ---

    const shortcuts = await window.api.Settings.get('settings/shortcuts') || {};
    const apiUrl = await window.api.Settings.get('settings/paths/securityLoginApi'); //console.log('Intentando login con API:', apiUrl);
    const response = await fetch(apiUrl + '?username=' + encodeURIComponent(credentials.value.username),
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
    const data = await response.json(); console.log('Respuesta de la API:', data);

    if (data.status === 'ok') {
      console.log('Login Exitoso. Perfil cargado:', data);
      const userData = {
        id: data.data.id,
        username: data.data.username,
        fullName: data.data.name,
        photo: (await fetchAvatarAsBase64(data.data.avatar)) || data.data.avatar,
        role: data.data.is_datarunner > 0 ? 'Data Runner' : 'User',
        token: credentials.value.password, //<- Guardamos el Secret-Key para futuras llamadas a la API (si es necesario)
        funcionalidades: [
          {
            label: 'Buy or Sell',
            icon: 'pi pi-shopping-cart', //<- https://primevue.org/icons/
            items: [
              { label: 'Comodities', icon: 'pi pi-box', shortcut: shortcuts.commodities, route: '/buysell/comodities' }, //<- Ruta como esta declarada en router.js
              { label: 'Items', icon: 'pi pi-objects-column', shortcut: shortcuts.items, route: '/buysell/items' },
              { label: 'Vehicles', icon: 'pi pi-car', shortcut: shortcuts.vehicles, route: '/buysell/vehicles' },
              { label: 'Marketplace', icon: 'pi pi-shopping-bag', shortcut: shortcuts.marketplace, route: '/buysell/marketplace' }
            ]
          },
          {
            label: 'Data Courrier',
            icon: 'pi pi-server',
            items: [
              //{ label: 'Contracts', icon: 'pi pi-book', route: '/contracts' },
              { label: 'Datarunner Captures', icon: 'pi pi-camera', shortcut: shortcuts.datarunnerCapture, route: '/datarunner-capture' },
              { label: 'UEX Notifications', icon: 'pi pi-bell', route: '/uex-notifications' },
              { label: 'Where to go', icon: 'pi pi-globe', route: '/places-to-visit' }
            ]
          }
        ],
        notifications: []
      };

      store.login(userData);
      // --- LÓGICA DE PERSISTENCIA DEL USUARIO LOGUEADO ---
      await window.api.Settings.set('settings/security/rememberMe', rememberMe.value);

      if (rememberMe.value) {
        await window.api.Settings.set('settings/security/user', userData);
      } else {
        // Si desmarcan la opción, borramos el rastro por privacidad
        await window.api.Settings.set('settings/security/user', null);
      }
      // ------------------------------------

      emit('login', userData);
      closeCallback();

    } else {
      const errorMsg = data.message || 'Invalid Credentials';
      notify.error(errorMsg, 'Access Error');
    }

  } catch (error) {
    console.error('Login Error:', error);
    notify.error('Could not connect to the login server', 'NETWORK ERROR');
  } finally {
    loading.value = false;
  }
}

// Limpia los campos del formulario
function resetForm() {
  credentials.value = { username: '', password: '' };
}
</script>

<style scoped>
.login-card {
  display: flex;
  flex-direction: column;
  padding: 2.5rem 2rem;
  gap: 1.5rem;
  border-radius: 1.2rem;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  width: 380px;
  position: relative;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
}

.close-corner-btn {
  position: absolute !important;
  top: 0.8rem;
  right: 0.8rem;
  width: 2rem !important;
  height: 2rem !important;
  color: rgba(255, 255, 255, 0.4) !important;
}

.login-header {
  text-align: center;
  color: white;
}

.login-header h2 {
  margin: 0.5rem 0 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.login-header p {
  opacity: 0.5;
  font-size: 0.8rem;
}

.login-logo-img {
  display: block;
  margin: 0 auto;
  width: 70px;
  height: auto;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1));
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.remember-me-section {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.2rem 0.5rem;
  margin-bottom: 0.5rem;
}

.remember-label {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.6);
  /* Gris claro para que no compita con los inputs */
  cursor: pointer;
  user-select: none;
  transition: color 0.2s;
}

.remember-me-section:hover .remember-label {
  color: rgba(255, 255, 255, 0.9);
}

/* Estilización profunda del Checkbox para Modo Oscuro */
:deep(.custom-checkbox .p-checkbox-box) {
  background: rgba(0, 0, 0, 0.4) !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  transition: all 0.2s;
  width: 18px;
  height: 18px;
}

/* Estado cuando está marcado */
:deep(.custom-checkbox .p-checkbox-box.p-highlight) {
  background: var(--p-primary-500) !important;
  border-color: var(--p-primary-400) !important;
  box-shadow: 0 0 10px var(--p-primary-900);
  /* Efecto neón sutil */
}

/* Icono interno (el check) */
:deep(.custom-checkbox .p-checkbox-icon) {
  color: white !important;
  font-size: 10px;
}

/* Hover sobre el cuadrito */
:deep(.custom-checkbox:not(.p-disabled):hover .p-checkbox-box) {
  border-color: var(--p-primary-400) !important;
}

/* Estilización de IconField e Inputs: 
   Usamos IconField para que el icono e input se comporten como una unidad.
*/
:deep(.p-iconfield) {
  width: 100%;
}

/* Ajuste del color de los iconos dentro del IconField */
:deep(.p-inputicon) {
  color: rgba(255, 255, 255, 0.3) !important;
}

:deep(.login-input),
:deep(.login-password-input input) {
  width: 100% !important;
  /* El padding izquierdo ahora lo gestiona IconField automáticamente */
  background: rgba(0, 0, 0, 0.3) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  color: white !important;
  border-radius: 8px !important;
}

:deep(.login-input:focus),
:deep(.login-password-input input:focus) {
  border-color: var(--p-primary-400) !important;
  background: rgba(0, 0, 0, 0.5) !important;
  box-shadow: none !important;
}

.button-container {
  display: flex;
  justify-content: center;
  margin-top: 0.5rem;
}

.login-submit-btn {
  background: var(--p-primary-500) !important;
  border: none !important;
  border-radius: 20px !important;
  padding: 0.5rem 2.5rem !important;
  font-weight: 600 !important;
  font-size: 0.9rem !important;
  min-width: 150px;
  transition: transform 0.2s;
}

.login-submit-btn:active {
  transform: scale(0.98);
}

:deep(.p-password) {
  width: 100%;
}

/* Enlace de Registro */
.signup-link {
  color: var(--p-primary-400);
  text-decoration: none;
  font-weight: 600;
  transition: color 0.2s;
}

.signup-link:hover {
  color: var(--p-primary-300);
  text-decoration: underline;
}

/* Botón de Ayuda */
.help-btn {
  position: absolute !important;
  top: 0.8rem;
  left: 0.8rem;
  /* Lado opuesto al de cerrar */
  width: 2rem !important;
  height: 2rem !important;
  color: rgba(255, 255, 255, 0.4) !important;
}

.help-btn:hover {
  color: var(--p-primary-400) !important;
  background: rgba(255, 255, 255, 0.05) !important;
}

/* Estilo del contenido del Popover */
.help-content {
  padding: 0.5rem;
  max-width: 250px;
  font-size: 0.85rem;
  color: #bbb6b6;
  /* O blanco si tu popover es oscuro */
}

.help-list {
  margin: 0.5rem 0 0;
  padding-left: 1.2rem;
}

.help-list li {
  margin-bottom: 0.3rem;
}
</style>
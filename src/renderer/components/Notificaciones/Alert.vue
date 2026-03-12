<!-- src/renderer/components/Alert.vue -->
<template>
  <div :class="['alert-container', positionClass]">
    <TransitionGroup name="alert">
      <div v-for="item in notifications" :key="item._t" class="alert-toast">
        <div class="alert-accent-bar"></div>
        <div class="alert-content">
          <i :class="item.icon || 'pi pi-bell'" class="alert-icon"></i>
          <div class="alert-text">
            <span class="alert-title">{{ item.summary }}</span>
            <p class="alert-message" v-html="item.detail"></p>
          </div>
          <button class="alert-close" @click="removeNotification(item)">
            <i class="pi pi-times"></i>
          </button>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { toastBus } from './Notify';

const props = defineProps({
  position: {
    type: String,
    default: 'top-right',
    validator: (value) => {
      return ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top-center', 'bottom-center'].includes(value);
    }
  }
});

const notifications = ref([]);

const positionClass = computed(() => {
  return `alert-${props.position}`;
});

const removeNotification = (item) => {
  const index = notifications.value.findIndex(n => n._t === item._t);
  if (index > -1) {
    notifications.value.splice(index, 1);
  }
};

watch(
  () => toastBus.data,
  (value) => {
    if (!value) return;

    if (value.clear) {
      notifications.value = [];
    } else if (value.severity === 'custom-orange') {
      notifications.value.push(value);

      if (value.life && value.life > 0) {
        setTimeout(() => {
          removeNotification(value);
        }, value.life);
      }
    }
  }
);
</script>

<style scoped>
.alert-container {
  position: fixed;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
}

.alert-top-right    { top: 70px; right: 20px; }
.alert-top-left     { top: 70px; left: 20px; }
.alert-top-center   { top: 70px; left: 50%; transform: translateX(-50%); }
.alert-bottom-right { bottom: 20px; right: 20px; }
.alert-bottom-left  { bottom: 20px; left: 20px; }
.alert-bottom-center{ bottom: 20px; left: 50%; transform: translateX(-50%); }

.alert-toast {
  display: flex;
  border-radius: 8px;
  overflow: hidden;
  min-width: 350px;
  max-width: 450px;
  pointer-events: auto;
  background-color: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.alert-accent-bar {
  width: 4px;
  background-color: var(--p-primary-color);
  flex-shrink: 0;
}

.alert-content {
  display: flex;
  align-items: flex-start;
  padding: 14px 16px;
  gap: 12px;
  flex: 1;
}

.alert-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--p-primary-color);
}

.alert-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.alert-title {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--p-text-color);
  line-height: 1.3;
}

.alert-message {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--p-text-muted-color);
}

/* Links dentro del mensaje */
:deep(.alert-message a) {
  color: var(--p-primary-color);
  text-decoration: underline;
}

:deep(.alert-message a:hover) {
  opacity: 0.8;
}

.alert-close {
  background: transparent;
  border: none;
  color: var(--p-text-muted-color);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background-color 0.2s, color 0.2s;
  flex-shrink: 0;
}

.alert-close:hover {
  background-color: var(--p-content-hover-background);
  color: var(--p-text-color);
}

.alert-close i { font-size: 14px; }

.alert-enter-active,
.alert-leave-active {
  transition: all 0.3s ease;
}
.alert-enter-from,
.alert-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
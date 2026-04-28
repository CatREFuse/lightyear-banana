<script setup lang="ts">
import { computed } from 'vue'
import BoxIcon from './BoxIcon.vue'

const props = defineProps<{
  inSettings: boolean
  status: string
  themeMode: 'dark' | 'light'
  title: string
  titlebarInset?: boolean
}>()

const connectionTone = computed(() => (props.status.includes('已连接') ? 'connected' : 'waiting'))

const emit = defineEmits<{
  back: []
  openSettings: []
  toggleTheme: []
}>()
</script>

<template>
  <header class="panel-header" :class="{ 'has-titlebar-inset': titlebarInset }">
    <div class="title-block">
      <button v-if="inSettings" class="icon-button" type="button" @click="emit('back')">
        <BoxIcon name="arrow-back" size="16" />
        <span>返回</span>
      </button>
      <span class="heading-copy">
        <h1>{{ title }}</h1>
      </span>
    </div>

    <div class="header-actions">
      <span
        v-if="status"
        class="connection-status"
        :class="`is-${connectionTone}`"
        role="status"
        :aria-label="status"
      >
        <span class="connection-dot" aria-hidden="true"></span>
        <span>{{ status }}</span>
      </span>
      <button v-if="!inSettings" class="icon-button" type="button" @click="emit('openSettings')">
        <BoxIcon name="cog" size="16" />
        <span>设置</span>
      </button>
      <button class="icon-button" type="button" @click="emit('toggleTheme')">
        <Transition name="theme-symbol" mode="out-in">
          <BoxIcon :key="themeMode" :name="themeMode === 'dark' ? 'sun' : 'moon'" size="16" />
        </Transition>
        <Transition name="theme-symbol" mode="out-in">
          <span :key="themeMode">{{ themeMode === 'dark' ? '浅色' : '深色' }}</span>
        </Transition>
      </button>
    </div>
  </header>
</template>

<style scoped>
.panel-header {
  display: flex;
  position: relative;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px 8px;
  border-bottom: 1px solid var(--lb-hairline);
  background: var(--lb-bg);
}

.panel-header.has-titlebar-inset {
  -webkit-app-region: drag;
  padding-top: 44px;
}

.title-block,
.header-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.heading-copy {
  display: grid;
  min-width: 0;
}

h1 {
  overflow: hidden;
  margin: 0;
  color: var(--lb-text);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 132px;
  color: var(--lb-muted);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}

.has-titlebar-inset .connection-status {
  position: absolute;
  top: 14px;
  right: 12px;
  max-width: 180px;
}

.connection-status span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
}

.connection-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #697283;
}

.connection-status.is-connected {
  color: var(--lb-secondary);
}

.connection-status.is-connected .connection-dot {
  background: #43d17a;
  box-shadow:
    0 0 0 2px rgba(67, 209, 122, 0.16),
    0 0 14px rgba(67, 209, 122, 0.74);
  animation: connection-glow 2.8s ease-in-out infinite;
}

.connection-status.is-waiting .connection-dot {
  background: #748093;
  box-shadow: 0 0 0 2px rgba(116, 128, 147, 0.13);
}

.icon-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  min-height: 28px;
  padding: 0 9px;
  border-color: transparent;
  background: transparent;
  color: var(--lb-muted);
  font-size: 12px;
  white-space: nowrap;
}

.has-titlebar-inset .icon-button,
.has-titlebar-inset .connection-status {
  -webkit-app-region: no-drag;
}

.icon-button:hover {
  border-color: transparent;
  background: var(--lb-surface-2);
  color: var(--lb-text);
}

.theme-symbol-enter-active,
.theme-symbol-leave-active {
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.theme-symbol-enter-from,
.theme-symbol-leave-to {
  opacity: 0;
  transform: translateY(2px) scale(0.92);
}

@keyframes connection-glow {
  0%,
  100% {
    opacity: 0.72;
    transform: scale(0.9);
    box-shadow:
      0 0 0 2px rgba(67, 209, 122, 0.12),
      0 0 8px rgba(67, 209, 122, 0.42);
  }

  50% {
    opacity: 1;
    transform: scale(1);
    box-shadow:
      0 0 0 4px rgba(67, 209, 122, 0.2),
      0 0 18px rgba(67, 209, 122, 0.88);
  }
}

@media (prefers-reduced-motion: reduce) {
  .theme-symbol-enter-active,
  .theme-symbol-leave-active,
  .connection-status.is-connected .connection-dot {
    transition: none;
    animation: none;
  }
}
</style>

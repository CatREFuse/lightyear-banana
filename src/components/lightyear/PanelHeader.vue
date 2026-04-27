<script setup lang="ts">
import BoxIcon from './BoxIcon.vue'

defineProps<{
  inSettings: boolean
  status: string
  themeMode: 'dark' | 'light'
  title: string
}>()

const emit = defineEmits<{
  back: []
  openSettings: []
  toggleTheme: []
}>()
</script>

<template>
  <header class="panel-header">
    <div class="title-block">
      <button v-if="inSettings" class="icon-button" type="button" @click="emit('back')">
        <BoxIcon name="arrow-back" size="16" />
        <span>返回</span>
      </button>
      <span class="heading-copy">
        <h1>{{ title }}</h1>
        <small v-if="status">{{ status }}</small>
      </span>
    </div>

    <div class="header-actions">
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
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px 8px;
  border-bottom: 1px solid var(--lb-hairline);
  background: var(--lb-bg);
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
  gap: 2px;
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

.heading-copy small {
  overflow: hidden;
  color: var(--lb-muted);
  font-size: 10px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
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

@media (prefers-reduced-motion: reduce) {
  .theme-symbol-enter-active,
  .theme-symbol-leave-active {
    transition: none;
  }
}
</style>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef } from 'vue'
import type { DesktopPlatform, WindowDeploySide, WindowDeployState } from '../../types/lightyear'
import BoxIcon from './BoxIcon.vue'

const props = defineProps<{
  inSettings: boolean
  installPluginUrl: string
  status: string
  themeMode: 'dark' | 'light'
  title: string
  desktopPlatform: DesktopPlatform
  windowDeployState: WindowDeployState
  titlebarInset?: boolean
  showWindowControls?: boolean
}>()

const deployMenuOpen = shallowRef(false)
const deployMenuWrap = useTemplateRef<HTMLElement>('deployMenuWrap')
const connectionTone = computed(() => (props.status.includes('已连接') ? 'connected' : 'waiting'))
const deployDisabled = computed(() => props.windowDeployState.status === 'deploying')
const showInstallPlugin = computed(() => Boolean(props.installPluginUrl) && props.status.includes('未连接'))
const showContentTitle = computed(() => props.desktopPlatform !== 'win32' || props.inSettings || !props.showWindowControls)
const showTitlebarBack = computed(() => props.desktopPlatform === 'win32' && props.inSettings && props.showWindowControls)

const emit = defineEmits<{
  back: []
  deployWindow: [side: WindowDeploySide]
  openSettings: []
  toggleTheme: []
}>()

function toggleDeployMenu() {
  if (deployDisabled.value) {
    return
  }

  deployMenuOpen.value = !deployMenuOpen.value
}

function selectDeploySide(side: WindowDeploySide) {
  deployMenuOpen.value = false
  emit('deployWindow', side)
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!deployMenuOpen.value) {
    return
  }

  const target = event.target
  if (target instanceof Node && deployMenuWrap.value?.contains(target)) {
    return
  }

  deployMenuOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
})
</script>

<template>
  <header
    class="panel-header"
    :class="[
      `is-${desktopPlatform}`,
      {
        'has-titlebar-inset': titlebarInset,
        'has-simulated-controls': showWindowControls,
        'has-titlebar-back': showTitlebarBack
      }
    ]"
  >
    <div v-if="showWindowControls" class="window-controls" aria-hidden="true">
      <span class="window-control is-close"></span>
      <span class="window-control is-minimize"></span>
      <span class="window-control is-maximize"></span>
    </div>
    <div v-if="showWindowControls && desktopPlatform === 'win32' && !inSettings" class="window-brand" aria-hidden="true">Lightyear Banana</div>
    <button v-if="showTitlebarBack" class="icon-button titlebar-back" type="button" @click="emit('back')">
      <BoxIcon name="arrow-back" size="16" />
      <span>返回</span>
    </button>

    <div class="title-block">
      <button v-if="inSettings && !showTitlebarBack" class="icon-button" type="button" @click="emit('back')">
        <BoxIcon name="arrow-back" size="16" />
        <span>返回</span>
      </button>
      <span class="heading-copy">
        <h1 v-if="showContentTitle">{{ title }}</h1>
        <span
          v-if="status && desktopPlatform === 'win32'"
          class="connection-status"
          :class="`is-${connectionTone}`"
          role="status"
          :aria-label="status"
        >
          <span class="connection-dot" aria-hidden="true"></span>
          <span>{{ status }}</span>
          <a v-if="showInstallPlugin" class="install-plugin-link" :href="installPluginUrl" download>安装插件</a>
        </span>
      </span>
    </div>

    <div class="header-actions">
      <span
        v-if="status && desktopPlatform !== 'win32'"
        class="connection-status"
        :class="`is-${connectionTone}`"
        role="status"
        :aria-label="status"
      >
        <span class="connection-dot" aria-hidden="true"></span>
        <span>{{ status }}</span>
        <a v-if="showInstallPlugin" class="install-plugin-link" :href="installPluginUrl" download>安装插件</a>
      </span>
      <div v-if="!inSettings" ref="deployMenuWrap" class="deploy-menu-wrap">
        <button
          class="icon-button icon-only"
          type="button"
          title="部署窗口"
          aria-label="部署窗口"
          :aria-expanded="deployMenuOpen"
          :disabled="deployDisabled"
          @click="toggleDeployMenu"
        >
          <BoxIcon name="expand-alt" size="16" />
        </button>
        <Transition name="deploy-menu">
          <div v-if="deployMenuOpen" class="deploy-menu" role="menu" aria-label="部署窗口">
            <button type="button" role="menuitem" @click="selectDeploySide('left')">
              <BoxIcon name="arrow-back" size="14" />
              <span>左侧</span>
            </button>
            <button type="button" role="menuitem" @click="selectDeploySide('right')">
              <span>右侧</span>
              <BoxIcon name="chevron-right" size="14" />
            </button>
          </div>
        </Transition>
      </div>
      <button v-if="!inSettings" class="icon-button icon-only" type="button" title="设置" aria-label="设置" @click="emit('openSettings')">
        <BoxIcon name="cog" size="16" />
      </button>
      <button
        class="icon-button icon-only"
        type="button"
        :title="themeMode === 'dark' ? '浅色' : '深色'"
        :aria-label="themeMode === 'dark' ? '浅色' : '深色'"
        @click="emit('toggleTheme')"
      >
        <Transition name="theme-symbol" mode="out-in">
          <BoxIcon :key="themeMode" :name="themeMode === 'dark' ? 'sun' : 'moon'" size="16" />
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

.panel-header.has-titlebar-inset.is-win32 {
  align-items: flex-start;
  padding-top: 42px;
}

.title-block,
.header-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.header-actions {
  margin-left: auto;
}

.heading-copy {
  display: grid;
  min-width: 0;
  gap: 5px;
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

.has-titlebar-inset.is-darwin .connection-status {
  position: absolute;
  top: 14px;
  right: 12px;
  max-width: 180px;
}

.has-titlebar-inset.is-win32 .title-block {
  flex: 1 1 auto;
}

.has-titlebar-inset.is-win32.has-titlebar-back .title-block {
  margin-left: 9px;
}

.has-titlebar-inset.is-win32 .header-actions {
  align-self: flex-start;
}

.window-controls {
  position: absolute;
  top: 14px;
  display: inline-flex;
  gap: 8px;
  align-items: center;
}

.panel-header.is-darwin .window-controls {
  left: 12px;
}

.panel-header.is-win32 .window-controls {
  top: 12px;
  right: 12px;
  gap: 0;
}

.window-brand {
  position: absolute;
  top: 12px;
  left: 12px;
  overflow: hidden;
  max-width: calc(100% - 132px);
  color: var(--lb-text);
  font-size: 12px;
  font-weight: 700;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.titlebar-back {
  position: absolute;
  top: 10px;
  left: 12px;
}

.window-control {
  width: 12px;
  height: 12px;
  border-radius: 999px;
}

.window-control.is-close {
  background: #ff5f57;
}

.window-control.is-minimize {
  background: #ffbd2e;
}

.window-control.is-maximize {
  background: #28c840;
}

.panel-header.is-win32 .window-control {
  position: relative;
  width: 36px;
  height: 24px;
  border-radius: 0;
  background: transparent;
}

.panel-header.is-win32 .window-control::before {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--lb-muted);
  font-size: 13px;
}

.panel-header.is-win32 .window-control.is-close::before {
  content: "×";
}

.panel-header.is-win32 .window-control.is-minimize::before {
  content: "−";
}

.panel-header.is-win32 .window-control.is-maximize::before {
  content: "□";
  font-size: 10px;
}

.connection-status span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
}

.install-plugin-link {
  flex: 0 0 auto;
  color: var(--lb-accent);
  font-size: 11px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.install-plugin-link:hover {
  color: var(--lb-text);
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
.has-titlebar-inset .connection-status,
.has-titlebar-inset .install-plugin-link,
.has-titlebar-inset .window-controls {
  -webkit-app-region: no-drag;
}

.icon-button:hover {
  border-color: transparent;
  background: var(--lb-surface-2);
  color: var(--lb-text);
}

.icon-button.icon-only {
  justify-content: center;
  width: 28px;
  padding: 0;
}

.icon-button:disabled {
  cursor: wait;
  opacity: 0.62;
}

.deploy-menu-wrap {
  position: relative;
  flex: 0 0 auto;
}

.deploy-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  display: grid;
  min-width: 118px;
  overflow: hidden;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-overlay);
  box-shadow: 0 14px 34px var(--lb-shadow);
}

.deploy-menu button {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lb-text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.deploy-menu button + button {
  box-shadow: inset 0 1px var(--lb-hairline);
}

.deploy-menu button:hover {
  background: var(--lb-hover);
}

.deploy-menu-enter-active,
.deploy-menu-leave-active {
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.deploy-menu-enter-from,
.deploy-menu-leave-to {
  opacity: 0;
  transform: translateY(-3px) scale(0.98);
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

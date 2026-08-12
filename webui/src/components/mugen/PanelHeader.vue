<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'
import type {
  ColorMode,
  DesktopPlatform,
  ResolvedColorMode,
  VisualTheme
} from '@mugen/core'
import BoxIcon from './BoxIcon.vue'

const props = defineProps<{
  activeMenuOwner?: string
  inSettings: boolean
  installPluginUrl: string
  status: string
  colorMode: ColorMode
  resolvedColorMode: ResolvedColorMode
  visualTheme: VisualTheme
  title: string
  desktopPlatform: DesktopPlatform
  titlebarInset?: boolean
  showWindowControls?: boolean
}>()

const themeMenuOpen = shallowRef(false)
const themeMenuWrap = useTemplateRef<HTMLElement>('themeMenuWrap')
const connectionTone = computed(() => (props.status.includes('已连接') ? 'connected' : 'waiting'))
const showInstallPlugin = computed(() => Boolean(props.installPluginUrl) && props.status.includes('未连接'))
const showContentTitle = computed(() => props.desktopPlatform !== 'win32' || props.inSettings || !props.showWindowControls)
const showTitlebarBack = computed(() => props.desktopPlatform === 'win32' && props.inSettings && props.showWindowControls)
const visualThemeOptions: VisualTheme[] = ['nothing', 'classic']
const colorModeOptions: ColorMode[] = ['system', 'dark', 'light']

const emit = defineEmits<{
  back: []
  menuOpen: [owner: string]
  openSettings: []
  setColorMode: [mode: ColorMode]
  setVisualTheme: [theme: VisualTheme]
}>()

function toggleThemeMenu() {
  themeMenuOpen.value = !themeMenuOpen.value
  emit('menuOpen', themeMenuOpen.value ? 'header:theme' : '')
}

function selectColorMode(mode: ColorMode) {
  emit('setColorMode', mode)
}

function selectVisualTheme(theme: VisualTheme) {
  emit('setVisualTheme', theme)
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!themeMenuOpen.value) {
    return
  }

  const target = event.target
  if (
    target instanceof Node &&
    themeMenuWrap.value?.contains(target)
  ) {
    return
  }

  themeMenuOpen.value = false
  emit('menuOpen', '')
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
})

watch(
  () => props.activeMenuOwner,
  (owner) => {
    if (owner === 'header:theme') {
      return
    }

    themeMenuOpen.value = false
  }
)
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
    <div v-if="showWindowControls && desktopPlatform === 'win32' && !inSettings" class="window-brand" aria-hidden="true">无幻</div>
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
      <button v-if="!inSettings" class="icon-button icon-only" type="button" title="设置" aria-label="设置" @click="emit('openSettings')">
        <BoxIcon name="cog" size="16" />
      </button>
      <div ref="themeMenuWrap" class="theme-menu-wrap">
        <button
          class="icon-button icon-only"
          type="button"
          title="主题"
          aria-label="主题"
          :aria-expanded="themeMenuOpen"
          @click="toggleThemeMenu"
        >
          <BoxIcon :name="resolvedColorMode === 'dark' ? 'sun' : 'moon'" size="16" />
        </button>
        <div v-if="themeMenuOpen" class="theme-menu" aria-label="主题设置" @click.stop>
          <span class="theme-menu-label">界面</span>
          <button
            v-for="theme in visualThemeOptions"
            :key="theme"
            type="button"
            :class="{ selected: visualTheme === theme }"
            @click="selectVisualTheme(theme)"
          >
            <span>{{ theme === 'nothing' ? 'Nothing' : '经典' }}</span>
            <small>{{ visualTheme === theme ? '[ON]' : '' }}</small>
          </button>
          <span class="theme-menu-label">模式</span>
          <button
            v-for="mode in colorModeOptions"
            :key="mode"
            type="button"
            :class="{ selected: colorMode === mode }"
            @click="selectColorMode(mode)"
          >
            <span>{{ mode === 'system' ? '跟随系统' : mode === 'dark' ? '深色' : '浅色' }}</span>
            <small>{{ colorMode === mode ? '[ON]' : '' }}</small>
          </button>
        </div>
      </div>
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
  border-bottom: 1px solid var(--mugen-hairline);
  background: var(--mugen-bg);
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
  color: var(--mugen-text);
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
  color: var(--mugen-muted);
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
  color: var(--mugen-text);
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
  color: var(--mugen-muted);
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
  color: var(--mugen-accent);
  font-size: 11px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.install-plugin-link:hover {
  color: var(--mugen-text);
}

.connection-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #697283;
}

.connection-status.is-connected {
  color: var(--mugen-secondary);
}

.connection-status.is-connected .connection-dot {
  background: var(--mugen-success);
  box-shadow:
    0 0 0 2px var(--mugen-success-ring),
    0 0 14px rgba(67, 209, 122, 0.74);
  animation: connection-glow 2.8s ease-in-out infinite;
}

.connection-status.is-waiting .connection-dot {
  background: #748093;
  box-shadow: 0 0 0 2px var(--mugen-neutral-ring);
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
  color: var(--mugen-muted);
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
  background: var(--mugen-surface-2);
  color: var(--mugen-text);
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

.deploy-menu-wrap,
.theme-menu-wrap {
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
  border: 1px solid var(--mugen-border);
  border-radius: 8px;
  background: var(--mugen-overlay);
  box-shadow: 0 14px 34px var(--mugen-shadow);
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
  color: var(--mugen-text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.deploy-menu button + button {
  box-shadow: inset 0 1px var(--mugen-hairline);
}

.deploy-menu button:hover {
  background: var(--mugen-hover);
}

.theme-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 32;
  display: grid;
  width: 176px;
  padding: 6px;
  border: 1px solid var(--mugen-border);
  border-radius: 8px;
  background: var(--mugen-overlay);
  box-shadow: 0 14px 34px var(--mugen-shadow);
}

.theme-menu-label {
  padding: 8px 8px 5px;
  color: var(--mugen-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.theme-menu button {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--mugen-secondary);
  font-size: 12px;
  text-align: left;
}

.theme-menu button:hover,
.theme-menu button.selected {
  background: var(--mugen-hover);
  color: var(--mugen-text);
}

.theme-menu small {
  color: var(--mugen-accent);
  font-size: 9px;
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

@media (max-width: 279px) {
  .panel-header {
    gap: 6px;
    padding-inline: 8px;
  }

  .title-block,
  .header-actions {
    gap: 4px;
  }

  .panel-header.is-darwin .window-controls,
  .window-brand {
    left: 8px;
  }

  .has-titlebar-inset.is-darwin .connection-status {
    right: 8px;
    max-width: 88px;
  }

  .theme-menu {
    right: -4px;
    max-width: calc(100vw - 16px);
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

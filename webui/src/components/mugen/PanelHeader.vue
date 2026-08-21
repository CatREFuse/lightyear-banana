<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'
import type { ColorMode, DesktopPlatform, ResolvedColorMode } from '@mugen/core'
import BoxIcon from './BoxIcon.vue'

const props = defineProps<{
  activeMenuOwner?: string
  inSettings: boolean
  installPluginUrl: string
  status: string
  colorMode: ColorMode
  resolvedColorMode: ResolvedColorMode
  title: string
  version: string
  desktopPlatform: DesktopPlatform
  titlebarInset?: boolean
  showWindowControls?: boolean
}>()

const themeMenuOpen = shallowRef(false)
const themeMenuWrap = useTemplateRef<HTMLElement>('themeMenuWrap')
const showInstallPlugin = computed(() => Boolean(props.installPluginUrl) && props.status.includes('未连接'))
const showConnectionStatus = computed(() => Boolean(props.status) && !props.status.includes('已连接') && !props.status.includes('浏览器模式'))
const colorModeOptions: ColorMode[] = ['system', 'light', 'dark']

const emit = defineEmits<{
  back: []
  menuOpen: [owner: string]
  openSettings: []
  setColorMode: [mode: ColorMode]
}>()

function toggleThemeMenu() {
  themeMenuOpen.value = !themeMenuOpen.value
  emit('menuOpen', themeMenuOpen.value ? 'header:theme' : '')
}

function selectColorMode(mode: ColorMode) {
  emit('setColorMode', mode)
  themeMenuOpen.value = false
  emit('menuOpen', '')
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!themeMenuOpen.value) return
  const target = event.target
  if (target instanceof Node && themeMenuWrap.value?.contains(target)) return
  themeMenuOpen.value = false
  emit('menuOpen', '')
}

onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerDown))
onUnmounted(() => document.removeEventListener('pointerdown', handleDocumentPointerDown))

watch(
  () => props.activeMenuOwner,
  (owner) => {
    if (owner !== 'header:theme') themeMenuOpen.value = false
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
        'is-settings': inSettings
      }
    ]"
  >
    <div v-if="showWindowControls" class="window-controls" aria-hidden="true">
      <span class="window-control is-close"></span>
      <span class="window-control is-minimize"></span>
      <span class="window-control is-maximize"></span>
    </div>

    <button v-if="inSettings" class="icon-button header-back" type="button" aria-label="返回" @click="emit('back')">
      <BoxIcon name="arrow-back" size="18" />
    </button>

    <div class="title-block">
      <h1>{{ title }}</h1>
      <span v-if="!inSettings" class="version-chip">{{ version }}</span>
    </div>

    <div class="header-actions">
      <span v-if="showConnectionStatus" class="connection-status" role="status">
        {{ status }}
        <a v-if="showInstallPlugin" class="install-plugin-link" :href="installPluginUrl" download>安装插件</a>
      </span>
      <div v-if="!inSettings" ref="themeMenuWrap" class="theme-menu-wrap">
        <button
          class="icon-button icon-only"
          type="button"
          title="外观"
          aria-label="外观"
          :aria-expanded="themeMenuOpen"
          @click="toggleThemeMenu"
        >
          <BoxIcon :name="resolvedColorMode === 'dark' ? 'sun' : 'moon'" size="18" />
        </button>
        <Transition name="menu-pop">
          <div v-if="themeMenuOpen" class="theme-menu" aria-label="外观设置" @click.stop>
            <button
              v-for="mode in colorModeOptions"
              :key="mode"
              type="button"
              :class="{ selected: colorMode === mode }"
              @click="selectColorMode(mode)"
            >
              <span>{{ mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色' }}</span>
              <BoxIcon v-if="colorMode === mode" name="check-circle" size="15" />
            </button>
          </div>
        </Transition>
      </div>
      <button v-if="!inSettings" class="icon-button icon-only" type="button" title="设置" aria-label="设置" @click="emit('openSettings')">
        <BoxIcon name="slider-alt" size="18" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.panel-header {
  position: relative;
  z-index: 20;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-height: 56px;
  padding: 0 12px;
  background: var(--mugen-workspace);
}

.panel-header.is-settings { grid-template-columns: 32px minmax(0, 1fr) 32px; }
.panel-header.has-titlebar-inset { -webkit-app-region: drag; padding-top: 32px; }

.title-block,
.header-actions {
  display: flex;
  min-width: 0;
  align-items: center;
}

.title-block { gap: 8px; }
.is-settings .title-block { grid-column: 2; justify-content: center; }
.header-actions { justify-content: flex-end; gap: 4px; }
.is-settings .header-actions { grid-column: 3; }

h1 {
  overflow: hidden;
  margin: 0;
  color: var(--mugen-text);
  font-family: var(--mugen-font-brand);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-chip {
  display: inline-flex;
  min-height: 20px;
  align-items: center;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--mugen-chip);
  color: var(--mugen-secondary);
  font-size: 10px;
  line-height: 20px;
}

.icon-button {
  display: inline-grid;
  width: 32px;
  min-height: 32px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--mugen-secondary);
}

.icon-button:hover,
.icon-button:focus-visible {
  background: var(--mugen-hover);
  color: var(--mugen-text);
  outline: none;
}

.header-back { grid-column: 1; justify-self: start; }

.has-titlebar-inset .icon-button,
.has-titlebar-inset .connection-status,
.has-titlebar-inset .window-controls { -webkit-app-region: no-drag; }

.connection-status {
  display: inline-flex;
  max-width: 138px;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--mugen-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.install-plugin-link { color: var(--mugen-accent); font-weight: 600; }
.theme-menu-wrap { position: relative; }

.theme-menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  right: 0;
  display: grid;
  width: 140px;
  padding: 6px;
  border: 1px solid var(--mugen-border);
  border-radius: 12px;
  background: var(--mugen-overlay);
  box-shadow: 0 12px 30px var(--mugen-shadow);
}

.theme-menu button {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--mugen-secondary);
  font-size: 12px;
}

.theme-menu button:hover,
.theme-menu button.selected { background: var(--mugen-hover); color: var(--mugen-text); }

.menu-pop-enter-active,
.menu-pop-leave-active { transition: opacity 140ms ease, transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.menu-pop-enter-from,
.menu-pop-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }

.window-controls {
  position: absolute;
  top: 12px;
  left: 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.window-control { width: 12px; height: 12px; border-radius: 999px; }
.window-control.is-close { background: #ff5f57; }
.window-control.is-minimize { background: #ffbd2e; }
.window-control.is-maximize { background: #28c840; }

@media (max-width: 300px) {
  .panel-header { padding-inline: 8px; }
  .connection-status { display: none; }
  .theme-menu { right: -36px; }
}

@media (prefers-reduced-motion: reduce) {
  .menu-pop-enter-active,
  .menu-pop-leave-active { transition: none; }
}
</style>

<script setup lang="ts">
import { shallowRef } from 'vue'
import LightyearPanel from './components/lightyear/LightyearPanel.vue'
import type { DesktopPlatform, RuntimeName } from './types/lightyear'

const props = withDefaults(
  defineProps<{
    runtime?: RuntimeName
    platform?: DesktopPlatform
  }>(),
  {
    runtime: 'browser',
    platform: 'darwin'
  }
)

const previewPlatform = shallowRef<DesktopPlatform>(props.platform)
</script>

<template>
  <main
    class="app-preview-shell"
    :class="{
      'is-plugin-preview': props.runtime === 'browser',
      'is-electron-app': props.runtime === 'electron'
    }"
  >
    <div v-if="props.runtime === 'browser'" class="preview-platform-switch" aria-label="窗口系统">
      <button
        type="button"
        :class="{ selected: previewPlatform === 'darwin' }"
        @click="previewPlatform = 'darwin'"
      >
        macOS
      </button>
      <button
        type="button"
        :class="{ selected: previewPlatform === 'win32' }"
        @click="previewPlatform = 'win32'"
      >
        Windows
      </button>
    </div>
    <div class="plugin-preview-frame">
      <LightyearPanel
        :runtime="props.runtime"
        :desktop-platform="props.runtime === 'browser' ? previewPlatform : props.platform"
        :show-window-controls="props.runtime === 'browser'"
      />
    </div>
  </main>
</template>

<style scoped>
.app-preview-shell {
  width: 100%;
  height: 100%;
  min-height: 100%;
  background: var(--lb-bg);
}

.plugin-preview-frame {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.app-preview-shell.is-electron-app {
  overflow: hidden;
}

.is-electron-app .plugin-preview-frame {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--lb-bg);
}

.app-preview-shell.is-plugin-preview {
  position: relative;
  display: flex;
  justify-content: center;
  overflow: hidden;
  padding: 58px 24px 24px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    #0f1115;
  background-size: 28px 28px;
}

.preview-platform-switch {
  position: absolute;
  top: 14px;
  left: 50%;
  z-index: 10;
  display: inline-flex;
  overflow: hidden;
  border: 1px solid rgba(168, 179, 196, 0.18);
  border-radius: 8px;
  background: rgba(27, 34, 44, 0.84);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  transform: translateX(-50%);
}

.preview-platform-switch button {
  min-height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lb-muted);
  cursor: pointer;
  font-size: 12px;
}

.preview-platform-switch button.selected {
  background: var(--lb-accent-soft);
  color: var(--lb-text);
}

.is-plugin-preview .plugin-preview-frame {
  width: min(100%, 390px);
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--lb-border);
  border-radius: 10px;
  background: var(--lb-bg);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.46);
}

@media (max-width: 430px) {
  .app-preview-shell.is-plugin-preview {
    padding: 42px 0 0;
  }

  .is-plugin-preview .plugin-preview-frame {
    width: 100%;
    border-width: 0;
    border-radius: 0;
  }
}
</style>

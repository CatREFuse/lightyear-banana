<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import MugenPanel from '../components/mugen/MugenPanel.vue'
import { useInnerMugen } from '@/composables/useInnerMugen'
import { useWorkspaceStore } from '@/stores/workspace'

const store = useWorkspaceStore()
const controller = useInnerMugen()
const { colorMode, resolvedTheme, visualTheme } = storeToRefs(store)
const themeController = {
  colorMode,
  resolvedColorMode: resolvedTheme,
  setColorMode: store.setColorMode,
  setVisualTheme: store.setVisualTheme,
  visualTheme
}
const platform = computed(() => store.context?.platform === 'win32' ? 'win32' : 'darwin')
const webUiVersion = __WEBUI_VERSION__

onMounted(store.initialize)
</script>

<template>
  <main class="app-shell">
    <section v-if="store.status === 'loading'" class="startup">
      <span class="spinner" />
      正在打开 Mugen
    </section>
    <section v-else-if="store.status === 'incompatible'" class="startup">
      <strong>Mugen 插件需要更新</strong>
      <button type="button" @click="store.openReleasePage">查看更新</button>
    </section>
    <section v-else-if="store.status === 'error'" class="startup">
      <strong>{{ store.error }}</strong>
      <button v-if="store.host.mode !== 'unavailable'" type="button" @click="store.initialize">重试</button>
    </section>
    <MugenPanel
      v-else
      runtime="photoshop-ccx"
      :controller="controller"
      :desktop-platform="platform"
      :diagnostic-export-available="true"
      :photoshop-integration-available="true"
      :theme-controller="themeController"
      :version="webUiVersion"
    />
  </main>
</template>

<style scoped>
.app-shell {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.startup {
  display: grid;
  min-height: 100%;
  place-content: center;
  justify-items: center;
  gap: 12px;
  padding: 24px;
  color: var(--mugen-muted);
  text-align: center;
}

.startup strong {
  color: var(--mugen-text);
}
</style>

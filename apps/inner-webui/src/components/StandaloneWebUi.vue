<script setup lang="ts">
import MugenPanel from '../../../../src/components/mugen/MugenPanel.vue'

const platform = /win/i.test(navigator.platform) ? 'win32' : 'darwin'
const webUiVersion = __WEBUI_VERSION__
</script>

<template>
  <main class="app-shell">
    <MugenPanel
      runtime="browser"
      :desktop-platform="platform"
      :photoshop-integration-available="false"
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
</style>

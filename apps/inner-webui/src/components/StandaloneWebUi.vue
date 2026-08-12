<script setup lang="ts">
import MugenPanel from '../../../../src/components/mugen/MugenPanel.vue'
import { useMugen } from '../../../../src/composables/useMugen'

const platform = /win/i.test(navigator.platform) ? 'win32' : 'darwin'
const webUiVersion = __WEBUI_VERSION__
const controller = useMugen('browser')
</script>

<template>
  <main class="app-shell">
    <MugenPanel
      runtime="browser"
      :controller="controller"
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

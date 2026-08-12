<script setup lang="ts">
import EmbeddedWebUi from '@/components/EmbeddedWebUi.vue'
import StandaloneWebUi from '@/components/StandaloneWebUi.vue'
import { resolveWebUiRuntime } from '@/host'

const runtime = resolveWebUiRuntime()
</script>

<template>
  <EmbeddedWebUi v-if="runtime === 'embedded'" />
  <StandaloneWebUi v-else />
</template>

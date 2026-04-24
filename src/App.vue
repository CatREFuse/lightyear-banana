<script setup lang="ts">
import LightyearPanel from './components/lightyear/LightyearPanel.vue'

type RuntimeName = 'browser' | 'photoshop-uxp'

const props = withDefaults(
  defineProps<{
    runtime?: RuntimeName
  }>(),
  {
    runtime: 'browser'
  }
)
</script>

<template>
  <LightyearPanel :runtime="props.runtime" />
</template>

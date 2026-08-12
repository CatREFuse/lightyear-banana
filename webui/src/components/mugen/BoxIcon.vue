<script setup lang="ts">
import { computed } from 'vue'
import { boxIconPaths, boxIconStrokePaths, type BoxIconName } from './boxIcons'

const props = withDefaults(
  defineProps<{
    name: BoxIconName
    size?: number | string
    title?: string
  }>(),
  {
    size: 18
  }
)

const paths = computed(() => boxIconPaths[props.name])
</script>

<template>
  <svg
    class="box-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    focusable="false"
    :aria-hidden="title ? undefined : true"
    :role="title ? 'img' : undefined"
  >
    <title v-if="title">{{ title }}</title>
    <g class="box-icon-classic" fill="currentColor">
      <path v-for="path in paths" :key="path" :d="path" />
    </g>
    <g
      class="box-icon-nothing"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path v-for="path in boxIconStrokePaths[name]" :key="path" :d="path" />
    </g>
  </svg>
</template>

<style scoped>
.box-icon {
  display: inline-block;
  flex: 0 0 auto;
}

.box-icon-nothing {
  display: none;
}

:global(.mugen-shell.design-nothing .box-icon-classic) {
  display: none;
}

:global(.mugen-shell.design-nothing .box-icon-nothing) {
  display: inline;
}
</style>

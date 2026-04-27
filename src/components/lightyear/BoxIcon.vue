<script setup lang="ts">
import { computed } from 'vue'
import { boxIconPaths, type BoxIconName } from './boxIcons'

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
    fill="currentColor"
    focusable="false"
    :aria-hidden="title ? undefined : true"
    :role="title ? 'img' : undefined"
  >
    <title v-if="title">{{ title }}</title>
    <path v-for="path in paths" :key="path" :d="path" />
  </svg>
</template>

<style scoped>
.box-icon {
  display: inline-block;
  flex: 0 0 auto;
}
</style>

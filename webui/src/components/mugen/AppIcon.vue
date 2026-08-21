<script setup lang="ts">
import { computed } from 'vue'
import { appIcons, type AppIconName } from './appIcons'

const props = withDefaults(
  defineProps<{
    name: AppIconName
    size?: number | string
    title?: string
  }>(),
  {
    size: 18
  }
)

const definition = computed(() => appIcons[props.name])
const iconSize = computed(() => {
  if (typeof props.size === 'number') {
    return `${props.size}px`
  }

  return /^\d+(?:\.\d+)?$/.test(props.size) ? `${props.size}px` : props.size
})
</script>

<template>
  <span
    class="app-icon"
    :aria-hidden="title ? undefined : true"
    :aria-label="title"
    :role="title ? 'img' : undefined"
    :style="{ width: iconSize, height: iconSize }"
  >
    <component
      :is="definition.component"
      v-if="definition.library === 'boxicons'"
      :width="size"
      :height="size"
      fill="currentColor"
      remove-padding
      aria-hidden="true"
    />
    <component
      :is="definition.component"
      v-else
      :size="String(size)"
      color="currentColor"
      aria-hidden="true"
    />
  </span>
</template>

<style scoped>
.app-icon {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
}

.app-icon :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>

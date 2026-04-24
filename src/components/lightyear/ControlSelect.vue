<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useOutsidePointerDown } from '../../composables/useOutsidePointerDown'

type SelectOption = {
  value: string
  label: string
  meta?: string
}

const props = withDefaults(
  defineProps<{
    direction?: 'up' | 'down'
    label: string
    open?: boolean
    options: SelectOption[]
    value: string
    wide?: boolean
  }>(),
  {
    direction: 'up',
    wide: false
  }
)

const emit = defineEmits<{
  change: [value: string]
  close: []
  toggle: []
}>()

const localOpen = shallowRef(false)
const rootRef = useTemplateRef<HTMLElement>('root')

const selectedOption = computed(
  () => props.options.find((option) => option.value === props.value) ?? props.options[0] ?? null
)
const isOpen = computed(() => props.open ?? localOpen.value)

function closeOpen() {
  if (props.open === undefined) {
    localOpen.value = false
    return
  }

  emit('close')
}

function selectOption(value: string) {
  emit('change', value)
  closeOpen()
}

function toggleOpen() {
  if (props.open === undefined) {
    localOpen.value = !localOpen.value
    return
  }

  emit('toggle')
}

useOutsidePointerDown(rootRef, closeOpen, () => isOpen.value)
</script>

<template>
  <div ref="root" class="select-field" :class="[`is-${direction}`, { 'is-wide': wide, 'is-open': isOpen }]">
    <span class="select-label">{{ label }}</span>
    <div class="select-anchor">
      <button class="select-trigger" type="button" @click="toggleOpen">
        <span>{{ selectedOption?.label ?? value }}</span>
        <i>⌄</i>
      </button>

      <div v-if="isOpen" class="select-menu">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          :class="{ selected: option.value === value }"
          @click="selectOption(option.value)"
        >
          <span>{{ option.label }}</span>
          <small v-if="option.meta">{{ option.meta }}</small>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.select-field {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 4px;
}

.select-label {
  overflow: hidden;
  color: var(--lb-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-anchor {
  position: relative;
  min-width: 0;
}

.select-trigger {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-height: 28px;
  padding: 0 7px;
  border-color: var(--lb-border);
  background: var(--lb-surface);
  color: var(--lb-text);
  font-size: 11px;
  text-align: left;
}

.select-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-trigger i {
  color: var(--lb-muted);
  font-style: normal;
}

.select-field.is-open .select-trigger {
  border-color: var(--lb-accent);
}

.select-menu {
  position: absolute;
  z-index: 20;
  left: 0;
  display: grid;
  width: max(100%, 132px);
  max-height: 190px;
  overflow-y: auto;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-surface-2);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.38);
}

.is-wide .select-menu {
  width: max(100%, 210px);
}

.is-up .select-menu {
  bottom: calc(100% + 2px);
}

.is-down .select-menu {
  top: calc(100% + 2px);
}

.select-menu button {
  display: grid;
  gap: 2px;
  min-height: 32px;
  justify-items: start;
  padding: 6px 9px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lb-secondary);
  font-size: 12px;
  text-align: left;
}

.select-menu button:hover,
.select-menu button.selected {
  background: var(--lb-accent-soft);
  color: var(--lb-text);
}

.select-menu small {
  overflow: hidden;
  max-width: 190px;
  color: var(--lb-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

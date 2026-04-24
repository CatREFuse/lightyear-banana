<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useOutsidePointerDown } from '../../composables/useOutsidePointerDown'

const props = defineProps<{
  open?: boolean
  options: string[]
  value: string
}>()

const emit = defineEmits<{
  change: [value: string]
  close: []
  toggle: []
}>()

const localOpen = shallowRef(false)
const rootRef = useTemplateRef<HTMLElement>('root')

const displayValue = computed(() => (props.value === '原图比例' ? '原图' : props.value))
const isOpen = computed(() => props.open ?? localOpen.value)

function closeOpen() {
  if (props.open === undefined) {
    localOpen.value = false
    return
  }

  emit('close')
}

function ratioStyle(option: string) {
  if (option === '原图比例') {
    return { aspectRatio: '4 / 3' }
  }

  const [width, height] = option.split(':').map(Number)
  if (!width || !height) {
    return { aspectRatio: '1 / 1' }
  }

  return { aspectRatio: `${width} / ${height}` }
}

function selectRatio(option: string) {
  emit('change', option)
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
  <div ref="root" class="ratio-picker" :class="{ 'is-open': isOpen }">
    <span class="ratio-label">比例</span>
    <div class="ratio-anchor">
      <button class="ratio-trigger" type="button" @click="toggleOpen">
        <span>{{ displayValue }}</span>
        <i>⌄</i>
      </button>

      <div v-if="isOpen" class="ratio-menu">
        <button
          v-for="option in options"
          :key="option"
          class="ratio-option"
          :class="{ selected: option === value }"
          type="button"
          @click="selectRatio(option)"
        >
          <span class="ratio-shape" :style="ratioStyle(option)" />
          <span class="ratio-copy">
            <strong>{{ option }}</strong>
            <small>{{ option === '原图比例' ? '跟随参考图 1' : '常用比例' }}</small>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ratio-picker {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 4px;
}

.ratio-label {
  color: var(--lb-muted);
  font-size: 10px;
}

.ratio-anchor {
  position: relative;
  min-width: 0;
}

.ratio-trigger {
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

.ratio-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ratio-trigger i {
  color: var(--lb-muted);
  font-style: normal;
}

.ratio-picker.is-open .ratio-trigger {
  border-color: var(--lb-accent);
}

.ratio-menu {
  position: absolute;
  z-index: 30;
  bottom: calc(100% + 2px);
  left: 0;
  display: grid;
  width: 230px;
  max-height: 230px;
  overflow-y: auto;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-surface-2);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.38);
}

.ratio-option {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-height: 42px;
  padding: 7px 9px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lb-secondary);
  text-align: left;
}

.ratio-option:hover,
.ratio-option.selected {
  background: var(--lb-accent-soft);
  color: var(--lb-text);
}

.ratio-shape {
  display: block;
  width: 28px;
  max-height: 28px;
  min-height: 12px;
  justify-self: center;
  border: 1px solid var(--lb-border-strong);
  border-radius: 3px;
  background: linear-gradient(135deg, rgba(47, 140, 255, 0.58), rgba(174, 181, 194, 0.12));
}

.ratio-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.ratio-copy strong,
.ratio-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ratio-copy strong {
  font-size: 12px;
  font-weight: 600;
}

.ratio-copy small {
  color: var(--lb-muted);
  font-size: 10px;
}
</style>

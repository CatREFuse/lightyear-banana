<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useOutsidePointerDown } from '../../composables/useOutsidePointerDown'
import BoxIcon from './BoxIcon.vue'

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

const displayValue = computed(() => {
  if (props.value === '原图比例') {
    return '原图'
  }

  if (props.value === '参考图比例') {
    return '参考图'
  }

  if (props.value === '画布比例') {
    return '画布'
  }

  return props.value
})
const isOpen = computed(() => props.open ?? localOpen.value)

function closeOpen() {
  if (props.open === undefined) {
    localOpen.value = false
    return
  }

  emit('close')
}

function ratioStyle(option: string) {
  if (option === '原图比例' || option === '参考图比例' || option === '画布比例') {
    return { aspectRatio: '4 / 3' }
  }

  const [width, height] = option.split(':').map(Number)
  if (!width || !height) {
    return { aspectRatio: '1 / 1' }
  }

  return { aspectRatio: `${width} / ${height}` }
}

function readRatioMeta(option: string) {
  if (option === '原图比例' || option === '参考图比例') {
    return '跟随参考图 1'
  }

  if (option === '画布比例') {
    return '跟随当前画布'
  }

  return `比例 ${option}`
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
        <BoxIcon name="crop" size="14" />
        <span>{{ displayValue }}</span>
        <BoxIcon class="ratio-chevron" name="chevron-down" size="16" />
      </button>

      <Transition name="menu-pop">
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
              <small>{{ readRatioMeta(option) }}</small>
            </span>
          </button>
        </div>
      </Transition>
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
  overflow: hidden;
  color: var(--lb-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ratio-anchor {
  position: relative;
  min-width: 0;
}

.ratio-trigger {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-height: 28px;
  padding: 0 7px;
  border-color: transparent;
  background: var(--lb-field);
  color: var(--lb-text);
  font-size: 11px;
  text-align: left;
  white-space: nowrap;
}

.ratio-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ratio-chevron {
  color: var(--lb-muted);
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
  border: 1px solid var(--lb-border-strong);
  border-radius: 8px;
  background: var(--lb-overlay);
  box-shadow: 0 12px 32px var(--lb-shadow);
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
  border: 1px solid var(--lb-hairline);
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

.menu-pop-enter-active,
.menu-pop-leave-active {
  transition:
    opacity 130ms ease,
    transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: bottom left;
}

.menu-pop-enter-from,
.menu-pop-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .menu-pop-enter-active,
  .menu-pop-leave-active {
    transition: none;
  }
}
</style>

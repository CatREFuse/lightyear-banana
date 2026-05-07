<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useOutsidePointerDown } from '../../composables/useOutsidePointerDown'
import BoxIcon from './BoxIcon.vue'
import type { BoxIconName } from './boxIcons'

type SelectOption = {
  icon?: BoxIconName
  value: string
  label: string
  meta?: string
  status?: string
  statusTone?: 'ready' | 'warning' | 'muted'
}

const props = withDefaults(
  defineProps<{
    direction?: 'up' | 'down'
    icon?: BoxIconName
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
      <button class="select-trigger" :class="{ 'has-icon': icon, 'has-status': selectedOption?.status }" type="button" @click="toggleOpen">
        <BoxIcon v-if="icon" :name="icon" size="14" />
        <span class="select-value">{{ selectedOption?.label ?? value }}</span>
        <span
          v-if="selectedOption?.status"
          class="select-status"
          :class="`is-${selectedOption.statusTone ?? 'muted'}`"
          :title="selectedOption.status"
          :aria-label="selectedOption.status"
        ></span>
        <BoxIcon class="select-chevron" name="chevron-down" size="16" />
      </button>

      <Transition name="menu-pop">
        <div v-if="isOpen" class="select-menu">
          <button
            v-for="option in options"
            :key="option.value"
            type="button"
            :class="{ selected: option.value === value, 'has-option-icon': option.icon, 'has-option-status': option.status }"
            @click="selectOption(option.value)"
          >
            <BoxIcon v-if="option.icon" :name="option.icon" size="15" />
            <span class="option-main">
              <span class="option-label">{{ option.label }}</span>
              <span
                v-if="option.status"
                class="select-status"
                :class="`is-${option.statusTone ?? 'muted'}`"
                :title="option.status"
                :aria-label="option.status"
              ></span>
            </span>
            <small v-if="option.meta">{{ option.meta }}</small>
          </button>
        </div>
      </Transition>
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
  border-color: transparent;
  background: var(--lb-field);
  color: var(--lb-text);
  font-size: 11px;
  text-align: left;
  white-space: nowrap;
}

.select-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-trigger.has-icon {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.select-trigger.has-status {
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.select-trigger.has-icon.has-status {
  grid-template-columns: auto minmax(0, 1fr) auto auto;
}

.select-chevron {
  color: var(--lb-muted);
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
  border: 1px solid var(--lb-border-strong);
  border-radius: 8px;
  background: var(--lb-overlay);
  box-shadow: 0 12px 32px var(--lb-shadow);
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
  min-width: 0;
  min-height: 32px;
  align-items: center;
  justify-items: start;
  padding: 6px 9px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lb-secondary);
  font-size: 12px;
  text-align: left;
}

.option-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.option-label {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-menu button.has-option-icon {
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 7px;
}

.select-status {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  min-height: 8px;
  padding: 0;
  border-radius: 999px;
  background: var(--lb-surface-2);
  box-shadow: 0 0 0 2px rgba(116, 128, 147, 0.12);
}

.select-status.is-ready {
  background: #43d17a;
  box-shadow: 0 0 0 2px rgba(67, 209, 122, 0.16);
}

.select-status.is-warning {
  background: #ffbd2e;
  box-shadow: 0 0 0 2px rgba(255, 189, 46, 0.16);
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

.select-menu button.has-option-icon .option-main,
.select-menu button.has-option-icon small {
  grid-column: 2;
}

.menu-pop-enter-active,
.menu-pop-leave-active {
  transition:
    opacity 130ms ease,
    transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: bottom left;
}

.is-down .menu-pop-enter-active,
.is-down .menu-pop-leave-active {
  transform-origin: top left;
}

.menu-pop-enter-from,
.menu-pop-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.98);
}

.is-down .menu-pop-enter-from,
.is-down .menu-pop-leave-to {
  transform: translateY(-5px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .menu-pop-enter-active,
  .menu-pop-leave-active {
    transition: none;
  }
}
</style>

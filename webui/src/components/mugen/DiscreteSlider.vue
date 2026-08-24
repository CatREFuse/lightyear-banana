<script setup lang="ts">
import { computed } from 'vue'

type DiscreteSliderOption = {
  value: string
  label: string
}

const props = withDefaults(defineProps<{
  ariaLabel?: string
  disabled?: boolean
  options: readonly DiscreteSliderOption[]
}>(), {
  ariaLabel: '离散选项',
  disabled: false
})

const model = defineModel<string>({ required: true })

const maxIndex = computed(() => Math.max(0, props.options.length - 1))
const selectedIndex = computed(() => {
  const index = props.options.findIndex((option) => option.value === model.value)
  return index >= 0 ? index : 0
})
const selectedOption = computed(() => props.options[selectedIndex.value])
const progress = computed(() => maxIndex.value > 0 ? selectedIndex.value / maxIndex.value : 0)
const fillStyle = computed(() => ({
  width: `calc(${progress.value * 100}% + ${16 * (1 - progress.value)}px)`,
  backgroundColor: selectedIndex.value === maxIndex.value && maxIndex.value > 0
    ? 'var(--mugen-slider-max, #a855f7)'
    : 'var(--mugen-accent, #0ea5e9)'
}))
const tickStyles = computed(() => props.options.map((_, index) => {
  const tickProgress = maxIndex.value > 0 ? index / maxIndex.value : 0
  return {
    left: `calc(${tickProgress * 100}% + ${8 - (16 * tickProgress)}px)`
  }
}))

function updateValue(event: Event) {
  const option = props.options[Number((event.target as HTMLInputElement).value)]
  if (option) model.value = option.value
}
</script>

<template>
  <div
    class="discrete-slider"
    :class="{ 'is-disabled': disabled || options.length <= 1 }"
    :data-value="selectedOption?.value"
  >
    <span class="discrete-slider-fill" :style="fillStyle">
      <span class="discrete-slider-thumb"></span>
    </span>
    <span
      v-for="(option, index) in options"
      :key="option.value"
      class="discrete-slider-tick"
      :style="tickStyles[index]"
      aria-hidden="true"
    ></span>
    <input
      class="discrete-slider-input"
      type="range"
      min="0"
      :max="maxIndex"
      step="1"
      :value="selectedIndex"
      :disabled="disabled || options.length <= 1"
      :aria-label="ariaLabel"
      :aria-valuetext="selectedOption?.label ?? ''"
      @input="updateValue"
    />
  </div>
</template>

<style scoped>
.discrete-slider {
  position: relative;
  width: 221px;
  height: 26px;
  overflow: clip;
  border-radius: 8px;
  background: var(--mugen-field, #f4f4f5);
}

.discrete-slider-fill {
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: 8px;
}

.discrete-slider-thumb {
  position: absolute;
  top: 7px;
  right: 7px;
  bottom: 7px;
  width: 2px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.95);
}

.discrete-slider-tick {
  position: absolute;
  z-index: 2;
  top: 11px;
  width: 4px;
  height: 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.3);
  transform: translateX(-50%);
}

.discrete-slider-input {
  position: absolute;
  z-index: 4;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}

.discrete-slider:focus-within {
  outline: 2px solid var(--mugen-accent, #0ea5e9);
  outline-offset: 2px;
}

.discrete-slider.is-disabled {
  opacity: 0.58;
}

.discrete-slider.is-disabled .discrete-slider-input {
  cursor: not-allowed;
}
</style>

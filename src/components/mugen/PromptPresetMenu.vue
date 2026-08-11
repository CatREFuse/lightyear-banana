<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useOutsidePointerDown } from '../../composables/useOutsidePointerDown'
import { filterPromptPresets } from '../../utils/promptPresets'

type PromptPreset = {
  id: string
  name: string
  content: string
}

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    input: string
    presets: readonly PromptPreset[]
  }>(),
  {
    disabled: false
  }
)

const emit = defineEmits<{
  close: []
  open: []
  select: [preset: PromptPreset]
}>()

const rootRef = useTemplateRef<HTMLElement>('root')
const activeIndex = shallowRef(0)
const dismissedInput = shallowRef<string | null>(null)
const isSingleSlashInput = computed(() => /^\/[^\s/]*$/u.test(props.input))
const matches = computed(() => filterPromptPresets(props.presets, props.input))
const isOpen = computed(
  () => !props.disabled && isSingleSlashInput.value && dismissedInput.value !== props.input
)
const activeOptionId = computed(() =>
  matches.value[activeIndex.value] ? `prompt-preset-option-${activeIndex.value}` : ''
)

function closeMenu() {
  if (!isOpen.value) {
    return
  }

  dismissedInput.value = props.input
}

function selectPreset(preset: PromptPreset) {
  dismissedInput.value = props.input
  emit('select', preset)
}

function moveSelection(offset: number) {
  if (!matches.value.length) {
    return
  }

  activeIndex.value = (activeIndex.value + offset + matches.value.length) % matches.value.length
}

function handleKeydown(event: KeyboardEvent) {
  if (!isOpen.value || event.isComposing) {
    return
  }

  const target = event.target as HTMLElement | null
  if (target?.tagName !== 'TEXTAREA' || !target.classList.contains('prompt-input')) {
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    event.stopPropagation()
    moveSelection(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    moveSelection(-1)
    return
  }

  if (event.key === 'Enter' && matches.value.length) {
    event.preventDefault()
    event.stopPropagation()
    selectPreset(matches.value[activeIndex.value])
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu()
  }
}

useOutsidePointerDown(rootRef, closeMenu, () => isOpen.value)

watch(
  () => props.input,
  () => {
    dismissedInput.value = null
    activeIndex.value = 0
  }
)

watch(matches, (nextMatches) => {
  if (activeIndex.value >= nextMatches.length) {
    activeIndex.value = Math.max(0, nextMatches.length - 1)
  }
})

watch(isOpen, (open, wasOpen) => {
  if (open) {
    emit('open')
  } else if (wasOpen) {
    emit('close')
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown, true)
})
</script>

<template>
  <div
    v-if="isOpen"
    ref="root"
    class="prompt-preset-menu"
    role="listbox"
    aria-label="预设提示词"
    :aria-activedescendant="activeOptionId || undefined"
  >
    <header>
      <span>预设提示词</span>
      <small>↑↓ 选择 · Enter 使用 · Esc 关闭</small>
    </header>

    <div v-if="matches.length" class="preset-options">
      <button
        v-for="(preset, index) in matches"
        :id="`prompt-preset-option-${index}`"
        :key="preset.id"
        type="button"
        role="option"
        tabindex="-1"
        :aria-selected="index === activeIndex"
        :class="{ active: index === activeIndex }"
        @mouseenter="activeIndex = index"
        @pointerdown.prevent
        @click="selectPreset(preset)"
      >
        <span class="preset-command">/{{ preset.name }}</span>
        <span class="preset-content">{{ preset.content }}</span>
      </button>
    </div>

    <p v-else class="empty-state">[无匹配]</p>
  </div>
</template>

<style scoped>
.prompt-preset-menu {
  position: absolute;
  z-index: 36;
  right: 0;
  bottom: calc(100% + 8px);
  left: 0;
  overflow: hidden;
  border: 1px solid var(--lb-border-strong, #333333);
  border-radius: 4px;
  background: var(--lb-overlay, #111111);
  color: var(--lb-text, #e8e8e8);
  font-family: var(--lb-font-body, "Space Grotesk", system-ui, sans-serif);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 32px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lb-hairline, #222222);
  color: var(--lb-muted, #999999);
  font-family: var(--lb-font-mono, "Space Mono", monospace);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

header small {
  overflow: hidden;
  color: var(--lb-muted, #999999);
  font: inherit;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-options {
  max-height: 240px;
  overflow-y: auto;
}

.preset-options button {
  position: relative;
  display: grid;
  width: 100%;
  min-height: 48px;
  gap: 4px;
  padding: 9px 12px 9px 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lb-secondary, #999999);
  cursor: pointer;
  text-align: left;
}

.preset-options button + button {
  border-top: 1px solid var(--lb-hairline, #222222);
}

.preset-options button::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  background: transparent;
  content: "";
}

.preset-options button.active {
  background: var(--lb-hover, #1a1a1a);
  color: var(--lb-text, #e8e8e8);
}

.preset-options button.active::before {
  background: var(--lb-accent, #d71921);
}

.preset-command {
  overflow: hidden;
  font-family: var(--lb-font-mono, "Space Mono", monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-content {
  overflow: hidden;
  color: var(--lb-muted, #999999);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  margin: 0;
  padding: 32px 16px;
  color: var(--lb-muted, #999999);
  font-family: var(--lb-font-mono, "Space Mono", monospace);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-align: center;
}
</style>

<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { AppIconName } from './appIcons'

withDefaults(defineProps<{
  badge?: string
  description?: string
  icon: AppIconName
  selected?: boolean
  status?: string
  statusTone?: 'ready' | 'warning' | 'muted'
  title: string
  value?: string
  valueIcon?: AppIconName
  variant?: 'main' | 'option'
}>(), {
  badge: '',
  description: '',
  selected: false,
  status: '',
  statusTone: 'muted',
  value: '',
  valueIcon: undefined,
  variant: 'option'
})

const emit = defineEmits<{
  activate: []
}>()
</script>

<template>
  <button
    class="generation-settings-item"
    :class="[`is-${variant}`, { 'has-description': description }]"
    type="button"
    @click="emit('activate')"
  >
    <AppIcon class="generation-settings-item-icon" :name="icon" size="16" />
    <span class="generation-settings-item-copy">
      <span class="generation-settings-item-title-line">
        <span class="generation-settings-item-title">{{ title }}</span>
        <span v-if="badge" class="generation-settings-item-badge">{{ badge }}</span>
      </span>
      <small v-if="description" class="generation-settings-item-description">{{ description }}</small>
    </span>
    <span v-if="variant === 'main'" class="generation-settings-item-value">
      <AppIcon v-if="valueIcon" :name="valueIcon" size="12" />
      <span>{{ value }}</span>
      <AppIcon name="arrow-right-s-line" size="24" />
    </span>
    <span v-else-if="status || selected" class="generation-settings-item-state">
      <span
        v-if="status"
        class="generation-settings-item-status"
        :class="`is-${statusTone}`"
      >{{ status }}</span>
      <AppIcon
        v-if="selected"
        class="generation-settings-item-check"
        name="checkbox-circle-fill"
        size="16"
      />
    </span>
  </button>
</template>

<style scoped>
.generation-settings-item {
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: 28px;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--mugen-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.generation-settings-item:hover,
.generation-settings-item:focus-visible {
  background: var(--mugen-field);
  outline: 0;
}

.generation-settings-item.is-main {
  min-height: 32px;
  column-gap: 7px;
}

.generation-settings-item-icon {
  color: var(--mugen-muted);
}

.generation-settings-item.has-description .generation-settings-item-icon {
  align-self: start;
}

.generation-settings-item-copy,
.generation-settings-item-title-line,
.generation-settings-item-value,
.generation-settings-item-state {
  display: flex;
  min-width: 0;
  align-items: center;
}

.generation-settings-item-copy {
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
}

.generation-settings-item-title-line {
  gap: 4px;
}

.generation-settings-item-title,
.generation-settings-item-description,
.generation-settings-item-value > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.generation-settings-item-title {
  font-size: 12px;
  line-height: 16px;
}

.is-main .generation-settings-item-title {
  color: var(--mugen-muted);
}

.generation-settings-item-description {
  color: var(--mugen-muted);
  font-size: 10px;
  line-height: 10px;
}

.generation-settings-item-badge,
.generation-settings-item-status {
  flex: 0 0 auto;
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--mugen-accent-soft);
  color: var(--mugen-accent);
  font-size: 10px;
  line-height: 10px;
  white-space: nowrap;
}

.generation-settings-item-value {
  max-width: 100%;
  justify-content: flex-end;
  gap: 3px;
  overflow: hidden;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
}

.generation-settings-item-value :deep(svg) {
  flex: 0 0 auto;
  color: var(--mugen-muted);
}

.generation-settings-item-state {
  justify-content: flex-end;
  gap: 4px;
}

.generation-settings-item-status.is-muted {
  background: var(--mugen-field);
  color: var(--mugen-muted);
}

.generation-settings-item-status.is-warning {
  background: var(--mugen-danger-bg);
  color: var(--mugen-danger-muted);
}

.generation-settings-item-status.is-ready {
  background: var(--mugen-success-bg);
  color: var(--mugen-success);
}

.generation-settings-item-check {
  flex: 0 0 auto;
  color: var(--mugen-accent);
}
</style>

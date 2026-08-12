<script setup lang="ts">
import { computed } from 'vue'
import type { DiagnosticExportState } from '@mugen/core'
import BoxIcon from './BoxIcon.vue'

const props = withDefaults(defineProps<{
  label?: string
  description?: string
  state: DiagnosticExportState
}>(), {
  label: '诊断日志',
  description: ''
})

const emit = defineEmits<{
  download: []
}>()

const buttonLabel = computed(() => (props.state.status === 'exporting' ? '整理中' : '下载'))
const isExporting = computed(() => props.state.status === 'exporting')
</script>

<template>
  <section class="diagnostic-card" :aria-label="props.label">
    <div class="diagnostic-copy">
      <strong>
        <BoxIcon name="download" size="14" />
        {{ props.label }}
      </strong>
      <small :class="`is-${props.state.status}`" aria-live="polite">
        {{ props.state.message || props.description }}
      </small>
    </div>
    <button type="button" :disabled="isExporting" @click="emit('download')">
      {{ buttonLabel }}
    </button>
  </section>
</template>

<style scoped>
.diagnostic-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--mugen-border);
  border-radius: 8px;
  background: var(--mugen-card);
}

.diagnostic-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.diagnostic-copy strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--mugen-text);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diagnostic-copy small {
  overflow: hidden;
  color: var(--mugen-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diagnostic-copy small.is-success {
  color: var(--mugen-success);
}

.diagnostic-copy small.is-error {
  color: var(--mugen-danger-muted);
}

.diagnostic-card button {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--mugen-border);
  border-radius: 8px;
  background: var(--mugen-surface-2);
  color: var(--mugen-text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.diagnostic-card button:hover:not(:disabled) {
  background: var(--mugen-hover);
}

.diagnostic-card button:disabled {
  cursor: default;
  opacity: 0.62;
}
</style>

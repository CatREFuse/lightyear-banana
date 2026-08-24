<script setup lang="ts">
import { computed } from 'vue'
import type { ImageProviderId, ModelConfig, ProviderCapability } from '@mugen/core'
import { validateProviderConfig } from '@mugen/core'
import AppIcon from './AppIcon.vue'

type ConfigStatus = {
  label: string
  tone: 'enabled' | 'disabled' | 'unavailable'
}

const props = defineProps<{
  configs: ModelConfig[]
  editingConfigId: string
  providerCapabilities: Record<ImageProviderId, ProviderCapability>
}>()

const emit = defineEmits<{
  create: []
  edit: [id: string]
}>()

const configRows = computed(() =>
  props.configs.map((config) => ({
    config,
    status: readConfigStatus(config)
  }))
)

function readConfigStatus(config: ModelConfig): ConfigStatus {
  if (!config.enabled) {
    return { label: '未启用', tone: 'disabled' }
  }

  if (!validateProviderConfig(config).valid) {
    return { label: 'API 不可用', tone: 'unavailable' }
  }

  return { label: '启用', tone: 'enabled' }
}
</script>

<template>
  <section class="custom-api-settings" aria-label="自定义 API 管理">
    <div class="custom-api-toolbar">
      <span>已有 {{ configs.length }} 个</span>
      <button type="button" @click="emit('create')">
        <AppIcon name="add-large-fill" size="15" />
        <span>添加</span>
      </button>
    </div>

    <div v-if="configRows.length" class="config-list">
      <button
        v-for="row in configRows"
        :key="row.config.id"
        class="config-row"
        :class="{ selected: row.config.id === editingConfigId }"
        type="button"
        @click="emit('edit', row.config.id)"
      >
        <AppIcon class="config-icon" name="key-2-line" size="17" />
        <span class="config-copy">
          <strong>{{ row.config.name }}</strong>
          <small>
            {{ providerCapabilities[row.config.provider].name }} ·
            {{ row.config.model }}
          </small>
        </span>
        <em class="status-badge" :class="`is-${row.status.tone}`">
          {{ row.status.label }}
        </em>
        <AppIcon class="row-arrow" name="arrow-right-s-line" size="16" />
      </button>
    </div>

    <p v-else class="empty-state">还没有接口配置</p>
  </section>
</template>

<style scoped>
.custom-api-settings {
  display: grid;
  gap: 12px;
  color: var(--mugen-text);
}

.custom-api-toolbar {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.custom-api-toolbar > span {
  color: var(--mugen-muted);
  font-size: 11px;
}

.custom-api-toolbar button {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: var(--mugen-field);
  color: var(--mugen-text);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}

.custom-api-toolbar button:hover,
.custom-api-toolbar button:focus-visible {
  background: var(--mugen-hover);
}

.config-list {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--mugen-border);
  border-radius: 16px;
  background: var(--mugen-card);
}

.config-row {
  display: grid;
  grid-template-columns: 17px minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: 8px;
  min-height: 56px;
  padding: 10px 16px;
  border: 0;
  background: transparent;
  color: var(--mugen-text);
  cursor: pointer;
  text-align: left;
}

.config-row + .config-row {
  border-top: 1px solid var(--mugen-hairline);
}

.config-row:hover,
.config-row:focus-visible {
  background: var(--mugen-hover);
}

.config-row.selected {
  background: var(--mugen-accent-soft);
}

.config-icon,
.row-arrow {
  color: var(--mugen-muted);
}

.config-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.config-copy strong,
.config-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-copy strong {
  font-size: 12px;
  font-weight: 600;
}

.config-copy small {
  color: var(--mugen-muted);
  font-size: 11px;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  min-width: max-content;
  padding: 2px 5px;
  border-radius: 999px;
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
}

.status-badge.is-enabled {
  background: var(--mugen-success-bg);
  color: var(--mugen-success);
}

.status-badge.is-disabled {
  background: rgba(143, 151, 163, 0.12);
  color: var(--mugen-muted);
}

.status-badge.is-unavailable {
  background: var(--mugen-danger-bg);
  color: var(--mugen-danger-muted);
}

.empty-state {
  margin: 0;
  padding: 32px 16px;
  border: 1px solid var(--mugen-border);
  border-radius: 16px;
  background: var(--mugen-card);
  color: var(--mugen-muted);
  font-size: 12px;
  text-align: center;
}
</style>

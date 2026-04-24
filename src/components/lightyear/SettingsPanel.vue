<script setup lang="ts">
import { computed } from 'vue'
import type { ImageProviderId, ModelConfig, ProviderCapability, SettingsView } from '../../types/lightyear'
import ConfigEditorForm from './ConfigEditorForm.vue'

const props = defineProps<{
  configs: ModelConfig[]
  editingCapability: ProviderCapability
  editingConfigId: string
  providerCapabilities: Record<ImageProviderId, ProviderCapability>
  settingsDraftIsNew: boolean
  settingsDraft: ModelConfig
  settingsView: SettingsView
}>()

const emit = defineEmits<{
  closeDetail: []
  create: []
  delete: []
  edit: [id: string]
  restore: []
  save: []
  test: []
  updateDraft: [patch: Partial<ModelConfig>]
}>()

const activeConfig = computed(() => props.configs.find((config) => config.id === props.editingConfigId))
const transitionName = computed(() => (props.settingsView === 'detail' ? 'settings-forward' : 'settings-back'))
</script>

<template>
  <main class="settings-panel">
    <Transition :name="transitionName" mode="out-in">
      <section v-if="settingsView === 'list'" key="list" class="settings-page" aria-label="配置列表">
        <p class="settings-intro">管理生图配置，保存后可在输入区选择。</p>

        <div class="config-list">
          <div class="section-header">
            <h2>配置列表</h2>
            <button type="button" @click="emit('create')">+ 新建配置</button>
          </div>

          <button
            v-for="config in configs"
            :key="config.id"
            class="config-row"
            :class="{ selected: config.id === editingConfigId }"
            type="button"
            @click="emit('edit', config.id)"
          >
            <span>
              <strong>{{ config.name }}</strong>
              <small>{{ providerCapabilities[config.provider].name }} · {{ config.model }}</small>
            </span>
            <em>{{ config.enabled ? '启用' : '停用' }}</em>
          </button>
        </div>
      </section>

      <section v-else key="detail" class="settings-page">
        <ConfigEditorForm
          :active-config-name="activeConfig?.name"
          :editing-capability="editingCapability"
          :provider-capabilities="providerCapabilities"
          :settings-draft-is-new="settingsDraftIsNew"
          :settings-draft="settingsDraft"
          @delete="emit('delete')"
          @restore="emit('restore')"
          @save="emit('save')"
          @test="emit('test')"
          @update-draft="emit('updateDraft', $event)"
        />
      </section>
    </Transition>
  </main>
</template>

<style scoped>
.settings-panel {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.settings-page {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 100%;
  overflow-y: auto;
  padding: 12px;
}

.settings-intro {
  margin: 0;
  color: var(--lb-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.config-list {
  display: grid;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-card);
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid var(--lb-border);
}

h2 {
  margin: 0;
  color: var(--lb-text);
  font-size: 13px;
}

.section-header button {
  min-height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.config-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 9px 10px;
  border: 0;
  border-top: 1px solid var(--lb-border);
  border-radius: 0;
  background: transparent;
  text-align: left;
}

.section-header + .config-row {
  border-top: 0;
}

.config-row:hover {
  background: rgba(255, 255, 255, 0.035);
}

.config-row.selected {
  background: var(--lb-accent-soft);
}

.config-row span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.config-row strong,
.config-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-row small {
  color: var(--lb-muted);
}

.config-row em {
  color: var(--lb-secondary);
  font-size: 11px;
  font-style: normal;
}

.settings-forward-enter-active,
.settings-forward-leave-active,
.settings-back-enter-active,
.settings-back-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.settings-forward-enter-from {
  opacity: 0;
  transform: translateX(26px);
}

.settings-forward-leave-to {
  opacity: 0;
  transform: translateX(-26px);
}

.settings-back-enter-from {
  opacity: 0;
  transform: translateX(-26px);
}

.settings-back-leave-to {
  opacity: 0;
  transform: translateX(26px);
}

@media (prefers-reduced-motion: reduce) {
  .settings-forward-enter-active,
  .settings-forward-leave-active,
  .settings-back-enter-active,
  .settings-back-leave-active {
    transition: none;
  }
}
</style>

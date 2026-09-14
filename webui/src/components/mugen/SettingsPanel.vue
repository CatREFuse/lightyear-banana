<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type {
  DiagnosticExportState,
  ImageProviderId,
  ModelConfig,
  PromptPreset,
  ProviderCapability,
  SettingsTestState,
  SettingsView
} from '@mugen/core'
import { validateProviderConfig } from '@mugen/core'
import {
  MAX_HISTORY_LIMIT,
  MIN_HISTORY_LIMIT,
  normalizeHistoryLimit
} from '../../utils/generationHistoryStorage'
import BoxIcon from './BoxIcon.vue'
import ConfigEditorForm from './ConfigEditorForm.vue'
import DiagnosticLogCard from './DiagnosticLogCard.vue'
import PromptPresetSettings from './PromptPresetSettings.vue'

type ConfigStatus = {
  icon: 'check-circle' | 'x'
  label: string
  tone: 'enabled' | 'disabled' | 'unavailable'
}

const props = defineProps<{
  active: boolean
  apiListOpen: boolean
  iminiSaving: boolean
  configs: ModelConfig[]
  editingCapability: ProviderCapability
  editingConfigId: string
  diagnosticExportAvailable: boolean
  diagnosticExportState: DiagnosticExportState
  historyLimit?: number
  providerCapabilities: Record<ImageProviderId, ProviderCapability>
  promptPresets: PromptPreset[]
  settingsDraftIsNew: boolean
  settingsDraft: ModelConfig
  settingsTestState: SettingsTestState
  settingsView: SettingsView
  version: string
}>()

const emit = defineEmits<{
  openApiList: []
  saveIminiKey: [key: string]
  clearConversationData: []
  closeDetail: []
  create: []
  delete: []
  duplicate: []
  edit: [id: string]
  downloadDiagnostics: []
  openPromptPresets: []
  save: []
  test: []
  toggleEnabled: [enabled: boolean]
  updateDraft: [patch: Partial<ModelConfig>]
  updateHistoryLimit: [value: number]
  updatePromptPresets: [presets: PromptPreset[]]
}>()

const activeConfig = computed(() => props.configs.find((config) => config.id === props.editingConfigId))
const clearConversationArmed = shallowRef(false)
const iminiConfig = computed(() => props.configs.find((config) => config.provider === 'iMini'))
const iminiKey = shallowRef('')
watch(() => iminiConfig.value?.apiKey, (key) => { iminiKey.value = key ?? '' }, { immediate: true })
watch(() => [props.active, props.settingsView, props.apiListOpen], () => { clearConversationArmed.value = false })
const configRows = computed(() =>
  props.configs.map((config) => ({
    config,
    status: readConfigStatus(config)
  }))
)
const transitionName = computed(() => (props.settingsView === 'detail' ? 'settings-forward' : 'settings-back'))


function readConfigStatus(config: ModelConfig): ConfigStatus {
  if (!config.enabled) {
    return {
      icon: 'check-circle',
      label: '未启用',
      tone: 'disabled'
    }
  }

  if (!validateProviderConfig(config).valid) {
    return {
      icon: 'x',
      label: 'API 不可用',
      tone: 'unavailable'
    }
  }

  return {
    icon: 'check-circle',
    label: '启用',
    tone: 'enabled'
  }
}

function requestClearConversationData() {
  clearConversationArmed.value = false
  emit('clearConversationData')
}

function adjustHistoryLimit(delta: number) {
  if (props.historyLimit === undefined) return
  emit('updateHistoryLimit', normalizeHistoryLimit(props.historyLimit + delta))
}

</script>

<template>
  <main class="settings-panel">
    <Transition :name="transitionName" mode="out-in">
      <section v-if="settingsView === 'list' && !apiListOpen" key="overview" class="settings-page settings-overview" aria-label="设置">
        <section class="settings-group" aria-labelledby="common-settings-heading">
          <h2 id="common-settings-heading">常用设置</h2>
          <div class="settings-group-body">
            <button class="settings-entry" type="button" @click="emit('openPromptPresets')">
              <span class="settings-glyph" data-glyph="text-block" aria-hidden="true"></span>
              <span class="settings-copy"><strong>常用提示词</strong><small>可在提示词中使用 / 进行调用</small></span>
              <BoxIcon name="chevron-right" size="20" class="row-arrow" />
            </button>
          </div>
        </section>
        <section class="settings-group" aria-labelledby="history-settings-heading">
          <h2 id="history-settings-heading">对话记录</h2>
          <div class="settings-group-body">
            <div class="history-setting">
              <span class="settings-glyph" data-glyph="list-ordered" aria-hidden="true"></span>
              <span class="settings-copy"><strong>生成记录保存条数</strong><small>{{ historyLimit === undefined ? '保留最近 30 条生成记录' : '超过设定上限的生成记录会被删除' }}</small></span>
              <span v-if="historyLimit !== undefined" class="history-stepper" role="group" aria-label="生成记录保存条数">
                <button type="button" aria-label="减少生成记录保存条数" :disabled="historyLimit <= MIN_HISTORY_LIMIT" @click="adjustHistoryLimit(-1)"><BoxIcon name="chevron-right" size="20" class="stepper-back" /></button>
                <output aria-live="polite">{{ historyLimit }}</output>
                <button type="button" aria-label="增加生成记录保存条数" :disabled="historyLimit >= MAX_HISTORY_LIMIT" @click="adjustHistoryLimit(1)"><BoxIcon name="chevron-right" size="20" /></button>
              </span>
            </div>
            <div v-if="clearConversationArmed" class="clear-confirmation" role="group" aria-label="确认清空生成记录" @keydown.esc="clearConversationArmed = false">
              <p>清空全部生成记录？此操作无法撤销。</p>
              <button type="button" @click="clearConversationArmed = false">取消</button>
              <button type="button" class="clear-action" @click="requestClearConversationData">确认清空</button>
            </div>
            <button v-else class="clear-action" type="button" @click="clearConversationArmed = true">
              <span class="settings-glyph" data-glyph="delete" aria-hidden="true"></span>清空生成记录
            </button>
          </div>
        </section>
        <section class="settings-group" aria-labelledby="api-settings-heading">
          <h2 id="api-settings-heading">生图 API</h2>
          <div class="settings-group-body">
            <form class="imini-key-form" @submit.prevent="emit('saveIminiKey', iminiKey.trim())">
              <span class="settings-glyph imini-glyph" data-glyph="shining" aria-hidden="true"></span>
              <div class="imini-key-content">
                <div class="imini-heading"><label for="imini-quick-key">iMini API Key <span class="recommended">推荐</span></label><a href="https://imini.ai/pricing" target="_blank" rel="noopener noreferrer">享受 7.9 折起折扣 <BoxIcon name="chevron-right" size="14" /></a></div>
                <input id="imini-quick-key" v-model="iminiKey" type="password" autocomplete="off" spellcheck="false" :disabled="iminiSaving" :placeholder="iminiConfig?.apiKey ? '已保存 API Key' : '填写 API Key'" />
                <button v-if="iminiKey.trim() && iminiKey !== (iminiConfig?.apiKey ?? '')" class="key-save" type="submit" :disabled="iminiSaving">{{ iminiSaving ? '保存中…' : '保存 API Key' }}</button>
              </div>
            </form>
            <button class="settings-entry" type="button" @click="emit('openApiList')">
              <span class="settings-glyph" data-glyph="code" aria-hidden="true"></span>
              <span class="settings-copy"><strong>自定义 API</strong><small>{{ configs.length ? `已有 ${configs.length} 个` : '添加 API 配置' }}</small></span>
              <BoxIcon name="chevron-right" size="20" class="row-arrow" />
            </button>
          </div>
        </section>
        <DiagnosticLogCard v-if="diagnosticExportAvailable" :state="diagnosticExportState" @download="emit('downloadDiagnostics')" />
        <footer class="settings-meta" aria-label="版本信息"><span>WebUI {{ version }}</span></footer>
      </section>
      <section v-else-if="settingsView === 'list'" key="apis" class="settings-page" aria-label="配置列表">
        <div class="config-list">
          <div class="section-header">
            <h2>配置列表</h2>
            <button type="button" @click="emit('create')">
              <BoxIcon name="plus" size="15" />
              <span>新建配置</span>
            </button>
          </div>

          <button
            v-for="row in configRows"
            :key="row.config.id"
            class="config-row"
            :class="{ selected: row.config.id === editingConfigId }"
            type="button"
            @click="emit('edit', row.config.id)"
          >
            <BoxIcon class="config-icon" name="key" size="17" />
            <span>
              <strong>{{ row.config.name }}</strong>
              <small>
                {{ providerCapabilities[row.config.provider].name }} ·
                {{ row.config.model }}
              </small>
            </span>
            <em class="status-badge" :class="`is-${row.status.tone}`">
              <BoxIcon :name="row.status.icon" size="13" />
              {{ row.status.label }}
            </em>
            <BoxIcon class="row-arrow" name="chevron-right" size="16" />
          </button>
        </div>

        <footer class="settings-meta" aria-label="版本信息">
          <span>WebUI {{ version }}</span>
        </footer>
      </section>

      <section v-else-if="settingsView === 'presets'" key="presets" class="settings-page">
        <PromptPresetSettings
          :presets="promptPresets"
          @update:presets="emit('updatePromptPresets', $event)"
        />
      </section>

      <section v-else key="detail" class="settings-page">
        <ConfigEditorForm
          :active-config-name="activeConfig?.name"
          :editing-capability="editingCapability"
          :provider-capabilities="providerCapabilities"
          :settings-draft-is-new="settingsDraftIsNew"
          :settings-draft="settingsDraft"
          :settings-test-state="settingsTestState"
          @delete="emit('delete')"
          @duplicate="emit('duplicate')"
          @save="emit('save')"
          @test="emit('test')"
          @toggle-enabled="emit('toggleEnabled', $event)"
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
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--mugen-workspace);
}

.settings-page {
  display: grid;
  align-content: start;
  gap: 24px;
  width: 100%;
  max-width: 640px;
  margin-inline: auto;
  padding: 16px;
}

.settings-intro {
  margin: 0;
  color: var(--mugen-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.permission-card {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--mugen-border);
  border-radius: 8px;
  background: var(--mugen-card);
}

.permission-heading {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.permission-heading strong {
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

.permission-heading small {
  overflow: hidden;
  color: var(--mugen-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.permission-actions button {
  min-width: 0;
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--mugen-border);
  border-radius: 8px;
  background: var(--mugen-surface-2);
  color: var(--mugen-text);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.permission-actions button:hover {
  background: var(--mugen-hover);
}

.config-list {
  display: grid;
  border: 1px solid var(--mugen-border);
  border-radius: 8px;
  background: var(--mugen-card);
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  box-shadow: inset 0 -1px var(--mugen-hairline);
}

h2 {
  margin: 0;
  color: var(--mugen-text);
  font-size: 13px;
}

.section-header button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  min-height: 28px;
  padding: 0 9px;
  border-color: transparent;
  font-size: 12px;
  white-space: nowrap;
}

.config-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 9px 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-align: left;
}

.config-icon {
  color: var(--mugen-muted);
}

.section-header + .config-row {
  box-shadow: none;
}

.config-row + .config-row {
  box-shadow: inset 0 1px var(--mugen-hairline);
}

.config-row:hover {
  background: var(--mugen-hover);
}

.config-row.selected {
  background: var(--mugen-accent-soft);
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
  color: var(--mugen-muted);
}

.config-row em {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: max-content;
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
}

.status-badge {
  padding: 2px 5px;
  border-radius: 999px;
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

.settings-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  justify-content: center;
  padding: 2px 2px 0;
  color: var(--mugen-muted);
  font-size: 11px;
  line-height: 1.4;
}

.settings-meta span,
.settings-meta button {
  min-width: 0;
  color: var(--mugen-muted);
  font: inherit;
  white-space: nowrap;
}

.settings-meta span.is-available {
  color: var(--mugen-success);
}

.settings-meta span.is-error {
  color: var(--mugen-danger-muted);
}

.settings-meta button {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  cursor: pointer;
}

.settings-meta button:hover:not(:disabled) {
  color: var(--mugen-text);
}

.settings-meta button:disabled {
  cursor: default;
  opacity: 0.62;
}

.row-arrow {
  color: var(--mugen-muted);
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

.settings-group {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.settings-group > h2 {
  font-size: 12px;
  line-height: 16px;
  font-weight: 400;
  color: var(--mugen-secondary);
}

.settings-group-body {
  display: grid;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--mugen-border);
  border-radius: 16px;
  background: var(--mugen-card);
}

.settings-entry, .history-setting {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  gap: 4px;
  align-items: start;
  min-width: 0;
}

.settings-entry {
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  text-align: left;
  align-items: center;
  min-height: 32px;
}

.settings-entry:hover {
  background: var(--mugen-hover);
}

.settings-glyph[data-glyph="text-block"] {
  mask-image: url('../../assets/settings/text-block.svg');
}

.settings-glyph[data-glyph="list-ordered"] {
  mask-image: url('../../assets/settings/list-ordered.svg');
}

.settings-glyph[data-glyph="delete"] {
  mask-image: url('../../assets/settings/delete.svg');
}

.settings-glyph[data-glyph="shining"] {
  mask-image: url('../../assets/settings/shining.svg');
}

.settings-glyph[data-glyph="code"] {
  mask-image: url('../../assets/settings/code.svg');
}

.settings-glyph {
  display: inline-block;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  background: currentColor;
  mask-size: contain;
  mask-position: center;
  mask-repeat: no-repeat;
}

.settings-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.settings-copy strong {
  font-size: 12px;
  line-height: 16px;
  font-weight: 400;
}

.settings-copy small {
  font-size: 10px;
  line-height: 14px;
  color: var(--mugen-secondary);
  overflow-wrap: anywhere;
}

.history-setting {
  align-items: center;
}

.history-stepper {
  display: inline-grid;
  align-items: center;
  grid-template-columns: 28px 24px 28px;
  height: 32px;
  border: 0;
  border-radius: 0;
}

.history-stepper button {
  display: grid;
  place-items: center;
  padding: 0;
  min-height: 32px;
  border: 0;
  background: transparent;
  color: var(--mugen-secondary);
}

.history-stepper output {
  color: var(--mugen-text);
  font-size: 12px;
  text-align: center;
  background: var(--mugen-field);
  border-radius: 2px;
  line-height: 24px;
}

.stepper-back {
  transform: rotate(180deg);
}

.clear-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  justify-self: start;
  min-height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--mugen-danger);
  font-size: 12px;
}

.clear-action:hover {
  color: var(--mugen-danger);
  background: var(--mugen-danger-bg);
}

.clear-confirmation {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.clear-confirmation p {
  width: 100%;
  margin: 0;
  font-size: 12px;
  line-height: 18px;
}

.clear-confirmation button {
  padding: 0 12px;
  font-size: 12px;
}

.imini-key-form {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 4px;
  min-width: 0;
}

.imini-key-content {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.imini-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  line-height: 16px;
}

.imini-heading label, .imini-heading a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.imini-heading a {
  color: var(--mugen-accent);
  text-decoration: none;
}

.imini-glyph {
  color: var(--mugen-accent);
}

.recommended {
  font-size: 10px;
  line-height: 12px;
  padding: 2px 4px;
  color: var(--mugen-accent);
  background: var(--mugen-accent-soft);
  border-radius: 4px;
}

.imini-key-content input {
  min-width: 0;
  min-height: 36px;
  border: 0;
  border-radius: 8px;
  background: var(--mugen-field);
  font-size: 12px;
}

.key-save {
  justify-self: end;
  padding: 0 12px;
  font-size: 12px;
}

button:focus-visible, input:focus-visible, a:focus-visible {
  outline: 2px solid var(--mugen-accent);
  outline-offset: 3px;
}

@media (max-width: 340px) {
  .history-setting {
    grid-template-columns: 16px minmax(0, 1fr);
  }

  .history-stepper {
    grid-column: 2;
    justify-self: end;
  }

}

</style>

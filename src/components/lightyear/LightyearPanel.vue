<script setup lang="ts">
import { useLightyearBanana } from '../../composables/useLightyearBanana'
import type { RuntimeName } from '../../types/lightyear'
import ComposerDock from './ComposerDock.vue'
import MessageThread from './MessageThread.vue'
import PanelHeader from './PanelHeader.vue'
import SettingsPanel from './SettingsPanel.vue'

const props = defineProps<{
  runtime: RuntimeName
}>()

const {
  activeCapability,
  activeConfigId,
  activeView,
  busy,
  canAddReference,
  clearReferences,
  closeSettingsDetail,
  closeSettings,
  configs,
  count,
  createConfig,
  deleteConfig,
  documentLabel,
  editConfig,
  editingCapability,
  editingConfigId,
  enabledConfigs,
  openSettings,
  placeImage,
  previewImage,
  prompt,
  providerCapabilities,
  quality,
  ratio,
  references,
  refreshDocument,
  removeReference,
  restoreSettingsDraft,
  saveConfig,
  selectedPreviewMode,
  selectConfig,
  sendPrompt,
  settingsDraft,
  settingsDraftIsNew,
  settingsView,
  size,
  status,
  testConfig,
  turns,
  addReference,
  upscaleImage,
  updateSettingsDraft,
  useResultAsReference
} = useLightyearBanana(props.runtime)

function handleHeaderBack() {
  if (activeView.value === 'settings' && settingsView.value === 'detail') {
    closeSettingsDetail()
    return
  }

  closeSettings()
}
</script>

<template>
  <main class="lightyear-shell" :class="{ 'is-browser-preview': props.runtime === 'browser' }">
    <PanelHeader
      :document-label="documentLabel"
      :in-settings="activeView === 'settings'"
      :status="status"
      @back="handleHeaderBack"
      @open-settings="openSettings()"
      @refresh="refreshDocument"
    />

    <template v-if="activeView === 'settings'">
      <SettingsPanel
        :configs="configs"
        :editing-capability="editingCapability"
        :editing-config-id="editingConfigId"
        :provider-capabilities="providerCapabilities"
        :settings-draft-is-new="settingsDraftIsNew"
        :settings-draft="settingsDraft"
        :settings-view="settingsView"
        @close-detail="closeSettingsDetail"
        @create="createConfig"
        @delete="deleteConfig"
        @edit="editConfig"
        @restore="restoreSettingsDraft"
        @save="saveConfig"
        @test="testConfig"
        @update-draft="updateSettingsDraft"
      />
    </template>

    <template v-else>
      <MessageThread
        :turns="turns"
        @place="placeImage"
        @preview="previewImage"
        @reference="useResultAsReference"
        @upscale="upscaleImage"
      />

      <ComposerDock
        :active-capability="activeCapability"
        :active-config-id="activeConfigId"
        :busy="busy"
        :can-add-reference="canAddReference"
        :configs="enabledConfigs"
        :count="count"
        :prompt="prompt"
        :quality="quality"
        :ratio="ratio"
        :references="references"
        :selected-preview-mode="selectedPreviewMode"
        :size="size"
        @add-reference="addReference"
        @clear-references="clearReferences"
        @remove-reference="removeReference"
        @select-config="selectConfig"
        @send="sendPrompt"
        @update-count="count = $event"
        @update-preview-mode="selectedPreviewMode = $event"
        @update-prompt="prompt = $event"
        @update-quality="quality = $event"
        @update-ratio="ratio = $event"
        @update-size="size = $event"
      />
    </template>
  </main>
</template>

<style scoped>
.lightyear-shell {
  display: flex;
  width: 100%;
  min-width: 280px;
  height: 100%;
  min-height: 100%;
  flex-direction: column;
  overflow: hidden;
  background: var(--lb-bg);
  color: var(--lb-text);
}

.lightyear-shell.is-browser-preview {
  width: min(100vw, 390px);
  max-width: 390px;
  margin: 0 auto;
  border-right: 1px solid var(--lb-border);
  border-left: 1px solid var(--lb-border);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.32);
}
</style>

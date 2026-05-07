<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useLightyearBanana } from '../../composables/useLightyearBanana'
import type { DesktopPlatform, RuntimeName } from '../../types/lightyear'
import ComposerDock from './ComposerDock.vue'
import BoxIcon from './BoxIcon.vue'
import MessageThread from './MessageThread.vue'
import PanelHeader from './PanelHeader.vue'
import SettingsPanel from './SettingsPanel.vue'

const props = defineProps<{
  runtime: RuntimeName
  desktopPlatform: DesktopPlatform
  showWindowControls?: boolean
}>()

const {
  activeCapability,
  activeConfigId,
  activeView,
  busy,
  canAddReference,
  canSend,
  cancelGeneration,
  clearReferences,
  closeSettingsDetail,
  closeSettings,
  configs,
  count,
  createConfig,
  deleteConfig,
  deployWindows,
  editConfig,
  editingCapability,
  editingConfigId,
  enabledConfigs,
  generationLoading,
  installPluginUrl,
  mockServer,
  openMacPermissionSettings,
  openSettings,
  placeImage,
  prompt,
  providerCapabilities,
  quality,
  ratio,
  references,
  removeReference,
  saveConfig,
  selectConfig,
  sendPrompt,
  settingsDraft,
  settingsDraftIsNew,
  settingsTestState,
  settingsView,
  size,
  status,
  testConfig,
  toastMessage,
  turns,
  addReference,
  toggleConfigEnabled,
  upscaleImage,
  updateSettingsDraft,
  updateMockServer,
  windowDeployState,
  useResultAsReference
} = useLightyearBanana(props.runtime)

const themeMode = shallowRef<'dark' | 'light'>('dark')
const navigationTitle = computed(() => {
  if (activeView.value !== 'settings') {
    return 'Lightyear Banana v0.1'
  }

  if (settingsView.value === 'list') {
    return '设置'
  }

  if (settingsDraftIsNew.value) {
    return '新建配置'
  }

  return settingsDraft.name || '配置详情'
})

function toggleTheme() {
  themeMode.value = themeMode.value === 'dark' ? 'light' : 'dark'
}

function handleHeaderBack() {
  if (activeView.value === 'settings' && settingsView.value === 'detail') {
    closeSettingsDetail()
    return
  }

  closeSettings()
}
</script>

<template>
  <main class="lightyear-shell" :class="`theme-${themeMode}`">
    <PanelHeader
      :in-settings="activeView === 'settings'"
      :install-plugin-url="installPluginUrl"
      :status="status"
      :titlebar-inset="props.runtime === 'electron' || props.showWindowControls"
      :desktop-platform="props.desktopPlatform"
      :show-window-controls="props.showWindowControls"
      :theme-mode="themeMode"
      :title="navigationTitle"
      :window-deploy-state="windowDeployState"
      @back="handleHeaderBack"
      @deploy-window="deployWindows"
      @open-settings="openSettings()"
      @toggle-theme="toggleTheme"
    />

    <SettingsPanel
      v-if="activeView === 'settings'"
      :configs="configs"
      :editing-capability="editingCapability"
      :editing-config-id="editingConfigId"
      :mock-server="mockServer"
      :mac-permission-settings-available="props.runtime === 'electron' && props.desktopPlatform === 'darwin'"
      :provider-capabilities="providerCapabilities"
      :settings-draft-is-new="settingsDraftIsNew"
      :settings-draft="settingsDraft"
      :settings-test-state="settingsTestState"
      :settings-view="settingsView"
      @close-detail="closeSettingsDetail"
      @create="createConfig"
      @delete="deleteConfig"
      @edit="editConfig"
      @open-mac-permission-settings="openMacPermissionSettings"
      @save="saveConfig"
      @test="testConfig"
      @toggle-enabled="toggleConfigEnabled"
      @update-draft="updateSettingsDraft"
      @update-mock-server="updateMockServer"
    />

    <section v-else class="workspace-route" aria-label="生成工作区">
      <MessageThread
        :loading="generationLoading"
        :turns="turns"
        @cancel="cancelGeneration"
        @place="placeImage"
        @reference="useResultAsReference"
        @upscale="upscaleImage"
      />

      <div class="toast-anchor" aria-live="polite">
        <Transition name="toast-pop">
          <div v-if="toastMessage" class="toast" role="status">
            <BoxIcon name="check-circle" size="15" />
            <span>{{ toastMessage }}</span>
          </div>
        </Transition>
      </div>

      <ComposerDock
        :active-capability="activeCapability"
        :active-config-id="activeConfigId"
        :busy="busy"
        :can-add-reference="canAddReference"
        :can-send="canSend"
        :configs="enabledConfigs"
        :count="count"
        :prompt="prompt"
        :quality="quality"
        :ratio="ratio"
        :references="references"
        :size="size"
        @add-reference="addReference"
        @clear-references="clearReferences"
        @remove-reference="removeReference"
        @select-config="selectConfig"
        @send="sendPrompt"
        @update-count="count = $event"
        @update-prompt="prompt = $event"
        @update-quality="quality = $event"
        @update-ratio="ratio = $event"
        @update-size="size = $event"
      />
    </section>
  </main>
</template>

<style scoped>
.lightyear-shell {
  --lb-accent: #2f8cff;
  --lb-accent-soft: rgba(47, 140, 255, 0.14);
  --lb-danger: #ffb4c0;
  position: relative;
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

.toast-anchor {
  position: relative;
  z-index: 80;
  display: flex;
  height: 0;
  justify-content: center;
  pointer-events: none;
}

.toast {
  position: absolute;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 24px);
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--lb-border-strong);
  border-radius: 8px;
  background: var(--lb-overlay);
  color: var(--lb-text);
  box-shadow: 0 12px 32px var(--lb-shadow);
  font-size: 12px;
  white-space: nowrap;
}

.toast :deep(.box-icon) {
  color: var(--lb-accent);
}

.toast-pop-enter-active,
.toast-pop-leave-active {
  transition:
    opacity 170ms ease,
    transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.toast-pop-enter-from,
.toast-pop-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}

.lightyear-shell,
.workspace-route,
.lightyear-shell :deep(.panel-header),
.lightyear-shell :deep(.thread),
.lightyear-shell :deep(.composer),
.lightyear-shell :deep(.icon-button),
.lightyear-shell :deep(.empty-state),
.lightyear-shell :deep(.user-message p),
.lightyear-shell :deep(.select-button),
.lightyear-shell :deep(.result-card),
.lightyear-shell :deep(.result-actions),
.lightyear-shell :deep(.result-actions button),
.lightyear-shell :deep(.add-reference-inline),
.lightyear-shell :deep(.clear-reference),
.lightyear-shell :deep(.prompt-input),
.lightyear-shell :deep(.select-trigger),
.lightyear-shell :deep(.ratio-trigger) {
  transition:
    background-color 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease,
    color 180ms ease;
}

.lightyear-shell.theme-dark {
  color-scheme: dark;
  --lb-bg: #1a2028;
  --lb-workspace: #151b23;
  --lb-thread-bg: #0d1218;
  --lb-thread-surface: #202733;
  --lb-thread-surface-2: #252d39;
  --lb-thread-card: #1b222c;
  --lb-thread-card-deep: #171e27;
  --lb-thread-image-bg: #111720;
  --lb-composer: #171e27;
  --lb-surface: #242b36;
  --lb-surface-2: #2c3440;
  --lb-field: #1e2630;
  --lb-card: #202733;
  --lb-card-deep: #1b222c;
  --lb-overlay: #242b36;
  --lb-border: rgba(168, 179, 196, 0.15);
  --lb-border-strong: rgba(180, 190, 205, 0.24);
  --lb-hairline: rgba(168, 179, 196, 0.12);
  --lb-hover: rgba(255, 255, 255, 0.045);
  --lb-text: #f3f4f6;
  --lb-secondary: #aeb5c2;
  --lb-muted: #7e8795;
  --lb-empty-bg: rgba(255, 255, 255, 0.045);
  --lb-shadow: rgba(0, 0, 0, 0.38);
}

.lightyear-shell.theme-light {
  color-scheme: light;
  --lb-bg: #ffffff;
  --lb-workspace: #f6f6f4;
  --lb-thread-bg: #eef0f3;
  --lb-thread-surface: #ffffff;
  --lb-thread-surface-2: #ffffff;
  --lb-thread-card: #ffffff;
  --lb-thread-card-deep: #ffffff;
  --lb-thread-image-bg: #e8ebf0;
  --lb-composer: #ffffff;
  --lb-surface: #f4f4f2;
  --lb-surface-2: #ececea;
  --lb-field: #f7f7f5;
  --lb-card: #ffffff;
  --lb-card-deep: #f5f5f3;
  --lb-overlay: #ffffff;
  --lb-border: rgba(48, 43, 35, 0.12);
  --lb-border-strong: rgba(48, 43, 35, 0.2);
  --lb-hairline: rgba(48, 43, 35, 0.1);
  --lb-hover: rgba(48, 43, 35, 0.055);
  --lb-text: #22211e;
  --lb-secondary: #5d5a53;
  --lb-muted: #8a857c;
  --lb-empty-bg: rgba(48, 43, 35, 0.055);
  --lb-shadow: rgba(67, 57, 39, 0.18);
  --lb-accent-soft: rgba(47, 140, 255, 0.13);
  --lb-danger: #a63b4a;
}

.workspace-route {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  background: var(--lb-workspace);
}

@media (prefers-reduced-motion: reduce) {
  .lightyear-shell,
  .workspace-route,
  .lightyear-shell :deep(.panel-header),
  .lightyear-shell :deep(.thread),
  .lightyear-shell :deep(.composer),
  .lightyear-shell :deep(.icon-button),
  .lightyear-shell :deep(.empty-state),
  .lightyear-shell :deep(.user-message p),
  .lightyear-shell :deep(.select-button),
  .lightyear-shell :deep(.result-card),
  .lightyear-shell :deep(.result-actions),
  .lightyear-shell :deep(.result-actions button),
  .lightyear-shell :deep(.add-reference-inline),
  .lightyear-shell :deep(.clear-reference),
  .lightyear-shell :deep(.prompt-input),
  .lightyear-shell :deep(.select-trigger),
  .lightyear-shell :deep(.ratio-trigger) {
    transition: none;
  }

}
</style>

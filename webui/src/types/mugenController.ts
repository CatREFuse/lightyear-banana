import type { Ref } from 'vue'
import type { CapturedCanvasImage } from '@mugen/core'
import type {
  AppView,
  CanvasOperationState,
  ChatTurn,
  DiagnosticExportState,
  GeneratedImage,
  GenerationLoadingState,
  ImageProviderId,
  ModelConfig,
  PlacementTarget,
  PromptPreset,
  ProviderCapability,
  ReferenceImage,
  ReferenceSource,
  ResolutionInputMode,
  SettingsTestState,
  SettingsView
} from '@mugen/core'

type ReadonlyState<T> = Readonly<Ref<T>>
type ControllerResult = void | Promise<unknown>

export type MugenController = {
  activeCapability: ReadonlyState<ProviderCapability>
  activeConfigId: Ref<string>
  activeView: Ref<AppView>
  appendGeneration: (turnId: string) => ControllerResult
  busy: Ref<boolean>
  canvasOperation: Ref<CanvasOperationState>
  canAddReference: ReadonlyState<boolean>
  canSend: ReadonlyState<boolean>
  cancelGeneration: (taskId: string) => ControllerResult
  clearConversationData: () => ControllerResult
  clearReferences: () => ControllerResult
  closeSettingsDetail: () => ControllerResult
  closeSettings: () => ControllerResult
  connectionStatus: ReadonlyState<string>
  configs: ReadonlyState<ModelConfig[]>
  count: Ref<number>
  createConfig: () => ControllerResult
  customHeight: Ref<number>
  customWidth: Ref<number>
  deleteConfig: () => ControllerResult
  diagnosticExportState: Ref<DiagnosticExportState>
  duplicateConfig: () => ControllerResult
  editConfig: (configId: string) => ControllerResult
  editGenerationRequest: (turnId: string) => ControllerResult
  editingCapability: ReadonlyState<ProviderCapability>
  editingConfigId: Ref<string>
  enabledConfigs: ReadonlyState<ModelConfig[]>
  exportDiagnostics: () => ControllerResult
  generationLoading: ReadonlyState<GenerationLoadingState[]>
  installPluginUrl: ReadonlyState<string>
  loadOriginalImage?: (image: CapturedCanvasImage) => Promise<CapturedCanvasImage>
  openPromptPresets: () => ControllerResult
  openSettings: (configId?: string) => ControllerResult
  placeImage: (image: GeneratedImage, target: PlacementTarget) => ControllerResult
  prompt: Ref<string>
  promptPresets: Ref<PromptPreset[]>
  providerCapabilities: Record<ImageProviderId, ProviderCapability>
  quality: Ref<string>
  ratio: Ref<string>
  references: ReadonlyState<ReferenceImage[]>
  removeReference: (id: string) => ControllerResult
  retryGeneration: (turnId: string) => ControllerResult
  resolutionMode: Ref<ResolutionInputMode>
  saveConfig: () => ControllerResult
  saveGeneratedImage: (image: CapturedCanvasImage) => ControllerResult
  selectConfig: (configId: string) => ControllerResult
  selectModel: (model: string) => ControllerResult
  sendPrompt: (skipPresetResolution?: boolean) => ControllerResult
  settingsDraft: ModelConfig
  settingsDraftIsNew: Ref<boolean>
  settingsTestState: Ref<SettingsTestState>
  settingsView: Ref<SettingsView>
  size: Ref<string>
  testConfig: () => ControllerResult
  toastMessage: Ref<string>
  toggleConfigEnabled: (enabled: boolean) => ControllerResult
  turns: ReadonlyState<ChatTurn[]>
  addReference: (source: ReferenceSource) => ControllerResult
  upscaleImage: (image: GeneratedImage) => ControllerResult
  updateSettingsDraft: (patch: Partial<ModelConfig>) => ControllerResult
  updatePromptPresets: (presets: PromptPreset[]) => ControllerResult
  useResultAsReference: (image: GeneratedImage) => ControllerResult
}

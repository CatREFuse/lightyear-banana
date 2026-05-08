import type { CapturedCanvasImage } from '../uxp/canvasPrimitives'

export type RuntimeName = 'browser' | 'electron' | 'photoshop-uxp'

export type DesktopPlatform = 'darwin' | 'win32'

export type AppView = 'workspace' | 'settings'

export type SettingsView = 'list' | 'detail'

export type WindowDeploySide = 'left' | 'right'

export type WindowDeployStatus = 'idle' | 'deploying' | 'success' | 'error'

export type WindowDeployState = {
  status: WindowDeployStatus
  message: string
}

export type WindowDeployResult = {
  side: WindowDeploySide
  panelBounds: {
    x: number
    y: number
    width: number
    height: number
  }
  photoshopBounds: {
    x: number
    y: number
    width: number
    height: number
  }
  photoshopAdjusted: boolean
  message: string
}

export type CanvasOperationState = {
  type: 'idle' | 'capture' | 'place'
  label: string
  imageId?: string
}

export type MacPermissionPane = 'accessibility' | 'automation' | 'screenCapture'

export type SettingsTestStatus = 'idle' | 'testing' | 'success' | 'error'

export type SettingsTestState = {
  status: SettingsTestStatus
  message: string
}

export type GenerationLoadingState = {
  id: string
  references: ReferenceImage[]
  prompt: string
  elapsedSeconds: number
}

export type ReferenceSource = 'visible' | 'selection' | 'layer' | 'upload' | 'clipboard' | 'generated'

export type PlacementTarget =
  | { type: 'default' }
  | {
      type: 'reference-selection'
      referenceId: string
      referenceIndex: number
      bounds: CapturedCanvasImage['sourceBounds']
    }
  | { type: 'original-size' }
  | { type: 'full-canvas' }
  | { type: 'current-selection' }

export type ImageProviderId =
  | 'openai'
  | 'gemini'
  | 'seedream'
  | 'qwen'
  | 'kling'
  | 'flux'
  | 'comfyui'
  | 'codex-image-server'
  | 'custom-openai'

export type ComfyUiNodeMappingType =
  | 'model'
  | 'prompt'
  | 'negative_prompt'
  | 'image'
  | 'width'
  | 'height'
  | 'batch_size'
  | 'steps'
  | 'seed'
  | 'custom'

export type ComfyUiNodeMapping = {
  type: ComfyUiNodeMappingType
  nodeIds: string[]
  key: string
  value?: string
}

export type ComfyUiSettings = {
  workflow: string
  workflowNodes: ComfyUiNodeMapping[]
  timeoutMs: number
  pollIntervalMs: number
}

export type ProviderCapabilityModelOverride = {
  referenceLimit?: number
  sizeOptions?: string[]
  qualityOptions?: string[]
  countOptions?: number[]
  ratioOptions?: string[]
}

export type ProviderCapability = {
  id: ImageProviderId
  name: string
  modelOptions: string[]
  referenceLimit: number
  sizeOptions: string[]
  qualityOptions: string[]
  countOptions: number[]
  ratioOptions: string[]
  supportsBaseUrl: boolean
  modelOverrides?: Record<string, ProviderCapabilityModelOverride>
}

export type ModelConfig = {
  id: string
  name: string
  provider: ImageProviderId
  model: string
  apiKey: string
  baseUrl: string
  enabled: boolean
  comfyUi?: ComfyUiSettings
}

export type ReferenceImage = {
  id: string
  source: ReferenceSource
  label: string
  image: CapturedCanvasImage
}

export type GeneratedImage = CapturedCanvasImage & {
  modelConfigId: string
}

export type GenerationRequestSnapshot = {
  canvasSize?: { width: number; height: number }
  config: ModelConfig
  count: number
  prompt: string
  quality: string
  ratio: string
  references: ReferenceImage[]
  resolvedSize: string
  selectedSize: string
  summary: string
}

export type ChatTurn = {
  id: string
  prompt: string
  references: ReferenceImage[]
  responseText: string
  elapsedLabel: string
  repeatRequest?: GenerationRequestSnapshot
  results: GeneratedImage[]
  tone?: 'normal' | 'error' | 'canceled'
}

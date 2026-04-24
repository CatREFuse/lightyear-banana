import type { CapturedCanvasImage } from '../uxp/canvasPrimitives'

export type RuntimeName = 'browser' | 'photoshop-uxp'

export type AppView = 'workspace' | 'settings'

export type SettingsView = 'list' | 'detail'

export type ReferenceSource = 'visible' | 'selection' | 'layer' | 'upload' | 'clipboard' | 'generated'

export type PreviewMode = 'reference-selection' | 'current-selection' | 'full-canvas'

export type ImageProviderId =
  | 'openai'
  | 'gemini'
  | 'seedream'
  | 'qwen'
  | 'kling'
  | 'flux'
  | 'custom-openai'

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
}

export type ModelConfig = {
  id: string
  name: string
  provider: ImageProviderId
  model: string
  apiKey: string
  baseUrl: string
  enabled: boolean
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

export type ChatTurn = {
  id: string
  prompt: string
  references: ReferenceImage[]
  responseText: string
  elapsedLabel: string
  previewMode: PreviewMode
  results: GeneratedImage[]
}

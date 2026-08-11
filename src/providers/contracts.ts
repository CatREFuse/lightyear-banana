import type {
  ImageProviderId,
  ImageRequestLogEntry,
  ModelConfig,
  ProviderCapability,
  ReferenceImage
} from '../types/mugen'

export type NormalizedImageResult = {
  previewUrl: string
  label: string
  resolvedSize?: string
}

export type ImageGenerationParams = {
  canvasSize?: { width: number; height: number }
  config: ModelConfig
  count: number
  loadingTaskId?: string
  prompt: string
  quality: string
  ratio: string
  references: ReferenceImage[]
  onTiming?: (entry: ImageRequestLogEntry) => void
  selectedSize?: string
  signal?: AbortSignal
  size: string
}

export type ProviderDefinition = {
  id: ImageProviderId
  capability: ProviderCapability
  requiresApiKey: boolean
  requiresBaseUrl: boolean
}

export type ProviderConfigValidationIssue = {
  code:
    | 'invalid-config'
    | 'unknown-provider'
    | 'provider-mismatch'
    | 'missing-model'
    | 'missing-api-key'
    | 'missing-base-url'
  field: 'config' | 'provider' | 'model' | 'apiKey' | 'baseUrl'
  message: string
}

export type ProviderConfigValidationResult =
  | { valid: true; issues: [] }
  | { valid: false; issues: ProviderConfigValidationIssue[] }

export type ProviderAdapter = {
  readonly id: ImageProviderId
  generate(params: ImageGenerationParams): Promise<NormalizedImageResult[]>
  test(config: ModelConfig): Promise<void>
}

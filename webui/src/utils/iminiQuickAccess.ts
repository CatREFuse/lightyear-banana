import { providerCapabilities, type ModelConfig } from '@mugen/core'

export function createIMiniQuickAccessConfig(existing: ModelConfig | undefined, apiKey: string, id: string): ModelConfig {
  const cleanApiKey = apiKey.trim()
  if (!cleanApiKey) {
    throw new Error('请输入 iMini API Key')
  }

  const capability = providerCapabilities.iMini
  const model = existing?.model && capability.modelOptions.includes(existing.model)
    ? existing.model
    : capability.modelOptions[0] ?? ''

  return {
    id: existing?.id ?? id,
    name: existing?.name.trim() || 'iMini',
    provider: 'iMini',
    model,
    models: [...capability.modelOptions],
    apiKey: cleanApiKey,
    baseUrl: capability.officialBaseUrl ?? '',
    usesOfficialBaseUrl: true,
    customFormat: undefined,
    enabled: true,
    comfyUi: undefined
  }
}

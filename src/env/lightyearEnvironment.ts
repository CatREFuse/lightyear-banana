import type { MockServerConfig } from '../types/lightyear'

export type LightyearEnvironment = 'development' | 'test' | 'production'

export const lightyearEnvironment: LightyearEnvironment = __LIGHTYEAR_APP_ENV__
export const canUseMockApi = __LIGHTYEAR_ENABLE_MOCK_API__
export const canUseApiKeyPresets = __LIGHTYEAR_ENABLE_API_KEY_PRESETS__

export const productionMockServer: MockServerConfig = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:38322'
}

export function readEffectiveMockServer(mockServer: MockServerConfig): MockServerConfig {
  if (canUseMockApi) {
    return mockServer
  }

  return {
    ...mockServer,
    enabled: false
  }
}

import type { ModelConfig } from '../types/mugen'

type MugenEnvironment = 'development' | 'test' | 'production'
type ApimartConfig = Pick<ModelConfig, 'provider' | 'apiKey' | 'baseUrl'>

function runtimeEnvironment(): MugenEnvironment {
  return typeof __MUGEN_APP_ENV__ === 'undefined' ? 'production' : __MUGEN_APP_ENV__
}

export function canConfigureDevelopmentApimartBaseUrl(
  config: Pick<ApimartConfig, 'provider' | 'apiKey'>,
  environment: MugenEnvironment = runtimeEnvironment()
) {
  return environment !== 'production'
    && config.provider === 'apimart'
    && config.apiKey.trim().startsWith('mock-')
}

export function canUseDevelopmentApimartBaseUrl(
  config: ApimartConfig,
  environment: MugenEnvironment = runtimeEnvironment()
) {
  if (!canConfigureDevelopmentApimartBaseUrl(config, environment) || !config.baseUrl.trim()) return false
  try {
    const url = new URL(config.baseUrl)
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.'))
  } catch {
    return false
  }
}

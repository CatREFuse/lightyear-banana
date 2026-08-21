import { describe, expect, it } from 'vitest'
import type { ModelConfig } from '@mugen/core'
import { createIMiniQuickAccessConfig } from './iminiQuickAccess'

describe('createIMiniQuickAccessConfig', () => {
  it('creates an enabled official iMini configuration', () => {
    const config = createIMiniQuickAccessConfig(undefined, '  secret-key  ', 'config-imini')

    expect(config).toMatchObject({
      id: 'config-imini',
      name: 'iMini',
      provider: 'iMini',
      model: 'google/nano-banana',
      apiKey: 'secret-key',
      baseUrl: 'https://openapi.imini.ai/imini/router',
      usesOfficialBaseUrl: true,
      enabled: true
    })
  })

  it('updates the existing iMini entry without changing its supported model', () => {
    const existing: ModelConfig = {
      id: 'saved-imini',
      name: '我的 iMini',
      provider: 'iMini',
      model: 'openai/gpt-image-2',
      models: ['openai/gpt-image-2'],
      apiKey: 'old-key',
      baseUrl: 'https://example.com',
      enabled: false
    }

    const config = createIMiniQuickAccessConfig(existing, 'new-key', 'unused')

    expect(config.id).toBe('saved-imini')
    expect(config.name).toBe('我的 iMini')
    expect(config.model).toBe('openai/gpt-image-2')
    expect(config.apiKey).toBe('new-key')
    expect(config.baseUrl).toBe('https://openapi.imini.ai/imini/router')
    expect(config.enabled).toBe(true)
  })

  it('rejects an empty key', () => {
    expect(() => createIMiniQuickAccessConfig(undefined, '  ', 'config-imini')).toThrow('请输入 iMini API Key')
  })
})

import { describe, expect, it } from 'vitest'
import { canConfigureDevelopmentApimartBaseUrl, canUseDevelopmentApimartBaseUrl } from './apimartDevelopmentConfig'

const fixtureConfig = {
  provider: 'apimart' as const,
  apiKey: 'mock-apimart-good',
  baseUrl: 'http://127.0.0.1:38323'
}

describe('APIMart development Base URL policy', () => {
  it('allows a mock key to reveal the local fixture field outside production', () => {
    expect(canConfigureDevelopmentApimartBaseUrl(fixtureConfig, 'development')).toBe(true)
    expect(canConfigureDevelopmentApimartBaseUrl(fixtureConfig, 'test')).toBe(true)
    expect(canConfigureDevelopmentApimartBaseUrl(fixtureConfig, 'production')).toBe(false)
  })

  it('accepts only loopback HTTP or HTTPS fixture URLs', () => {
    expect(canUseDevelopmentApimartBaseUrl(fixtureConfig, 'test')).toBe(true)
    expect(canUseDevelopmentApimartBaseUrl({ ...fixtureConfig, baseUrl: 'http://localhost:38323' }, 'test')).toBe(true)
    expect(canUseDevelopmentApimartBaseUrl({ ...fixtureConfig, baseUrl: 'http://[::1]:38323' }, 'test')).toBe(true)
    expect(canUseDevelopmentApimartBaseUrl({ ...fixtureConfig, baseUrl: 'https://api.example.com' }, 'test')).toBe(false)
    expect(canUseDevelopmentApimartBaseUrl({ ...fixtureConfig, baseUrl: 'file:///tmp/mock' }, 'test')).toBe(false)
  })

  it('rejects real keys and non-APIMart providers', () => {
    expect(canUseDevelopmentApimartBaseUrl({ ...fixtureConfig, apiKey: 'real-key' }, 'development')).toBe(false)
    expect(canUseDevelopmentApimartBaseUrl({ ...fixtureConfig, provider: 'openai' }, 'development')).toBe(false)
  })
})

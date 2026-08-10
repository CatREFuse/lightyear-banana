import { describe, expect, it } from 'vitest'
import { expectsUxpHost, requestedMockScenario } from './index'

describe('browser preview routing', () => {
  it('accepts only named mock scenarios', () => {
    expect(requestedMockScenario('?mock=success')).toBe('success')
    expect(requestedMockScenario('?mock=provider-failure')).toBe('provider-failure')
    expect(requestedMockScenario('')).toBeNull()
    expect(requestedMockScenario('?mock=anything')).toBeNull()
  })

  it('reserves the embedded marker for the UXP shell', () => {
    expect(expectsUxpHost('?host=uxp')).toBe(true)
    expect(expectsUxpHost('')).toBe(false)
    expect(expectsUxpHost('?host=browser')).toBe(false)
  })
})

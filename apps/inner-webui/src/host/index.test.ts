import { describe, expect, it } from 'vitest'
import { createHostClient, expectsUxpHost } from './index'

describe('browser preview routing', () => {
  it('never enables a production mock host from the URL', () => {
    const value = { location: { search: '?mock=success' } } as unknown as Window
    expect(createHostClient(value).mode).toBe('unavailable')
  })

  it('reserves the embedded marker for the UXP shell', () => {
    expect(expectsUxpHost('?host=uxp')).toBe(true)
    expect(expectsUxpHost('')).toBe(false)
    expect(expectsUxpHost('?host=browser')).toBe(false)
  })
})

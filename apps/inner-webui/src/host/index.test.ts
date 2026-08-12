import { describe, expect, it } from 'vitest'
import { createHostClient, resolveWebUiRuntime } from './index'

describe('browser preview routing', () => {
  it('never enables a production mock host from the URL', () => {
    const value = { location: { search: '?mock=success' } } as unknown as Window
    expect(createHostClient(value).mode).toBe('unavailable')
  })

  it('uses the shared browser runtime when no trusted CCX bridge is present', () => {
    const browser = { location: { search: '' } } as unknown as Window
    const embedded = {
      location: { search: '' },
      uxpHost: { postMessage() {} }
    } as unknown as Window

    expect(resolveWebUiRuntime(browser)).toBe('browser')
    expect(resolveWebUiRuntime(embedded)).toBe('embedded')
  })

  it('does not let URL parameters impersonate the Photoshop runtime', () => {
    const forgedUrls = ['?host=uxp', '?host=photoshop-uxp', '?mock=success&host=uxp']

    for (const search of forgedUrls) {
      const browser = { location: { search } } as unknown as Window
      expect(resolveWebUiRuntime(browser)).toBe('browser')
      expect(createHostClient(browser).mode).toBe('unavailable')
    }
  })
})

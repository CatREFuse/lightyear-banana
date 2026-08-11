import { describe, expect, it } from 'vitest'
import { createHostClient, expectsUxpHost, resolveWebUiRuntime } from './index'

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

  it('uses the shared browser runtime when no UXP bridge is present', () => {
    const browser = { location: { search: '' } } as unknown as Window
    const embedded = {
      location: { search: '' },
      uxpHost: { postMessage() {} }
    } as unknown as Window

    expect(resolveWebUiRuntime(browser)).toBe('browser')
    expect(resolveWebUiRuntime(embedded)).toBe('embedded')
    expect(resolveWebUiRuntime({ location: { search: '?host=uxp' } } as unknown as Window)).toBe('embedded')
  })
})

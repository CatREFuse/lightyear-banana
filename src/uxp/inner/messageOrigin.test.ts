import { describe, expect, it } from 'vitest'
import { matchesWebViewMessageOrigin } from './messageOrigin'

describe('matchesWebViewMessageOrigin', () => {
  it('accepts the full content URL emitted by Photoshop UXP', () => {
    expect(matchesWebViewMessageOrigin(
      'http://127.0.0.1:4173/?host=uxp#/',
      'http://127.0.0.1:4173'
    )).toBe(true)
  })

  it('rejects malformed and cross-origin values', () => {
    expect(matchesWebViewMessageOrigin(undefined, 'https://webui.example.com')).toBe(false)
    expect(matchesWebViewMessageOrigin('not-a-url', 'https://webui.example.com')).toBe(false)
    expect(matchesWebViewMessageOrigin('https://evil.example.com/app', 'https://webui.example.com')).toBe(false)
  })
})

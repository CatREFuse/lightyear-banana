import { describe, expect, it } from 'vitest'
import { decodeUtf8, encodeUtf8, utf8ByteLength } from './utf8'

describe('UXP UTF-8 helpers', () => {
  it('round-trips ASCII, Chinese and supplementary characters without browser encoding globals', () => {
    const value = 'Lightyear 小猫 🐈'
    const encoded = encodeUtf8(value)

    expect(decodeUtf8(encoded)).toBe(value)
    expect(utf8ByteLength(value)).toBe(encoded.byteLength)
    expect(Array.from(encoded)).toEqual(Array.from(new TextEncoder().encode(value)))
  })

  it('replaces malformed UTF-8 and unpaired UTF-16 surrogates', () => {
    expect(decodeUtf8(Uint8Array.from([0xE0, 0x80, 0x80]))).toBe('\uFFFD\uFFFD\uFFFD')
    expect(decodeUtf8(encodeUtf8('\uD800'))).toBe('\uFFFD')
  })
})

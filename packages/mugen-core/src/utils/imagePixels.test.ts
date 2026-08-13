import { describe, expect, it } from 'vitest'
import { createCanvasImageFromApiAsset, readImageByteDimensions, readInlineImageDimensions } from './imagePixels'

function dataUrl(bytes: number[], mimeType: string) {
  return `data:${mimeType};base64,${btoa(String.fromCharCode(...bytes))}`
}

describe('inline image dimensions', () => {
  it('reads PNG dimensions from the IHDR header', () => {
    const bytes = [
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
      0, 0, 2, 0, 0, 0, 1, 0
    ]
    expect(readImageByteDimensions(Uint8Array.from(bytes))).toEqual({ width: 512, height: 256 })
    expect(readInlineImageDimensions(dataUrl(bytes, 'image/png'))).toEqual({ width: 512, height: 256 })
  })

  it('reads JPEG dimensions without waiting for UXP DOM Image events', async () => {
    const bytes = [
      0xFF, 0xD8,
      0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00,
      0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x01, 0x2C, 0x02, 0x80, 0x03, 0x01, 0x11,
      0xFF, 0xD9
    ]
    const previewUrl = dataUrl(bytes, 'image/jpeg')

    expect(readInlineImageDimensions(previewUrl)).toEqual({ width: 640, height: 300 })
    await expect(createCanvasImageFromApiAsset({
      id: 'cat',
      label: 'Cat',
      modelConfigId: 'apimart-smoke',
      modelName: 'gpt-image-2',
      previewUrl
    })).resolves.toMatchObject({ width: 640, height: 300, previewUrl })
  })
})

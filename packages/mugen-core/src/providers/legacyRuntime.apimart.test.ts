import { describe, expect, it } from 'vitest'
import { createApimartReferenceUpload } from './legacyRuntime'

const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
])

function toDataUrl(mimeType: string, bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:${mimeType};base64,${btoa(binary)}`
}

function includesBytes(body: Uint8Array, expected: Uint8Array) {
  return body.some((_byte, offset) => (
    offset + expected.byteLength <= body.byteLength
    && expected.every((value, index) => body[offset + index] === value)
  ))
}

describe('APIMart reference upload body', () => {
  it('builds a byte-stable multipart body with the declared boundary and original image bytes', () => {
    const upload = createApimartReferenceUpload(toDataUrl('image/png', pngBytes), 0, 'mugen-test-boundary')
    const encoder = new TextEncoder()
    const footer = encoder.encode('\r\n--mugen-test-boundary--\r\n')

    expect(upload.contentType).toBe('multipart/form-data; boundary=mugen-test-boundary')
    expect(upload.filename).toBe('mugen-reference-1.png')
    expect(includesBytes(upload.body, encoder.encode('Content-Disposition: form-data; name="file"; filename="mugen-reference-1.png"'))).toBe(true)
    expect(includesBytes(upload.body, encoder.encode('Content-Type: image/png'))).toBe(true)
    expect(includesBytes(upload.body, pngBytes)).toBe(true)
    expect(upload.body.subarray(-footer.byteLength)).toEqual(footer)
  })

  it('rejects a MIME/signature mismatch before starting the request', () => {
    expect(() => createApimartReferenceUpload(
      toDataUrl('image/png', Uint8Array.from([0xff, 0xd8, 0xff, 0xdb])),
      0,
      'mugen-test-boundary'
    )).toThrow('参考图内容无效')
    expect(() => createApimartReferenceUpload(
      'data:image/png,%not-valid-uri-data',
      0,
      'mugen-test-boundary'
    )).toThrow('参考图内容无效')
  })

  it('rejects a reference larger than the safe upload budget', () => {
    const oversized = new Uint8Array(9 * 1024 * 1024 + 1)
    oversized.set(pngBytes)
    expect(() => createApimartReferenceUpload(
      toDataUrl('image/png', oversized),
      0,
      'mugen-test-boundary'
    )).toThrow('参考图超过 9 MB')
  })
})

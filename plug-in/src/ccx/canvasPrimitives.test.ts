import { imageProcessor } from './inner/imageProcessing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureVisibleComposite, createBridgeThumbnail, createBridgeThumbnailFromPreview, createBridgeThumbnailFromLocalFile, createProviderReferencePreview } from './canvasPrimitives'

type HostRequire = (name: string) => unknown

const hostGlobal = globalThis as unknown as { require?: HostRequire }
const originalRequire = hostGlobal.require

afterEach(() => {
  if (originalRequire) {
    hostGlobal.require = originalRequire
  } else {
    delete hostGlobal.require
  }
})

describe('visible composite capture', () => {
  it('retries the current document state when the active history state cannot be rendered', async () => {
    const calls: Array<Record<string, unknown>> = []
    const bounds = { left: 0, top: 0, right: 2, bottom: 1 }
    const layer = { id: 7, name: 'Camera Raw', bounds, boundsNoEffects: bounds }

    hostGlobal.require = (name) => {
      if (name !== 'photoshop') throw new Error(`Unexpected host module: ${name}`)
      return {
        action: { batchPlay: async () => [] },
        app: {
          activeDocument: {
            id: 1,
            name: 'camera-raw.arw',
            width: 2,
            height: 1,
            activeHistoryState: { id: 30, name: 'Open' },
            activeLayers: [layer],
            layers: [layer]
          }
        },
        core: {
          executeAsModal: async (target: () => Promise<unknown>) => target()
        },
        imaging: {
          getPixels: async (options: Record<string, unknown>) => {
            calls.push({ ...options })
            if ('historyStateID' in options) throw new Error('Camera Raw history state cannot be rendered')
            return {
              imageData: {
                width: 2,
                height: 1,
                components: 4,
                getData: async () => new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]),
                dispose() {}
              },
              sourceBounds: bounds
            }
          },
          getSelection: async () => { throw new Error('Unexpected getSelection call') },
          createImageDataFromBuffer: async (data: Uint8Array, options: Record<string, unknown>) => ({
            width: Number(options.width),
            height: Number(options.height),
            components: Number(options.components),
            getData: async () => data,
            dispose() {}
          }),
          encodeImageData: async () => 'preview',
          putPixels: async () => undefined
        }
      }
    }

    const captured = await captureVisibleComposite()

    expect(Array.from(captured.rgba)).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ documentID: 1, historyStateID: 30 })
    expect(calls[1]).toMatchObject({ documentID: 1 })
    expect(calls[1]).not.toHaveProperty('historyStateID')
  })
})


describe('internal image processing', () => {
  it('compresses capture previews and restored images without Photoshop or full-resolution RGBA conversion', async () => {
    hostGlobal.require = (name) => { throw new Error(`Unexpected host module: ${name}`) }
    const process = vi.spyOn(imageProcessor, 'process').mockResolvedValue({ thumbnailUrl: 'data:image/jpeg;base64,/9j/2Q==', width: 6000, height: 4000 })
    const image = { id: 'large', label: 'large', width: 6000, height: 4000, sourceBounds: { left: 0, top: 0, right: 6000, bottom: 4000 }, previewUrl: 'data:image/jpeg;base64,/9j/2Q==', get rgba(): Uint8Array { throw new Error('Must not serialize full-resolution pixels') } }
    try {
      await createBridgeThumbnail(image)
      await createBridgeThumbnailFromPreview(image)
      await createProviderReferencePreview(image)
      expect(process).toHaveBeenCalledTimes(3)
      for (const [input, options] of process.mock.calls) {
        expect(input).toBe(image.previewUrl)
        expect(options.source).toBe('dataUrl')
      }
      expect(process.mock.calls[2]?.[1]).toMatchObject({ maxEdge: 4096, measure: 'binary' })
    } finally { process.mockRestore() }
  })

  it('reads local attachment bytes without opening a Photoshop document', async () => {
    hostGlobal.require = (name) => {
      if (name !== 'uxp') throw new Error(`Unexpected host module: ${name}`)
      return { storage: { formats: { binary: 'binary' } } }
    }
    const process = vi.spyOn(imageProcessor, 'process').mockResolvedValue({ thumbnailUrl: 'data:image/jpeg;base64,/9j/2Q==', width: 10, height: 10 })
    const read = vi.fn().mockResolvedValue(new Uint8Array([255, 216, 255, 217]))
    try {
      await createBridgeThumbnailFromLocalFile({ name: 'photo.jpg', read, write: vi.fn() })
      expect(read).toHaveBeenCalledWith({ format: 'binary' })
      expect(process).toHaveBeenCalledWith('data:image/jpeg;base64,/9j/2Q==', expect.objectContaining({ source: 'dataUrl', maxEdge: 800 }))
    } finally { process.mockRestore() }
  })
})

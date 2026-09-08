import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureVisibleComposite, captureSelectionComposite } from './canvasPrimitives'

vi.mock('./inner/imageProcessing', () => ({ imageProcessor: { process: vi.fn(async () => ({ thumbnailUrl: 'data:image/jpeg;base64,cHJldmlldw==', width: 2, height: 1 })) }, encodeImageBytes: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)) }))

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
          executeAsModal: async () => { throw new Error('Unexpected PS mutation') }
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
          createImageDataFromBuffer: async () => { throw new Error('Unexpected PS encoding') },
          encodeImageData: async () => { throw new Error('Unexpected PS encoding') },
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

 it('reads selection from the original document and applies the mask without creating or closing documents', async () => {
  const bounds = { left: 0, top: 0, right: 2, bottom: 1 }
  const getPixels = vi.fn(async (_options: Record<string, unknown>) => ({ imageData: { width: 2, height: 1, components: 4, getData: async () => new Uint8Array([255,0,0,255,0,0,255,255]), dispose() {} }, sourceBounds: bounds }))
  hostGlobal.require = () => ({
    app: { activeDocument: { id: 1, width: 2, height: 1, activeLayers: [], duplicate() { throw new Error('Unexpected duplicate') } } },
    core: { executeAsModal() { throw new Error('Unexpected modal') } },
    imaging: { getPixels, getSelection: async () => ({ imageData: { width: 2, height: 1, components: 1, getData: async () => new Uint8Array([255,128]), dispose() {} }, sourceBounds: bounds }) }
  })
  const image = await captureSelectionComposite()
  expect(Array.from(image.rgba)).toEqual([255,0,0,255,0,0,255,128])
  expect(getPixels).toHaveBeenCalledWith(expect.objectContaining({ documentID: 1 }))
  expect(getPixels.mock.calls[0]?.[0]).not.toHaveProperty('layerID')
})

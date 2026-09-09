import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureVisibleComposite, captureSelectionComposite, captureSelectedLayer, readSelectionBounds } from './canvasPrimitives'

let modalActive = false

vi.mock('./inner/imageProcessing', () => ({ imageProcessor: { process: vi.fn(async () => { expect(modalActive).toBe(false); return { thumbnailUrl: 'data:image/jpeg;base64,cHJldmlldw==', width: 2, height: 1 } }) }, encodeImageBytes: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)) }))

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
  it.each([captureVisibleComposite, captureSelectedLayer])('reads pixels inside modal and encodes outside it: %s', async (capture) => {
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
          executeAsModal: async (target: () => Promise<unknown>) => {
            modalActive = true
            try { return await target() } finally { modalActive = false }
          }
        },
        imaging: {
          getPixels: async (options: Record<string, unknown>) => {
            if (!modalActive) throw Object.assign(new Error('The requested functionality is only allowed from inside a modal scope.'), { code: '1000' })
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

    const captured = await capture()

    expect(Array.from(captured.rgba)).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
    if (capture === captureVisibleComposite) {
      expect(calls).toHaveLength(2)
      expect(calls[0]).toMatchObject({ documentID: 1, historyStateID: 30 })
      expect(calls[1]).toMatchObject({ documentID: 1 })
      expect(calls[1]).not.toHaveProperty('historyStateID')
    } else {
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ documentID: 1, layerID: 7 })
    }
  })
})

 it('reads selection from the original document and applies the mask without creating or closing documents', async () => {
  const bounds = { left: 0, top: 0, right: 2, bottom: 1 }
  const getPixels = vi.fn(async (_options: Record<string, unknown>) => ({ imageData: { width: 2, height: 1, components: 4, getData: async () => new Uint8Array([255,0,0,255,0,0,255,255]), dispose() {} }, sourceBounds: bounds }))
  hostGlobal.require = () => ({
    app: { activeDocument: { id: 1, width: 2, height: 1, activeLayers: [], duplicate() { throw new Error('Unexpected duplicate') } } },
    core: { async executeAsModal(target: () => Promise<unknown>) { modalActive = true; try { return await target() } finally { modalActive = false } } },
    imaging: { getPixels, getSelection: async () => { expect(modalActive).toBe(true); return { imageData: { width: 2, height: 1, components: 1, getData: async () => new Uint8Array([255,128]), dispose() {} }, sourceBounds: bounds } } }
  })
  expect(await readSelectionBounds()).toEqual({ left: 0, top: 0, width: 2, height: 1 })
  const image = await captureSelectionComposite()
  expect(Array.from(image.rgba)).toEqual([255,0,0,255,0,0,255,128])
  expect(getPixels).toHaveBeenCalledWith(expect.objectContaining({ documentID: 1 }))
  expect(getPixels.mock.calls[0]?.[0]).not.toHaveProperty('layerID')
})

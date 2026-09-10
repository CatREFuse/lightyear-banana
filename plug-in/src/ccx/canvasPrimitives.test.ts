import { afterEach, describe, expect, it } from 'vitest'
import { captureVisibleComposite } from './canvasPrimitives'

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

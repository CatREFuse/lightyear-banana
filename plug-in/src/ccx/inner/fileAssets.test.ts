import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetStore } from './assetStore'

const runtime = vi.hoisted(() => ({
  selectedFile: null as null | {
    name: string
    read: () => Promise<ArrayBuffer | Uint8Array | string>
    write: () => Promise<void>
  },
  clipboard: undefined as undefined | {
    read?: () => Promise<unknown>
    getContent?: () => Promise<unknown>
  }
}))

vi.mock('../photoshopHost', () => ({
  getHostRequire: () => (name: string) => {
    if (name !== 'uxp') throw new Error('unexpected module')
    return {
      storage: {
        formats: { binary: Symbol('binary') },
        fileTypes: { images: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
        localFileSystem: {
          getFileForOpening: async () => runtime.selectedFile
        }
      }
    }
  }
}))

import { FileAssetService } from './fileAssets'

class TestImage {
  naturalWidth = 640
  naturalHeight = 480
  width = 640
  height = 480
  private readonly listeners = new Map<string, () => void>()

  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener)
  }

  set src(_value: string) {
    queueMicrotask(() => this.listeners.get('load')?.())
  }
}

function createService() {
  const add = vi.fn(async (source: 'upload' | 'clipboard', image: { label: string; width: number; height: number; previewUrl: string }) => ({
    assetId: `asset-${source}`,
    source,
    label: image.label,
    width: image.width,
    height: image.height,
    previewUrl: 'data:image/jpeg;base64,dGh1bWI=',
    status: 'available' as const
  }))
  return {
    add,
    service: new FileAssetService({ add } as unknown as AssetStore)
  }
}

describe('FileAssetService reference images', () => {
  beforeEach(() => {
    runtime.selectedFile = null
    runtime.clipboard = undefined
    vi.stubGlobal('Image', TestImage)
    vi.stubGlobal('navigator', { clipboard: runtime.clipboard })
  })

  it('reads a Windows UXP image clipboard value through arrayBuffer()', async () => {
    runtime.clipboard = {
      read: async () => ({
        'image/png': {
          type: 'image/png',
          arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer
        }
      })
    }
    vi.stubGlobal('navigator', { clipboard: runtime.clipboard })
    const { add, service } = createService()

    await expect(service.readClipboardReference()).resolves.toMatchObject({ source: 'clipboard' })
    expect(add).toHaveBeenCalledWith('clipboard', expect.objectContaining({
      label: '剪贴板图片',
      width: 640,
      height: 480,
      previewUrl: 'data:image/png;base64,iVBORw=='
    }))
  })

  it('uses the legacy UXP clipboard reader when read() is unavailable', async () => {
    runtime.clipboard = {
      getContent: async () => ({
        'image/png': Uint8Array.from([137, 80, 78, 71])
      })
    }
    vi.stubGlobal('navigator', { clipboard: runtime.clipboard })
    const { service } = createService()

    await expect(service.readClipboardReference()).resolves.toMatchObject({ source: 'clipboard' })
  })

  it('adds a selected image file as a reference', async () => {
    runtime.selectedFile = {
      name: 'reference.png',
      read: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
      write: async () => undefined
    }
    const { add, service } = createService()

    await expect(service.pickReference()).resolves.toMatchObject({ source: 'upload' })
    expect(add).toHaveBeenCalledWith('upload', expect.objectContaining({
      label: '上传图片：reference.png',
      previewUrl: 'data:image/png;base64,iVBORw=='
    }))
  })

  it('keeps reference state unchanged when file selection is cancelled', async () => {
    const { add, service } = createService()

    await expect(service.pickReference()).resolves.toBeNull()
    expect(add).not.toHaveBeenCalled()
  })
})

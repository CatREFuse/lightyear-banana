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
  },
  localThumbnail: vi.fn(async () => ({ thumbnailUrl: 'data:image/jpeg;base64,dGh1bWI=', width: 640, height: 480 }))
}))

vi.mock('../canvasPrimitives', async (importOriginal) => ({
  ...await importOriginal<typeof import('../canvasPrimitives')>(),
  createBridgeThumbnailFromLocalFile: runtime.localThumbnail
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

class TestCanvas {
  width = 0
  height = 0

  getContext() {
    return { drawImage: vi.fn() }
  }

  toDataURL() {
    return 'data:image/jpeg;base64,dGh1bWI='
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
    runtime.localThumbnail.mockClear()
    vi.stubGlobal('Image', TestImage)
    vi.stubGlobal('document', { createElement: () => new TestCanvas() })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-image')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
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
    }), { thumbnailUrl: 'data:image/jpeg;base64,dGh1bWI=' })
  })

  it('falls back to the legacy reader when Clipboard.read() fails', async () => {
    runtime.clipboard = {
      read: async () => { throw new Error('read is unavailable') },
      getContent: async () => ({
        'image/png': Uint8Array.from([137, 80, 78, 71])
      })
    }
    vi.stubGlobal('navigator', { clipboard: runtime.clipboard })
    const { service } = createService()

    await expect(service.readClipboardReference()).resolves.toMatchObject({ source: 'clipboard' })
  })

  it('falls back to the legacy reader when Clipboard.read() contains no image', async () => {
    runtime.clipboard = {
      read: async () => ({ 'text/plain': 'not an image' }),
      getContent: async () => ({
        'image/png': Uint8Array.from([137, 80, 78, 71])
      })
    }
    vi.stubGlobal('navigator', { clipboard: runtime.clipboard })
    const { service } = createService()

    await expect(service.readClipboardReference()).resolves.toMatchObject({ source: 'clipboard' })
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
    }), { thumbnailUrl: 'data:image/jpeg;base64,dGh1bWI=' })
  })

  it('generates an upload thumbnail from the selected local file', async () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    bytes.set([0, 0, 2, 0], 16)
    bytes.set([0, 0, 1, 0], 20)
    runtime.selectedFile = {
      name: 'large-reference.png',
      read: async () => bytes.buffer,
      write: async () => undefined
    }
    runtime.localThumbnail.mockResolvedValueOnce({ thumbnailUrl: 'data:image/jpeg;base64,dGh1bWI=', width: 512, height: 256 })
    const { add, service } = createService()

    await expect(service.pickReference()).resolves.toMatchObject({ source: 'upload' })
    expect(add).toHaveBeenCalledWith('upload', expect.objectContaining({
      width: 512,
      height: 256
    }), { thumbnailUrl: 'data:image/jpeg;base64,dGh1bWI=' })
    expect(runtime.localThumbnail).toHaveBeenCalledWith(runtime.selectedFile, 16 * 1024)
  })

  it('rejects an empty selected file without adding a reference', async () => {
    runtime.selectedFile = {
      name: 'empty.png',
      read: async () => new ArrayBuffer(0),
      write: async () => undefined
    }
    const { add, service } = createService()

    await expect(service.pickReference()).rejects.toThrow('图片文件为空')
    expect(add).not.toHaveBeenCalled()
  })

  it('reassembles WebView image chunks and keeps its thumbnail', async () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    bytes.set([0, 0, 2, 0], 16)
    bytes.set([0, 0, 1, 0], 20)
    const encoded = Buffer.from(bytes).toString('base64')
    const { add, service } = createService()

    await expect(service.importImageChunk({
      importId: 'paste-1', name: '剪贴板图片.png', mimeType: 'image/png', source: 'clipboard',
      width: 512, height: 256,
      index: 0, total: 2, chunk: encoded.slice(0, 12), thumbnailUrl: 'data:image/jpeg;base64,dGh1bWI='
    })).resolves.toBeNull()
    await expect(service.importImageChunk({
      importId: 'paste-1', name: '剪贴板图片.png', mimeType: 'image/png', source: 'clipboard',
      width: 512, height: 256,
      index: 1, total: 2, chunk: encoded.slice(12)
    })).resolves.toMatchObject({ source: 'clipboard' })

    expect(add).toHaveBeenCalledWith('clipboard', expect.objectContaining({
      label: '剪贴板图片', width: 512, height: 256
    }), { thumbnailUrl: 'data:image/jpeg;base64,dGh1bWI=' })
  })

  it('keeps reference state unchanged when file selection is cancelled', async () => {
    const { add, service } = createService()

    await expect(service.pickReference()).resolves.toBeNull()
    expect(add).not.toHaveBeenCalled()
  })
})

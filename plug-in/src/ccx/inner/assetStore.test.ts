import { beforeEach, describe, expect, it, vi } from 'vitest'

type MemoryFile = {
  isFile: true
  value: string | Uint8Array
  read: (options?: Record<string, unknown>) => Promise<string | Uint8Array>
  write: (value: string | Uint8Array) => Promise<void>
  delete: () => Promise<void>
}

class MemoryFolder {
  readonly isFolder = true
  readonly entries = new Map<string, MemoryFile | MemoryFolder>()

  async getEntry(name: string) {
    const entry = this.entries.get(name)
    if (!entry) throw new Error('missing')
    return entry
  }

  async createFile(name: string) {
    const folder = this
    const file: MemoryFile = {
      isFile: true,
      value: '',
      async read() {
        return typeof this.value === 'string' ? this.value : new Uint8Array(this.value)
      },
      async write(value) {
        this.value = typeof value === 'string' ? value : new Uint8Array(value)
      },
      async delete() {
        folder.entries.delete(name)
      }
    }
    this.entries.set(name, file)
    return file
  }

  async createFolder(name: string) {
    if (this.entries.has(name)) throw new Error('exists')
    const folder = new MemoryFolder()
    this.entries.set(name, folder)
    return folder
  }
}

const runtime = vi.hoisted(() => ({
  dataFolder: undefined as MemoryFolder | undefined,
  thumbnailError: false
}))

vi.mock('../photoshopHost', () => ({
  getHostRequire: () => (name: string) => {
    if (name !== 'uxp') throw new Error('unexpected module')
    return {
      storage: {
        formats: { binary: Symbol('binary'), utf8: Symbol('utf8') },
        localFileSystem: { getDataFolder: async () => runtime.dataFolder }
      }
    }
  }
}))

vi.mock('../canvasPrimitives', () => ({
  createBridgeThumbnail: async () => {
    if (runtime.thumbnailError) throw new Error('缩略图编码失败')
    return 'data:image/png;base64,dGh1bWI='
  },
  createBridgeThumbnailFromPreview: async () => {
    if (runtime.thumbnailError) throw new Error('缩略图编码失败')
    return 'data:image/png;base64,dGh1bWI='
  }
}))

import { AssetStore } from './assetStore'
import { HistoryStore } from './hostData'

const image = {
  id: 'generated-1',
  label: '生成结果',
  width: 16,
  height: 16,
  sourceBounds: { left: 0, top: 0, right: 16, bottom: 16 },
  previewUrl: 'data:image/png;base64,AQIDBA==',
  rgba: new Uint8Array()
}

function historyEntry(id: string) {
  return {
    id,
    updatedAt: new Date().toISOString(),
    prompt: id,
    assets: [],
    status: 'completed' as const
  }
}

describe('persistent Host assets', () => {
  beforeEach(() => {
    runtime.dataFolder = new MemoryFolder()
    runtime.thumbnailError = false
  })

  it('reports a thumbnail error without returning a placeholder image', async () => {
    runtime.thumbnailError = true
    const assets = new AssetStore()
    const ref = await assets.add('generated', { ...image, previewUrl: `data:image/png;base64,${'a'.repeat(20_000)}` })

    expect(ref).toMatchObject({ previewUrl: '', thumbnailUrl: '', previewStatus: 'unavailable', originalAvailable: true })
    expect(ref.previewError).toContain('缩略图编码失败')
    expect((await assets.readOriginal(ref.assetId, 0)).chunk).toContain('data:image/png;base64,')
  })

  it('restores a generated asset in a new Host session and deletes it with history', async () => {
    const firstAssets = new AssetStore()
    const firstHistory = new HistoryStore(firstAssets)
    const asset = await firstAssets.add('generated', image)
    const snapshot = {
      configId: 'config-1',
      prompt: '海报',
      references: [],
      size: '1024x1024',
      quality: 'high',
      count: 1,
      ratio: '1:1',
      submittedAt: new Date().toISOString()
    }

    const saved = await firstHistory.upsert({
      id: 'turn-1',
      updatedAt: new Date().toISOString(),
      prompt: '海报',
      assets: [{ assetId: asset.assetId, label: asset.label, source: asset.source, width: asset.width, height: asset.height, mimeType: asset.mimeType }],
      snapshot,
      status: 'completed'
    })
    expect(saved.entry.assets[0]?.status).toBe('available')

    const restoredAssets = new AssetStore()
    const restoredHistory = new HistoryStore(restoredAssets)
    const page = await restoredHistory.list(undefined, 10)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.assets[0]?.status).toBe('available')
    expect((await restoredAssets.getOrRestore(asset.assetId)).image.previewUrl).toBe(image.previewUrl)

    await restoredHistory.clear()
    const finalAssets = new AssetStore()
    expect((await finalAssets.resolvePointer({ assetId: asset.assetId, label: asset.label, source: 'generated', width: 16, height: 16 })).status).toBe('missing')
  })

  it('keeps a captured reference usable after composer release until history is cleared', async () => {
    const firstAssets = new AssetStore()
    const firstHistory = new HistoryStore(firstAssets)
    const reference = await firstAssets.add('selection', { ...image, id: 'selection-1', label: '选区参考' }, { documentId: 'document-1' })
    const pointer = {
      assetId: reference.assetId,
      label: reference.label,
      source: reference.source,
      width: reference.width,
      height: reference.height,
      mimeType: reference.mimeType,
      sourceBounds: reference.sourceBounds,
      documentId: reference.documentId
    }
    const snapshot = {
      configId: 'config-1',
      prompt: '沿用选区参考',
      references: [pointer],
      size: '1024x1024',
      quality: 'high',
      count: 1,
      ratio: '1:1',
      submittedAt: new Date().toISOString()
    }

    await firstHistory.upsert({
      id: 'turn-with-reference',
      updatedAt: new Date().toISOString(),
      prompt: snapshot.prompt,
      assets: [],
      references: [pointer],
      snapshot,
      status: 'completed'
    })
    firstAssets.release(reference.assetId)

    expect((await firstAssets.getOrRestore(reference.assetId)).image.previewUrl).toBe(image.previewUrl)

    const restoredAssets = new AssetStore()
    const restoredHistory = new HistoryStore(restoredAssets)
    const page = await restoredHistory.list(undefined, 10)
    expect(page.items[0]?.references?.[0]).toMatchObject({
      assetId: reference.assetId,
      source: 'selection',
      status: 'missing',
      documentId: 'document-1'
    })

    await firstHistory.clear()
    expect((await firstAssets.resolvePointer(pointer)).status).toBe('missing')
  })

  it('pins an active task reference before the composer releases it', async () => {
    const assets = new AssetStore()
    const reference = await assets.add('upload', { ...image, id: 'upload-1', label: '上传参考' })

    await assets.retain([reference.assetId], 'task:task-1')
    assets.release(reference.assetId)
    expect((await assets.getOrRestore(reference.assetId)).ref.status).toBe('available')

    assets.releaseOwner('task:task-1', true)
    expect((await assets.resolvePointer(reference)).status).toBe('missing')
  })

  it('keeps a shared session reference until its final history owner releases it', async () => {
    const assets = new AssetStore()
    const history = new HistoryStore(assets)
    const reference = await assets.add('clipboard', { ...image, id: 'clipboard-1', label: '剪贴板参考' })
    const pointer = { assetId: reference.assetId, label: reference.label, source: reference.source, width: reference.width, height: reference.height }
    const withReference = (id: string) => ({
      ...historyEntry(id),
      references: [pointer],
      snapshot: {
        configId: 'config-1', prompt: id, references: [pointer], size: '1024x1024', quality: 'high', count: 1, ratio: '1:1', submittedAt: new Date().toISOString()
      }
    })

    await history.upsert(withReference('turn-shared-1'))
    await history.upsert(withReference('turn-shared-2'))
    assets.release(reference.assetId)

    await history.upsert(historyEntry('turn-shared-1'))
    expect((await assets.getOrRestore(reference.assetId)).ref.status).toBe('available')

    await history.upsert(historyEntry('turn-shared-2'))
    expect((await assets.resolvePointer(pointer)).status).toBe('missing')
  })

  it('unloads persisted history results from memory without losing disk recovery', async () => {
    const assets = new AssetStore()
    const history = new HistoryStore(assets)
    const assetIds: string[] = []

    for (let index = 0; index < 65; index += 1) {
      const asset = await assets.add('generated', { ...image, id: `generated-${index}`, label: `生成结果 ${index + 1}` })
      assetIds.push(asset.assetId)
      await history.upsert({
        ...historyEntry(`turn-capacity-${index}`),
        assets: [{ assetId: asset.assetId, label: asset.label, source: asset.source, width: asset.width, height: asset.height }]
      })
    }

    expect((await assets.resolvePointer({ assetId: assetIds[0]!, label: '生成结果 1', source: 'generated', width: 16, height: 16 })).status).toBe('missing')
    expect((await assets.getOrRestore(assetIds[64]!)).ref.status).toBe('available')
    expect((await history.list(undefined, 50)).items).toHaveLength(30)
  })

  it('treats session-history references as soft owners under the memory limit', async () => {
    const assets = new AssetStore()
    const assetIds: string[] = []

    for (let index = 0; index < 65; index += 1) {
      const reference = await assets.add('visible', { ...image, id: `visible-${index}`, label: `画布参考 ${index + 1}` })
      assetIds.push(reference.assetId)
      await assets.retain([reference.assetId], `history:turn-${index}`)
      assets.release(reference.assetId)
    }

    expect((await assets.resolvePointer({ assetId: assetIds[0]!, label: '画布参考 1', source: 'visible', width: 16, height: 16 })).status).toBe('missing')
    expect((await assets.getOrRestore(assetIds[64]!)).ref.status).toBe('available')
  })

  it('serializes concurrent upserts without losing earlier records', async () => {
    const history = new HistoryStore(new AssetStore())

    await Promise.all([
      history.upsert(historyEntry('turn-1')),
      history.upsert(historyEntry('turn-2'))
    ])

    expect((await history.list(undefined, 10)).items.map((entry) => entry.id)).toEqual(['turn-2', 'turn-1'])
  })

  it('restores the previous history file when the current file is corrupted', async () => {
    const history = new HistoryStore(new AssetStore())
    await history.upsert(historyEntry('turn-1'))
    await history.upsert(historyEntry('turn-2'))
    const current = await runtime.dataFolder!.getEntry('mugen-inner-history.v1.json') as MemoryFile
    current.value = '{broken'

    const restored = new HistoryStore(new AssetStore())
    expect((await restored.list(undefined, 30)).items.map((entry) => entry.id)).toEqual(['turn-1'])
  })

  it('protects damaged history when no valid backup exists', async () => {
    const current = await runtime.dataFolder!.createFile('mugen-inner-history.v1.json')
    await current.write('{broken')

    await expect(new HistoryStore(new AssetStore()).list(undefined, 30)).rejects.toThrow('已停止写入')
  })

  it('does not treat a structurally invalid history file as an empty history', async () => {
    const current = await runtime.dataFolder!.createFile('mugen-inner-history.v1.json')
    await current.write(JSON.stringify({ entries: [] }))

    await expect(new HistoryStore(new AssetStore()).list(undefined, 30)).rejects.toThrow('已停止写入')
  })

  it('applies clear and upsert mutations in invocation order', async () => {
    const history = new HistoryStore(new AssetStore())
    await history.upsert(historyEntry('turn-before-clear'))

    await Promise.all([
      history.clear(),
      history.upsert(historyEntry('turn-after-clear'))
    ])
    expect((await history.list(undefined, 10)).items.map((entry) => entry.id)).toEqual(['turn-after-clear'])

    await Promise.all([
      history.upsert(historyEntry('turn-before-final-clear')),
      history.clear()
    ])
    expect((await history.list(undefined, 10)).items).toEqual([])
  })

  it('deletes the history file and every indexed generated asset when all local data is cleared', async () => {
    const assets = new AssetStore()
    const history = new HistoryStore(assets)
    const asset = await assets.add('generated', image)
    await history.upsert({
      ...historyEntry('turn-clear-all'),
      assets: [{ assetId: asset.assetId, label: asset.label, source: asset.source, width: asset.width, height: asset.height }]
    })

    await history.clearAllLocalData()

    expect(runtime.dataFolder?.entries.has('mugen-inner-history.v1.json')).toBe(false)
    const assetFolder = runtime.dataFolder?.entries.get('mugen-inner-assets-v1') as MemoryFolder
    expect(assetFolder.entries.size).toBe(0)
    expect((await new HistoryStore(new AssetStore()).list(undefined, 10)).items).toEqual([])
  })
})

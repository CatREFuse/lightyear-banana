import { createBridgeThumbnail, createBridgeThumbnailFromPreview, type CapturedCanvasImage, type PixelBounds } from '../canvasPrimitives'
import { getHostRequire } from '../photoshopHost'
import type { HostAssetPointer, HostAssetRef } from '@mugen/inner-protocol'
import { decodeUtf8, encodeUtf8, utf8ByteLength } from './utf8'

type Asset = {
  image: CapturedCanvasImage
  ref: HostAssetRef
  createdAt: number
  lastAccessedAt: number
  bytes: number
  persistent: boolean
  owners: Set<string>
}

type PersistentAssetRecord = {
  assetId: string
  fileName: string
  label: string
  source: HostAssetRef['source']
  mimeType: string
  width: number
  height: number
  sourceBounds?: PixelBounds
  documentId?: string
  createdAt: number
  lastAccessedAt: number
  bytes: number
}

type AdobeUxpFile = {
  isFile?: boolean
  read: (options?: Record<string, unknown>) => Promise<ArrayBuffer | Uint8Array | string>
  write: (data: Uint8Array | string, options?: Record<string, unknown>) => Promise<void>
  delete?: () => Promise<unknown>
}

type AdobeUxpFolder = {
  isFolder?: boolean
  getEntry: (name: string) => Promise<AdobeUxpFile | AdobeUxpFolder>
  createFile: (name: string, options?: { overwrite?: boolean }) => Promise<AdobeUxpFile>
  createFolder: (name: string) => Promise<AdobeUxpFolder>
  delete?: () => Promise<unknown>
}

type AdobeUxpStorage = {
  formats?: { binary?: unknown; utf8?: unknown }
  localFileSystem?: { getDataFolder?: () => Promise<AdobeUxpFolder> }
}

const ASSET_TTL_MS = 60 * 60 * 1000
const MAX_ASSET_COUNT = 64
const MAX_ASSET_BYTES = 512 * 1024 * 1024
const MAX_THUMBNAIL_BYTES = 16 * 1024
const ORIGINAL_CHUNK_LENGTH = 192 * 1024
const MAX_PERSISTENT_ASSET_COUNT = 256
const MAX_PERSISTENT_ASSET_BYTES = 512 * 1024 * 1024
const MAX_PERSISTENT_FILE_BYTES = 128 * 1024 * 1024
const PERSISTENT_FOLDER = 'mugen-inner-assets-v1'
const PERSISTENT_INDEX = 'index.json'
const WORKSPACE_OWNER = 'workspace'

function hasActiveMemoryOwner(asset: Asset) {
  return [...asset.owners].some((owner) => !owner.startsWith('history:'))
}

type AssetInvalidationReason = 'expired' | 'capacity'
type AssetInvalidationListener = (assetId: string, reason: AssetInvalidationReason) => void

const assetSources = new Set<HostAssetRef['source']>(['visible', 'selection', 'layer', 'upload', 'clipboard', 'generated'])

function getAdobeUxpStorage(): AdobeUxpStorage {
  const hostRequire = getHostRequire()
  if (!hostRequire) throw new Error('Photoshop UXP runtime is unavailable.')
  return hostRequire('uxp').storage as AdobeUxpStorage
}

function readMimeType(previewUrl: string) {
  const match = /^data:([^;,]+)/i.exec(previewUrl)
  if (match?.[1]?.startsWith('image/')) return match[1]
  const extension = previewUrl.split('?')[0]?.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  return 'image/png'
}

function extensionForMimeType(mimeType: string) {
  const normalized = mimeType.split(';')[0]?.toLowerCase()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  return 'png'
}

function serializedBytes(value: string) {
  return utf8ByteLength(value)
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function readDataUrl(value: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value)
  if (!match) throw new Error('图片数据无效')
  const mimeType = match[1] || 'image/png'
  const bytes = match[2]
    ? base64ToBytes(match[3] ?? '')
    : encodeUtf8(decodeURIComponent(match[3] ?? ''))
  return { mimeType, bytes }
}

async function readPreviewBytes(previewUrl: string) {
  if (previewUrl.startsWith('data:')) return readDataUrl(previewUrl)
  if (!/^(?:https?|blob):/i.test(previewUrl)) throw new Error('生成图片无法持久保存')
  const response = await fetch(previewUrl)
  if (!response.ok) throw new Error('生成图片下载失败')
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_PERSISTENT_FILE_BYTES) throw new Error('生成图片超过持久存储大小限制')
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { mimeType: response.headers.get('content-type')?.split(';')[0] || 'image/png', bytes }
}

function toUint8Array(value: ArrayBuffer | Uint8Array | string) {
  if (value instanceof Uint8Array) return value
  if (typeof value === 'string') return encodeUtf8(value)
  return new Uint8Array(value)
}

function isPersistentRecord(value: unknown): value is PersistentAssetRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.assetId === 'string' && /^asset-[A-Za-z0-9-]{8,128}$/.test(record.assetId) &&
    typeof record.fileName === 'string' && /^asset-[A-Za-z0-9-]{8,128}\.(?:png|jpe?g|webp|gif)$/.test(record.fileName) &&
    typeof record.label === 'string' &&
    assetSources.has(record.source as HostAssetRef['source']) &&
    typeof record.mimeType === 'string' && record.mimeType.startsWith('image/') &&
    Number.isFinite(record.width) && Number(record.width) > 0 &&
    Number.isFinite(record.height) && Number(record.height) > 0 &&
    Number.isFinite(record.createdAt) && Number.isFinite(record.lastAccessedAt) &&
    Number.isFinite(record.bytes) && Number(record.bytes) > 0 && Number(record.bytes) <= MAX_PERSISTENT_FILE_BYTES
  )
}

export class AssetStore {
  private readonly assets = new Map<string, Asset>()
  private readonly onInvalidated?: AssetInvalidationListener
  private persistentIndex?: Map<string, PersistentAssetRecord>
  private persistentIndexLoad?: Promise<Map<string, PersistentAssetRecord>>
  private persistentQueue: Promise<void> = Promise.resolve()
  private readonly restoreTasks = new Map<string, Promise<Asset>>()

  constructor(onInvalidated?: AssetInvalidationListener) {
    this.onInvalidated = onInvalidated
  }

  async add(
    source: HostAssetRef['source'],
    image: CapturedCanvasImage,
    options: { documentId?: string; owner?: string; thumbnailUrl?: string } = {}
  ): Promise<HostAssetRef> {
    this.cleanup()
    const assetId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const now = Date.now()
    const expiresAt = new Date(now + ASSET_TTL_MS).toISOString()
    let thumbnail = options.thumbnailUrl ?? image.previewUrl
    let previewError = ''

    if (options.thumbnailUrl !== undefined) {
      if (serializedBytes(options.thumbnailUrl) > MAX_THUMBNAIL_BYTES) {
        thumbnail = ''
        previewError = '缩略图超过传输限制'
      } else if (!options.thumbnailUrl) {
        previewError = '当前 Photoshop 版本无法生成文件缩略图'
      }
    } else if (image.rgba.byteLength > 0) {
      try {
        thumbnail = await createBridgeThumbnail(image, MAX_THUMBNAIL_BYTES)
      } catch (error) {
        thumbnail = ''
        previewError = error instanceof Error ? error.message : '缩略图生成失败'
      }
    } else if (/^https?:/i.test(thumbnail) || serializedBytes(thumbnail) > MAX_THUMBNAIL_BYTES) {
      try {
        thumbnail = await createBridgeThumbnailFromPreview(image, MAX_THUMBNAIL_BYTES)
      } catch (error) {
        thumbnail = ''
        previewError = error instanceof Error ? error.message : '缩略图生成失败'
      }
    }
    if (serializedBytes(thumbnail) > MAX_THUMBNAIL_BYTES) {
      thumbnail = ''
      previewError = '缩略图超过传输限制'
    }

    const assetBytes = image.rgba.byteLength + serializedBytes(image.previewUrl)
    if (assetBytes > MAX_ASSET_BYTES) throw new Error('图片过大，无法在 Photoshop 中暂存')

    const ref: HostAssetRef = {
      assetId,
      label: image.label,
      source,
      mimeType: readMimeType(image.previewUrl),
      width: image.width,
      height: image.height,
      previewUrl: thumbnail,
      thumbnailUrl: thumbnail,
      previewStatus: thumbnail ? 'ready' : 'unavailable',
      ...(previewError ? { previewError: previewError.slice(0, 256) } : {}),
      originalAvailable: true,
      status: 'available',
      sourceBounds: image.sourceBounds,
      ...(options.documentId ? { documentId: options.documentId } : {}),
      expiresAt
    }
    this.assets.set(assetId, {
      image,
      ref,
      createdAt: now,
      lastAccessedAt: now,
      bytes: assetBytes,
      persistent: false,
      owners: new Set(options.owner ? [options.owner] : (source === 'generated' ? [] : [WORKSPACE_OWNER]))
    })
    try {
      this.enforceCapacity()
    } catch (error) {
      this.assets.delete(assetId)
      throw error
    }
    return ref
  }

  get(assetId: unknown) {
    if (typeof assetId !== 'string') throw new Error('资产 ID 无效')
    const asset = this.assets.get(assetId)
    if (!asset || (!asset.persistent && !hasActiveMemoryOwner(asset) && Date.parse(asset.ref.expiresAt ?? '') <= Date.now())) {
      if (asset) this.invalidate(assetId, 'expired')
      throw new Error('资产已失效，请重新获取')
    }
    asset.lastAccessedAt = Date.now()
    return asset
  }

  async getOrRestore(assetId: unknown) {
    if (typeof assetId !== 'string') throw new Error('资产 ID 无效')
    try {
      return this.get(assetId)
    } catch {
      const existing = this.restoreTasks.get(assetId)
      if (existing) return existing
      const task = this.restorePersistentAsset(assetId)
      this.restoreTasks.set(assetId, task)
      try {
        return await task
      } finally {
        this.restoreTasks.delete(assetId)
      }
    }
  }

  async getMany(assetIds: string[]) {
    return Promise.all(assetIds.map((assetId) => this.getOrRestore(assetId)))
  }

  async retain(assetIds: string[], owner: string) {
    if (!owner) throw new Error('资产持有者无效')
    const retained: string[] = []
    try {
      for (const assetId of new Set(assetIds)) {
        let asset: Asset
        try {
          asset = this.get(assetId)
        } catch {
          asset = await this.getOrRestore(assetId)
        }
        if (!asset.owners.has(owner)) {
          asset.owners.add(owner)
          retained.push(assetId)
        }
      }
    } catch (error) {
      for (const assetId of retained) this.releaseAssetOwner(assetId, owner)
      throw error
    }
  }

  async retainAvailable(assetIds: string[], owner: string) {
    for (const assetId of new Set(assetIds)) {
      try {
        await this.retain([assetId], owner)
      } catch {
        // Session-only references are expected to be unavailable after restart.
      }
    }
  }

  async retainWorkspace(assetId: unknown) {
    if (typeof assetId !== 'string') throw new Error('资产 ID 无效')
    await this.retain([assetId], WORKSPACE_OWNER)
    return { ...this.get(assetId).ref }
  }

  resetWorkspace() {
    return this.releaseOwner(WORKSPACE_OWNER, true)
  }

  releaseOwner(owner: string, discardIfUnowned = false) {
    if (!owner) return
    for (const assetId of [...this.assets.keys()]) this.releaseAssetOwner(assetId, owner, discardIfUnowned)
  }

  releaseAssetOwner(assetId: string, owner: string, discardIfUnowned = false) {
    const asset = this.assets.get(assetId)
    if (!asset) return
    asset.owners.delete(owner)
    if (discardIfUnowned && !asset.persistent && asset.owners.size === 0) this.assets.delete(assetId)
  }

  async resolvePointer(pointer: HostAssetPointer): Promise<HostAssetRef> {
    try {
      return { ...(await this.getOrRestore(pointer.assetId)).ref }
    } catch {
      return {
        ...pointer,
        previewUrl: '',
        thumbnailUrl: '',
        previewStatus: 'unavailable',
        previewError: '原图已失效',
        originalAvailable: false,
        status: 'missing'
      }
    }
  }

  async readOriginal(assetId: string, offset: number) {
    const asset = await this.getOrRestore(assetId)
    const previewUrl = asset.image.previewUrl
    if (!Number.isInteger(offset) || offset < 0 || offset > previewUrl.length) throw new Error('原图读取位置无效')
    const chunk = previewUrl.slice(offset, offset + ORIGINAL_CHUNK_LENGTH)
    return {
      assetId,
      chunk,
      offset,
      totalLength: previewUrl.length,
      done: offset + chunk.length >= previewUrl.length
    }
  }

  async persist(assetIds: string[]) {
    const uniqueIds = [...new Set(assetIds)]
    if (!uniqueIds.length) return
    await this.mutatePersistent(async () => {
      const index = await this.loadPersistentIndex()
      const incoming: Array<{ record: PersistentAssetRecord; bytes: Uint8Array }> = []
      const protectedIds = new Set(uniqueIds)

      for (const assetId of uniqueIds) {
        const existing = index.get(assetId)
        if (existing) {
          if (existing.source !== 'generated') throw new Error('只有生成结果可以持久保存')
          existing.lastAccessedAt = Date.now()
          const memoryAsset = this.assets.get(assetId)
          if (memoryAsset) this.markPersistent(memoryAsset)
          continue
        }
        const asset = this.get(assetId)
        if (asset.ref.source !== 'generated') throw new Error('只有生成结果可以持久保存')
        const payload = await readPreviewBytes(asset.image.previewUrl)
        if (!payload.bytes.length || payload.bytes.byteLength > MAX_PERSISTENT_FILE_BYTES) {
          throw new Error('生成图片超过持久存储大小限制')
        }
        const mimeType = payload.mimeType.startsWith('image/') ? payload.mimeType : (asset.ref.mimeType || readMimeType(asset.image.previewUrl))
        incoming.push({
          bytes: payload.bytes,
          record: {
            assetId,
            fileName: `${assetId}.${extensionForMimeType(mimeType)}`,
            label: asset.ref.label.slice(0, 256),
            source: asset.ref.source,
            mimeType,
            width: asset.ref.width,
            height: asset.ref.height,
            sourceBounds: asset.image.sourceBounds,
            documentId: asset.ref.documentId,
            createdAt: asset.createdAt,
            lastAccessedAt: Date.now(),
            bytes: payload.bytes.byteLength
          }
        })
      }

      const projected = new Map(index)
      for (const item of incoming) projected.set(item.record.assetId, item.record)
      const evicted = this.selectPersistentEvictions(projected, protectedIds)
      const folder = await this.getPersistentFolder(true)
      if (!folder) throw new Error('本地生成记录存储不可用')
      const storage = getAdobeUxpStorage()
      const written: PersistentAssetRecord[] = []
      try {
        for (const item of incoming) {
          const file = await folder.createFile(item.record.fileName, { overwrite: true })
          await file.write(item.bytes, storage.formats?.binary ? { format: storage.formats.binary } : undefined)
          written.push(item.record)
          index.set(item.record.assetId, item.record)
          const memoryAsset = this.assets.get(item.record.assetId)
          if (memoryAsset) this.markPersistent(memoryAsset)
        }
        for (const record of evicted) {
          await this.deletePersistentFile(folder, record)
          index.delete(record.assetId)
          this.markTransient(record.assetId)
        }
        await this.writePersistentIndex(folder, index)
      } catch (error) {
        for (const record of written) {
          await this.deletePersistentFile(folder, record)
          index.delete(record.assetId)
          this.markTransient(record.assetId)
        }
        throw error
      }
    })
  }

  async removePersistent(assetIds: string[]) {
    const uniqueIds = [...new Set(assetIds)]
    if (!uniqueIds.length) return
    await this.mutatePersistent(async () => {
      const index = await this.loadPersistentIndex()
      const folder = await this.getPersistentFolder(false)
      for (const assetId of uniqueIds) {
        const record = index.get(assetId)
        if (!record) continue
        if (folder) await this.deletePersistentFile(folder, record)
        index.delete(assetId)
        this.markTransient(assetId)
      }
      if (folder) await this.writePersistentIndex(folder, index)
    })
  }

  async clearPersistent() {
    await this.mutatePersistent(async () => {
      const index = await this.loadPersistentIndex()
      const folder = await this.getPersistentFolder(false)
      if (folder) {
        for (const record of index.values()) {
          let file: AdobeUxpFile
          try {
            file = await folder.getEntry(record.fileName) as AdobeUxpFile
          } catch {
            continue
          }
          if (typeof file.delete !== 'function') throw new Error('本地生成记录不支持删除')
          await file.delete()
        }
        let indexFile: AdobeUxpFile | undefined
        try {
          indexFile = await folder.getEntry(PERSISTENT_INDEX) as AdobeUxpFile
        } catch {
          indexFile = undefined
        }
        if (indexFile) {
          if (typeof indexFile.delete !== 'function') throw new Error('本地生成记录索引不支持删除')
          await indexFile.delete()
        }
      }
      index.clear()
      this.persistentIndex = new Map()
      this.assets.clear()
      this.restoreTasks.clear()
    })
  }

  release(assetId: unknown) {
    if (typeof assetId !== 'string') throw new Error('资产 ID 无效')
    const asset = this.assets.get(assetId)
    if (asset) {
      asset.owners.delete(WORKSPACE_OWNER)
      if (!asset.persistent && asset.owners.size === 0) this.assets.delete(assetId)
    }
    return { assetId, released: true }
  }

  discard(assetId: unknown) {
    if (typeof assetId !== 'string') throw new Error('资产 ID 无效')
    this.assets.delete(assetId)
  }

  clear() {
    const count = this.assets.size
    this.assets.clear()
    return count
  }

  destroy() {
    this.assets.clear()
    this.restoreTasks.clear()
  }

  private markPersistent(asset: Asset) {
    asset.persistent = true
    delete asset.ref.expiresAt
  }

  private markTransient(assetId: string) {
    const asset = this.assets.get(assetId)
    if (!asset) return
    asset.persistent = false
    asset.ref.expiresAt = new Date(Date.now() + ASSET_TTL_MS).toISOString()
  }

  private cleanup() {
    const now = Date.now()
    for (const [assetId, asset] of this.assets) {
      if (!asset.persistent && !hasActiveMemoryOwner(asset) && Date.parse(asset.ref.expiresAt ?? '') <= now) this.invalidate(assetId, 'expired')
    }
  }

  private enforceCapacity() {
    let totalBytes = Array.from(this.assets.values()).reduce((total, asset) => total + asset.bytes, 0)
    const oldestFirst = () => Array.from(this.assets.entries()).sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)
    for (const [assetId, asset] of oldestFirst()) {
      if (this.assets.size <= MAX_ASSET_COUNT && totalBytes <= MAX_ASSET_BYTES) break
      if (asset.persistent && !hasActiveMemoryOwner(asset)) this.assets.delete(assetId)
      else if (!asset.persistent && !hasActiveMemoryOwner(asset)) this.invalidate(assetId, 'capacity')
      else continue
      totalBytes -= asset.bytes
    }
    if (this.assets.size > MAX_ASSET_COUNT || totalBytes > MAX_ASSET_BYTES) {
      throw new Error('当前任务和参考图超过 Photoshop 暂存容量，请减少图片数量或尺寸')
    }
  }

  private invalidate(assetId: string, reason: AssetInvalidationReason) {
    if (!this.assets.delete(assetId)) return
    this.onInvalidated?.(assetId, reason)
  }

  private mutatePersistent<T>(operation: () => Promise<T>) {
    const run = this.persistentQueue.then(operation, operation)
    this.persistentQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async getPersistentFolder(create: boolean) {
    const fileSystem = getAdobeUxpStorage().localFileSystem
    if (!fileSystem?.getDataFolder) throw new Error('本地生成记录存储不可用')
    const dataFolder = await fileSystem.getDataFolder()
    try {
      const entry = await dataFolder.getEntry(PERSISTENT_FOLDER)
      if (typeof (entry as AdobeUxpFolder).getEntry !== 'function') throw new Error('生成记录存储目录无效')
      return entry as AdobeUxpFolder
    } catch (error) {
      if (!create) return undefined
      try {
        return await dataFolder.createFolder(PERSISTENT_FOLDER)
      } catch {
        const entry = await dataFolder.getEntry(PERSISTENT_FOLDER)
        if (typeof (entry as AdobeUxpFolder).getEntry !== 'function') throw error
        return entry as AdobeUxpFolder
      }
    }
  }

  private async loadPersistentIndex() {
    if (this.persistentIndex) return this.persistentIndex
    if (this.persistentIndexLoad) return this.persistentIndexLoad
    this.persistentIndexLoad = (async () => {
      const index = new Map<string, PersistentAssetRecord>()
      const folder = await this.getPersistentFolder(false)
      if (!folder) return index
      try {
        const file = await folder.getEntry(PERSISTENT_INDEX) as AdobeUxpFile
        const raw = await file.read(getAdobeUxpStorage().formats?.utf8 ? { format: getAdobeUxpStorage().formats?.utf8 } : undefined)
        const text = typeof raw === 'string' ? raw : decodeUtf8(toUint8Array(raw))
        const parsed = JSON.parse(text) as { schemaVersion?: unknown; items?: unknown }
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.items)) return index
        for (const item of parsed.items) if (isPersistentRecord(item)) index.set(item.assetId, item)
      } catch {
        return index
      }
      return index
    })()
    try {
      this.persistentIndex = await this.persistentIndexLoad
      return this.persistentIndex
    } finally {
      this.persistentIndexLoad = undefined
    }
  }

  private async writePersistentIndex(folder: AdobeUxpFolder, index: Map<string, PersistentAssetRecord>) {
    const file = await folder.createFile(PERSISTENT_INDEX, { overwrite: true })
    const format = getAdobeUxpStorage().formats?.utf8
    const contents = JSON.stringify({ schemaVersion: 1, items: [...index.values()] })
    await file.write(contents, format ? { format } : undefined)
  }

  private selectPersistentEvictions(projected: Map<string, PersistentAssetRecord>, protectedIds: Set<string>) {
    let totalBytes = [...projected.values()].reduce((total, record) => total + record.bytes, 0)
    let totalCount = projected.size
    const evicted: PersistentAssetRecord[] = []
    const candidates = [...projected.values()]
      .filter((record) => !protectedIds.has(record.assetId))
      .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt)
    for (const record of candidates) {
      if (totalCount <= MAX_PERSISTENT_ASSET_COUNT && totalBytes <= MAX_PERSISTENT_ASSET_BYTES) break
      projected.delete(record.assetId)
      evicted.push(record)
      totalCount -= 1
      totalBytes -= record.bytes
    }
    if (totalCount > MAX_PERSISTENT_ASSET_COUNT || totalBytes > MAX_PERSISTENT_ASSET_BYTES) {
      throw new Error('生成结果超过持久存储容量，请清理历史记录或减少图片数量')
    }
    return evicted
  }

  private async deletePersistentFile(folder: AdobeUxpFolder, record: PersistentAssetRecord) {
    try {
      const file = await folder.getEntry(record.fileName) as AdobeUxpFile
      await file.delete?.()
    } catch {
      // A missing data file is already equivalent to deletion.
    }
  }

  private async restorePersistentAsset(assetId: string) {
    await this.persistentQueue
    const index = await this.loadPersistentIndex()
    const record = index.get(assetId)
    if (!record) throw new Error('资产已失效，请重新获取')
    try {
      const folder = await this.getPersistentFolder(false)
      if (!folder) throw new Error('本地生成记录存储不可用')
      const file = await folder.getEntry(record.fileName) as AdobeUxpFile
      const format = getAdobeUxpStorage().formats?.binary
      const raw = await file.read(format ? { format } : undefined)
      const bytes = toUint8Array(raw)
      if (!bytes.length || bytes.byteLength !== record.bytes || bytes.byteLength > MAX_PERSISTENT_FILE_BYTES) {
        throw new Error('生成图片文件已损坏')
      }
      const previewUrl = `data:${record.mimeType};base64,${bytesToBase64(bytes)}`
      const image: CapturedCanvasImage = {
        id: record.assetId,
        label: record.label,
        width: record.width,
        height: record.height,
        sourceBounds: record.sourceBounds ?? { left: 0, top: 0, right: record.width, bottom: record.height },
        previewUrl,
        rgba: new Uint8Array()
      }
      let thumbnail = ''
      let previewError = ''
      try {
        thumbnail = await createBridgeThumbnailFromPreview(image, MAX_THUMBNAIL_BYTES)
        if (serializedBytes(thumbnail) > MAX_THUMBNAIL_BYTES) {
          thumbnail = ''
          previewError = '缩略图超过传输限制'
        }
      } catch (error) {
        previewError = error instanceof Error ? error.message : '缩略图生成失败'
      }
      const now = Date.now()
      record.lastAccessedAt = now
      const ref: HostAssetRef = {
        assetId: record.assetId,
        label: record.label,
        source: record.source,
        mimeType: record.mimeType,
        width: record.width,
        height: record.height,
        previewUrl: thumbnail,
        thumbnailUrl: thumbnail,
        previewStatus: thumbnail ? 'ready' : 'unavailable',
        ...(previewError ? { previewError: previewError.slice(0, 256) } : {}),
        originalAvailable: true,
        status: 'available',
        sourceBounds: record.sourceBounds,
        ...(record.documentId ? { documentId: record.documentId } : {})
      }
      const asset: Asset = {
        image,
        ref,
        createdAt: record.createdAt,
        lastAccessedAt: now,
        bytes: serializedBytes(previewUrl),
        persistent: true,
        owners: new Set()
      }
      this.assets.set(assetId, asset)
      this.enforceCapacity()
      return asset
    } catch (error) {
      index.delete(assetId)
      const folder = await this.getPersistentFolder(false)
      if (folder) await this.writePersistentIndex(folder, index).catch(() => undefined)
      throw error
    }
  }
}

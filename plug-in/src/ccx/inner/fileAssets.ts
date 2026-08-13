import { createBridgeThumbnailFromLocalFile, type CapturedCanvasImage } from '../canvasPrimitives'
import { readImageByteDimensions } from '@mugen/core'
import { getHostRequire } from '../photoshopHost'
import { AssetStore } from './assetStore'
import { encodeUtf8 } from './utf8'

type AdobeUxpFile = {
  name?: string
  read: (options?: Record<string, unknown>) => Promise<ArrayBuffer | Uint8Array | string>
  write: (data: Uint8Array, options?: Record<string, unknown>) => Promise<void>
}

type FileSystemProvider = {
  getFileForOpening: (options?: Record<string, unknown>) => Promise<AdobeUxpFile | AdobeUxpFile[] | null>
  getFileForSaving: (suggestedName: string, options?: Record<string, unknown>) => Promise<AdobeUxpFile | null>
}

type UxpClipboard = {
  read?: () => Promise<unknown>
  getContent?: () => Promise<unknown>
}

type ClipboardBinary = {
  arrayBuffer?: () => Promise<ArrayBuffer>
  type?: string
}

type ImageImportChunk = {
  importId: string
  name: string
  mimeType: string
  source: 'upload' | 'clipboard'
  width: number
  height: number
  index: number
  total: number
  chunk: string
  thumbnailUrl?: string
}

const MAX_REFERENCE_FILE_BYTES = 128 * 1024 * 1024
const MAX_REFERENCE_BASE64_LENGTH = Math.ceil(MAX_REFERENCE_FILE_BYTES / 3) * 4 + 4
const MAX_ACTIVE_IMPORTS = 16
const MAX_THUMBNAIL_BYTES = 16 * 1024
const THUMBNAIL_MAX_EDGE = 512
const IMAGE_DECODE_TIMEOUT_MS = 15_000

function getAdobeUxpStorage() {
  const hostRequire = getHostRequire()
  if (!hostRequire) throw new Error('Photoshop UXP runtime is unavailable.')
  return hostRequire('uxp').storage as {
    formats?: { binary?: unknown }
    fileTypes?: { images?: string[] }
    localFileSystem?: FileSystemProvider
  }
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

function readExtension(name: string) {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension) ? extension : 'png'
}

function mimeForExtension(extension: string) {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  return 'image/png'
}

function extensionForMime(mimeType: string) {
  const clean = mimeType.split(';')[0]?.toLowerCase()
  if (clean === 'image/jpeg' || clean === 'image/jpg') return 'jpg'
  if (clean === 'image/webp') return 'webp'
  if (clean === 'image/gif') return 'gif'
  return 'png'
}

async function loadImage(sourceUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const timeout = setTimeout(() => reject(new Error('图片解析超时')), IMAGE_DECODE_TIMEOUT_MS)
    image.addEventListener('load', () => {
      clearTimeout(timeout)
      resolve(image)
    }, { once: true })
    image.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('无法读取图片尺寸'))
    }, { once: true })
    image.src = sourceUrl
  })
}

function renderImage(image: HTMLImageElement, width: number, height: number, mimeType: 'image/png' | 'image/jpeg', quality?: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('图片预览生成失败')
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL(mimeType, quality)
}

function createThumbnail(image: HTMLImageElement, width: number, height: number) {
  let maxEdge = THUMBNAIL_MAX_EDGE
  while (maxEdge >= 64) {
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    const thumbnail = renderImage(
      image,
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
      'image/jpeg',
      0.72
    )
    if (thumbnail.length <= MAX_THUMBNAIL_BYTES) return thumbnail
    maxEdge = Math.floor(maxEdge * 0.7)
  }
  throw new Error('缩略图超过传输限制')
}

async function createImage(bytes: Uint8Array, mimeType: string, label: string, source?: Blob, knownDimensions?: { width: number; height: number }) {
  if (!bytes.byteLength) throw new Error('图片文件为空')
  if (bytes.byteLength > MAX_REFERENCE_FILE_BYTES) throw new Error('图片超过 128 MB，无法读取')
  if (mimeType === 'image/uncompressed' && !source) throw new Error('剪贴板图片格式无法读取')
  const inlineDimensions = knownDimensions ?? (mimeType === 'image/uncompressed' ? undefined : readImageByteDimensions(bytes))
  const encoded = mimeType === 'image/uncompressed' ? '' : `data:${mimeType};base64,${bytesToBase64(bytes)}`
  const sourceUrl = source
    ? URL.createObjectURL(source)
    : mimeType === 'image/uncompressed'
      ? ''
      : encoded
  try {
    if (inlineDimensions && !source) {
      const image: CapturedCanvasImage = {
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        width: inlineDimensions.width,
        height: inlineDimensions.height,
        sourceBounds: { left: 0, top: 0, right: inlineDimensions.width, bottom: inlineDimensions.height },
        previewUrl: encoded,
        rgba: new Uint8Array()
      }
      return { image, thumbnailUrl: '' }
    }
    const element = await loadImage(sourceUrl)
    const width = Math.max(1, Math.round(element.naturalWidth || element.width || 1))
    const height = Math.max(1, Math.round(element.naturalHeight || element.height || 1))
    const previewUrl = mimeType === 'image/uncompressed'
      ? renderImage(element, width, height, 'image/png')
      : encoded
    const image: CapturedCanvasImage = {
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      width,
      height,
      sourceBounds: { left: 0, top: 0, right: width, bottom: height },
      previewUrl,
      rgba: new Uint8Array()
    }
    return { image, thumbnailUrl: createThumbnail(element, width, height) }
  } finally {
    if (source) URL.revokeObjectURL(sourceUrl)
  }
}

function readDataUrl(value: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value)
  if (!match) throw new Error('图片数据无效')
  const mimeType = match[1] || 'image/png'
  const bytes = match[2] ? base64ToBytes(match[3] ?? '') : encodeUtf8(decodeURIComponent(match[3] ?? ''))
  return { mimeType, bytes }
}

async function readPreviewBytes(previewUrl: string) {
  if (previewUrl.startsWith('data:')) return readDataUrl(previewUrl)
  const response = await fetch(previewUrl)
  if (!response.ok) throw new Error('图片下载失败')
  return {
    mimeType: response.headers.get('content-type') || 'image/png',
    bytes: new Uint8Array(await response.arrayBuffer())
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'mugen-image'
}

function withCause(message: string, cause: unknown) {
  const error = new Error(message) as Error & { cause?: unknown }
  error.cause = cause
  return error
}

async function readBinary(value: unknown) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (value && typeof value === 'object' && typeof (value as ClipboardBinary).arrayBuffer === 'function') {
    return new Uint8Array(await (value as Required<Pick<ClipboardBinary, 'arrayBuffer'>>).arrayBuffer())
  }
  return undefined
}

function clipboardEntries(raw: unknown) {
  return Array.isArray(raw) ? raw : [raw]
}

async function readClipboardImage(raw: unknown) {
  for (const item of clipboardEntries(raw)) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown> & {
      type?: string
      types?: string[]
      getType?: (type: string) => Promise<unknown>
    }
    const type = record.types?.find((value) => value.startsWith('image/'))
      ?? Object.keys(record).find((value) => value.startsWith('image/'))
      ?? (record.type?.startsWith('image/') ? record.type : undefined)
    if (!type) continue
    const value = typeof record.getType === 'function' ? await record.getType(type) : (record[type] ?? item)
    const bytes = await readBinary(value)
    if (bytes?.length) return {
      type,
      bytes,
      source: value && typeof value === 'object' && typeof (value as ClipboardBinary).arrayBuffer === 'function'
        ? value as Blob
        : undefined
    }
  }
  return undefined
}

export class FileAssetService {
  private readonly assets: AssetStore
  private readonly imports = new Map<string, { name: string; mimeType: string; source: 'upload' | 'clipboard'; width: number; height: number; total: number; chunks: string[]; encodedLength: number; thumbnailUrl?: string }>()

  constructor(assets: AssetStore) {
    this.assets = assets
  }

  async pickReference() {
    const storage = getAdobeUxpStorage()
    const picker = storage.localFileSystem
    if (!picker) throw new Error('文件选择器不可用')
    let selected: AdobeUxpFile | AdobeUxpFile[] | null
    try {
      selected = await picker.getFileForOpening({ types: storage.fileTypes?.images ?? ['png', 'jpg', 'jpeg', 'webp', 'gif'] })
    } catch (error) {
      throw withCause('文件选择失败，请重试', error)
    }
    const file = Array.isArray(selected) ? selected[0] : selected
    if (!file) return null
    let raw: ArrayBuffer | Uint8Array | string
    try {
      raw = await file.read(storage.formats?.binary ? { format: storage.formats.binary } : undefined)
    } catch (error) {
      throw withCause('文件读取失败，请重新选择图片', error)
    }
    const bytes = raw instanceof Uint8Array ? raw : typeof raw === 'string' ? encodeUtf8(raw) : new Uint8Array(raw)
    const name = file.name || '上传图片.png'
    const extension = readExtension(name)
    const mimeType = mimeForExtension(extension)
    if (!bytes.byteLength) throw new Error('图片文件为空')
    if (bytes.byteLength > MAX_REFERENCE_FILE_BYTES) throw new Error('图片超过 128 MB，无法读取')
    const localPreview = await createBridgeThumbnailFromLocalFile(file, MAX_THUMBNAIL_BYTES)
    const prepared = await createImage(bytes, mimeType, `上传图片：${name}`, undefined, localPreview)
    return this.assets.add('upload', prepared.image, { thumbnailUrl: localPreview.thumbnailUrl })
  }

  async readClipboardReference() {
    const clipboard = navigator.clipboard as UxpClipboard | undefined
    if (!clipboard) throw new Error('当前 Photoshop 版本不支持读取剪贴板图片')
    const readers = [clipboard.read, clipboard.getContent].filter((read): read is () => Promise<unknown> => typeof read === 'function')
    if (!readers.length) throw new Error('当前 Photoshop 版本不支持读取剪贴板图片')
    let lastError: unknown
    let successfulRead = false
    for (const read of readers) {
      try {
        const raw = await read.call(clipboard)
        successfulRead = true
        const clipboardImage = await readClipboardImage(raw)
        if (!clipboardImage) continue
        const prepared = await createImage(clipboardImage.bytes, clipboardImage.type, '剪贴板图片', clipboardImage.source)
        return this.assets.add('clipboard', prepared.image, { thumbnailUrl: prepared.thumbnailUrl })
      } catch (error) {
        lastError = error
      }
    }
    if (!successfulRead && lastError) throw withCause('剪贴板图片读取失败，请重新复制图片后重试', lastError)
    throw new Error('剪贴板里没有图片')
  }

  async importImageChunk(payload: ImageImportChunk) {
    const existing = this.imports.get(payload.importId)
    if (!existing && this.imports.size >= MAX_ACTIVE_IMPORTS) {
      this.imports.delete(this.imports.keys().next().value as string)
    }
    const active = existing ?? {
      name: payload.name,
      mimeType: payload.mimeType,
      source: payload.source,
      width: payload.width,
      height: payload.height,
      total: payload.total,
      chunks: new Array<string>(payload.total),
      encodedLength: 0,
      thumbnailUrl: payload.thumbnailUrl
    }
    if (active.name !== payload.name || active.mimeType !== payload.mimeType || active.source !== payload.source || active.width !== payload.width || active.height !== payload.height || active.total !== payload.total) {
      this.imports.delete(payload.importId)
      throw new Error('图片导入分片不一致')
    }
    const previous = active.chunks[payload.index]
    active.encodedLength += payload.chunk.length - (previous?.length ?? 0)
    if (active.encodedLength > MAX_REFERENCE_BASE64_LENGTH) {
      this.imports.delete(payload.importId)
      throw new Error('图片超过 128 MB，无法读取')
    }
    active.chunks[payload.index] = payload.chunk
    this.imports.set(payload.importId, active)
    if (active.chunks.filter((chunk) => typeof chunk === 'string').length !== active.total) return null

    this.imports.delete(payload.importId)
    const dataUrl = `data:${active.mimeType};base64,${active.chunks.join('')}`
    const imageData = readDataUrl(dataUrl)
    const prepared = await createImage(imageData.bytes, imageData.mimeType, active.source === 'clipboard' ? '剪贴板图片' : `上传图片：${active.name}`, undefined, active)
    return this.assets.add(active.source, prepared.image, { thumbnailUrl: active.thumbnailUrl ?? prepared.thumbnailUrl })
  }

  async save(assetId: string) {
    const asset = await this.assets.getOrRestore(assetId)
    const storage = getAdobeUxpStorage()
    const picker = storage.localFileSystem
    if (!picker) throw new Error('文件保存器不可用')
    const imageData = await readPreviewBytes(asset.image.previewUrl)
    const extension = extensionForMime(imageData.mimeType)
    const fileName = `${sanitizeFileName(asset.ref.label)}-${asset.ref.width}x${asset.ref.height}.${extension}`
    const file = await picker.getFileForSaving(fileName, { types: [extension] })
    if (!file) return { saved: false }
    await file.write(imageData.bytes, storage.formats?.binary ? { format: storage.formats.binary } : undefined)
    return { saved: true, fileName }
  }
}

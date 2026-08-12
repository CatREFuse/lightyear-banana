import type { CapturedCanvasImage } from '../canvasPrimitives'
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

async function readImageDimensions(previewUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    const timeout = setTimeout(() => reject(new Error('图片解析超时')), 60_000)
    image.addEventListener('load', () => {
      clearTimeout(timeout)
      resolve({
        width: Math.max(1, Math.round(image.naturalWidth || image.width || 1)),
        height: Math.max(1, Math.round(image.naturalHeight || image.height || 1))
      })
    }, { once: true })
    image.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('无法读取图片尺寸'))
    }, { once: true })
    image.src = previewUrl
  })
}

async function createImage(previewUrl: string, label: string): Promise<CapturedCanvasImage> {
  const dimensions = await readImageDimensions(previewUrl)
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    width: dimensions.width,
    height: dimensions.height,
    sourceBounds: { left: 0, top: 0, right: dimensions.width, bottom: dimensions.height },
    previewUrl,
    rgba: new Uint8Array()
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
    if (bytes?.length) return { type, bytes }
  }
  return undefined
}

export class FileAssetService {
  private readonly assets: AssetStore

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
    const previewUrl = `data:${mimeForExtension(extension)};base64,${bytesToBase64(bytes)}`
    return this.assets.add('upload', await createImage(previewUrl, `上传图片：${name}`))
  }

  async readClipboardReference() {
    const clipboard = navigator.clipboard as UxpClipboard | undefined
    const read = clipboard?.read ?? clipboard?.getContent
    if (!clipboard || typeof read !== 'function') throw new Error('当前 Photoshop 版本不支持读取剪贴板图片')
    let raw: unknown
    try {
      raw = await read.call(clipboard)
    } catch (error) {
      throw withCause('剪贴板图片读取失败，请重新复制图片后重试', error)
    }
    const image = await readClipboardImage(raw)
    if (!image) throw new Error('剪贴板里没有图片')
    const previewUrl = `data:${image.type};base64,${bytesToBase64(image.bytes)}`
    return this.assets.add('clipboard', await createImage(previewUrl, '剪贴板图片'))
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

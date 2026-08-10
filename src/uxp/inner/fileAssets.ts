import type { CapturedCanvasImage } from '../canvasPrimitives'
import { getHostRequire } from '../photoshopHost'
import { AssetStore } from './assetStore'

type UxpFile = {
  name?: string
  read: (options?: Record<string, unknown>) => Promise<ArrayBuffer | Uint8Array | string>
  write: (data: Uint8Array, options?: Record<string, unknown>) => Promise<void>
}

type FileSystemProvider = {
  getFileForOpening: (options?: Record<string, unknown>) => Promise<UxpFile | UxpFile[] | null>
  getFileForSaving: (suggestedName: string, options?: Record<string, unknown>) => Promise<UxpFile | null>
}

function getUxpStorage() {
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
    image.addEventListener('load', () => resolve({
      width: Math.max(1, Math.round(image.naturalWidth || image.width || 1)),
      height: Math.max(1, Math.round(image.naturalHeight || image.height || 1))
    }), { once: true })
    image.addEventListener('error', () => reject(new Error('无法读取图片尺寸')), { once: true })
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
  const bytes = match[2] ? base64ToBytes(match[3] ?? '') : new TextEncoder().encode(decodeURIComponent(match[3] ?? ''))
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
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'lightyear-image'
}

export class FileAssetService {
  private readonly assets: AssetStore

  constructor(assets: AssetStore) {
    this.assets = assets
  }

  async pickReference() {
    const storage = getUxpStorage()
    const picker = storage.localFileSystem
    if (!picker) throw new Error('文件选择器不可用')
    const selected = await picker.getFileForOpening({ types: storage.fileTypes?.images ?? ['png', 'jpg', 'jpeg', 'webp', 'gif'] })
    const file = Array.isArray(selected) ? selected[0] : selected
    if (!file) return null
    const raw = await file.read(storage.formats?.binary ? { format: storage.formats.binary } : undefined)
    const bytes = raw instanceof Uint8Array ? raw : typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw)
    const name = file.name || '上传图片.png'
    const extension = readExtension(name)
    const previewUrl = `data:${mimeForExtension(extension)};base64,${bytesToBase64(bytes)}`
    return this.assets.add('upload', await createImage(previewUrl, `上传图片：${name}`))
  }

  async readClipboardReference() {
    const clipboard = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> }
    if (typeof clipboard.read !== 'function') throw new Error('当前 Photoshop 版本不支持读取剪贴板图片')
    const items = await clipboard.read()
    for (const item of items ?? []) {
      const type = item.types?.find((value) => value.startsWith('image/'))
      if (!type || typeof item.getType !== 'function') continue
      const blob = await item.getType(type)
      const previewUrl = `data:${type};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`
      return this.assets.add('clipboard', await createImage(previewUrl, '剪贴板图片'))
    }
    throw new Error('剪贴板里没有图片')
  }

  async save(assetId: string) {
    const asset = await this.assets.getOrRestore(assetId)
    const storage = getUxpStorage()
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

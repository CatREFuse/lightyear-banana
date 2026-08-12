import type { CapturedCanvasImage } from '../types/canvas'
import type { DiagnosticExportResult, ImageRequestLogEntry } from '../types/mugen'

type BridgeStatus = {
  bridge: {
    host: string
    port: number
    running: boolean
  }
  ccxPackage?: {
    fileName: string
    downloadUrl: string
  }
}

type ElectronBridgeApi = {
  getBridgeStatus: () => Promise<BridgeStatus>
  loadSettings: () => unknown
  openPreview: (image: Pick<CapturedCanvasImage, 'height' | 'label' | 'previewUrl' | 'width'>) => Promise<{ ok: boolean }>
  recordGenerationRequest?: (entry: ImageRequestLogEntry) => void
  saveSettings: (settings: unknown) => Promise<{ ok: boolean }>
  invoke: <T = unknown>(command: string, payload?: unknown) => Promise<T>
}

export type SerializedCanvasImage = Omit<CapturedCanvasImage, 'rgba'> & {
  rgba: string | number[] | Record<string, number>
}

declare global {
  interface Window {
    mugenBridge?: ElectronBridgeApi
  }
}

function readRgba(value: SerializedCanvasImage['rgba']) {
  if (typeof value === 'string') {
    return base64ToBytes(value)
  }

  if (Array.isArray(value)) {
    return new Uint8Array(value)
  }

  const keys = Object.keys(value)
    .map(Number)
    .filter((key) => Number.isFinite(key))
    .sort((a, b) => a - b)

  return new Uint8Array(keys.map((key) => value[String(key)] ?? 0))
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

export function hasElectronBridge() {
  return typeof window !== 'undefined' && Boolean(window.mugenBridge)
}

export function readElectronStoredSettings() {
  if (!window.mugenBridge?.loadSettings) {
    return undefined
  }

  return window.mugenBridge.loadSettings()
}

export async function writeElectronStoredSettings(settings: unknown) {
  if (!window.mugenBridge?.saveSettings) {
    return
  }

  await window.mugenBridge.saveSettings(settings)
}

export async function openElectronPreviewImage(image: CapturedCanvasImage) {
  if (!window.mugenBridge?.openPreview) {
    throw new Error('Mugen App 未启动')
  }

  return window.mugenBridge.openPreview({
    height: image.height,
    label: image.label,
    previewUrl: image.previewUrl,
    width: image.width
  })
}

export async function getElectronBridgeStatus() {
  if (!window.mugenBridge) {
    throw new Error('Mugen App 未启动')
  }

  return window.mugenBridge.getBridgeStatus()
}

export async function invokeElectronBridge<T = unknown>(command: string, payload?: unknown) {
  if (!window.mugenBridge) {
    throw new Error('Mugen App 未启动')
  }

  return window.mugenBridge.invoke<T>(command, payload)
}

export async function exportElectronDiagnostics() {
  return invokeElectronBridge<DiagnosticExportResult>('diagnostics.export')
}

export function recordElectronGenerationRequest(entry: ImageRequestLogEntry) {
  window.mugenBridge?.recordGenerationRequest?.(entry)
}

export function deserializeCanvasImage(image: SerializedCanvasImage): CapturedCanvasImage {
  return {
    ...image,
    rgba: readRgba(image.rgba)
  }
}

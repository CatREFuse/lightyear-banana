import type { CapturedCanvasImage } from '../uxp/canvasPrimitives'
import type { PlacementTarget } from '../types/lightyear'

type BridgeStatus = {
  bridge: {
    host: string
    port: number
    running: boolean
  }
  photoshop: {
    connected: boolean
    documentLabel?: string
  }
  uxpPackage?: {
    fileName: string
    downloadUrl: string
  }
}

type ElectronBridgeApi = {
  getBridgeStatus: () => Promise<BridgeStatus>
  loadSettings: () => unknown
  saveSettings: (settings: unknown) => Promise<{ ok: boolean }>
  invoke: <T = unknown>(command: string, payload?: unknown) => Promise<T>
  onEvent: (callback: (event: unknown) => void) => () => void
}

type SerializedCanvasImage = Omit<CapturedCanvasImage, 'rgba'> & {
  rgba: string | number[] | Record<string, number>
}

declare global {
  interface Window {
    lightyearBridge?: ElectronBridgeApi
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

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
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
  return typeof window !== 'undefined' && Boolean(window.lightyearBridge)
}

export function readElectronStoredSettings() {
  if (!window.lightyearBridge?.loadSettings) {
    return undefined
  }

  return window.lightyearBridge.loadSettings()
}

export async function writeElectronStoredSettings(settings: unknown) {
  if (!window.lightyearBridge?.saveSettings) {
    return
  }

  await window.lightyearBridge.saveSettings(settings)
}

export async function getElectronBridgeStatus() {
  if (!window.lightyearBridge) {
    throw new Error('Lightyear App 未启动')
  }

  return window.lightyearBridge.getBridgeStatus()
}

export async function invokeElectronBridge<T = unknown>(command: string, payload?: unknown) {
  if (!window.lightyearBridge) {
    throw new Error('Lightyear App 未启动')
  }

  return window.lightyearBridge.invoke<T>(command, payload)
}

export function onElectronBridgeEvent(callback: (event: unknown) => void) {
  if (!window.lightyearBridge) {
    return undefined
  }

  return window.lightyearBridge.onEvent(callback)
}

export function deserializeCanvasImage(image: SerializedCanvasImage): CapturedCanvasImage {
  return {
    ...image,
    rgba: readRgba(image.rgba)
  }
}

export function serializeCanvasImage(image: CapturedCanvasImage): SerializedCanvasImage {
  return {
    ...image,
    rgba: bytesToBase64(image.rgba)
  }
}

export function serializePlacementTarget(target: PlacementTarget, image?: CapturedCanvasImage) {
  if (target.type === 'reference-selection') {
    const bounds = target.bounds
    return {
      type: 'bounds',
      bounds: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top
      }
    }
  }

  if (target.type === 'original-size' && image) {
    return {
      type: 'bounds',
      bounds: {
        left: 0,
        top: 0,
        width: image.width,
        height: image.height
      }
    }
  }

  if (target.type === 'current-selection') {
    return { type: 'currentSelection' }
  }

  return { type: 'fullCanvas' }
}

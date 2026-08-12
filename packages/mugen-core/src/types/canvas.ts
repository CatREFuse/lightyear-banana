export type PixelBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

export type CapturedCanvasImage = {
  id: string
  label: string
  width: number
  height: number
  sourceBounds: PixelBounds
  previewUrl: string
  previewStatus?: 'ready' | 'unavailable'
  previewError?: string
  originalAvailable?: boolean
  rgba: Uint8Array
}

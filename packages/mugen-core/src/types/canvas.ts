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
  rgba: Uint8Array
}

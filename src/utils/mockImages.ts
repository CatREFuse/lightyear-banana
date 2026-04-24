import type { CapturedCanvasImage } from '../uxp/canvasPrimitives'

type MockImageTone = 'blue' | 'green' | 'amber' | 'pink' | 'violet' | 'gray'

const tones: Record<MockImageTone, { a: string; b: string; c: [number, number, number] }> = {
  blue: { a: '#2257d6', b: '#0f172a', c: [72, 132, 255] },
  green: { a: '#1f9f76', b: '#10201c', c: [58, 201, 154] },
  amber: { a: '#d58a20', b: '#21180f', c: [236, 168, 76] },
  pink: { a: '#c64c7c', b: '#24121c', c: [228, 102, 154] },
  violet: { a: '#7058d8', b: '#17132a', c: [142, 122, 255] },
  gray: { a: '#5f6b7c', b: '#171a20', c: [150, 160, 176] }
}

export function createMockCanvasImage(id: string, label: string, tone: MockImageTone, width = 360, height = 240) {
  const rgba = new Uint8Array(width * height * 4)
  const color = tones[tone].c

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const stripe = Math.floor((x + y) / 24) % 2
      const spot = (x - width * 0.67) ** 2 + (y - height * 0.36) ** 2 < (height * 0.2) ** 2

      rgba[index] = Math.min(255, color[0] + stripe * 24)
      rgba[index + 1] = Math.min(255, color[1] + stripe * 18)
      rgba[index + 2] = Math.min(255, color[2] + stripe * 14)
      rgba[index + 3] = 255

      if (spot) {
        rgba[index] = 245
        rgba[index + 1] = 235
        rgba[index + 2] = 214
      }
    }
  }

  const fill = tones[tone]
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="${fill.a}"/>
          <stop offset="1" stop-color="${fill.b}"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <rect x="${width * 0.12}" y="${height * 0.24}" width="${width * 0.34}" height="${height * 0.48}" rx="18" fill="rgba(255,255,255,.22)"/>
      <circle cx="${width * 0.68}" cy="${height * 0.36}" r="${height * 0.2}" fill="rgba(255,255,255,.72)"/>
      <path d="M${width * 0.1} ${height * 0.78} C ${width * 0.32} ${height * 0.52}, ${width * 0.58} ${height * 0.88}, ${width * 0.9} ${height * 0.62}" fill="none" stroke="rgba(255,255,255,.44)" stroke-width="8"/>
    </svg>`
  )

  return {
    id,
    label,
    width,
    height,
    sourceBounds: {
      left: 0,
      top: 0,
      right: width,
      bottom: height
    },
    previewUrl: `data:image/svg+xml;charset=utf-8,${svg}`,
    rgba
  } satisfies CapturedCanvasImage
}


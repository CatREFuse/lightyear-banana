import { expect, test } from '@playwright/test'
import { imageProcessor } from '../../plug-in/src/ccx/inner/imageProcessing'
import { createBridgeThumbnail, createProviderReferencePreview } from '../../plug-in/src/ccx/canvasPrimitives'
import { installTestHost } from './hostFixture'

test('CCX processes pixels, uploaded files and corrupt images through WebView without Photoshop', async ({ page }, testInfo) => {
  const service = imageProcessor
  const calls: string[] = []
  await page.exposeFunction('memoryImageCommand', (command: string, payload: any) => {
    calls.push(command)
    if (command === 'image.readChunk') return service.read(payload.jobId, payload.offset)
    if (command === 'image.writeChunk') return service.write(payload)
    if (command === 'image.fail') return service.fail(payload.jobId, payload.message)
    throw new Error(`Unexpected command: ${command}`)
  })
  await installTestHost(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'iMini PS' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__MUGEN_E2E_TRACE__?.commands?.some((item: any) => item.command === 'settings.get') ?? false)).toBe(true)
  await page.evaluate(() => {
    const original = window.postMessage.bind(window)
    window.postMessage = ((request: any, ...args: any[]) => {
      if (!request?.command?.startsWith('image.')) return (original as any)(request, ...args)
      void (window as any).memoryImageCommand(request.command, request.payload).then((payload: unknown) => {
        window.dispatchEvent(new MessageEvent('message', { source: window, data: { ...request, kind: 'response', payload } }))
      })
    }) as typeof window.postMessage
  })
  service.connect(request => {
    void page.evaluate(payload => {
      window.dispatchEvent(new MessageEvent('message', { source: window, data: {
        protocol: 'inner-host/v1', kind: 'event', messageId: payload.jobId, sessionId: 'e2e-session', command: 'image.process', timestamp: new Date().toISOString(), payload
      } }))
    }, request)
  })
  try {
    const pixels = Buffer.alloc(640 * 480 * 4)
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = Math.floor(index / 4) % 640 < 320 ? 235 : 32
      pixels[index + 1] = Math.floor(index / (640 * 4)) < 240 ? 96 : 192
      pixels[index + 2] = 72
      pixels[index + 3] = 255
    }
    const result = await service.process(pixels.toString('base64'), { source: 'rgba', width: 640, height: 480, maxEdge: 256, maxBytes: 16384, measure: 'dataUrl' })
    expect(result.thumbnailUrl.length).toBeLessThanOrEqual(16384)
    expect(calls.filter(command => command === 'image.readChunk').length).toBeGreaterThan(1)
    const rendered = await page.evaluate(async (src) => {
      const image = new Image()
      image.src = src
      await image.decode()
      image.style.cssText = 'position:fixed;top:16px;left:16px;z-index:99999'
      document.body.append(image)
      return { width: image.naturalWidth, height: image.naturalHeight }
    }, result.thumbnailUrl)
    expect(rendered).toEqual({ width: 256, height: 192 })
    await page.screenshot({ path: testInfo.outputPath('js-thumbnail.png') })
    const restored = await service.process(result.thumbnailUrl, { source: 'dataUrl', width: 640, height: 480, maxBytes: 16384, maxEdge: 128, measure: 'dataUrl' })
    expect(restored.width).toBe(256)
    expect(restored.height).toBe(192)
    for (let index = 0; index < pixels.length; index += 4) {
      const value = Math.imul(index + 1, 2654435761) ^ Math.imul(index >>> 8, 1597334677)
      pixels[index] = value & 255
      pixels[index + 1] = (value >>> 8) & 255
      pixels[index + 2] = (value >>> 16) & 255
    }
    const textured = await service.process(pixels.toString('base64'), { source: 'rgba', width: 640, height: 480, maxEdge: 800, maxBytes: 16384, measure: 'dataUrl' })
    expect(textured.thumbnailUrl.length).toBeLessThanOrEqual(16384)
    expect(await page.evaluate(async src => {
      const image = new Image()
      image.src = src
      await image.decode()
      return image.naturalWidth
    }, textured.thumbnailUrl)).toBeLessThan(640)
    const largePreview = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 6000
      canvas.height = 4000
      const context = canvas.getContext('2d')!
      context.fillStyle = '#66aabb'
      context.fillRect(0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.9)
    })
    const largeImage = { id: 'large', label: 'large', width: 6000, height: 4000, sourceBounds: { left: 0, top: 0, right: 6000, bottom: 4000 }, previewUrl: largePreview, get rgba(): Uint8Array { throw new Error('Full RGBA must not be serialized') } }
    for (const [createPreview, maxEdge] of [[createBridgeThumbnail, 800], [createProviderReferencePreview, 4096]] as const) {
      const preview = await createPreview(largeImage)
      const size = await page.evaluate(async src => {
        const image = new Image()
        image.src = src
        await image.decode()
        return { width: image.naturalWidth, height: image.naturalHeight }
      }, preview)
      expect(size.width).toBe(maxEdge)
      expect(size.height).toBe(Math.round(maxEdge * 4000 / 6000))
    }
    await expect(service.process('data:image/png;base64,broken', { source: 'dataUrl', width: 1, height: 1, measure: 'dataUrl' })).rejects.toThrow()
    expect(calls).toContain('image.fail')
  } finally {
    service.disconnect()
  }
})

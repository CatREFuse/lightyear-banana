import { expect, test } from '@playwright/test'
import { ImageProcessingService } from '../../plug-in/src/ccx/inner/imageProcessing'
import { installTestHost } from './hostFixture'

test('CCX processes pixels, uploaded files and corrupt images through WebView without Photoshop', async ({ page }, testInfo) => {
  const service = new ImageProcessingService()
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
  await expect(page.getByText('Photoshop 已连接')).toBeVisible()
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
    await expect(service.process('data:image/png;base64,broken', { source: 'dataUrl', width: 1, height: 1, measure: 'dataUrl' })).rejects.toThrow()
    expect(calls).toContain('image.fail')
  } finally {
    service.disconnect()
  }
})

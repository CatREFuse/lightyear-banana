import { describe, expect, it } from 'vitest'
import { ImageProcessingService } from './imageProcessing'
import type { ImageProcessingRequest } from '@mugen/inner-protocol'

const options = { source: 'dataUrl' as const, width: 2, height: 1, maxEdge: 800, maxBytes: 16384, measure: 'dataUrl' as const }
const result = 'data:image/jpeg;base64,/9j/2Q=='

describe('internal image processing', () => {
  it('transfers concurrent images in bounded chunks and resolves the matching job', async () => {
    const service = new ImageProcessingService()
    const requests: ImageProcessingRequest[] = []
    service.connect(request => requests.push(request))
    const first = service.process('a'.repeat(300_000), options)
    const second = service.process('second', options)
    const part = service.read(requests[0]!.jobId, 0)
    expect(part.chunk.length).toBe(192 * 1024)
    expect(part.done).toBe(false)
    expect(service.read(requests[0]!.jobId, part.chunk.length).done).toBe(true)
    service.write({ jobId: requests[1]!.jobId, offset: 0, chunk: result, done: true, width: 2, height: 1 })
    await expect(second).resolves.toMatchObject({ thumbnailUrl: result })
    service.write({ jobId: requests[0]!.jobId, offset: 0, chunk: result.slice(0, 20), done: false, width: 2, height: 1 })
    expect(() => service.write({ jobId: requests[0]!.jobId, offset: 0, chunk: result, done: true, width: 2, height: 1 })).toThrow('顺序')
    service.write({ jobId: requests[0]!.jobId, offset: 20, chunk: result.slice(20), done: true, width: 2, height: 1 })
    await expect(first).resolves.toMatchObject({ width: 2, height: 1 })
    expect(() => service.read(requests[0]!.jobId, 0)).toThrow('失效')
  })

  it('rejects unavailable sessions, invalid offsets and failed decodes', async () => {
    const service = new ImageProcessingService()
    await expect(service.process('bad', options)).rejects.toThrow('尚未就绪')
    let request: ImageProcessingRequest
    service.connect(value => { request = value })
    const pending = service.process('bad', options)
    expect(() => service.read(request!.jobId, -1)).toThrow('位置')
    expect(() => service.read(request!.jobId, 3)).toThrow('位置')
    service.fail(request!.jobId, '无法解码图片')
    await expect(pending).rejects.toThrow('无法解码图片')
  })

  it('rejects waiting jobs on reconnect and accepts only jobs from the new session', async () => {
    const service = new ImageProcessingService()
    let oldId = ''
    service.connect(request => { oldId = request.jobId })
    const pending = service.process('input', options)
    service.connect(() => undefined)
    await expect(pending).rejects.toThrow('连接已关闭')
    expect(() => service.read(oldId, 0)).toThrow('失效')
    service.disconnect()
  })

  it('rejects malformed or oversized output instead of returning an image', async () => {
    for (const chunk of ['invalid', 'x'.repeat(16385)]) {
      const service = new ImageProcessingService()
      let jobId = ''
      service.connect(request => { jobId = request.jobId })
      const pending = service.process('input', options)
      expect(() => service.write({ jobId, offset: 0, chunk, done: true, width: 2, height: 1 })).toThrow()
      await expect(pending).rejects.toThrow()
    }
  })
})

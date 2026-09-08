import type { ImageProcessingRequest, ImageProcessingWrite } from '@mugen/inner-protocol'

type Result = { thumbnailUrl: string; width: number; height: number }
type Emit = (request: ImageProcessingRequest) => void
type Job = { input: string; output: string; request: ImageProcessingRequest; resolve: (result: Result) => void; reject: (error: Error) => void }

export function encodeImageBytes(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export class ImageProcessingService {
  private emit?: Emit
  private sequence = 0
  private readonly jobs = new Map<string, Job>()

  connect(emit: Emit) {
    this.disconnect()
    this.emit = emit
  }

  disconnect() {
    this.emit = undefined
    for (const job of this.jobs.values()) job.reject(new Error('图片处理连接已关闭'))
    this.jobs.clear()
  }

  process(input: string, options: Omit<ImageProcessingRequest, 'jobId'>): Promise<Result> {
    if (!this.emit) return Promise.reject(new Error('图片处理尚未就绪'))
    const request = { ...options, jobId: `image-${Date.now()}-${++this.sequence}` }
    return new Promise((resolve, reject) => {
      this.jobs.set(request.jobId, { input, output: '', request, resolve, reject })
      try {
        this.emit!(request)
      } catch (error) {
        this.jobs.delete(request.jobId)
        reject(error)
      }
    })
  }

  read(jobId: string, offset: number) {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('图片处理任务已失效')
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= job.input.length) throw new Error('图片分片位置无效')
    const chunk = job.input.slice(offset, offset + 192 * 1024)
    return { jobId, offset, chunk, totalLength: job.input.length, done: offset + chunk.length === job.input.length }
  }

  write(payload: ImageProcessingWrite) {
    const job = this.jobs.get(payload.jobId)
    if (!job) throw new Error('图片处理任务已失效')
    if (payload.offset !== job.output.length) throw new Error('图片分片顺序无效')
    job.output += payload.chunk
    const limit = job.request.maxBytes
    if (limit && job.output.length > (job.request.measure === 'dataUrl' ? limit : Math.ceil(limit / 3) * 4 + 64)) {
      this.fail(payload.jobId, '图片处理结果超过请求限制')
      throw new Error('图片处理结果超过请求限制')
    }
    if (payload.done) {
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(job.output)) {
        this.fail(payload.jobId, '图片处理结果无效')
        throw new Error('图片处理结果无效')
      }
      this.jobs.delete(payload.jobId)
      job.resolve({ thumbnailUrl: job.output, width: payload.width, height: payload.height })
    }
    return { accepted: true as const }
  }

  fail(jobId: string, message: string) {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('图片处理任务已失效')
    this.jobs.delete(jobId)
    job.reject(new Error(message))
    return { accepted: true as const }
  }
}

export const imageProcessor = new ImageProcessingService()

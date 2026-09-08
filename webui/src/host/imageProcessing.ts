import type { HostCommand, HostCommandPayload, HostCommandResult, ImageProcessingRequest } from '@mugen/inner-protocol'

type Invoke = <C extends HostCommand>(command: C, payload: HostCommandPayload<C>) => Promise<HostCommandResult<C>>

export async function renderHostImage(request: ImageProcessingRequest, input: string) {
  let source: HTMLCanvasElement | HTMLImageElement
  if (request.source === 'rgba') {
    const binary = atob(input)
    if (binary.length !== request.width * request.height * 4) throw new Error('图片像素长度无效')
    const bytes = Uint8ClampedArray.from(binary, character => character.charCodeAt(0))
    source = document.createElement('canvas')
    source.width = request.width
    source.height = request.height
    const context = source.getContext('2d')
    if (!context) throw new Error('无法读取图片像素')
    context.putImageData(new ImageData(bytes, request.width, request.height), 0, 0)
  } else {
    if (!input.startsWith('data:image/')) throw new Error('图片数据无效')
    source = new Image()
    source.src = input
    await source.decode()
  }
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height
  let maxEdge = Math.min(request.maxEdge ?? Math.max(width, height), Math.max(width, height))
  while (true) {
    const scale = maxEdge / Math.max(width, height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法生成图片预览')
    context.fillStyle = '#222222'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    const size = request.measure === 'dataUrl' ? dataUrl.length : atob(dataUrl.split(',')[1]!).length
    if (request.maxBytes === undefined || size <= request.maxBytes) return { dataUrl, width, height }
    if (maxEdge === 1) throw new Error('图片处理结果超过请求限制')
    maxEdge = Math.max(1, Math.floor(maxEdge * 0.72))
  }
}

export async function processHostImage(request: ImageProcessingRequest, invoke: Invoke) {
  try {
    let input = ''
    while (true) {
      const part = await invoke('image.readChunk', { jobId: request.jobId, offset: input.length })
      if (part.jobId !== request.jobId || part.offset !== input.length || !part.chunk.length || part.offset + part.chunk.length > part.totalLength || part.done !== (part.offset + part.chunk.length === part.totalLength)) throw new Error('图片分片响应无效')
      input += part.chunk
      if (part.done) break
    }
    const result = await renderHostImage(request, input)
    for (let offset = 0; offset < result.dataUrl.length; offset += 192 * 1024) {
      const chunk = result.dataUrl.slice(offset, offset + 192 * 1024)
      await invoke('image.writeChunk', { jobId: request.jobId, offset, chunk, done: offset + chunk.length === result.dataUrl.length, width: result.width, height: result.height })
    }
  } catch (error) {
    await invoke('image.fail', { jobId: request.jobId, message: (error instanceof Error ? error.message : String(error)).slice(0, 2048) })
  }
}

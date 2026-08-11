import { describe, expect, it, vi } from 'vitest'
import type { GenerationSnapshot } from '../../../packages/inner-protocol/src/index'
import type { ImageProviderId } from '../../types/mugen'
import {
  ProviderRuntime,
  mapProviderTimingPhase,
  materializeProviderPreviewUrl,
  redactUrl,
  reduceProviderTimingProgress,
  validateHostGenerationRequest,
  validateProviderPreviewNetworkUrl
} from './providerRuntime'
import type { AssetStore } from './assetStore'

function mockResponse(
  status: number,
  headers: Record<string, string> = {},
  bytes: number[] = [1, 2, 3],
  redirected = false
) {
  return {
    status,
    ok: status >= 200 && status < 300,
    redirected,
    headers: new Headers(headers),
    arrayBuffer: async () => Uint8Array.from(bytes).buffer
  } as Response
}

describe('Provider preview URL policy', () => {
  it('removes credentials, query parameters, and fragments from request logs', () => {
    expect(redactUrl('https://user:password@images.vendor.dev/output.png?token=secret#private')).toBe('https://images.vendor.dev/output.png')
  })

  it('allows a public HTTPS URL and signed query for a remote Provider', () => {
    const url = validateProviderPreviewNetworkUrl('https://images.vendor.dev/output.png?signature=abc', 'openai')
    expect(url.hostname).toBe('images.vendor.dev')
    expect(url.searchParams.get('signature')).toBe('abc')
  })

  it.each([
    'http://images.vendor.dev/output.png',
    'https://user:password@images.vendor.dev/output.png',
    'https://localhost/output.png',
    'https://127.0.0.1/output.png',
    'https://8.8.8.8/output.png',
    'https://[::1]/output.png',
    'https://metadata.google.internal/output.png',
    'https://host.local/output.png',
    'https://example.com/output.png',
    'https://intranet/output.png',
    'https://127.0.0.1.nip.io/output.png'
  ])('rejects an unsafe remote URL: %s', (value) => {
    expect(() => validateProviderPreviewNetworkUrl(value, 'openai')).toThrow()
  })

  it.each<ImageProviderId>(['comfyui', 'codex-image-server'])('allows only explicit loopback HTTP(S) for %s', (provider) => {
    expect(validateProviderPreviewNetworkUrl('http://localhost:8188/view', provider).hostname).toBe('localhost')
    expect(validateProviderPreviewNetworkUrl('https://127.0.0.2/image.png', provider).hostname).toBe('127.0.0.2')
    expect(validateProviderPreviewNetworkUrl('http://[::1]/image.png', provider).hostname).toContain('::1')
    expect(() => validateProviderPreviewNetworkUrl('http://127.0.0.1.evil.dev/image.png', provider)).toThrow()
    expect(() => validateProviderPreviewNetworkUrl('https://images.vendor.dev/image.png', provider)).toThrow()
    expect(() => validateProviderPreviewNetworkUrl('http://user:pass@localhost/image.png', provider)).toThrow()
  })
})

describe('Host generation parameter validation', () => {
  const config = { provider: 'openai' as const, model: 'gpt-image-2' }
  const snapshot: Pick<GenerationSnapshot, 'size' | 'quality' | 'count' | 'ratio' | 'references'> = {
    size: '1280x512',
    quality: 'auto',
    count: 1,
    ratio: '原图比例',
    references: []
  }

  it('accepts parameters inside the shared Provider boundary', () => {
    expect(validateHostGenerationRequest(config, snapshot)).toEqual({
      valid: true,
      dimensions: { width: 1280, height: 512 }
    })
  })

  it.each([
    [{ ...snapshot, size: '1025x1024' }, '16 的倍数'],
    [{ ...snapshot, quality: 'ultra' }, '质量'],
    [{ ...snapshot, count: 11 }, '图片数量'],
    [{ ...snapshot, ratio: '1:1' }, '图片比例'],
    [{ ...snapshot, references: Array.from({ length: 17 }, (_, index) => ({ assetId: `asset-${index}`, label: `参考图 ${index + 1}`, source: 'upload' as const, width: 32, height: 32 })) }, '16 张参考图']
  ])('rejects an untrusted WebUI payload before a Provider request', (candidate, message) => {
    expect(() => validateHostGenerationRequest(config, candidate)).toThrow(message)
  })
})

describe('Provider preview materialization', () => {
  it('accepts Base64 image data and rejects non-image data', async () => {
    const signal = new AbortController().signal
    await expect(materializeProviderPreviewUrl('data:image/png;base64,AQID', 'openai', signal)).resolves.toBe('data:image/png;base64,AQID')
    await expect(materializeProviderPreviewUrl('data:text/html;base64,PGgxPk5vPC9oMT4=', 'openai', signal)).rejects.toThrow()
  })

  it('uses manual redirects, validates every hop, and downloads an image', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(mockResponse(302, { location: 'https://cdn.vendor.dev/final.png' }))
      .mockResolvedValueOnce(mockResponse(200, { 'content-type': 'image/png', 'content-length': '3' }))
    const signal = new AbortController().signal

    const result = await materializeProviderPreviewUrl('https://api.vendor.dev/start', 'openai', signal, fetcher)

    expect(result).toBe('data:image/png;base64,AQID')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', redirect: 'manual', signal })
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://cdn.vendor.dev/final.png')
  })

  it('blocks a redirect to a local address before requesting it', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(mockResponse(302, { location: 'http://127.0.0.1/admin' }))

    await expect(materializeProviderPreviewUrl(
      'https://api.vendor.dev/start',
      'openai',
      new AbortController().signal,
      fetcher
    )).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('limits redirect chains', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mockResponse(302, { location: '/next' }))

    await expect(materializeProviderPreviewUrl(
      'https://api.vendor.dev/start',
      'openai',
      new AbortController().signal,
      fetcher
    )).rejects.toThrow('跳转次数过多')
    expect(fetcher).toHaveBeenCalledTimes(6)
  })

  it('requires an image Content-Type and checks Content-Length before reading', async () => {
    const textFetcher = vi.fn<typeof fetch>().mockResolvedValue(mockResponse(200, { 'content-type': 'text/html' }))
    await expect(materializeProviderPreviewUrl(
      'https://api.vendor.dev/output',
      'openai',
      new AbortController().signal,
      textFetcher
    )).rejects.toThrow('不是图片')

    const oversized = mockResponse(200, {
      'content-type': 'image/png',
      'content-length': String(128 * 1024 * 1024 + 1)
    })
    const read = vi.spyOn(oversized, 'arrayBuffer')
    const largeFetcher = vi.fn<typeof fetch>().mockResolvedValue(oversized)
    await expect(materializeProviderPreviewUrl(
      'https://api.vendor.dev/output',
      'openai',
      new AbortController().signal,
      largeFetcher
    )).rejects.toThrow('超过大小限制')
    expect(read).not.toHaveBeenCalled()
  })

  it('preserves abort and does not start a fetch after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn<typeof fetch>()

    await expect(materializeProviderPreviewUrl(
      'https://api.vendor.dev/output',
      'openai',
      controller.signal,
      fetcher
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('Provider timing progress', () => {
  it('maps request stages to protocol phases', () => {
    expect(mapProviderTimingPhase('upload')).toBe('uploading')
    expect(mapProviderTimingPhase('poll')).toBe('polling')
    expect(mapProviderTimingPhase('submit')).toBe('requesting')
    expect(mapProviderTimingPhase('request')).toBe('requesting')
    expect(mapProviderTimingPhase('unknown')).toBeUndefined()
  })

  it('deduplicates repeated timing phases and emits transitions', () => {
    const initial = reduceProviderTimingProgress('requesting', 'submit')
    expect(initial).toEqual({ current: 'requesting', emitted: undefined })

    const uploading = reduceProviderTimingProgress(initial.current, 'upload')
    expect(uploading).toEqual({ current: 'uploading', emitted: 'uploading' })

    const duplicate = reduceProviderTimingProgress(uploading.current, 'upload')
    expect(duplicate).toEqual({ current: 'uploading', emitted: undefined })

    expect(reduceProviderTimingProgress(duplicate.current, 'poll')).toEqual({ current: 'polling', emitted: 'polling' })
  })
})

describe('Provider task ownership', () => {
  const snapshot: GenerationSnapshot = {
    configId: 'missing-config',
    prompt: '测试任务',
    references: [],
    size: '1024x1024',
    quality: 'high',
    count: 1,
    ratio: '1:1',
    submittedAt: new Date().toISOString()
  }

  function fakeAssets(retain: AssetStore['retain'] = vi.fn(async () => undefined)) {
    return {
      retain,
      releaseOwner: vi.fn(),
      removePersistent: vi.fn(async () => undefined),
      discard: vi.fn()
    } as unknown as AssetStore
  }

  it('commits a terminal Host history record before emitting failure and releases the task lease', async () => {
    const order: string[] = []
    const assets = fakeAssets()
    const persisted = vi.fn(async () => { order.push('persist') })
    const runtime = new ProviderRuntime({
      assets,
      persistHistory: persisted,
      emit: (event, payload) => {
        if (event === 'generation.failed' || event === 'generation.progress' && (payload as { phase?: string }).phase === 'failed') order.push(event)
      }
    })

    const { taskId } = await runtime.start(snapshot)
    await runtime.waitForIdle()

    expect(persisted).toHaveBeenCalledWith(expect.objectContaining({ id: taskId, status: 'failed', snapshot }))
    expect(order[0]).toBe('persist')
    expect(assets.releaseOwner).toHaveBeenCalledWith(`task:${taskId}`, true)
  })

  it('drains a start that is still retaining assets and rejects it before any Provider work', async () => {
    let resolveRetain!: () => void
    const retain = vi.fn(() => new Promise<void>((resolve) => { resolveRetain = resolve }))
    const assets = fakeAssets(retain)
    const persisted = vi.fn(async () => undefined)
    const runtime = new ProviderRuntime({ assets, persistHistory: persisted, emit: vi.fn() })

    const start = runtime.start(snapshot)
    const drain = runtime.pauseAndDrain()
    resolveRetain()

    await expect(start).rejects.toThrow('正在清理')
    await drain
    expect(persisted).not.toHaveBeenCalled()
    expect(assets.releaseOwner).toHaveBeenCalledWith(expect.stringMatching(/^task:/), true)
  })
})

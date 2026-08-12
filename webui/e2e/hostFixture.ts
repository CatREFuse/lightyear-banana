import type { Page } from '@playwright/test'

export type TestHostTrace = {
  commands: Array<{ sequence: number; command: string; payload: unknown }>
  captures: Array<{ assetId: string; source: string; width: number; height: number; previewBytes: number }>
  network: Array<{ sequence: number; phase: string; method: string; url: string; status: number; durationMs: number }>
  placements: Array<{ assetId: string; target: unknown; previewUrl: string; layerName: string }>
}

export async function installTestHost(page: Page, options: { apimartBaseUrl?: string; apiKey?: string; generationDelayMs?: number; thumbnailUnavailable?: boolean } = {}) {
  await page.addInitScript(({ apimartBaseUrl, apiKey, generationDelayMs, thumbnailUnavailable }) => {
    const protocol = 'inner-host/v1'
    const sessionId = 'e2e-session'
    const hostNonce = 'e2e-host-nonce'
    const canvasImage = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 640 480%22%3E%3Crect width=%22640%22 height=%22480%22 fill=%22%23181818%22/%3E%3Cpath d=%22M170 330c0-112 62-194 150-194s150 82 150 194%22 fill=%22%23f3ead7%22/%3E%3Cpath d=%22M206 176l34-82 58 64m136 18-34-82-58 64%22 fill=%22%23f3ead7%22/%3E%3Ccircle cx=%22275%22 cy=%22260%22 r=%2210%22/%3E%3Ccircle cx=%22365%22 cy=%22260%22 r=%2210%22/%3E%3C/svg%3E'
    const trace: TestHostTrace = { commands: [], captures: [], network: [], placements: [] }
    const context = {
      ready: true,
      hostVersion: '1.0.2',
      photoshopVersion: '27.3.0',
      uxpVersion: '8.1.0',
      platform: 'darwin',
      theme: 'dark',
      document: { id: 'e2e-document', name: '冒烟测试.psd', width: 1024, height: 1024 },
      capabilities: [
        'host.getContext', 'settings.get', 'settings.save', 'history.list', 'history.upsert', 'history.clear',
        'credential.set', 'credential.remove', 'canvas.captureVisible', 'canvas.captureSelection',
        'canvas.captureLayer', 'canvas.readSize', 'reference.pickFile', 'reference.readClipboard',
        'generation.start', 'generation.cancel', 'generation.testConfig', 'canvas.placeAsset',
        'asset.save', 'asset.readOriginal', 'asset.retain', 'asset.release', 'diagnostics.export', 'storage.clearAll'
      ]
    }
    let settings = {
      activeConfigId: 'e2e-apimart',
      configs: [{
        id: 'e2e-apimart',
        name: 'APIMart',
        provider: 'apimart',
        model: 'gpt-image-1',
        models: ['gpt-image-1'],
        baseUrl: apimartBaseUrl,
        enabled: true,
        credentialState: 'stored'
      }],
      promptPresets: []
    }
    const assets = new Map<string, Record<string, any>>()
    const originals = new Map<string, string>()
    const bridge = window as Window & { uxpHost?: { postMessage(message: unknown): void } }
    const nativePostMessage = window.postMessage.bind(window)
    let taskSequence = 0

    function envelope(kind: 'response' | 'event', command: string, payload: unknown, messageId: string) {
      return { protocol, kind, command, payload, messageId, sessionId, timestamp: new Date().toISOString() }
    }
    function emit(kind: 'response' | 'event', command: string, payload: unknown, messageId: string) {
      window.dispatchEvent(new MessageEvent('message', { data: envelope(kind, command, payload, messageId), source: window }))
    }
    function asset(assetId: string, source: string, label: string, previewUrl = canvasImage) {
      originals.set(assetId, previewUrl)
      const value = {
        assetId,
        source,
        label,
        mimeType: previewUrl.startsWith('data:image/svg') ? 'image/svg+xml' : 'image/jpeg',
        width: 640,
        height: 480,
        previewUrl,
        status: 'available',
        documentId: 'e2e-document'
      }
      if (thumbnailUnavailable && source === 'generated') {
        Object.assign(value, { previewUrl: '', thumbnailUrl: '', previewStatus: 'unavailable', previewError: '缩略图超过传输限制', originalAvailable: true })
      }
      assets.set(assetId, value)
      return value
    }
    function capture(assetId: string, source: string, label: string, sourceBounds?: Record<string, number>) {
      const value = { ...asset(assetId, source, label), ...(sourceBounds ? { sourceBounds } : {}) }
      assets.set(assetId, value)
      trace.captures.push({ assetId, source, width: value.width, height: value.height, previewBytes: value.previewUrl.length })
      return value
    }
    function respond(request: Record<string, any>, payload: unknown) {
      queueMicrotask(() => emit('response', request.command, payload, request.messageId))
    }
    function safePayload(request: Record<string, any>) {
      if (request.payload === undefined) return null
      if (request.command === 'credential.set') return { configId: request.payload.configId, apiKey: '[redacted]' }
      return JSON.parse(JSON.stringify(request.payload))
    }
    async function requestJson(phase: string, url: string, init: RequestInit) {
      const startedAt = performance.now()
      let status = 0
      try {
        const response = await fetch(url, init)
        status = response.status
        const text = await response.text()
        if (!response.ok) throw new Error(text || `HTTP ${response.status}`)
        return text ? JSON.parse(text) : {}
      } finally {
        trace.network.push({
          sequence: trace.network.length + 1,
          phase,
          method: init.method || 'GET',
          url,
          status,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt))
        })
      }
    }
    function authHeaders(extra: Record<string, string> = {}) {
      return { Authorization: `Bearer ${apiKey}`, ...extra }
    }
    function dataUrlBlob(value: string) {
      const separator = value.indexOf(',')
      if (separator < 0) throw new Error('Captured canvas data URL is invalid')
      const metadata = value.slice(5, separator)
      const encoded = value.slice(separator + 1)
      const mimeType = metadata.split(';')[0] || 'application/octet-stream'
      const binary = metadata.includes(';base64') ? atob(encoded) : decodeURIComponent(encoded)
      return new Blob([Uint8Array.from(binary, character => character.charCodeAt(0))], { type: mimeType })
    }
    async function readAssetBlob(previewUrl: string) {
      if (previewUrl.startsWith('data:')) return dataUrlBlob(previewUrl)
      const response = await fetch(previewUrl)
      if (!response.ok) throw new Error(`Unable to read captured asset: HTTP ${response.status}`)
      return response.blob()
    }
    async function runGeneration(request: Record<string, any>, taskId: string) {
      const snapshot = request.payload
      const startedAt = performance.now()
      const imageUrls: string[] = []

      emit('event', 'generation.progress', { taskId, phase: 'uploading', elapsedSeconds: 0 }, `${taskId}-uploading`)
      for (const reference of snapshot.references) {
        const source = assets.get(reference.assetId)
        if (!source?.previewUrl) throw new Error(`Missing captured asset: ${reference.assetId}`)
        const form = new FormData()
        form.append('file', await readAssetBlob(source.previewUrl), `${reference.assetId}.jpg`)
        const upload = await requestJson('reference.upload', `${apimartBaseUrl}/v1/uploads/images`, {
          method: 'POST', headers: authHeaders(), body: form
        })
        imageUrls.push(upload.url)
      }

      emit('event', 'generation.progress', { taskId, phase: 'requesting', elapsedSeconds: 0 }, `${taskId}-requesting`)
      const submitted = await requestJson('generation.submit', `${apimartBaseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: settings.configs.find((config) => config.id === snapshot.configId)?.model || 'gpt-image-1',
          prompt: snapshot.prompt,
          n: snapshot.count,
          size: snapshot.ratio === '1:1' ? '1:1' : snapshot.size,
          image_urls: imageUrls
        })
      })
      const remoteTaskId = submitted?.data?.[0]?.task_id
      if (!remoteTaskId) throw new Error('APIMart fixture did not return a task id')

      emit('event', 'generation.progress', { taskId, phase: 'polling', elapsedSeconds: 0 }, `${taskId}-polling`)
      if (generationDelayMs) await new Promise((resolve) => window.setTimeout(resolve, generationDelayMs))
      const completed = await requestJson('generation.poll', `${apimartBaseUrl}/v1/tasks/${encodeURIComponent(remoteTaskId)}?language=zh`, {
        method: 'GET', headers: authHeaders()
      })
      const catUrl = completed?.data?.result?.images?.[0]?.url?.[0]
      if (!catUrl) throw new Error('APIMart fixture did not return the cat image')

      emit('event', 'generation.progress', { taskId, phase: 'downloading', elapsedSeconds: 0 }, `${taskId}-downloading`)
      const downloadStartedAt = performance.now()
      const catResponse = await fetch(catUrl)
      const catBytes = await catResponse.arrayBuffer()
      trace.network.push({
        sequence: trace.network.length + 1,
        phase: 'image.download',
        method: 'GET',
        url: catUrl,
        status: catResponse.status,
        durationMs: Math.max(0, Math.round(performance.now() - downloadStartedAt))
      })
      if (!catResponse.ok || !catResponse.headers.get('content-type')?.startsWith('image/jpeg') || !catBytes.byteLength) {
        throw new Error('APIMart fixture returned an invalid cat image')
      }

      const result = asset(`e2e-result-${taskSequence}`, 'generated', '生成结果 1', catUrl)
      const logs = trace.network.map((entry) => ({
        id: `e2e-log-${entry.sequence}`,
        method: entry.method,
        url: entry.url,
        status: entry.status,
        durationMs: entry.durationMs,
        createdAt: new Date().toISOString()
      }))
      emit('event', 'generation.completed', { taskId, assets: [result], logs }, `${taskId}-completed`)
      trace.network.push({
        sequence: trace.network.length + 1,
        phase: 'workflow.completed',
        method: 'HOST',
        url: result.previewUrl,
        status: 200,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt))
      })
    }
    function handle(request: Record<string, any>) {
      trace.commands.push({ sequence: trace.commands.length + 1, command: request.command, payload: safePayload(request) })
      switch (request.command) {
        case 'host.handshake': respond(request, { sessionId, protocolVersion: 1, clientNonce: request.payload.clientNonce, hostNonce, context }); return
        case 'host.getContext': respond(request, context); return
        case 'settings.get': respond(request, settings); return
        case 'settings.save': settings = request.payload; respond(request, settings); return
        case 'history.list': respond(request, { items: [] }); return
        case 'history.upsert': respond(request, { entry: { ...request.payload.entry, assets: [] } }); return
        case 'history.clear': respond(request, { cleared: true }); return
        case 'canvas.captureVisible': respond(request, capture('e2e-visible', 'visible', '可见图层')); return
        case 'canvas.captureSelection': respond(request, capture('e2e-selection', 'selection', '选区', { left: 128, top: 128, width: 640, height: 480 })); return
        case 'canvas.captureLayer': respond(request, capture('e2e-layer', 'layer', '选择图层')); return
        case 'canvas.readSize': respond(request, { width: 1024, height: 1024 }); return
        case 'reference.pickFile': respond(request, capture('e2e-upload', 'upload', '上传图片')); return
        case 'reference.readClipboard': respond(request, capture('e2e-clipboard', 'clipboard', '剪贴板')); return
        case 'asset.retain': respond(request, assets.get(request.payload.assetId)); return
        case 'asset.release': respond(request, { assetId: request.payload.assetId, released: true }); return
        case 'generation.start': {
          taskSequence += 1
          const taskId = request.payload.clientTaskId || `e2e-task-${taskSequence}`
          respond(request, { taskId })
          window.setTimeout(() => {
            void runGeneration(request, taskId).catch((reason) => emit('event', 'generation.failed', {
              taskId,
              error: { code: 'APIMART_FIXTURE_FAILED', message: reason instanceof Error ? reason.message : 'APIMart fixture failed', recoverable: true }
            }, `${taskId}-failed`))
          }, 20)
          return
        }
        case 'generation.cancel': respond(request, { taskId: request.payload.taskId, cancelled: true }); return
        case 'generation.testConfig': {
          void requestJson('models.list', `${apimartBaseUrl}/v1/models`, { method: 'GET', headers: authHeaders() })
            .then(() => respond(request, { ok: true, message: '连接成功' }))
            .catch((reason) => respond(request, { ok: false, message: reason instanceof Error ? reason.message : '连接失败' }))
          return
        }
        case 'canvas.placeAsset': {
          const source = assets.get(request.payload.assetId)
          const layerName = 'Mugen 生成结果'
          trace.placements.push({ assetId: request.payload.assetId, target: safePayload(request).target, previewUrl: source?.previewUrl || '', layerName })
          respond(request, { layerName, target: request.payload.target })
          return
        }
        case 'asset.save': respond(request, { saved: true, fileName: 'mugen-result.png' }); return
        case 'asset.readOriginal': {
          const original = originals.get(request.payload.assetId) || ''
          const offset = request.payload.offset
          const chunk = original.slice(offset, offset + 192 * 1024)
          respond(request, { assetId: request.payload.assetId, chunk, offset, totalLength: original.length, done: offset + chunk.length >= original.length })
          return
        }
        case 'credential.set': respond(request, { configId: request.payload.configId, credentialState: 'stored' }); return
        case 'credential.remove': respond(request, { configId: request.payload.configId, credentialState: 'missing' }); return
        case 'diagnostics.export': respond(request, { saved: true, fileName: 'mugen-diagnostics.json' }); return
        case 'storage.clearAll': respond(request, { cleared: true, deleted: ['credentials', 'settings', 'history', 'assets', 'diagnostics'] }); return
        case 'host.openReleasePage': respond(request, { opened: true }); return
        default: throw new Error(`Unhandled E2E host command: ${request.command}`)
      }
    }

    Object.defineProperty(window, '__MUGEN_E2E_TRACE__', { value: trace, configurable: true })
    Object.defineProperty(window, 'uxpHost', { value: bridge, configurable: true })
    window.postMessage = ((message: unknown, targetOrigin?: string, transfer?: Transferable[]) => {
      if (message && typeof message === 'object' && (message as Record<string, unknown>).protocol === protocol) {
        handle(message as Record<string, any>)
        return
      }
      nativePostMessage(message, targetOrigin ?? '*', transfer ?? [])
    }) as typeof window.postMessage

    const readyTimer = window.setInterval(() => {
      emit('event', 'host.ready', { protocolVersion: 1, hostNonce, hostVersion: '1.0.2' }, `e2e-ready-${Date.now()}`)
    }, 25)
    window.setTimeout(() => window.clearInterval(readyTimer), 3_000)
  }, {
    apimartBaseUrl: options.apimartBaseUrl ?? 'http://127.0.0.1:38323',
    apiKey: options.apiKey ?? 'mock-apimart-good',
    generationDelayMs: options.generationDelayMs ?? 0,
    thumbnailUnavailable: options.thumbnailUnavailable ?? false
  })
}

export async function readTestHostTrace(page: Page): Promise<TestHostTrace> {
  return page.evaluate(() => (window as typeof window & { __MUGEN_E2E_TRACE__: TestHostTrace }).__MUGEN_E2E_TRACE__)
}

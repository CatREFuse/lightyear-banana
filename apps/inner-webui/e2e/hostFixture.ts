import type { Page } from '@playwright/test'

export async function installTestHost(page: Page) {
  await page.addInitScript(() => {
    const protocol = 'inner-host/v1'
    const sessionId = 'e2e-session'
    const hostNonce = 'e2e-host-nonce'
    const image = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 640 480%22%3E%3Crect width=%22640%22 height=%22480%22 fill=%22%23181818%22/%3E%3Cpath d=%22M170 330c0-112 62-194 150-194s150 82 150 194%22 fill=%22%23f3ead7%22/%3E%3Cpath d=%22M206 176l34-82 58 64m136 18-34-82-58 64%22 fill=%22%23f3ead7%22/%3E%3Ccircle cx=%22275%22 cy=%22260%22 r=%2210%22/%3E%3Ccircle cx=%22365%22 cy=%22260%22 r=%2210%22/%3E%3C/svg%3E'
    const context = {
      ready: true,
      hostVersion: '1.0.0',
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
        'asset.save', 'asset.retain', 'asset.release', 'diagnostics.export', 'storage.clearAll'
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
        baseUrl: 'http://127.0.0.1:38323',
        enabled: true,
        credentialState: 'stored'
      }],
      promptPresets: []
    }
    const assets = new Map<string, Record<string, unknown>>()
    const bridge = window as Window & { uxpHost?: { postMessage(message: unknown): void } }
    const nativePostMessage = window.postMessage.bind(window)

    function envelope(kind: 'response' | 'event', command: string, payload: unknown, messageId: string) {
      return { protocol, kind, command, payload, messageId, sessionId, timestamp: new Date().toISOString() }
    }
    function emit(kind: 'response' | 'event', command: string, payload: unknown, messageId: string) {
      window.dispatchEvent(new MessageEvent('message', {
        data: envelope(kind, command, payload, messageId),
        source: window
      }))
    }
    function asset(assetId: string, source: string, label: string) {
      const value = { assetId, source, label, width: 640, height: 480, previewUrl: image, status: 'available' }
      assets.set(assetId, value)
      return value
    }
    function respond(request: Record<string, any>, payload: unknown) {
      queueMicrotask(() => emit('response', request.command, payload, request.messageId))
    }
    function handle(request: Record<string, any>) {
      switch (request.command) {
        case 'host.handshake':
          respond(request, { sessionId, protocolVersion: 1, clientNonce: request.payload.clientNonce, hostNonce, context })
          return
        case 'host.getContext': respond(request, context); return
        case 'settings.get': respond(request, settings); return
        case 'settings.save': settings = request.payload; respond(request, settings); return
        case 'history.list': respond(request, { items: [] }); return
        case 'history.upsert': respond(request, { entry: { ...request.payload.entry, assets: [] } }); return
        case 'history.clear': respond(request, { cleared: true }); return
        case 'canvas.captureVisible': respond(request, asset('e2e-visible', 'visible', '可见图层')); return
        case 'canvas.captureSelection': respond(request, asset('e2e-selection', 'selection', '选区')); return
        case 'canvas.captureLayer': respond(request, asset('e2e-layer', 'layer', '选择图层')); return
        case 'reference.pickFile': respond(request, asset('e2e-upload', 'upload', '上传图片')); return
        case 'reference.readClipboard': respond(request, asset('e2e-clipboard', 'clipboard', '剪贴板')); return
        case 'asset.retain': respond(request, assets.get(request.payload.assetId)); return
        case 'asset.release': respond(request, { assetId: request.payload.assetId, released: true }); return
        case 'generation.start': {
          const taskId = 'e2e-task'
          respond(request, { taskId })
          setTimeout(() => emit('event', 'generation.progress', { taskId, phase: 'requesting', elapsedSeconds: 1 }, 'e2e-progress'), 20)
          setTimeout(() => emit('event', 'generation.completed', {
            taskId,
            assets: [asset('e2e-result', 'generated', '生成结果 1')],
            logs: [{ id: 'e2e-log', method: 'POST', url: 'http://127.0.0.1:38323/v1/images/generations', status: 200, durationMs: 25, createdAt: new Date().toISOString() }]
          }, 'e2e-completed'), 40)
          return
        }
        case 'generation.cancel': respond(request, { taskId: request.payload.taskId, cancelled: true }); return
        case 'generation.testConfig': respond(request, { ok: true, message: '连接成功' }); return
        case 'canvas.placeAsset': respond(request, { layerName: '无幻生成结果', target: request.payload.target }); return
        case 'asset.save': respond(request, { saved: true, fileName: 'mugen-result.png' }); return
        case 'credential.set': respond(request, { configId: request.payload.configId, credentialState: 'stored' }); return
        case 'credential.remove': respond(request, { configId: request.payload.configId, credentialState: 'missing' }); return
        case 'diagnostics.export': respond(request, { saved: true, fileName: 'mugen-diagnostics.json' }); return
        case 'storage.clearAll': respond(request, { cleared: true, deleted: ['credentials', 'settings', 'history', 'assets', 'diagnostics'] }); return
        case 'host.openReleasePage': respond(request, { opened: true }); return
        default: throw new Error(`Unhandled E2E host command: ${request.command}`)
      }
    }

    Object.defineProperty(window, 'uxpHost', { value: bridge, configurable: true })
    window.postMessage = ((message: unknown, targetOrigin?: string, transfer?: Transferable[]) => {
      if (message && typeof message === 'object' && (message as Record<string, unknown>).protocol === protocol) {
        handle(message as Record<string, any>)
        return
      }
      nativePostMessage(message, targetOrigin ?? '*', transfer ?? [])
    }) as typeof window.postMessage

    const readyTimer = window.setInterval(() => {
      emit('event', 'host.ready', { protocolVersion: 1, hostNonce, hostVersion: '1.0.0' }, `e2e-ready-${Date.now()}`)
    }, 25)
    window.setTimeout(() => window.clearInterval(readyTimer), 3_000)
  })
}

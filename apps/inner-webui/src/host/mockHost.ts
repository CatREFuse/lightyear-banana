import type {
  BridgeError,
  DiagnosticExport,
  GenerationResult,
  GenerationSnapshot,
  HistoryEntry,
  HostAssetPointer,
  HostAssetRef,
  HostClient,
  HostCommand,
  HostCommandPayload,
  HostCommandResult,
  HostContext,
  HostEvent,
  HostEventMap,
  HostEventName,
  HostEventPayload,
  HostRequestOptions,
  ModelConfig,
  PlacementResult,
  PlacementTarget,
  PublicModelConfig,
  TaskEvent
} from '@lightyear-banana/inner-protocol'
import {
  HostClientError,
  PROTOCOL_VERSION,
  createMessageId,
  toModelConfig,
  validateCommandPayload,
  validateCommandResult
} from '@lightyear-banana/inner-protocol'

export type MockHostScenario = 'success' | 'no-document' | 'no-selection' | 'provider-failure' | 'timeout' | 'asset-invalidated' | 'incompatible'
export type MockHostOptions = { scenario?: MockHostScenario; latencyMs?: number }

const colors = ['8b5cf6', 'ec4899', '0ea5e9', 'f97316']
const phaseDelay = 120

function image(label: string, color = colors[Math.floor(Math.random() * colors.length)]) {
  const escaped = label.replace(/[<>&]/g, '')
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#${color}"/><stop offset="1" stop-color="#111827"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="600" cy="145" r="110" fill="white" opacity=".12"/><path d="M0 460 240 300l145 104 126-172 289 228v140H0z" fill="white" opacity=".18"/><text x="40" y="540" fill="white" font-family="Arial" font-size="34" font-weight="bold">${escaped}</text></svg>`)}`
}

function hostError(code: string, message: string, recoverable = true) {
  return new HostClientError({ code, message, recoverable })
}

function publicConfig(config: ModelConfig): PublicModelConfig {
  return { ...config, models: config.models ?? [config.model], credentialState: config.hasCredential ? 'stored' : 'missing' }
}

const defaultConfig: ModelConfig = {
  id: 'openai-default',
  name: 'OpenAI 图像',
  provider: 'openai',
  model: 'gpt-image-2',
  models: ['gpt-image-2'],
  baseUrl: 'https://api.openai.com',
  enabled: true,
  hasCredential: true
}

const defaultContext: HostContext = {
  ready: true,
  hostVersion: '1.0.0',
  photoshopVersion: '27.3.0',
  uxpVersion: '8.1.0',
  platform: 'mock',
  theme: 'dark',
  document: { id: 'mock-document', name: '海报设计.psd', width: 1920, height: 1080 },
  capabilities: [
    'host.getContext', 'settings.get', 'settings.save', 'history.list', 'history.upsert', 'history.clear',
    'credential.set', 'credential.remove', 'canvas.captureVisible', 'canvas.captureSelection',
    'canvas.captureLayer', 'canvas.readSize', 'reference.pickFile', 'reference.readClipboard',
    'generation.start', 'generation.cancel', 'generation.testConfig', 'canvas.placeAsset',
    'asset.save', 'asset.retain', 'asset.release', 'diagnostics.export', 'storage.clearAll'
  ]
}

export class MockHostClient implements HostClient {
  readonly mode = 'mock' as const
  readonly scenario: MockHostScenario
  private readonly latencyMs: number
  private readonly eventListeners = new Map<HostEventName, Set<(payload: never) => void>>()
  private readonly compatibilityListeners = new Set<(event: HostEvent) => void>()
  private readonly timers = new Map<string, Array<ReturnType<typeof setTimeout>>>()
  private readonly taskSnapshots = new Map<string, GenerationSnapshot>()
  private readonly assets = new Map<string, HostAssetRef>()
  private readonly credentials = new Set<string>([defaultConfig.id])
  private readonly history = new Map<string, HistoryEntry>()
  private configs: ModelConfig[] = [{ ...defaultConfig }]
  private activeConfigId = defaultConfig.id
  private sessionId = createMessageId('mock-session')
  private hostNonce = createMessageId('mock-host-nonce')
  private context: HostContext

  constructor(options: MockHostOptions = {}) {
    this.scenario = options.scenario ?? 'success'
    this.latencyMs = Math.max(0, options.latencyMs ?? 0)
    this.context = {
      ...defaultContext,
      document: this.scenario === 'no-document' ? undefined : { ...defaultContext.document! },
      capabilities: [...defaultContext.capabilities]
    }
  }

  handshake(payload: Parameters<HostClient['handshake']>[0]) {
    return this.invoke('host.handshake', payload)
  }

  invoke<TCommand extends HostCommand>(command: TCommand, payload: HostCommandPayload<TCommand>, options: HostRequestOptions = {}): Promise<HostCommandResult<TCommand>> {
    validateCommandPayload(command, payload)
    const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 2_000
    const operation = this.scenario === 'timeout' && command === 'generation.start'
      ? new Promise<unknown>(() => undefined)
      : new Promise<unknown>((resolve, reject) => {
          const run = () => Promise.resolve(this.route(command, payload)).then(resolve, reject)
          if (this.latencyMs) setTimeout(run, this.latencyMs); else run()
        })

    return new Promise<HostCommandResult<TCommand>>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(hostError('REQUEST_CANCELLED', '操作已取消'))
        return
      }
      let settled = false
      const cleanup = () => {
        clearTimeout(timeoutId)
        options.signal?.removeEventListener('abort', onAbort)
      }
      const rejectOnce = (reason: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(reason)
      }
      const timeoutId = setTimeout(() => rejectOnce(hostError('REQUEST_TIMEOUT', '宿主响应超时，请重试')), timeoutMs)
      const onAbort = () => rejectOnce(hostError('REQUEST_CANCELLED', '操作已取消'))
      options.signal?.addEventListener('abort', onAbort, { once: true })
      operation.then(result => {
        if (settled) return
        settled = true
        cleanup()
        try {
          validateCommandResult(command, result)
          resolve(result)
        } catch (reason) {
          reject(reason)
        }
      }, rejectOnce)
    })
  }

  private async route<TCommand extends HostCommand>(command: TCommand, payload: HostCommandPayload<TCommand>): Promise<HostCommandResult<TCommand>> {
    switch (command) {
      case 'host.handshake': {
        const request = payload as HostCommandPayload<'host.handshake'>
        return {
          sessionId: this.sessionId,
          protocolVersion: this.scenario === 'incompatible' ? PROTOCOL_VERSION + 1 : PROTOCOL_VERSION,
          clientNonce: request.clientNonce,
          hostNonce: request.hostNonce ?? this.hostNonce,
          context: this.context
        } as HostCommandResult<TCommand>
      }
      case 'host.getContext': return this.context as HostCommandResult<TCommand>
      case 'host.openReleasePage': return { opened: true } as HostCommandResult<TCommand>
      case 'settings.get': return { activeConfigId: this.activeConfigId, configs: this.configs.map(publicConfig) } as HostCommandResult<TCommand>
      case 'settings.save': {
        const settings = payload as HostCommandPayload<'settings.save'>
        this.configs = settings.configs.map(toModelConfig)
        this.activeConfigId = settings.activeConfigId ?? this.configs.find(config => config.enabled)?.id ?? ''
        return { activeConfigId: this.activeConfigId, configs: this.configs.map(publicConfig) } as HostCommandResult<TCommand>
      }
      case 'history.list': {
        const request = payload as HostCommandPayload<'history.list'>
        const limit = Math.min(100, Math.max(1, request.limit ?? 30))
        return { items: [...this.history.values()].slice(0, limit) } as HostCommandResult<TCommand>
      }
      case 'history.upsert': {
        const { entry } = payload as HostCommandPayload<'history.upsert'>
        const hydrated: HistoryEntry = {
          ...entry,
          assets: entry.assets.map(asset => this.hydrateHistoryAsset(asset)),
          references: entry.references?.map(asset => this.hydrateHistoryAsset(asset))
        }
        this.history.set(entry.id, hydrated)
        return { entry: hydrated } as HostCommandResult<TCommand>
      }
      case 'history.clear':
        for (const taskId of [...this.timers.keys()]) this.stopTimers(taskId)
        this.taskSnapshots.clear()
        this.history.clear()
        return { cleared: true } as HostCommandResult<TCommand>
      case 'credential.set': {
        const request = payload as HostCommandPayload<'credential.set'>
        this.credentials.add(request.configId)
        this.configs = this.configs.map(config => config.id === request.configId ? { ...config, hasCredential: true } : config)
        return { configId: request.configId, credentialState: 'stored' } as HostCommandResult<TCommand>
      }
      case 'credential.remove': {
        const request = payload as HostCommandPayload<'credential.remove'>
        this.credentials.delete(request.configId)
        this.configs = this.configs.map(config => config.id === request.configId ? { ...config, hasCredential: false } : config)
        return { configId: request.configId, credentialState: 'missing' } as HostCommandResult<TCommand>
      }
      case 'canvas.captureVisible': return this.capture('visible', '可见图层') as HostCommandResult<TCommand>
      case 'canvas.captureSelection':
        return (this.scenario === 'no-selection' ? null : this.capture('selection', '当前选区')) as HostCommandResult<TCommand>
      case 'canvas.captureLayer': return this.capture('layer', '当前图层') as HostCommandResult<TCommand>
      case 'canvas.readSize': {
        if (!this.context.document) throw hostError('NO_DOCUMENT', '请先打开 Photoshop 文档')
        return { width: this.context.document.width, height: this.context.document.height } as HostCommandResult<TCommand>
      }
      case 'reference.pickFile': return this.capture('upload', '上传图片') as HostCommandResult<TCommand>
      case 'reference.readClipboard': return this.capture('clipboard', '剪贴板图片') as HostCommandResult<TCommand>
      case 'generation.start': return this.beginGeneration(payload as HostCommandPayload<'generation.start'>) as HostCommandResult<TCommand>
      case 'generation.cancel': {
        const { taskId } = payload as HostCommandPayload<'generation.cancel'>
        this.stopTimers(taskId)
        const snapshot = this.taskSnapshots.get(taskId)
        if (snapshot) this.persistTerminalHistory(taskId, snapshot, 'cancelled')
        this.taskSnapshots.delete(taskId)
        this.emit('generation.progress', { taskId, phase: 'cancelled', elapsedSeconds: 0 })
        return { taskId, cancelled: true } as HostCommandResult<TCommand>
      }
      case 'generation.testConfig': {
        const request = payload as HostCommandPayload<'generation.testConfig'>
        const config = this.configs.find(item => item.id === request.configId)
        const configured = Boolean(config?.name && config.model && (config.provider === 'comfyui' || config.hasCredential || this.credentials.has(config.id)))
        return { ok: configured, message: configured ? '连接成功' : '请填写 API Key' } as HostCommandResult<TCommand>
      }
      case 'canvas.placeAsset': {
        const request = payload as HostCommandPayload<'canvas.placeAsset'>
        this.requireAsset(request.assetId)
        return { layerName: 'Lightyear Banana 生成图', target: request.target } as HostCommandResult<TCommand>
      }
      case 'asset.save': {
        const request = payload as HostCommandPayload<'asset.save'>
        this.requireAsset(request.assetId)
        return { saved: true, fileName: `${request.assetId}.png` } as HostCommandResult<TCommand>
      }
      case 'asset.retain': {
        const request = payload as HostCommandPayload<'asset.retain'>
        return { ...this.requireAsset(request.assetId) } as HostCommandResult<TCommand>
      }
      case 'asset.release': {
        const request = payload as HostCommandPayload<'asset.release'>
        return { assetId: request.assetId, released: true } as HostCommandResult<TCommand>
      }
      case 'diagnostics.export': return { saved: true, fileName: 'lightyear-banana-diagnostics.jsonl' } as HostCommandResult<TCommand>
      case 'storage.clearAll':
        for (const taskId of [...this.timers.keys()]) this.stopTimers(taskId)
        this.taskSnapshots.clear()
        this.credentials.clear()
        this.configs = []
        this.activeConfigId = ''
        this.history.clear()
        this.assets.clear()
        return { cleared: true, deleted: ['credentials', 'settings', 'history', 'assets', 'diagnostics'] } as HostCommandResult<TCommand>
    }
  }

  private capture(source: Exclude<HostAssetRef['source'], 'generated'>, label: string): HostAssetRef {
    if (!this.context.document && source !== 'upload' && source !== 'clipboard') throw hostError('NO_DOCUMENT', '请先打开 Photoshop 文档')
    const previewUrl = image(label)
    const asset: HostAssetRef = {
      assetId: createMessageId('asset'),
      previewUrl,
      thumbnailUrl: previewUrl,
      mimeType: 'image/svg+xml',
      width: 1536,
      height: 1024,
      label,
      source,
      status: 'available',
      sourceBounds: source === 'selection' ? { left: 340, top: 210, right: 1060, bottom: 710, width: 720, height: 500 } : undefined
    }
    this.assets.set(asset.assetId, asset)
    if (this.scenario === 'asset-invalidated') {
      setTimeout(() => {
        this.assets.delete(asset.assetId)
        this.emit('asset.invalidated', { assetId: asset.assetId, reason: '预览资产已过期' })
      }, phaseDelay)
    }
    return asset
  }

  private beginGeneration(snapshot: GenerationSnapshot) {
    const taskId = createMessageId('task')
    this.taskSnapshots.set(taskId, snapshot)
    const phases: Array<TaskEvent['phase']> = ['waiting', 'uploading', 'requesting', 'polling', 'downloading']
    const timers = phases.map((phase, index) => setTimeout(() => {
      this.emit('generation.progress', { taskId, phase, elapsedSeconds: index + 1 })
    }, phaseDelay * (index + 1)))

    timers.push(setTimeout(() => {
      if (this.scenario === 'provider-failure') {
        const error: BridgeError = { code: 'PROVIDER_FAILED', message: 'Provider 暂时不可用', recoverable: true }
        this.persistTerminalHistory(taskId, snapshot, 'failed', [], [], error.message)
        this.taskSnapshots.delete(taskId)
        this.emit('generation.progress', { taskId, phase: 'failed', elapsedSeconds: phases.length + 1 })
        this.emit('generation.failed', { taskId, error })
        return
      }
      const assets = Array.from({ length: snapshot.count }, (_, index) => this.captureGenerated(`生成结果 ${index + 1}`))
      const result: GenerationResult = {
        taskId,
        assets,
        logs: [{ id: createMessageId('log'), method: 'POST', url: 'https://api.example.com/images', status: 200, durationMs: 2800, createdAt: new Date().toISOString() }]
      }
      this.persistTerminalHistory(taskId, snapshot, 'completed', assets, result.logs)
      this.taskSnapshots.delete(taskId)
      this.emit('generation.progress', { taskId, phase: 'completed', elapsedSeconds: phases.length + 1, message: '已完成' })
      this.emit('generation.completed', result)
    }, phaseDelay * (phases.length + 1)))
    this.timers.set(taskId, timers)
    return { taskId }
  }

  private persistTerminalHistory(
    taskId: string,
    snapshot: GenerationSnapshot,
    status: 'completed' | 'failed' | 'cancelled',
    assets: HostAssetRef[] = [],
    logs: GenerationResult['logs'] = [],
    error?: string
  ) {
    this.history.set(taskId, {
      id: taskId,
      updatedAt: new Date().toISOString(),
      prompt: snapshot.prompt,
      assets: assets.map((asset) => ({ ...asset })),
      references: snapshot.references.map((asset) => this.hydrateHistoryAsset(asset)),
      snapshot,
      logs,
      status,
      elapsedSeconds: 0,
      ...(error ? { error } : {})
    })
  }

  private captureGenerated(label: string) {
    const previewUrl = image(label)
    const asset: HostAssetRef = { assetId: createMessageId('result'), previewUrl, thumbnailUrl: previewUrl, mimeType: 'image/svg+xml', width: 1536, height: 1024, label, source: 'generated', status: 'available' }
    this.assets.set(asset.assetId, asset)
    return asset
  }

  private requireAsset(assetId: string) {
    const asset = this.assets.get(assetId)
    if (!asset) throw hostError('ASSET_INVALID', '图片已失效，请重新生成')
    return asset
  }

  private hydrateHistoryAsset(pointer: HostAssetPointer): HostAssetRef {
    const asset = this.assets.get(pointer.assetId)
    if (asset) return { ...asset }
    const previewUrl = image(pointer.label)
    return { ...pointer, previewUrl, thumbnailUrl: previewUrl, status: 'missing' }
  }

  private stopTimers(taskId: string) {
    this.timers.get(taskId)?.forEach(timer => clearTimeout(timer))
    this.timers.delete(taskId)
  }

  private emit<TEvent extends HostEventName>(event: TEvent, payload: HostEventPayload<TEvent>) {
    this.eventListeners.get(event)?.forEach(listener => listener(payload as never))
    let compatibilityEvent: HostEvent | undefined
    if (event === 'host.contextChanged') compatibilityEvent = { type: 'contextChanged', context: payload as HostEventMap['host.contextChanged'] }
    if (event === 'generation.progress') compatibilityEvent = { type: 'taskProgress', event: payload as HostEventMap['generation.progress'] }
    if (event === 'generation.completed') compatibilityEvent = { type: 'generationCompleted', result: payload as HostEventMap['generation.completed'] }
    if (event === 'generation.failed') {
      const failed = payload as HostEventMap['generation.failed']
      compatibilityEvent = { type: 'generationFailed', taskId: failed.taskId, error: failed.error }
    }
    if (event === 'asset.invalidated') compatibilityEvent = { type: 'assetInvalidated', ...(payload as HostEventMap['asset.invalidated']) }
    if (event === 'diagnostics.notice') compatibilityEvent = { type: 'diagnosticsNotice', ...(payload as HostEventMap['diagnostics.notice']) }
    if (compatibilityEvent) this.compatibilityListeners.forEach(listener => listener(compatibilityEvent as HostEvent))
    if (event === 'generation.completed' && typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('inner-host-result', { detail: payload }))
    }
  }

  on<TEvent extends HostEventName>(event: TEvent, listener: (payload: HostEventPayload<TEvent>) => void) {
    const listeners = this.eventListeners.get(event) ?? new Set<(payload: never) => void>()
    listeners.add(listener as (payload: never) => void)
    this.eventListeners.set(event, listeners)
    return () => listeners.delete(listener as (payload: never) => void)
  }

  getContext() { return this.invoke('host.getContext', undefined) }
  captureReference(source: Parameters<HostClient['captureReference']>[0]) {
    if (source === 'upload') return this.invoke('reference.pickFile', undefined)
    if (source === 'clipboard') return this.invoke('reference.readClipboard', undefined)
    const command = `canvas.capture${source[0].toUpperCase()}${source.slice(1)}` as 'canvas.captureVisible' | 'canvas.captureSelection' | 'canvas.captureLayer'
    return this.invoke(command, undefined)
  }
  startGeneration(snapshot: GenerationSnapshot) { return this.invoke('generation.start', snapshot) }
  async cancelGeneration(taskId: string) { await this.invoke('generation.cancel', { taskId }) }
  async placeAsset(assetId: string, target: PlacementTarget): Promise<PlacementResult> { return this.invoke('canvas.placeAsset', { assetId, target }) }
  saveAsset(assetId: string) { return this.invoke('asset.save', { assetId }) }
  async getConfigs() { const settings = await this.invoke('settings.get', undefined); return settings.configs.map(toModelConfig) }
  async saveConfig(config: ModelConfig, apiKey?: string) {
    const settings = await this.invoke('settings.get', undefined)
    const next = { ...config, id: config.id || createMessageId('config') }
    const value = publicConfig(next)
    const index = settings.configs.findIndex(item => item.id === next.id)
    if (index >= 0) settings.configs.splice(index, 1, value); else settings.configs.push(value)
    await this.invoke('settings.save', { activeConfigId: next.enabled ? next.id : settings.activeConfigId, configs: settings.configs })
    if (apiKey) await this.invoke('credential.set', { configId: next.id, apiKey })
    return { ...next, hasCredential: next.hasCredential || Boolean(apiKey) }
  }
  async deleteConfig(configId: string) {
    const settings = await this.invoke('settings.get', undefined)
    const configs = settings.configs.filter(config => config.id !== configId)
    await this.invoke('settings.save', { activeConfigId: settings.activeConfigId === configId ? configs.find(config => config.enabled)?.id : settings.activeConfigId, configs })
    await this.invoke('credential.remove', { configId })
  }
  async testConfig(config: ModelConfig, apiKey?: string) {
    const saved = await this.saveConfig({ ...config, id: config.id || createMessageId('config') }, apiKey)
    return this.invoke('generation.testConfig', { configId: saved.id })
  }
  async clearHistory() { await this.invoke('history.clear', undefined) }
  exportDiagnostics(): Promise<DiagnosticExport> { return this.invoke('diagnostics.export', undefined) }
  clearLocalData() { return this.invoke('storage.clearAll', undefined) }
  onEvent(listener: (event: HostEvent) => void) { this.compatibilityListeners.add(listener); return () => this.compatibilityListeners.delete(listener) }

  dispose() {
    this.timers.forEach(timers => timers.forEach(timer => clearTimeout(timer)))
    this.timers.clear()
    this.eventListeners.clear()
    this.compatibilityListeners.clear()
  }
}

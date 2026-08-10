import type {
  BridgeEnvelope,
  Handshake,
  HandshakeResult,
  HostClient,
  HostCommand,
  HostCommandPayload,
  HostCommandResult,
  HostEvent,
  HostEventMap,
  HostEventName,
  HostEventPayload,
  HostReady,
  HostRequestOptions,
  ModelConfig,
  PublicModelConfig
} from '@lightyear-banana/inner-protocol'
import {
  BridgeValidationError,
  HostClientError,
  PROTOCOL_VERSION,
  assertMessageSize,
  createMessageId,
  createRequestEnvelope,
  isProtocolCompatible,
  parseBridgeEnvelope,
  toModelConfig,
  toWebUiAssetRef,
  validateCommandResult,
  validateHostEventPayload
} from '@lightyear-banana/inner-protocol'

export type UxpHostBridge = { postMessage(message: unknown): void }

declare global {
  interface Window {
    uxpHost?: UxpHostBridge
  }
}

type ReadyState = { sessionId: string; payload: HostReady }
type PendingRequest = {
  command: HostCommand
  sessionId: string
  resolve(value: unknown): void
  reject(reason: Error): void
  timeoutId: ReturnType<typeof setTimeout>
  detachAbort?: () => void
}
type ReadyWaiter = { resolve(value: ReadyState): void; reject(reason: Error): void; timeoutId: ReturnType<typeof setTimeout> }

const DEFAULT_TIMEOUT_MS = 12_000
const READY_TIMEOUT_MS = 12_000

function clientError(code: string, message: string, recoverable = true) {
  return new HostClientError({ code, message, recoverable })
}

function incomingPayload(data: unknown): unknown {
  if (typeof data !== 'string') return data
  assertMessageSize(data)
  try {
    return JSON.parse(data)
  } catch {
    throw new BridgeValidationError('INVALID_MESSAGE', '宿主消息格式无效')
  }
}

function normalizeResult<TCommand extends HostCommand>(command: TCommand, payload: HostCommandResult<TCommand>): HostCommandResult<TCommand> {
  if (['canvas.captureVisible', 'canvas.captureSelection', 'canvas.captureLayer', 'reference.pickFile', 'reference.readClipboard'].includes(command)) {
    return (payload ? toWebUiAssetRef(payload as never) : null) as HostCommandResult<TCommand>
  }
  return payload
}

export class WebViewHostClient implements HostClient {
  readonly mode = 'webview' as const
  private readonly pending = new Map<string, PendingRequest>()
  private readonly readyWaiters = new Set<ReadyWaiter>()
  private readonly eventListeners = new Map<HostEventName, Set<(payload: never) => void>>()
  private readonly compatibilityListeners = new Set<(event: HostEvent) => void>()
  private readyState?: ReadyState
  private establishedSessionId?: string
  private disposed = false

  constructor(private readonly host: UxpHostBridge = window.uxpHost as UxpHostBridge) {
    if (!host || typeof host.postMessage !== 'function') throw clientError('HOST_UNAVAILABLE', 'Photoshop 宿主暂时不可用')
    window.addEventListener('message', this.handleMessage)
  }

  private handleMessage = (event: MessageEvent) => {
    if (this.disposed) return
    if (event.source !== (this.host as unknown as MessageEventSource)) return

    let envelope: BridgeEnvelope
    try {
      envelope = parseBridgeEnvelope(incomingPayload(event.data))
    } catch {
      return
    }

    if (envelope.kind === 'event' && envelope.command === 'host.ready') {
      this.acceptReady(envelope)
      return
    }

    if (!this.readyState || envelope.sessionId !== this.readyState.sessionId) return
    if (envelope.kind === 'response') this.acceptResponse(envelope)
    if (envelope.kind === 'event' && this.establishedSessionId === envelope.sessionId) this.acceptEvent(envelope)
  }

  private acceptReady(envelope: BridgeEnvelope) {
    try {
      validateHostEventPayload('host.ready', envelope.payload)
    } catch {
      return
    }
    if (!envelope.sessionId) return
    const next = { sessionId: envelope.sessionId, payload: envelope.payload }
    const changed = !this.readyState || this.readyState.sessionId !== next.sessionId || this.readyState.payload.hostNonce !== next.payload.hostNonce
    if (changed) {
      this.rejectPending(clientError('SESSION_REPLACED', 'Photoshop 宿主已重新连接'))
      this.establishedSessionId = undefined
    }
    this.readyState = next
    for (const waiter of this.readyWaiters) {
      clearTimeout(waiter.timeoutId)
      waiter.resolve(next)
    }
    this.readyWaiters.clear()
    this.emit('host.ready', next.payload)
  }

  private acceptResponse(envelope: BridgeEnvelope) {
    const pending = this.pending.get(envelope.messageId)
    if (!pending || pending.sessionId !== envelope.sessionId || pending.command !== envelope.command) return
    this.finishPending(envelope.messageId)
    if (envelope.error) {
      pending.reject(new HostClientError(envelope.error))
      return
    }
    try {
      validateCommandResult(pending.command, envelope.payload)
      pending.resolve(normalizeResult(pending.command, envelope.payload as never))
    } catch (reason) {
      pending.reject(reason instanceof Error ? reason : clientError('INVALID_RESPONSE', '宿主响应无效', false))
    }
  }

  private acceptEvent(envelope: BridgeEnvelope) {
    const eventName = envelope.command as HostEventName
    try {
      validateHostEventPayload(eventName, envelope.payload)
    } catch {
      return
    }
    let payload = envelope.payload as HostEventMap[HostEventName]
    if (eventName === 'generation.completed') {
      const result = payload as HostEventMap['generation.completed']
      payload = { ...result, assets: result.assets.map(toWebUiAssetRef) }
    }
    this.emit(eventName, payload as never)
    this.emitCompatibility(eventName, payload)
  }

  private emit<TEvent extends HostEventName>(event: TEvent, payload: HostEventPayload<TEvent>) {
    this.eventListeners.get(event)?.forEach(listener => listener(payload as never))
  }

  private emitCompatibility(event: HostEventName, payload: HostEventMap[HostEventName]) {
    let compatibilityEvent: HostEvent | undefined
    if (event === 'host.contextChanged') compatibilityEvent = { type: 'contextChanged', context: payload as HostEventMap['host.contextChanged'] }
    if (event === 'generation.progress') compatibilityEvent = { type: 'taskProgress', event: payload as HostEventMap['generation.progress'] }
    if (event === 'generation.completed') compatibilityEvent = { type: 'generationCompleted', result: payload as HostEventMap['generation.completed'] }
    if (event === 'generation.failed') {
      const failed = payload as HostEventMap['generation.failed']
      compatibilityEvent = { type: 'generationFailed', taskId: failed.taskId, error: failed.error }
    }
    if (event === 'asset.invalidated') {
      const invalidated = payload as HostEventMap['asset.invalidated']
      compatibilityEvent = { type: 'assetInvalidated', ...invalidated }
    }
    if (event === 'diagnostics.notice') compatibilityEvent = { type: 'diagnosticsNotice', ...(payload as HostEventMap['diagnostics.notice']) }
    if (!compatibilityEvent) return
    this.compatibilityListeners.forEach(listener => listener(compatibilityEvent as HostEvent))
    if (compatibilityEvent.type === 'generationCompleted') {
      window.dispatchEvent(new CustomEvent('inner-host-result', { detail: compatibilityEvent.result }))
    }
  }

  private waitForReady(timeoutMs = READY_TIMEOUT_MS): Promise<ReadyState> {
    if (this.readyState) return Promise.resolve(this.readyState)
    return new Promise((resolve, reject) => {
      const waiter: ReadyWaiter = {
        resolve,
        reject,
        timeoutId: setTimeout(() => {
          this.readyWaiters.delete(waiter)
          reject(clientError('HOST_READY_TIMEOUT', 'Photoshop 宿主启动超时'))
        }, timeoutMs)
      }
      this.readyWaiters.add(waiter)
    })
  }

  private sendRequest<TCommand extends HostCommand>(command: TCommand, payload: HostCommandPayload<TCommand>, sessionId: string, options: HostRequestOptions = {}): Promise<HostCommandResult<TCommand>> {
    if (this.disposed) return Promise.reject(clientError('CLIENT_DISPOSED', '宿主连接已关闭', false))
    if (options.signal?.aborted) return Promise.reject(clientError('REQUEST_CANCELLED', '操作已取消'))
    const envelope = createRequestEnvelope({ command, sessionId, payload })
    const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS

    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        command,
        sessionId,
        resolve,
        reject,
        timeoutId: setTimeout(() => {
          this.finishPending(envelope.messageId)
          reject(clientError('REQUEST_TIMEOUT', '宿主响应超时，请重试'))
        }, timeoutMs)
      }
      if (options.signal) {
        const onAbort = () => {
          const active = this.pending.get(envelope.messageId)
          if (!active) return
          this.finishPending(envelope.messageId)
          reject(clientError('REQUEST_CANCELLED', '操作已取消'))
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
        pending.detachAbort = () => options.signal?.removeEventListener('abort', onAbort)
      }
      this.pending.set(envelope.messageId, pending)
      try {
        this.host.postMessage(envelope)
      } catch (reason) {
        this.finishPending(envelope.messageId)
        reject(reason instanceof Error ? reason : clientError('POST_MESSAGE_FAILED', '无法发送宿主请求'))
      }
    })
  }

  private finishPending(messageId: string) {
    const pending = this.pending.get(messageId)
    if (!pending) return
    clearTimeout(pending.timeoutId)
    pending.detachAbort?.()
    this.pending.delete(messageId)
  }

  private rejectPending(reason: Error) {
    for (const [messageId, pending] of this.pending) {
      this.finishPending(messageId)
      pending.reject(reason)
    }
  }

  async handshake(payload: Handshake): Promise<HandshakeResult> {
    const ready = await this.waitForReady()
    if (!isProtocolCompatible(ready.payload.protocolVersion)) throw clientError('UNSUPPORTED_PROTOCOL', 'Lightyear Banana 插件需要更新', false)
    const request = { ...payload, hostNonce: ready.payload.hostNonce }
    const result = await this.sendRequest('host.handshake', request, ready.sessionId)
    if (result.sessionId !== ready.sessionId || result.clientNonce !== payload.clientNonce || result.hostNonce !== ready.payload.hostNonce) {
      this.establishedSessionId = undefined
      throw clientError('HANDSHAKE_MISMATCH', '宿主会话验证失败', false)
    }
    if (!isProtocolCompatible(result.protocolVersion)) throw clientError('UNSUPPORTED_PROTOCOL', 'Lightyear Banana 插件需要更新', false)
    this.establishedSessionId = result.sessionId
    return result
  }

  invoke<TCommand extends HostCommand>(command: TCommand, payload: HostCommandPayload<TCommand>, options?: HostRequestOptions): Promise<HostCommandResult<TCommand>> {
    if (command === 'host.handshake') return this.handshake(payload as Handshake) as Promise<HostCommandResult<TCommand>>
    if (!this.establishedSessionId) return Promise.reject(clientError('HANDSHAKE_REQUIRED', '正在连接 Photoshop 宿主'))
    return this.sendRequest(command, payload, this.establishedSessionId, options)
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
  startGeneration(snapshot: Parameters<HostClient['startGeneration']>[0]) { return this.invoke('generation.start', snapshot) }
  async cancelGeneration(taskId: string) { await this.invoke('generation.cancel', { taskId }) }
  placeAsset(assetId: string, target: Parameters<HostClient['placeAsset']>[1]) { return this.invoke('canvas.placeAsset', { assetId, target }) }
  saveAsset(assetId: string) { return this.invoke('asset.save', { assetId }) }
  async getConfigs() { const settings = await this.invoke('settings.get', undefined); return settings.configs.map(toModelConfig) }
  async saveConfig(config: ModelConfig, apiKey?: string) {
    const settings = await this.invoke('settings.get', undefined)
    const publicConfig: PublicModelConfig = { ...config, models: config.models ?? [config.model], credentialState: config.hasCredential || apiKey ? 'stored' : 'missing' }
    const index = settings.configs.findIndex(item => item.id === config.id)
    if (index >= 0) settings.configs.splice(index, 1, publicConfig); else settings.configs.push(publicConfig)
    const saved = await this.invoke('settings.save', { ...settings, activeConfigId: config.enabled ? config.id : settings.activeConfigId })
    if (apiKey) await this.invoke('credential.set', { configId: config.id, apiKey })
    const result = saved.configs.find(item => item.id === config.id) ?? publicConfig
    return toModelConfig({ ...result, credentialState: apiKey ? 'stored' : result.credentialState })
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
  exportDiagnostics() { return this.invoke('diagnostics.export', undefined) }
  clearLocalData() { return this.invoke('storage.clearAll', undefined) }
  onEvent(listener: (event: HostEvent) => void) { this.compatibilityListeners.add(listener); return () => this.compatibilityListeners.delete(listener) }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    window.removeEventListener('message', this.handleMessage)
    this.rejectPending(clientError('CLIENT_DISPOSED', '宿主连接已关闭', false))
    for (const waiter of this.readyWaiters) {
      clearTimeout(waiter.timeoutId)
      waiter.reject(clientError('CLIENT_DISPOSED', '宿主连接已关闭', false))
    }
    this.readyWaiters.clear()
    this.eventListeners.clear()
    this.compatibilityListeners.clear()
  }
}

export function hasUxpHost(value: Window = window): boolean {
  return Boolean(value.uxpHost && typeof value.uxpHost.postMessage === 'function')
}

export { PROTOCOL_VERSION }

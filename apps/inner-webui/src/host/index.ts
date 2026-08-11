import type { DiagnosticExport, Handshake, HandshakeResult, HostAssetRef, HostClient, HostCommand, HostCommandPayload, HostCommandResult, HostContext, HostEvent, HostEventName, HostEventPayload, HostRequestOptions, LocalDataClearResult, ModelConfig, PlacementResult, PlacementTarget, ReferenceSource } from '@mugen/inner-protocol'
import { HostClientError } from '@mugen/inner-protocol'
import { WebViewHostClient, hasUxpHost } from './webviewHost'

export function expectsUxpHost(search: string): boolean {
  return new URLSearchParams(search).get('host') === 'uxp'
}

export type WebUiRuntime = 'browser' | 'embedded'

export function resolveWebUiRuntime(value: Window = window): WebUiRuntime {
  return hasUxpHost(value) || expectsUxpHost(value.location.search) ? 'embedded' : 'browser'
}

class UnavailableHostClient implements HostClient {
  readonly mode = 'unavailable' as const
  private reject<T>(): Promise<T> { return Promise.reject(new HostClientError({ code: 'HOST_UNAVAILABLE', message: '请在 Photoshop 的无幻插件中打开', recoverable: false })) }
  handshake(_payload: Handshake): Promise<HandshakeResult> { return this.reject() }
  invoke<TCommand extends HostCommand>(_command: TCommand, _payload: HostCommandPayload<TCommand>, _options?: HostRequestOptions): Promise<HostCommandResult<TCommand>> { return this.reject() }
  on<TEvent extends HostEventName>(_event: TEvent, _listener: (payload: HostEventPayload<TEvent>) => void) { return () => undefined }
  getContext(): Promise<HostContext> { return this.reject() }
  captureReference(_source: Exclude<ReferenceSource, 'generated'>): Promise<HostAssetRef | null> { return this.reject() }
  startGeneration(_snapshot: Parameters<HostClient['startGeneration']>[0]): Promise<{ taskId: string }> { return this.reject() }
  cancelGeneration(_taskId: string): Promise<void> { return this.reject() }
  placeAsset(_assetId: string, _target: PlacementTarget): Promise<PlacementResult> { return this.reject() }
  saveAsset(_assetId: string): Promise<{ saved: boolean; fileName?: string }> { return this.reject() }
  getConfigs(): Promise<ModelConfig[]> { return this.reject() }
  saveConfig(_config: ModelConfig, _apiKey?: string): Promise<ModelConfig> { return this.reject() }
  deleteConfig(_configId: string): Promise<void> { return this.reject() }
  testConfig(_config: ModelConfig, _apiKey?: string): Promise<{ ok: boolean; message: string }> { return this.reject() }
  clearHistory(): Promise<void> { return this.reject() }
  exportDiagnostics(): Promise<DiagnosticExport> { return this.reject() }
  clearLocalData(): Promise<LocalDataClearResult> { return this.reject() }
  onEvent(_listener: (event: HostEvent) => void) { return () => undefined }
}

export function createHostClient(value: Window = window): HostClient {
  if (hasUxpHost(value)) return new WebViewHostClient(value.uxpHost)
  return new UnavailableHostClient()
}

export { WebViewHostClient, hasUxpHost }

import type { DiagnosticExport, Handshake, HandshakeResult, HostAssetRef, HostClient, HostCommand, HostCommandPayload, HostCommandResult, HostContext, HostEvent, HostEventName, HostEventPayload, HostRequestOptions, LocalDataClearResult, ModelConfig, PlacementResult, PlacementTarget, ReferenceSource } from '@lightyear-banana/inner-protocol'
import { HostClientError } from '@lightyear-banana/inner-protocol'
import { MockHostClient, type MockHostScenario } from './mockHost'
import { WebViewHostClient, hasUxpHost } from './webviewHost'

const mockScenarios = new Set<MockHostScenario>(['success', 'no-document', 'no-selection', 'provider-failure', 'timeout', 'asset-invalidated', 'incompatible'])

export function requestedMockScenario(search: string): MockHostScenario | null {
  const value = new URLSearchParams(search).get('mock')
  return value && mockScenarios.has(value as MockHostScenario) ? value as MockHostScenario : null
}

export function expectsUxpHost(search: string): boolean {
  return new URLSearchParams(search).get('host') === 'uxp'
}

class UnavailableHostClient implements HostClient {
  readonly mode = 'unavailable' as const
  private reject<T>(): Promise<T> { return Promise.reject(new HostClientError({ code: 'HOST_UNAVAILABLE', message: '请在 Photoshop 的 Lightyear Banana 插件中打开', recoverable: false })) }
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

export function createHostClient(): HostClient {
  if (hasUxpHost()) return new WebViewHostClient()
  const scenario = requestedMockScenario(window.location.search)
  if (expectsUxpHost(window.location.search)) return new UnavailableHostClient()
  return new MockHostClient({ scenario: scenario ?? 'success' })
}

export { MockHostClient, WebViewHostClient, hasUxpHost }
export type { MockHostScenario }

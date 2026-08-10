import { describe, expect, it } from 'vitest'
import {
  INNER_HOST_PROTOCOL,
  MAX_BRIDGE_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  createRequestEnvelope,
  isBridgeEnvelope,
  isHostEvent,
  isGenerationSnapshot,
  isProtocolCompatible,
  parseBridgeEnvelope,
  serializedMessageSize,
  toHostAssetPointer,
  validateCommandPayload,
  validateCommandResult,
  validateHostEventPayload
} from './index'
import { providerCapabilities, providerUsesApiKey, readProviderCapability } from './providerCapabilities'

const context = {
  ready: true,
  hostVersion: '1.0.0',
  photoshopVersion: '27.0.0',
  platform: 'mock' as const,
  theme: 'dark' as const,
  capabilities: ['host.getContext']
}

describe('inner-host/v1 envelope', () => {
  it('creates a versioned request with a timestamp and session', () => {
    const envelope = createRequestEnvelope({ command: 'host.getContext', sessionId: 'session-1', payload: undefined })
    expect(envelope).toMatchObject({ protocol: INNER_HOST_PROTOCOL, kind: 'request', sessionId: 'session-1', command: 'host.getContext' })
    expect(isBridgeEnvelope(envelope, 'request')).toBe(true)
  })

  it('rejects unknown commands and messages over 1 MB', () => {
    const base = { protocol: INNER_HOST_PROTOCOL, kind: 'request', messageId: 'm1', sessionId: 's1', timestamp: new Date().toISOString() }
    expect(() => parseBridgeEnvelope({ ...base, command: 'host.unknown' })).toThrow('宿主命令无效')
    expect(() => parseBridgeEnvelope({ ...base, command: 'settings.save', payload: { value: 'x'.repeat(MAX_BRIDGE_MESSAGE_BYTES) } })).toThrow('1 MB')
  })

  it('validates handshake nonce and session confirmations', () => {
    expect(() => validateCommandResult('host.handshake', {
      sessionId: 'session-1', protocolVersion: PROTOCOL_VERSION, clientNonce: 'client-1', hostNonce: 'host-1', context
    })).not.toThrow()
    expect(() => validateCommandResult('host.handshake', {
      sessionId: 'session-1', protocolVersion: PROTOCOL_VERSION, clientNonce: 'client-1', context
    })).toThrow('握手')
  })

  it('validates all event payloads before delivery', () => {
    expect(() => validateHostEventPayload('host.ready', { protocolVersion: PROTOCOL_VERSION, hostNonce: 'host-1' })).not.toThrow()
    expect(() => validateHostEventPayload('generation.progress', { taskId: 'task-1', phase: 'requesting', elapsedSeconds: 2 })).not.toThrow()
    expect(() => validateHostEventPayload('generation.progress', { taskId: 'task-1', phase: 'unknown', elapsedSeconds: 2 })).toThrow('进度')
  })

  it('keeps credentials in their dedicated command', () => {
    expect(() => validateCommandPayload('credential.set', { configId: 'config-1', apiKey: 'secret' })).not.toThrow()
    expect(() => validateCommandPayload('generation.testConfig', { configId: 'config-1' })).not.toThrow()
    expect(() => validateCommandPayload('generation.testConfig', { config: {}, apiKey: 'secret' })).toThrow('配置测试')
  })

  it('validates workspace asset ownership without accepting preview data in the request', () => {
    expect(() => validateCommandPayload('asset.retain', { assetId: 'asset-1' })).not.toThrow()
    expect(() => validateCommandPayload('asset.retain', { assetId: '' })).toThrow('asset.retain')
    expect(() => validateCommandResult('asset.retain', {
      assetId: 'asset-1', label: '参考图', source: 'upload', width: 256, height: 256,
      previewUrl: 'data:image/png;base64,AQID', status: 'available'
    })).not.toThrow()
  })

  it('whitelists clear-all as a parameterless command with a closed result shape', () => {
    expect(() => createRequestEnvelope({ command: 'storage.clearAll', sessionId: 'session-1', payload: undefined })).not.toThrow()
    expect(() => validateCommandPayload('storage.clearAll', { confirm: true })).toThrow('不接受参数')
    expect(() => validateCommandResult('storage.clearAll', {
      cleared: true,
      deleted: ['credentials', 'settings', 'history', 'assets', 'diagnostics']
    })).not.toThrow()
    expect(() => validateCommandResult('storage.clearAll', { cleared: true, deleted: ['cookies'] })).toThrow('清理响应')
  })
})

describe('compatibility helpers', () => {
  it('accepts only the current major protocol', () => {
    expect(isProtocolCompatible(PROTOCOL_VERSION)).toBe(true)
    expect(isProtocolCompatible(PROTOCOL_VERSION + 1)).toBe(false)
  })

  it('checks compatibility events with their payloads', () => {
    expect(isHostEvent({ type: 'contextChanged', context })).toBe(true)
    expect(isHostEvent({ type: 'taskProgress', event: { taskId: 'task-1', phase: 'requesting', elapsedSeconds: 1 } })).toBe(true)
    expect(isHostEvent({ type: 'taskProgress', event: { phase: 'requesting' } })).toBe(false)
  })
})

describe('generation and provider contracts', () => {
  const snapshot = {
    configId: 'openai-default',
    prompt: '一张海报',
    references: [],
    size: '1024x1024',
    quality: 'high',
    count: 1,
    ratio: '1:1',
    submittedAt: new Date().toISOString()
  }

  it('validates generation snapshots and structured history metadata', () => {
    expect(isGenerationSnapshot(snapshot)).toBe(true)
    expect(isGenerationSnapshot({ ...snapshot, count: 0 })).toBe(false)
    expect(() => validateCommandPayload('history.upsert', {
      entry: {
        id: 'task-1',
        updatedAt: new Date().toISOString(),
        prompt: snapshot.prompt,
        assets: [],
        snapshot,
        logs: [],
        status: 'completed',
        elapsedSeconds: 4
      }
    })).not.toThrow()
    expect(() => validateCommandPayload('history.upsert', {
      entry: { id: 'task-1', updatedAt: new Date().toISOString(), prompt: snapshot.prompt, assets: [], snapshot: { ...snapshot, count: 0 } }
    })).toThrow('历史记录')
  })

  it('keeps generation and history requests free of bridge thumbnails', () => {
    const fullAsset = {
      assetId: 'asset-1', label: '参考图', source: 'visible' as const, width: 1024, height: 1024,
      previewUrl: `data:image/jpeg;base64,${'a'.repeat(500_000)}`,
      thumbnailUrl: `data:image/jpeg;base64,${'a'.repeat(500_000)}`
    }
    const pointer = toHostAssetPointer(fullAsset)
    expect(pointer).not.toHaveProperty('previewUrl')
    expect(pointer).not.toHaveProperty('thumbnailUrl')
    expect(serializedMessageSize({ ...snapshot, references: Array.from({ length: 16 }, () => pointer) })).toBeLessThan(20_000)
    expect(() => validateCommandPayload('generation.start', { ...snapshot, references: [fullAsset] })).toThrow('生成参数')
    expect(() => validateCommandPayload('generation.start', { ...snapshot, references: [pointer] })).not.toThrow()
  })

  it('declares every supported provider and applies model-specific limits', () => {
    expect(Object.keys(providerCapabilities)).toHaveLength(11)
    expect(readProviderCapability({ provider: 'iMini', model: 'google/nano-banana' }).referenceLimit).toBe(3)
    expect(readProviderCapability({ provider: 'kling', model: 'kling/kling-v3-image-generation' }).referenceLimit).toBe(1)
    expect(readProviderCapability({ provider: 'custom-openai', model: 'custom', customFormat: 'gemini' }).id).toBe('custom-openai')
    expect(providerUsesApiKey('openai')).toBe(true)
    expect(providerUsesApiKey('comfyui')).toBe(false)
  })

  it('rejects unknown providers in public settings', () => {
    const config = {
      id: 'config-1', name: '配置', provider: 'unknown', model: 'model', baseUrl: 'https://example.com', enabled: true, credentialState: 'stored'
    }
    expect(() => validateCommandPayload('settings.save', { configs: [config], activeConfigId: config.id })).toThrow('设置参数')
    expect(() => validateCommandPayload('settings.save', { configs: [{ ...config, provider: 'openai', baseUrl: 'file:///tmp/key' }], activeConfigId: config.id })).toThrow('设置参数')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicModelConfig } from '../../../packages/inner-protocol/src/index'

type MemoryFile = {
  read: () => Promise<string>
  write: (value: string) => Promise<void>
  delete: () => Promise<void>
}

const runtime = vi.hoisted(() => ({
  settings: undefined as string | undefined,
  credentials: new Map<string, Uint8Array>(),
  failRemove: false
}))

vi.mock('../photoshopHost', () => ({
  getHostRequire: () => (name: string) => {
    if (name !== 'uxp') throw new Error('unexpected module')
    const file: MemoryFile = {
      read: async () => {
        if (runtime.settings === undefined) throw new Error('missing')
        return runtime.settings
      },
      write: async (value) => {
        runtime.settings = value
      },
      delete: async () => {
        runtime.settings = undefined
      }
    }
    return {
      storage: {
        secureStorage: {
          getItem: async (key: string) => {
            const value = runtime.credentials.get(key)
            return value ? new Uint8Array(value) : undefined
          },
          setItem: async (key: string, value: Uint8Array) => {
            runtime.credentials.set(key, new Uint8Array(value))
          },
          removeItem: async (key: string) => {
            if (runtime.failRemove) throw new Error('secure storage unavailable')
            runtime.credentials.delete(key)
          }
        },
        localFileSystem: {
          getDataFolder: async () => ({
            getEntry: async () => file,
            createFile: async () => file
          })
        }
      }
    }
  }
}))

import {
  clearAllSettingsAndCredentials,
  getCredential,
  getSettings,
  resolveCredentialBinding,
  saveSettings,
  setCredential
} from './storage'

type ConfigInput = Omit<PublicModelConfig, 'credentialState' | 'hasCredential'>

function config(overrides: Partial<ConfigInput> = {}): ConfigInput {
  return {
    id: 'config-1',
    name: '模型配置',
    provider: 'custom-openai',
    model: 'image-model',
    models: ['image-model'],
    baseUrl: 'https://api.first-provider.dev/v1',
    enabled: true,
    ...overrides
  }
}

async function save(single: ConfigInput) {
  return saveSettings({ activeConfigId: single.id, configs: [single] })
}

describe('BYOK credential binding', () => {
  beforeEach(() => {
    runtime.settings = undefined
    runtime.credentials.clear()
    runtime.failRemove = false
  })

  it('clears a credential before the same config ID moves to a new origin', async () => {
    await save(config())
    await setCredential({ configId: 'config-1', apiKey: 'old-secret' })
    expect((await getSettings()).configs[0]?.credentialState).toBe('stored')

    const changed = await save(config({ baseUrl: 'https://api.second-provider.dev/v1' }))

    expect(changed.configs[0]?.credentialState).toBe('missing')
    expect(runtime.credentials.size).toBe(0)
    expect(await getCredential(changed.configs[0]!)).toBe('')
  })

  it('rejects a stale binding even if settings and secure storage become inconsistent', async () => {
    await save(config())
    await setCredential({ configId: 'config-1', apiKey: 'old-secret' })

    await expect(getCredential(config({ baseUrl: 'https://api.attacker.dev/v1' }))).resolves.toBe('')
    expect(runtime.credentials.size).toBe(0)
  })

  it('keeps the old endpoint active when secure storage cannot invalidate its credential', async () => {
    await save(config())
    await setCredential({ configId: 'config-1', apiKey: 'old-secret' })
    runtime.failRemove = true

    await expect(save(config({ baseUrl: 'https://api.second-provider.dev/v1' }))).rejects.toThrow('secure storage unavailable')

    const unchanged = await getSettings()
    expect(unchanged.configs[0]?.baseUrl).toBe('https://api.first-provider.dev/v1')
    expect(unchanged.configs[0]?.credentialState).toBe('stored')
  })

  it('clears a credential when the Provider changes even on the same origin', async () => {
    await save(config({
      provider: 'iMini',
      baseUrl: 'https://openapi.imini.ai/imini/router'
    }))
    await setCredential({ configId: 'config-1', apiKey: 'provider-secret' })

    const changed = await save(config({
      provider: 'custom-openai',
      baseUrl: 'https://openapi.imini.ai/v1'
    }))

    expect(changed.configs[0]?.credentialState).toBe('missing')
    expect(runtime.credentials.size).toBe(0)
  })

  it('binds an empty Base URL to the official default origin', async () => {
    await save(config({ provider: 'iMini', baseUrl: '' }))
    await setCredential({ configId: 'config-1', apiKey: 'default-secret' })
    const original = (await getSettings()).configs[0]!
    expect(resolveCredentialBinding(original)).toEqual({
      provider: 'iMini',
      origin: 'https://openapi.imini.ai'
    })

    const equivalent = await save(config({
      provider: 'iMini',
      baseUrl: 'https://openapi.imini.ai:443/another/path'
    }))

    expect(equivalent.configs[0]?.credentialState).toBe('stored')
    expect(await getCredential(equivalent.configs[0]!)).toBe('default-secret')
  })

  it('keeps local keyless Providers credential-free across endpoint changes', async () => {
    const local = await save(config({
      provider: 'comfyui',
      model: 'workflow-api-json',
      models: ['workflow-api-json'],
      baseUrl: ''
    }))
    expect(local.configs[0]?.credentialState).toBe('missing')
    await expect(setCredential({ configId: 'config-1', apiKey: 'must-not-store' })).rejects.toThrow('不需要 API Key')

    const moved = await save(config({
      provider: 'comfyui',
      model: 'workflow-api-json',
      models: ['workflow-api-json'],
      baseUrl: 'http://localhost:8188'
    }))
    expect(moved.configs[0]?.credentialState).toBe('missing')
    expect(runtime.credentials.size).toBe(0)
  })

  it('treats unbound legacy secure-storage values as missing', async () => {
    await save(config())
    runtime.credentials.set('lightyear.provider-credential.v1.config-1', new TextEncoder().encode('legacy-secret'))

    const settings = await getSettings()

    expect(settings.configs[0]?.credentialState).toBe('missing')
    expect(runtime.credentials.size).toBe(0)
  })

  it('deletes every configured credential before removing settings', async () => {
    const first = config()
    const second = config({ id: 'config-2', name: '第二个配置' })
    await saveSettings({ activeConfigId: first.id, configs: [first, second] })
    await setCredential({ configId: first.id, apiKey: 'first-secret' })
    await setCredential({ configId: second.id, apiKey: 'second-secret' })

    await clearAllSettingsAndCredentials()

    expect(runtime.credentials.size).toBe(0)
    expect(runtime.settings).toBeUndefined()
  })

  it('keeps settings when secure storage cannot confirm credential deletion', async () => {
    await save(config())
    await setCredential({ configId: 'config-1', apiKey: 'secret' })
    runtime.failRemove = true

    await expect(clearAllSettingsAndCredentials()).rejects.toThrow('secure storage unavailable')

    expect(runtime.settings).toBeDefined()
    expect(runtime.credentials.size).toBe(1)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useMugen } from './useMugen'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('browser config persistence', () => {
  it.each([false, true])('saves and reloads an unverified key (test rejected: %s)', async rejected => {
    vi.useFakeTimers()
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })))
    const scope = effectScope()
    const controller = scope.run(() => useMugen('browser'))!
    controller.createConfig()
    controller.updateSettingsDraft({ provider: 'openai', name: 'Saved without verification' })
    controller.updateSettingsDraft({ baseUrl: 'https://api.openai.com', apiKey: 'unverified-key' })
    if (rejected) {
      await controller.testConfig()
      expect(controller.settingsTestState.value.status).toBe('error')
    }
    controller.saveConfig()
    expect(controller.toastMessage.value).toBe('保存成功')
    scope.stop()
    const restoredScope = effectScope()
    const restored = restoredScope.run(() => useMugen('browser'))!
    expect(restored.configs.value).toContainEqual(expect.objectContaining({ name: 'Saved without verification', apiKey: 'unverified-key' }))
    restoredScope.stop()
  })
  it('retains the draft and reports failure when storage rejects a save', () => {
    vi.useFakeTimers()
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    const scope = effectScope()
    const controller = scope.run(() => useMugen('browser'))!
    controller.createConfig()
    controller.updateSettingsDraft({ name: 'Unsaved config', apiKey: 'unverified-key' })
    storage.setItem.mockImplementation(() => { throw new Error('quota exceeded') })
    controller.saveConfig()
    expect(controller.settingsView.value).toBe('detail')
    expect(controller.settingsDraft.apiKey).toBe('unverified-key')
    expect(controller.settingsDraftIsNew.value).toBe(true)
    expect(controller.toastMessage.value).not.toBe('保存成功')
    scope.stop()
  })
})

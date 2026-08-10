import { describe, expect, it } from 'vitest'
import type { HistoryEntry, ModelConfig } from '@lightyear-banana/inner-protocol'
import { toHostAssetPointer } from '@lightyear-banana/inner-protocol'
import { canRetryTurn, historyEntryToTurn, isConfigUsable, pickActiveConfigId, turnToHistoryEntry } from './workspace'

const config: ModelConfig = {
  id: 'openai-default',
  name: 'OpenAI',
  provider: 'openai',
  model: 'gpt-image-2',
  baseUrl: 'https://api.openai.com',
  enabled: true,
  hasCredential: true
}

const entry: HistoryEntry = {
  id: 'task-1',
  updatedAt: '2026-08-10T00:00:01.000Z',
  prompt: '一张海报',
  assets: [],
  snapshot: {
    configId: config.id,
    prompt: '一张海报',
    references: [],
    size: '1024x1024',
    quality: 'high',
    count: 1,
    ratio: '1:1',
    submittedAt: '2026-08-10T00:00:00.000Z'
  },
  logs: [],
  status: 'completed',
  elapsedSeconds: 3
}

describe('workspace persistence', () => {
  it('restores and serializes a stable generation snapshot', () => {
    const turn = historyEntryToTurn(entry)
    expect(turn).toMatchObject({ id: 'task-1', status: 'completed', elapsed: 3, snapshot: entry.snapshot })
    const serialized = turnToHistoryEntry(turn!)
    expect(serialized).toMatchObject({ id: 'task-1', status: 'completed', snapshot: entry.snapshot })
    expect(serialized.assets).toEqual([])
  })

  it('allows stable-snapshot retry only while every session reference is available', () => {
    const reference = {
      assetId: 'asset-reference-1',
      label: '选区参考',
      source: 'selection' as const,
      width: 512,
      height: 512,
      previewUrl: 'data:image/png;base64,AQID',
      status: 'available' as const
    }
    const turn = historyEntryToTurn({
      ...entry,
      references: [reference],
      snapshot: { ...entry.snapshot!, references: [toHostAssetPointer(reference)] }
    })!

    expect(canRetryTurn(turn)).toBe(true)
    expect(canRetryTurn({ ...turn, references: [{ ...reference, status: 'missing' }] })).toBe(false)
    expect(canRetryTurn({ ...turn, references: [] })).toBe(false)
  })

  it('ignores legacy records without a valid request snapshot', () => {
    expect(historyEntryToTurn({ ...entry, snapshot: undefined })).toBeNull()
  })

  it('shows only enabled and fully configured models in the composer', () => {
    expect(isConfigUsable(config)).toBe(true)
    expect(isConfigUsable({ ...config, hasCredential: false, credentialState: 'missing' })).toBe(false)
    expect(isConfigUsable({ ...config, provider: 'comfyui', baseUrl: 'http://127.0.0.1:8000', hasCredential: false })).toBe(true)
    expect(isConfigUsable({ ...config, enabled: false })).toBe(false)
  })

  it('restores the saved active configuration when it is still usable', () => {
    const second = { ...config, id: 'openai-second', name: 'OpenAI 2' }
    expect(pickActiveConfigId([config, second], second.id)).toBe(second.id)
    expect(pickActiveConfigId([config, { ...second, enabled: false }], second.id)).toBe(config.id)
  })
})

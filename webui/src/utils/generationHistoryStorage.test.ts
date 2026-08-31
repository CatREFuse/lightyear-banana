import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HISTORY_LIMIT,
  generationHistoryStorageKey,
  normalizeHistoryLimit,
  readStoredGenerationHistory,
  writeStoredGenerationHistory
} from './generationHistoryStorage'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  constructor(private readonly quota = Number.POSITIVE_INFINITY) {}

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    const otherSize = [...this.values.entries()]
      .filter(([storedKey]) => storedKey !== key)
      .reduce((total, [storedKey, storedValue]) => total + storedKey.length + storedValue.length, 0)
    if (otherSize + key.length + value.length > this.quota) {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    }
    this.values.set(key, value)
  }
}

describe('generation history storage', () => {
  it('normalizes the configured retention boundary', () => {
    expect(normalizeHistoryLimit(undefined)).toBe(DEFAULT_HISTORY_LIMIT)
    expect(normalizeHistoryLimit(0)).toBe(1)
    expect(normalizeHistoryLimit(12.6)).toBe(13)
    expect(normalizeHistoryLimit(51)).toBe(50)
  })

  it('migrates legacy settings history and keeps only the configured newest records', () => {
    const storage = new MemoryStorage()
    const legacy = [{ id: 'oldest' }, { id: 'middle' }, { id: 'newest' }]

    expect(readStoredGenerationHistory(storage, legacy, 2)).toEqual([
      { id: 'middle' },
      { id: 'newest' }
    ])
  })

  it('reads the dedicated history independently from legacy settings', () => {
    const storage = new MemoryStorage()
    storage.setItem(generationHistoryStorageKey, JSON.stringify([{ id: 'persisted' }]))

    expect(readStoredGenerationHistory(storage, [{ id: 'legacy' }], 30)).toEqual([{ id: 'persisted' }])
  })

  it('drops the oldest records until the newest history fits the available quota', () => {
    const storage = new MemoryStorage(130)
    const stored = writeStoredGenerationHistory(storage, [
      { id: 'oldest', payload: 'a'.repeat(50) },
      { id: 'middle', payload: 'b'.repeat(50) },
      { id: 'newest', payload: 'c'.repeat(50) }
    ], 3)

    expect(stored).toEqual([{ id: 'newest', payload: 'c'.repeat(50) }])
    expect(JSON.parse(storage.getItem(generationHistoryStorageKey)!)).toEqual(stored)
  })

  it('does not hide non-quota storage failures', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new DOMException('Storage is blocked', 'SecurityError') }
    }

    expect(() => writeStoredGenerationHistory(storage, [{ id: 'newest' }], 30)).toThrow('Storage is blocked')
  })
})

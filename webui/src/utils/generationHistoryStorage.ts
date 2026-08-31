export const DEFAULT_HISTORY_LIMIT = 30
export const MIN_HISTORY_LIMIT = 1
export const MAX_HISTORY_LIMIT = 50
export const generationHistoryStorageKey = 'mugen.generation-history.v1'

type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>

export function normalizeHistoryLimit(value: unknown) {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : DEFAULT_HISTORY_LIMIT

  return Math.min(MAX_HISTORY_LIMIT, Math.max(MIN_HISTORY_LIMIT, numeric))
}

export function readStoredGenerationHistory(
  storage: HistoryStorage,
  legacyHistory: unknown,
  historyLimit: number
) {
  const fallback = Array.isArray(legacyHistory) ? legacyHistory : []

  try {
    const raw = storage.getItem(generationHistoryStorageKey)
    const parsed = raw === null ? fallback : JSON.parse(raw)
    return (Array.isArray(parsed) ? parsed : fallback).slice(-normalizeHistoryLimit(historyLimit))
  } catch {
    return fallback.slice(-normalizeHistoryLimit(historyLimit))
  }
}

function isStorageQuotaError(error: unknown) {
  return error instanceof DOMException && (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  )
}

export function writeStoredGenerationHistory<T>(
  storage: HistoryStorage,
  history: T[],
  historyLimit: number
) {
  const stored = history.slice(-normalizeHistoryLimit(historyLimit))

  while (true) {
    try {
      storage.setItem(generationHistoryStorageKey, JSON.stringify(stored))
      return stored
    } catch (error) {
      if (!isStorageQuotaError(error) || stored.length <= 1) throw error
      stored.shift()
    }
  }
}

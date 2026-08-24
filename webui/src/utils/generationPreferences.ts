import type { ResolutionInputMode } from '@mugen/core'

export type GenerationPreferences = {
  count: number
  customHeight: number
  customWidth: number
  quality: string
  ratio: string
  resolutionMode: ResolutionInputMode
  size: string
}

type StoredGenerationPreferences = Record<string, GenerationPreferences>

const generationPreferencesStorageKey = 'mugen.generation-preferences.v1'

function readAllGenerationPreferences(): StoredGenerationPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(generationPreferencesStorageKey) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as StoredGenerationPreferences
      : {}
  } catch {
    return {}
  }
}

export function readGenerationPreferences(configId: string) {
  const preferences = readAllGenerationPreferences()[configId]
  if (!preferences || typeof preferences !== 'object') return undefined

  return preferences
}

export function writeGenerationPreferences(configId: string, preferences: GenerationPreferences) {
  if (!configId) return

  try {
    localStorage.setItem(generationPreferencesStorageKey, JSON.stringify({
      ...readAllGenerationPreferences(),
      [configId]: preferences
    }))
  } catch {
  }
}

import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import type { ColorMode, ResolvedColorMode, VisualTheme } from '@mugen/core'
import type { ComputedRef, Ref } from 'vue'

type StoredThemePreferences = {
  visualTheme?: VisualTheme
  colorMode?: ColorMode
}

export type ThemePreferencesController = {
  colorMode: Ref<ColorMode>
  resolvedColorMode: ComputedRef<ResolvedColorMode>
  setColorMode(mode: ColorMode): void
  setVisualTheme(theme: VisualTheme): void
  visualTheme: Ref<VisualTheme>
}

const themeStorageKey = 'mugen.theme.v1'
const legacyThemeStorageKey = 'lightyear-banana.theme.v1'

function readStoredPreferences(): Required<StoredThemePreferences> {
  try {
    const stored = JSON.parse(
      localStorage.getItem(themeStorageKey) ?? localStorage.getItem(legacyThemeStorageKey) ?? '{}'
    ) as StoredThemePreferences
    return {
      visualTheme: stored.visualTheme === 'classic' ? 'classic' : 'nothing',
      colorMode: stored.colorMode === 'system' || stored.colorMode === 'dark' || stored.colorMode === 'light'
        ? stored.colorMode
        : 'dark'
    }
  } catch {
    return { visualTheme: 'nothing', colorMode: 'dark' }
  }
}

function readSystemMode(): ResolvedColorMode {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function useThemePreferences() {
  const stored = readStoredPreferences()
  const visualTheme = shallowRef<VisualTheme>(stored.visualTheme)
  const colorMode = shallowRef<ColorMode>(stored.colorMode)
  const systemMode = shallowRef<ResolvedColorMode>(readSystemMode())
  const resolvedColorMode = computed<ResolvedColorMode>(() => colorMode.value === 'system' ? systemMode.value : colorMode.value)
  let mediaQuery: MediaQueryList | undefined

  function setVisualTheme(theme: VisualTheme) {
    visualTheme.value = theme
  }

  function setColorMode(mode: ColorMode) {
    colorMode.value = mode
  }

  function handleSystemModeChange(event: MediaQueryListEvent) {
    systemMode.value = event.matches ? 'light' : 'dark'
  }

  watch([visualTheme, colorMode], () => {
    try {
      localStorage.setItem(themeStorageKey, JSON.stringify({
        visualTheme: visualTheme.value,
        colorMode: colorMode.value
      }))
    } catch {
    }
  })

  onMounted(() => {
    mediaQuery = window.matchMedia?.('(prefers-color-scheme: light)')
    systemMode.value = mediaQuery?.matches ? 'light' : 'dark'
    mediaQuery?.addEventListener?.('change', handleSystemModeChange)
  })

  onUnmounted(() => {
    mediaQuery?.removeEventListener?.('change', handleSystemModeChange)
  })

  return {
    colorMode,
    resolvedColorMode,
    setColorMode,
    setVisualTheme,
    visualTheme
  }
}

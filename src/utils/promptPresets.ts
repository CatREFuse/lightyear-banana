type PromptPresetShape = {
  id: string
  name: string
  content: string
}

type PromptPresetErrors = Partial<Record<'id' | 'name' | 'content' | 'limit', string>>

export const PROMPT_PRESET_LIMIT = 100
export const PROMPT_PRESET_NAME_MAX_CODE_POINTS = 24

const promptPresetNamePattern = /^[A-Za-z0-9_\-\p{Script=Han}]+$/u

function normalizePromptPresetName(value: string) {
  return value.trim().normalize('NFKC')
}

function normalizePromptPresetContent(value: string) {
  return value.replace(/\r\n?/g, '\n').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readSingleSlashQuery(input: string) {
  if (!/^\/[^\s/]*$/u.test(input)) {
    return null
  }

  return input.slice(1)
}

export function canonicalizePromptPresetName(value: string) {
  return normalizePromptPresetName(value).replace(/[A-Z]/g, (character) => character.toLowerCase())
}

export function validatePromptPreset<T extends PromptPresetShape>(
  preset: T,
  existingPresets: readonly PromptPresetShape[] = []
) {
  const errors: PromptPresetErrors = {}
  const normalizedId = preset.id.trim()
  const normalizedName = normalizePromptPresetName(preset.name)
  const canonicalName = canonicalizePromptPresetName(normalizedName)
  const editingExistingPreset = existingPresets.some((existingPreset) => existingPreset.id === normalizedId)

  if (!normalizedId) {
    errors.id = '预设 ID 不能为空'
  }

  if (!normalizedName) {
    errors.name = '请输入名称'
  } else if (Array.from(normalizedName).length > PROMPT_PRESET_NAME_MAX_CODE_POINTS) {
    errors.name = `名称最多 ${PROMPT_PRESET_NAME_MAX_CODE_POINTS} 个字符`
  } else if (!promptPresetNamePattern.test(normalizedName)) {
    errors.name = '仅支持中文、英文字母、数字、_ 和 -'
  } else if (
    existingPresets.some(
      (existingPreset) =>
        existingPreset.id !== normalizedId && canonicalizePromptPresetName(existingPreset.name) === canonicalName
    )
  ) {
    errors.name = '名称已存在'
  }

  if (!normalizePromptPresetContent(preset.content)) {
    errors.content = '请输入提示词'
  }

  if (!editingExistingPreset && existingPresets.length >= PROMPT_PRESET_LIMIT) {
    errors.limit = `最多保存 ${PROMPT_PRESET_LIMIT} 条预设`
  }

  return {
    errors,
    valid: Object.keys(errors).length === 0
  }
}

export function normalizePromptPresets(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: PromptPresetShape[] = []

  for (const entry of value) {
    if (normalized.length >= PROMPT_PRESET_LIMIT || !isRecord(entry)) {
      continue
    }

    if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.content !== 'string') {
      continue
    }

    const preset = {
      id: entry.id.trim(),
      name: normalizePromptPresetName(entry.name),
      content: normalizePromptPresetContent(entry.content)
    }

    if (!normalized.some((existingPreset) => existingPreset.id === preset.id) && validatePromptPreset(preset, normalized).valid) {
      normalized.push(preset)
    }
  }

  return normalized
}

export function filterPromptPresets<T extends PromptPresetShape>(presets: readonly T[], input: string) {
  const rawQuery = readSingleSlashQuery(input)
  if (rawQuery === null) {
    return []
  }

  const query = canonicalizePromptPresetName(rawQuery)

  return presets
    .map((preset, index) => {
      const name = canonicalizePromptPresetName(preset.name)
      const rank = name === query ? 0 : name.startsWith(query) ? 1 : name.includes(query) ? 2 : 3
      return { index, preset, rank }
    })
    .filter((entry) => entry.rank < 3)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.preset)
    .slice(0, 6)
}

export function resolvePromptPresetInput<T extends PromptPresetShape>(
  input: string,
  presets: readonly T[],
  options: { alreadyExpanded?: boolean } = {}
) {
  if (options.alreadyExpanded) {
    return {
      kind: 'plain' as const,
      prompt: input
    }
  }

  if (input.startsWith('//')) {
    return {
      kind: 'escaped' as const,
      prompt: input.slice(1)
    }
  }

  const rawName = readSingleSlashQuery(input)
  if (rawName === null) {
    return {
      kind: 'plain' as const,
      prompt: input
    }
  }

  const canonicalName = canonicalizePromptPresetName(rawName)
  const preset = presets.find((candidate) => canonicalizePromptPresetName(candidate.name) === canonicalName)

  if (preset) {
    return {
      kind: 'resolved' as const,
      preset,
      prompt: preset.content
    }
  }

  return {
    kind: 'error' as const,
    message: rawName ? `未找到预设“${rawName}”` : '请选择一个预设提示词',
    prompt: input
  }
}

export {
  canonicalizePromptPresetName as canonicalize,
  filterPromptPresets as filter,
  normalizePromptPresets as normalize,
  resolvePromptPresetInput as resolve,
  validatePromptPreset as validate
}

import { describe, expect, it } from 'vitest'
import { formatComposerSize, validateComposerGeneration } from './generationValidation'

const config = { provider: 'openai' as const, model: 'gpt-image-2' }
const validParameters = {
  selectedSize: '自定义',
  customWidth: 1280,
  customHeight: 512,
  quality: 'auto',
  count: 1,
  ratio: '原图比例',
  referenceCount: 0
}

describe('WebUI generation parameter validation', () => {
  it('keeps the entered values intact instead of silently clamping them', () => {
    expect(formatComposerSize(4097, 1024)).toBe('4097x1024')
    expect(formatComposerSize('1024.5', ' 768 ')).toBe('1024.5x768')
  })

  it('accepts a valid custom GPT Image 2 size', () => {
    expect(validateComposerGeneration(config, validParameters)).toEqual({
      valid: true,
      dimensions: { width: 1280, height: 512 }
    })
  })

  it.each([
    [{ ...validParameters, customWidth: 1024.5 }, 'CUSTOM_SIZE_INTEGER', '整数'],
    [{ ...validParameters, customWidth: 1025 }, 'CUSTOM_SIZE_STEP', '16 的倍数'],
    [{ ...validParameters, customWidth: 4000 }, 'CUSTOM_SIZE_RANGE', '3840'],
    [{ ...validParameters, customWidth: 1024, customHeight: 512 }, 'CUSTOM_SIZE_PIXELS', '655,360'],
    [{ ...validParameters, customWidth: 3840, customHeight: 1024 }, 'CUSTOM_SIZE_RATIO', '3 倍']
  ])('blocks invalid custom dimensions with user-facing guidance', (parameters, code, message) => {
    const result = validateComposerGeneration(config, parameters)
    expect(result).toMatchObject({ valid: false, code })
    if (!result.valid) expect(result.message).toContain(message)
  })

  it('blocks unsupported quality, count, ratio, and reference count', () => {
    expect(validateComposerGeneration(config, { ...validParameters, quality: 'ultra' })).toMatchObject({ valid: false, code: 'QUALITY_UNSUPPORTED' })
    expect(validateComposerGeneration(config, { ...validParameters, count: 11 })).toMatchObject({ valid: false, code: 'COUNT_UNSUPPORTED' })
    expect(validateComposerGeneration(config, { ...validParameters, ratio: '1:1' })).toMatchObject({ valid: false, code: 'RATIO_UNSUPPORTED' })
    expect(validateComposerGeneration(config, { ...validParameters, referenceCount: 17 })).toMatchObject({ valid: false, code: 'REFERENCE_LIMIT' })
  })
})

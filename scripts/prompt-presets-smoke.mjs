import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function readTscBin() {
  return join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc')
}

function compilePromptPresets(outDir) {
  execFileSync(
    process.execPath,
    [
      readTscBin(),
      '--ignoreConfig',
      '--target',
      'ES2022',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--ignoreDeprecations',
      '6.0',
      '--outDir',
      outDir,
      '--rootDir',
      'src',
      '--skipLibCheck',
      'src/utils/promptPresets.ts'
    ],
    { stdio: 'pipe' }
  )
}

function runValidationTests(api) {
  const existing = [{ id: 'foo', name: 'foo', content: '已有内容' }]
  const valid = api.validatePromptPreset({ id: 'new', name: '产品海报-01', content: '生成产品海报' }, existing)
  assert(valid.valid, 'Chinese, ASCII, underscore and hyphen names should be valid')

  const duplicate = api.validatePromptPreset({ id: 'new', name: 'ＦＯＯ', content: '重复内容' }, existing)
  assert(duplicate.errors.name === '名称已存在', 'NFKC and ASCII case conflicts should be rejected')

  const tooLong = api.validatePromptPreset(
    { id: 'new', name: '中'.repeat(25), content: '内容' },
    existing
  )
  assert(tooLong.errors.name?.includes('24'), 'names over 24 code points should be rejected')

  const exactLimit = api.validatePromptPreset(
    { id: 'new', name: '中'.repeat(24), content: '内容' },
    []
  )
  assert(exactLimit.valid, 'a 24 code point name should be accepted')

  const invalidCharacters = api.validatePromptPreset({ id: 'new', name: 'foo bar!', content: '内容' }, [])
  assert(Boolean(invalidCharacters.errors.name), 'spaces and punctuation should be rejected')

  const emptyContent = api.validatePromptPreset({ id: 'new', name: 'foo', content: '   ' }, [])
  assert(Boolean(emptyContent.errors.content), 'blank preset content should be rejected')

  const fullList = Array.from({ length: 100 }, (_, index) => ({
    id: `preset-${index}`,
    name: `preset_${index}`,
    content: `content ${index}`
  }))
  const overLimit = api.validatePromptPreset({ id: 'new', name: 'new_preset', content: '内容' }, fullList)
  assert(Boolean(overLimit.errors.limit), 'a 101st preset should be rejected')

  const editingAtLimit = api.validatePromptPreset({ ...fullList[0], content: '更新内容' }, fullList)
  assert(editingAtLimit.valid, 'editing an existing preset should remain possible at the limit')
}

function runNormalizationTests(api) {
  const normalized = api.normalizePromptPresets([
    { id: ' first ', name: ' Ｆｏｏ ', content: ' first\r\nline ' },
    { id: 'second', name: 'foo', content: 'duplicate' },
    { id: 'first', name: 'other', content: 'duplicate id' },
    { id: 'invalid', name: 'not valid', content: 'invalid name' },
    null
  ])

  assert(normalized.length === 1, 'normalization should remove invalid and duplicate records')
  assert(normalized[0].id === 'first', 'normalization should trim IDs')
  assert(normalized[0].name === 'Foo', 'normalization should apply NFKC to names')
  assert(normalized[0].content === 'first\nline', 'normalization should normalize newlines and trim content')

  const capped = api.normalizePromptPresets(
    Array.from({ length: 101 }, (_, index) => ({
      id: `id-${index}`,
      name: `name_${index}`,
      content: `content ${index}`
    }))
  )
  assert(capped.length === 100, 'normalization should cap stored presets at 100')
}

function runFilterAndResolutionTests(api) {
  const presets = [
    { id: 'foo', name: 'foo', content: 'exact content' },
    { id: 'foobar', name: 'foobar', content: 'prefix content' },
    { id: 'xfoo', name: 'xfoo', content: 'contains content' },
    { id: 'poster', name: '产品海报', content: '海报内容' }
  ]

  assert(api.canonicalizePromptPresetName(' ＦＯＯ ') === 'foo', 'canonical names should use NFKC and ASCII lowercase')

  const matches = api.filterPromptPresets(presets, '/ＦＯＯ')
  assert(matches.map((preset) => preset.id).join(',') === 'foo,foobar,xfoo', 'filter results should rank exact, prefix and contains matches')
  assert(api.filterPromptPresets(presets, '/').length === presets.length, 'a single slash should list all presets')
  assert(api.filterPromptPresets(presets, '//foo').length === 0, 'escaped slash input should not open the preset menu')
  assert(api.filterPromptPresets(presets, 'foo').length === 0, 'plain input should not open the preset menu')
  assert(api.filterPromptPresets(presets, '/foo more').length === 0, 'slash input with trailing text should remain plain')

  const resolved = api.resolvePromptPresetInput('/ＦＯＯ', presets)
  assert(resolved.kind === 'resolved' && resolved.prompt === 'exact content', 'exact slash names should resolve by canonical name')

  const escaped = api.resolvePromptPresetInput('//foo', presets)
  assert(escaped.kind === 'escaped' && escaped.prompt === '/foo', 'double slash should escape one slash')

  const plain = api.resolvePromptPresetInput('普通提示词', presets)
  assert(plain.kind === 'plain' && plain.prompt === '普通提示词', 'plain prompts should pass through')

  const slashWithText = api.resolvePromptPresetInput('/foo more', presets)
  assert(slashWithText.kind === 'plain', 'slash input with trailing text should remain a plain prompt')

  const unknown = api.resolvePromptPresetInput('/unknown', presets)
  assert(unknown.kind === 'error' && unknown.message.includes('unknown'), 'unknown exact slash names should return an error')

  const empty = api.resolvePromptPresetInput('/', presets)
  assert(empty.kind === 'error', 'a bare slash should not resolve as a prompt')

  const commandContentPresets = [
    ...presets,
    { id: 'chain', name: 'chain', content: '/foo' }
  ]
  const expandedCommand = api.resolvePromptPresetInput('/chain', commandContentPresets)
  const sentExpandedCommand = api.resolvePromptPresetInput(
    expandedCommand.prompt,
    commandContentPresets,
    { alreadyExpanded: true }
  )
  assert(
    sentExpandedCommand.kind === 'plain' && sentExpandedCommand.prompt === '/foo',
    'menu-expanded preset content must not resolve as a second slash command'
  )
}

function main() {
  const outDir = join(tmpdir(), 'mugen-prompt-presets-smoke')
  rmSync(outDir, { force: true, recursive: true })

  try {
    compilePromptPresets(outDir)
    const require = createRequire(import.meta.url)
    const api = require(join(outDir, 'utils', 'promptPresets.js'))

    runValidationTests(api)
    runNormalizationTests(api)
    runFilterAndResolutionTests(api)
    console.log('Prompt presets smoke passed')
  } finally {
    rmSync(outDir, { force: true, recursive: true })
  }
}

main()

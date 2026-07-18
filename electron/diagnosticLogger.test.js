import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  DIAGNOSTIC_RETENTION_MS,
  createDiagnosticLogger,
  diagnosticFileNameForTimestamp,
  normalizeDiagnosticError,
  sanitizeDiagnosticValue
} from './diagnosticLogger.js'

async function createFixture(nowValue = Date.parse('2026-07-10T08:00:00.000Z')) {
  const directory = await mkdtemp(join(tmpdir(), 'lightyear-diagnostics-'))
  let currentTime = nowValue
  const logger = createDiagnosticLogger({
    directory,
    now: () => currentTime,
    runtime: () => ({ appVersion: '0.3.12', platform: 'win32' }),
    schedule: false
  })
  await logger.initialize()

  return {
    directory,
    logger,
    setTime(value) {
      currentTime = value
    },
    async cleanup() {
      await logger.close()
      await rm(directory, { force: true, recursive: true })
    }
  }
}

test('redacts credentials, data URLs, binary payloads, and embedded secrets', () => {
  const sanitized = sanitizeDiagnosticValue({
    apiKey: 'top-secret',
    headers: {
      Authorization: 'Bearer abc123',
      nested: 'token=hidden-value'
    },
    previewUrl: 'data:image/png;base64,AAAA',
    buffer: new Uint8Array(32),
    errorMessage: 'request failed at https://example.test/path?api_key=secret&mode=fast'
  })

  assert.equal(sanitized.apiKey, '[REDACTED]')
  assert.equal(sanitized.headers.Authorization, '[REDACTED]')
  assert.match(sanitized.headers.nested, /\[REDACTED\]/)
  assert.equal(sanitized.previewUrl, '[OMITTED previewUrl]')
  assert.deepEqual(sanitized.buffer, { type: 'Uint8Array', byteLength: 32 })
  assert.doesNotMatch(sanitized.errorMessage, /secret/)
})

test('normalizes non-enumerable and Windows filesystem error fields', () => {
  const error = new Error('open failed with token=hidden')
  Object.defineProperty(error, 'code', { value: 'EACCES', enumerable: false })
  Object.defineProperty(error, 'errno', { value: -4092, enumerable: false })
  Object.defineProperty(error, 'syscall', { value: 'open', enumerable: false })
  Object.defineProperty(error, 'path', { value: 'C:\\资料\\selection.psd', enumerable: false })
  Object.defineProperty(error, 'number', { value: 8800, enumerable: false })

  const normalized = normalizeDiagnosticError(error)

  assert.equal(normalized.code, 'EACCES')
  assert.equal(normalized.errno, -4092)
  assert.equal(normalized.syscall, 'open')
  assert.equal(normalized.path, 'C:\\资料\\selection.psd')
  assert.equal(normalized.number, 8800)
  assert.doesNotMatch(normalized.message, /hidden/)
  assert.doesNotMatch(normalized.stack, /hidden/)
})

test('keeps the exact 24-hour cutoff and removes older records', async () => {
  const fixture = await createFixture()
  const snapshot = Date.parse('2026-07-10T08:00:00.000Z')
  const cutoff = snapshot - DIAGNOSTIC_RETENTION_MS

  try {
    await fixture.logger.log({
      timestamp: new Date(cutoff - 1).toISOString(),
      category: 'file',
      operation: 'too-old',
      phase: 'success'
    })
    await fixture.logger.log({
      timestamp: new Date(cutoff).toISOString(),
      category: 'file',
      operation: 'at-cutoff',
      phase: 'success'
    })
    await fixture.logger.log({
      timestamp: new Date(snapshot).toISOString(),
      category: 'file',
      operation: 'at-snapshot',
      phase: 'success'
    })

    const recent = await fixture.logger.readRecent(snapshot)
    assert.deepEqual(recent.records.map((record) => record.operation), ['at-cutoff', 'at-snapshot'])
  } finally {
    await fixture.cleanup()
  }
})

test('prunes expired records inside the cutoff-hour file', async () => {
  const fixture = await createFixture()
  const snapshot = Date.parse('2026-07-10T08:15:00.000Z')
  const cutoff = snapshot - DIAGNOSTIC_RETENTION_MS
  const filePath = join(fixture.directory, diagnosticFileNameForTimestamp(cutoff))
  const records = [
    { timestamp: new Date(cutoff - 1000).toISOString(), operation: 'expired' },
    { timestamp: new Date(cutoff + 1000).toISOString(), operation: 'retained' }
  ]

  try {
    await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8')
    await fixture.logger.prune(snapshot)

    const content = await readFile(filePath, 'utf8')
    assert.doesNotMatch(content, /expired/)
    assert.match(content, /retained/)
  } finally {
    await fixture.cleanup()
  }
})

test('exports ordered records and reports malformed lines', async () => {
  const fixture = await createFixture()
  const exportPath = join(fixture.directory, 'export.jsonl')
  const malformedFile = join(fixture.directory, diagnosticFileNameForTimestamp('2026-07-10T07:00:00.000Z'))

  try {
    await fixture.logger.log({
      timestamp: '2026-07-10T07:59:00.000Z',
      requestId: 'b',
      sequence: 2,
      operation: 'second',
      category: 'bridge',
      phase: 'success'
    })
    await fixture.logger.log({
      timestamp: '2026-07-10T07:59:00.000Z',
      requestId: 'a',
      sequence: 1,
      operation: 'first',
      category: 'bridge',
      phase: 'success'
    })
    await writeFile(malformedFile, '{invalid json}\n', { encoding: 'utf8', flag: 'a' })

    const result = await fixture.logger.exportTo(exportPath)
    const lines = (await readFile(exportPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))

    assert.equal(result.recordCount, 2)
    assert.equal(lines[0].operation, 'diagnostics.export.snapshot')
    assert.equal(lines[0].details.corruptRecordCount, 1)
    assert.deepEqual(lines.slice(1).map((record) => record.operation), ['first', 'second'])
  } finally {
    await fixture.cleanup()
  }
})

test('serializes concurrent append, prune, and export requests', async () => {
  const fixture = await createFixture()
  const exportPath = join(fixture.directory, 'concurrent-export.jsonl')

  try {
    const writes = Array.from({ length: 20 }, (_, index) => fixture.logger.log({
      timestamp: new Date(Date.parse('2026-07-10T07:00:00.000Z') + index).toISOString(),
      category: 'file',
      operation: `write-${index}`,
      phase: 'success'
    }))
    const prune = fixture.logger.prune()
    const exported = fixture.logger.exportTo(exportPath)
    await Promise.all([...writes, prune, exported])

    const lines = (await readFile(exportPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(lines.length, 21)
    assert.equal(new Set(lines.slice(1).map((record) => record.operation)).size, 20)
  } finally {
    await fixture.cleanup()
  }
})

test('exports a filtered connection log with dedicated metadata', async () => {
  const fixture = await createFixture()
  const exportPath = join(fixture.directory, 'crx-export.jsonl')

  try {
    await fixture.logger.log({ category: 'app', operation: 'app.start', phase: 'success' })
    await fixture.logger.log({ category: 'crx', operation: 'crx.interaction', phase: 'success' })
    await fixture.logger.log({ category: 'bridge', operation: 'bridge.uxp.command', phase: 'success' })
    await fixture.logger.log({ category: 'photoshop', operation: 'uxp.command', phase: 'success' })

    const result = await fixture.logger.exportTo(exportPath, {
      category: 'crx',
      operation: 'crx.logs.export.snapshot',
      filter: (record) => ['crx', 'bridge', 'photoshop'].includes(record.category)
    })
    const lines = (await readFile(exportPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))

    assert.equal(result.recordCount, 3)
    assert.equal(lines[0].category, 'crx')
    assert.equal(lines[0].operation, 'crx.logs.export.snapshot')
    assert.deepEqual(lines.slice(1).map((record) => record.category), ['crx', 'bridge', 'photoshop'])
  } finally {
    await fixture.cleanup()
  }
})

test('removes expired records while the app remains idle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lightyear-diagnostics-idle-'))
  const logger = createDiagnosticLogger({
    directory,
    retentionMs: 30,
    runtime: () => ({ platform: 'win32' })
  })

  try {
    await logger.initialize()
    await logger.log({ category: 'app', operation: 'expires', phase: 'success' })
    await new Promise((resolve) => setTimeout(resolve, 90))
    const files = (await readdir(directory)).filter((entry) => entry.startsWith('diagnostics-'))
    assert.deepEqual(files, [])
  } finally {
    await logger.close()
    await rm(directory, { force: true, recursive: true })
  }
})

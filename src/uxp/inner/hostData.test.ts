import { beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryFile {
  value = ''
  private readonly onDelete?: () => void

  constructor(onDelete?: () => void) {
    this.onDelete = onDelete
  }

  async read() { return this.value }
  async write(value: string) { this.value = value }
  async delete() { this.onDelete?.() }
}

class MemoryFolder {
  readonly entries = new Map<string, MemoryFile>()

  async getEntry(name: string) {
    const file = this.entries.get(name)
    if (!file) throw new Error('missing')
    return file
  }

  async createFile(name: string) {
    const file = new MemoryFile(() => this.entries.delete(name))
    this.entries.set(name, file)
    return file
  }
}

const runtime = vi.hoisted(() => ({
  dataFolder: undefined as MemoryFolder | undefined,
  exportFile: undefined as MemoryFile | undefined,
  exportName: '',
  exportTypes: [] as string[]
}))

vi.mock('../photoshopHost', () => ({
  getHostRequire: () => (name: string) => {
    if (name !== 'uxp') throw new Error('unexpected module')
    return {
      storage: {
        localFileSystem: {
          getDataFolder: async () => runtime.dataFolder,
          getFileForSaving: async (fileName: string, options: { types?: string[] }) => {
            runtime.exportName = fileName
            runtime.exportTypes = options.types ?? []
            runtime.exportFile = new MemoryFile()
            return runtime.exportFile
          }
        }
      }
    }
  }
}))

import { DiagnosticStore } from './hostData'

const diagnosticFile = 'mugen-inner-diagnostics.v1.json'

function diagnostic(id: string, timestamp = new Date().toISOString()) {
  return { id, timestamp, category: 'bridge', operation: 'message-validation', phase: 'notice' as const }
}

describe('DiagnosticStore', () => {
  beforeEach(() => {
    runtime.dataFolder = new MemoryFolder()
    runtime.exportFile = undefined
    runtime.exportName = ''
    runtime.exportTypes = []
  })

  it('persists a 24-hour bounded log and exports one redacted event per JSONL line', async () => {
    const persisted = await runtime.dataFolder!.createFile(diagnosticFile)
    await persisted.write(JSON.stringify({
      schemaVersion: 1,
      records: [diagnostic('expired', new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString())]
    }))
    const store = new DiagnosticStore()
    store.record({
      category: 'provider',
      operation: 'generation.progress',
      phase: 'notice',
      details: {
        apiKey: 'sk-secret-value',
        authorization: 'Bearer private-token',
        prompt: '保密提示词',
        image: 'data:image/png;base64,AAAA',
        path: 'C:\\Users\\person\\private.png',
        url: 'https://provider.dev/v1/images?signature=secret#fragment',
        taskId: 'task-1'
      }
    })
    await store.flush()

    const restored = new DiagnosticStore()
    await expect(restored.export()).resolves.toMatchObject({ saved: true })

    expect(runtime.exportName).toMatch(/\.jsonl$/)
    expect(runtime.exportTypes).toEqual(['jsonl'])
    const lines = runtime.exportFile!.value.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toHaveLength(1)
    expect(JSON.stringify(lines)).not.toContain('sk-secret-value')
    expect(JSON.stringify(lines)).not.toContain('private-token')
    expect(JSON.stringify(lines)).not.toContain('保密提示词')
    expect(JSON.stringify(lines)).not.toContain('private.png')
    expect(JSON.stringify(lines)).not.toContain('signature=secret')
    expect(JSON.stringify(lines)).toContain('task-1')
  })

  it('keeps only the newest fixed-capacity records', async () => {
    const persisted = await runtime.dataFolder!.createFile(diagnosticFile)
    await persisted.write(JSON.stringify({
      schemaVersion: 1,
      records: Array.from({ length: 505 }, (_, index) => diagnostic(`record-${index}`))
    }))

    const store = new DiagnosticStore()
    await store.export()

    const lines = runtime.exportFile!.value.trim().split('\n')
    expect(lines).toHaveLength(500)
    expect(lines[0]).toContain('record-5')
    expect(lines.at(-1)).toContain('record-504')
  })

  it('deletes persisted diagnostics during a full local-data clear', async () => {
    const store = new DiagnosticStore()
    store.record({ category: 'bridge', operation: 'host.handshake', phase: 'success' })
    await store.flush()
    expect(runtime.dataFolder!.entries.has(diagnosticFile)).toBe(true)

    await store.clear()

    expect(runtime.dataFolder!.entries.has(diagnosticFile)).toBe(false)
  })
})

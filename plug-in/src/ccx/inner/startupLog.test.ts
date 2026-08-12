import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  exported: '',
  fileName: '',
  types: [] as string[]
}))

vi.mock('../photoshopHost', () => ({
  getHostRequire: () => (name: string) => {
    if (name === 'photoshop') return { app: { version: '27.0.0' } }
    if (name === 'uxp') {
      return {
        versions: { uxp: '9.0.0' },
        storage: {
          localFileSystem: {
            getFileForSaving: async (fileName: string, options: { types?: string[] }) => {
              runtime.fileName = fileName
              runtime.types = options.types ?? []
              return { write: async (value: string) => { runtime.exported = value } }
            }
          }
        }
      }
    }
    throw new Error(`unexpected module: ${name}`)
  }
}))

import { StartupLog } from './startupLog'

describe('StartupLog', () => {
  beforeEach(() => {
    runtime.exported = ''
    runtime.fileName = ''
    runtime.types = []
  })

  it('exports an ordered PS, CCX and WebUI startup trace with sensitive payloads removed', async () => {
    const log = new StartupLog('1.1.1', 'session-1')
    log.record('webui', 'ccx', 'bridge.receive', {
      command: 'generation.start',
      messageId: 'message-1',
      apiKey: 'sk-example-secret-value',
      authorization: 'Bearer private-token',
      prompt: 'private prompt',
      image: 'data:image/png;base64,AAAA',
      data: 'raw-image-body',
      chunk: Uint8Array.from([1, 2, 3]),
      path: 'C:\\Users\\person\\reference.png',
      url: 'https://provider.example/v1/images?signature=private#fragment'
    })
    log.record('ccx', 'photoshop', 'host.command.start', { command: 'canvas.captureVisible' })
    log.record('photoshop', 'ccx', 'host.command.success', { command: 'canvas.captureVisible' })
    log.record('ccx', 'webui', 'bridge.send', { command: 'generation.complete', messageId: 'message-1' })

    await expect(log.export()).resolves.toMatchObject({ saved: true })

    expect(runtime.fileName).toMatch(/^mugen-startup-1\.1\.1-.+\.jsonl$/)
    expect(runtime.types).toEqual(['jsonl'])
    const lines = runtime.exported.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines.map((line) => `${line.source}->${line.target}`)).toEqual([
      'ccx->ccx',
      'webui->ccx',
      'ccx->photoshop',
      'photoshop->ccx',
      'ccx->webui',
      'ccx->ccx'
    ])
    const serialized = JSON.stringify(lines)
    expect(serialized).toContain('message-1')
    expect(serialized).toContain('canvas.captureVisible')
    expect(serialized).not.toContain('sk-example-secret-value')
    expect(serialized).not.toContain('private-token')
    expect(serialized).not.toContain('private prompt')
    expect(serialized).not.toContain('reference.png')
    expect(serialized).not.toContain('signature=private')
    expect(serialized).not.toContain('AAAA')
    expect(serialized).not.toContain('raw-image-body')
  })

  it('stops collecting communication after the startup handshake completes', () => {
    const log = new StartupLog('1.1.1', 'session-1')
    log.record('ccx', 'webui', 'bridge.send', { command: 'host.handshake' })
    log.finish({ attempt: 1 })
    log.record('webui', 'ccx', 'bridge.receive', { command: 'generation.start' })

    expect(log.snapshot().map((record) => record.event)).toEqual([
      'startup.begin',
      'bridge.send',
      'startup.ready'
    ])
  })
})

/// <reference types="node" />

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { toHostAssetPointer, type HistoryUpsertEntry } from '@mugen/inner-protocol'
import { createApimartFixtureServer, expectedApiKey } from '../../../../utils/apimart-smoke-server.mjs'
import type { ModelConfig } from '@mugen/core'
import { AssetStore } from './assetStore'
import { ProviderRuntime } from './providerRuntime'
import { saveSettings } from './storage'

const hostStorage = vi.hoisted(() => ({ settings: undefined as string | undefined }))

vi.mock('../photoshopHost', () => ({
  getHostRequire: () => (moduleName: string) => {
    if (moduleName === 'photoshop') return undefined
    if (moduleName !== 'uxp') throw new Error(`Unexpected Host module: ${moduleName}`)
    const settingsFile = {
      read: async () => {
        if (hostStorage.settings === undefined) throw new Error('Settings file is missing')
        return hostStorage.settings
      },
      write: async (value: string) => {
        hostStorage.settings = value
      },
      delete: async () => {
        hostStorage.settings = undefined
      }
    }
    return {
      storage: {
        localFileSystem: {
          getDataFolder: async () => ({
            getEntry: async () => settingsFile,
            createFile: async () => settingsFile
          })
        }
      }
    }
  }
}))

const capturedCanvasPreview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlVQAAAAASUVORK5CYII='
const catFixturePath = fileURLToPath(new URL('../../../../webui/public/mock-images/cats/cat-01.jpg', import.meta.url))

describe('ProviderRuntime APIMart fixture integration', () => {
  const fixture = createApimartFixtureServer({ port: 0 })
  let baseUrl = ''

  beforeAll(async () => {
    baseUrl = await fixture.start()
  })

  afterAll(async () => {
    await fixture.stop()
  })

  it('runs capture asset upload, submit, poll, cat materialization, and AssetStore commit through the real Provider runtime', async () => {
    fixture.reset()
    hostStorage.settings = undefined
    const config: ModelConfig = {
      id: 'apimart-smoke',
      name: 'APIMart Smoke',
      provider: 'apimart',
      model: 'gpt-image-1',
      models: ['gpt-image-1'],
      apiKey: expectedApiKey,
      baseUrl,
      enabled: true
    }
    await saveSettings({
      activeConfigId: config.id,
      configs: [{
        id: config.id,
        name: config.name,
        provider: config.provider,
        model: config.model,
        models: config.models,
        baseUrl: config.baseUrl,
        enabled: config.enabled
      }]
    })
    const assets = new AssetStore()
    const captured = await assets.add('visible', {
      id: 'captured-visible',
      label: '可见图层',
      width: 1,
      height: 1,
      sourceBounds: { left: 0, top: 0, right: 1, bottom: 1 },
      previewUrl: capturedCanvasPreview,
      rgba: new Uint8Array()
    }, { documentId: 'integration-document' })
    const events: Array<{ event: string; payload: unknown }> = []
    const history: HistoryUpsertEntry[] = []
    const runtime = new ProviderRuntime({
      assets,
      emit: (event, payload) => events.push({ event, payload }),
      persistHistory: async (entry) => {
        if (entry.status === 'completed') {
          await assets.retain(entry.assets.map((asset) => asset.assetId), `history:${entry.id}`)
        }
        history.push(entry)
      }
    })

    await expect(runtime.testConfig(config.id)).resolves.toEqual({ ok: true, message: '连接成功' })
    const snapshot = {
      configId: config.id,
      prompt: '把画布变成一张小猫海报',
      references: [toHostAssetPointer(captured)],
      size: '1K',
      quality: '自动',
      count: 1,
      ratio: '1:1',
      submittedAt: new Date().toISOString()
    }
    const { taskId } = await runtime.start(snapshot)
    await runtime.waitForIdle()

    expect(events.some(({ event }) => event === 'generation.failed')).toBe(false)
    const completed = events.find(({ event }) => event === 'generation.completed')?.payload as {
      taskId: string
      assets: Array<{ assetId: string }>
    } | undefined
    expect(completed?.taskId).toBe(taskId)
    expect(completed?.assets).toHaveLength(1)
    expect(history).toContainEqual(expect.objectContaining({ id: taskId, status: 'completed', snapshot }))

    const generatedAsset = assets.get(completed!.assets[0]!.assetId)
    expect(generatedAsset.ref.source).toBe('generated')
    expect(generatedAsset.image.previewUrl).toMatch(/^data:image\/jpeg;base64,/)
    const materializedBytes = Buffer.from(generatedAsset.image.previewUrl.split(',', 2)[1]!, 'base64')
    const expectedCatBytes = readFileSync(catFixturePath)
    expect(materializedBytes.equals(expectedCatBytes)).toBe(true)
    expect(createHash('sha256').update(materializedBytes).digest('hex')).toBe(
      createHash('sha256').update(expectedCatBytes).digest('hex')
    )

    expect(fixture.state).toMatchObject({
      modelChecks: 1,
      uploads: 1,
      generations: 1,
      polls: 1,
      imageDownloads: 1,
      lastUpload: { hasFile: true, contentType: 'multipart/form-data' },
      lastGeneration: {
        model: config.model,
        prompt: snapshot.prompt,
        n: 1,
        image_urls: [`${baseUrl}/fixtures/cat.jpg`]
      }
    })
    expect(fixture.state.requests.map((request) => request.phase)).toEqual([
      'models.list',
      'reference.upload',
      'generation.submit',
      'generation.poll',
      'image.download'
    ])
  })
})

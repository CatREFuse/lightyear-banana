import { afterEach, expect, it, vi } from 'vitest'
import { generateImagesWithProvider } from './registry'

afterEach(() => vi.unstubAllGlobals())
it('sends n=3 then three n=1 requests when the native API rejects a batch', async () => {
  const counts: number[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    counts.push(body.n)
    return new Response(JSON.stringify(body.n > 1
      ? { error: { message: 'n must be 1' } }
      : { data: [{ b64_json: 'AA==' }] }), {
      status: body.n > 1 ? 400 : 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }))
  const images = await generateImagesWithProvider({
    config: { id: 'custom', name: 'Custom', provider: 'custom-openai', model: 'my-model', models: ['my-model'], apiKey: 'test-key', baseUrl: 'https://example.test', enabled: true },
    prompt: 'cat', count: 3, references: [], size: '1024x1024', quality: 'auto', ratio: '1:1'
  })
  expect(counts).toEqual([3, 1, 1, 1])
  expect(images).toHaveLength(3)
})

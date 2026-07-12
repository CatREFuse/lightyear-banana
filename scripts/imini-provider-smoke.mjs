import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import http from 'node:http'

const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function readTscBin() {
  return join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc')
}

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function createConfig(port, model) {
  return {
    apiKey: 'test-token',
    baseUrl: `http://127.0.0.1:${port}`,
    enabled: true,
    id: 'config-imini',
    model,
    models: ['google/nano-banana', 'google/nano-banana-pro', 'google/nano-banana-2', 'openai/gpt-image-2'],
    name: 'i-mini Mock',
    provider: 'iMini',
    usesOfficialBaseUrl: false
  }
}

function createReference() {
  return {
    id: 'ref-1',
    image: {
      height: 1,
      id: 'img-1',
      label: 'Reference',
      previewUrl: `data:image/png;base64,${tinyPng}`,
      rgba: new Uint8Array(),
      sourceBounds: {
        bottom: 1,
        left: 0,
        right: 1,
        top: 0
      },
      width: 1
    },
    label: 'Reference',
    source: 'upload'
  }
}

async function main() {
  const outDir = join(tmpdir(), 'lightyear-banana-imini-smoke')
  rmSync(outDir, { force: true, recursive: true })

  execFileSync(process.execPath, [readTscBin(),
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
    'src/services/imageApiClient.ts',
    'src/data/providerCapabilities.ts',
    'src/types/lightyear.ts'
  ], { stdio: 'pipe' })

  const captured = []
  const server = http.createServer(async (request, response) => {
    const bodyText = await readRequestBody(request)
    captured.push({
      auth: request.headers.authorization,
      bodyText,
      method: request.method,
      url: request.url
    })

    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'POST' && request.url === '/v1/images/generate') {
      const body = JSON.parse(bodyText)
      response.end(JSON.stringify({
        task_id: body.model === 'openai/gpt-image-2' ? 'task_gpt' : 'task_nano',
        model: body.model,
        created_at: '2026-04-07T03:00:17.062Z',
        request_id: 'req_submit'
      }))
      return
    }

    if (request.method === 'GET' && request.url?.startsWith('/v1/images/tasks/')) {
      response.end(JSON.stringify({
        task_id: request.url.split('/').pop(),
        status: 'succeeded',
        model: 'google/nano-banana-2',
        created_at: '2026-04-07T03:00:17.062Z',
        completed_at: '2026-04-07T03:00:27.062Z',
        images: [
          {
            url: 'https://file.iminicdn.com/file/test.png',
            width: 1024,
            height: 1024
          }
        ],
        error: null,
        request_id: 'req_poll'
      }))
      return
    }

    response.statusCode = 404
    response.end(JSON.stringify({
      error: {
        message: `unexpected ${request.method} ${request.url}`
      }
    }))
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    const require = createRequire(import.meta.url)
    const { providerCapabilities, readProviderCapability } = require(join(outDir, 'data', 'providerCapabilities.js'))
    const { generateImagesWithProvider } = require(join(outDir, 'services', 'imageApiClient.js'))

    assert(
      JSON.stringify(providerCapabilities.iMini.modelOptions) === JSON.stringify([
        'google/nano-banana',
        'google/nano-banana-pro',
        'google/nano-banana-2',
        'openai/gpt-image-2'
      ]),
      'i-mini default model list is incorrect'
    )
    assert(readProviderCapability(createConfig(port, 'google/nano-banana')).referenceLimit === 3, 'Nano Banana reference limit is incorrect')
    assert(readProviderCapability(createConfig(port, 'google/nano-banana-2')).sizeOptions.includes('512'), 'Nano Banana 2 512 tier is missing')
    assert(readProviderCapability(createConfig(port, 'openai/gpt-image-2')).countOptions.includes(10), 'GPT Image 2 count options are incomplete')

    const nanoImages = await generateImagesWithProvider({
      config: createConfig(port, 'google/nano-banana-2'),
      count: 1,
      prompt: 'Create a product image',
      quality: '',
      ratio: '16:9',
      references: [createReference()],
      selectedSize: '512',
      size: '512'
    })

    const gptImages = await generateImagesWithProvider({
      config: createConfig(port, 'openai/gpt-image-2'),
      count: 3,
      prompt: 'Create a poster',
      quality: 'high',
      ratio: '9:21',
      references: [],
      selectedSize: '4K',
      size: '4K'
    })

    const posts = captured.filter((item) => item.method === 'POST')
    assert(posts.length === 2, 'expected two i-mini submit requests')
    assert(posts.every((item) => item.url === '/v1/images/generate'), 'i-mini submit path is incorrect')
    assert(captured.filter((item) => item.method === 'GET').every((item) => item.url.startsWith('/v1/images/tasks/')), 'i-mini poll path is incorrect')
    assert(captured.every((item) => item.auth === 'Bearer test-token'), 'i-mini requests must use Bearer auth')

    const nanoBody = JSON.parse(posts[0].bodyText)
    assert(nanoBody.model === 'google/nano-banana-2', 'Nano Banana 2 model was not forwarded')
    assert(nanoBody.aspect_ratio === '16:9', 'Nano Banana 2 aspect_ratio was not forwarded')
    assert(nanoBody.resolution === '512', 'Nano Banana 2 resolution was not forwarded')
    assert(Array.isArray(nanoBody.images) && nanoBody.images[0]?.reference_type === 'asset', 'i-mini reference image was not forwarded')
    assert(nanoBody.quality === undefined && nanoBody.num === undefined, 'Nano Banana 2 should not receive GPT Image 2 fields')

    const gptBody = JSON.parse(posts[1].bodyText)
    assert(gptBody.model === 'openai/gpt-image-2', 'GPT Image 2 model was not forwarded')
    assert(gptBody.aspect_ratio === '9:21', 'GPT Image 2 aspect_ratio was not forwarded')
    assert(gptBody.resolution === '4K', 'GPT Image 2 resolution was not forwarded')
    assert(gptBody.quality === 'high', 'GPT Image 2 quality was not forwarded')
    assert(gptBody.num === 3, 'GPT Image 2 num was not forwarded')
    assert(nanoImages[0].previewUrl === 'https://file.iminicdn.com/file/test.png', 'i-mini image URL was not parsed')
    assert(gptImages[0].resolvedSize === '1024x1024', 'i-mini result dimensions were not parsed')

    console.log('i-mini provider smoke passed')
  } finally {
    server.close()
    rmSync(outDir, { force: true, recursive: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

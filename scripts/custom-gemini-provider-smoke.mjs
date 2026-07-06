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
  return join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')
}

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const outDir = join(tmpdir(), 'lightyear-banana-custom-gemini-smoke')
  rmSync(outDir, { force: true, recursive: true })

  execFileSync(readTscBin(), [
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
    if (request.method === 'GET' && request.url === '/v1beta/models') {
      response.end(JSON.stringify({
        models: [
          {
            name: 'models/gemini-3-pro-image-preview',
            supportedGenerationMethods: ['generateContent']
          }
        ]
      }))
      return
    }

    if (request.method === 'POST' && request.url === '/v1beta/models/gemini-3-pro-image-preview%3AgenerateContent') {
      response.end(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: tinyPng,
                    mimeType: 'image/png'
                  }
                }
              ]
            }
          }
        ]
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
    const { generateImagesWithProvider, testImageConfig } = require(join(outDir, 'services', 'imageApiClient.js'))
    const config = {
      apiKey: 'test-token',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      customFormat: 'gemini',
      enabled: true,
      id: 'config-test',
      model: 'gemini-3-pro-image-preview',
      models: ['gemini-3-pro-image-preview'],
      name: 'New API Gemini Mock',
      provider: 'custom-openai',
      usesOfficialBaseUrl: false
    }

    await testImageConfig(config)
    const images = await generateImagesWithProvider({
      config,
      count: 1,
      prompt: '生成一张测试图',
      quality: '',
      ratio: '1:1',
      references: [
        {
          id: 'ref-1',
          image: {
            height: 1,
            id: 'img-1',
            label: '参考图',
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
          label: '参考图',
          source: 'upload'
        }
      ],
      size: '1k'
    })

    const post = captured.find((item) => item.method === 'POST')
    assert(captured.some((item) => item.method === 'GET' && item.url === '/v1beta/models'), 'models request was not sent to /v1beta/models')
    assert(post, 'generateContent request was not sent')
    assert(post.url === '/v1beta/models/gemini-3-pro-image-preview%3AgenerateContent', 'generateContent URL is incorrect')
    assert(captured.every((item) => item.auth === 'Bearer test-token'), 'Gemini custom requests must use Bearer auth')

    const body = JSON.parse(post.bodyText)
    const parts = body.contents?.[0]?.parts ?? []
    assert(parts.some((part) => part.text === '生成一张测试图'), 'prompt text part is missing')
    assert(parts.some((part) => part.inlineData?.data), 'reference image inlineData is missing')
    assert(body.generationConfig?.imageConfig?.aspectRatio === '1:1', 'aspectRatio was not forwarded')
    assert(body.generationConfig?.imageConfig?.imageSize === '1K', 'imageSize was not normalized')
    assert(images.length === 1, 'Gemini inline image was not parsed')
    assert(images[0].previewUrl.startsWith('data:image/png;base64,'), 'Gemini image preview URL is invalid')

    console.log('Custom Gemini provider smoke passed')
  } finally {
    server.close()
    rmSync(outDir, { force: true, recursive: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

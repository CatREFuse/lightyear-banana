import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const defaultMockImageApiPort = Number(process.env.LIGHTYEAR_MOCK_IMAGE_API_PORT ?? 38322)
export const defaultMockImageApiHost = process.env.LIGHTYEAR_MOCK_IMAGE_API_HOST ?? '127.0.0.1'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const fixtureDirCandidates = [path.join(projectRoot, 'public', 'mock-images'), path.join(projectRoot, 'dist', 'mock-images')]
const fixtureDir = fixtureDirCandidates.find((candidate) => existsSync(candidate)) ?? fixtureDirCandidates[0]
const fixtureFiles = Array.from({ length: 20 }, (_, index) => `cats/cat-${String(index + 1).padStart(2, '0')}.jpg`)
const generationDelayMinMs = Number(process.env.LIGHTYEAR_MOCK_IMAGE_API_DELAY_MIN_MS ?? 3000)
const generationDelayMaxMs = Number(process.env.LIGHTYEAR_MOCK_IMAGE_API_DELAY_MAX_MS ?? 5000)

const goodKeys = {
  'codex-image-server': new Set(['', 'mock-good', 'mock-good-codex']),
  comfyui: new Set(['', 'mock-good', 'mock-good-comfyui']),
  flux: new Set(['mock-good', 'mock-good-flux']),
  gemini: new Set(['mock-good', 'mock-good-gemini']),
  kling: new Set(['mock-good', 'mock-good-kling']),
  openai: new Set(['mock-good', 'mock-good-openai']),
  qwen: new Set(['mock-good', 'mock-good-qwen']),
  seedream: new Set(['mock-good', 'mock-good-seedream']),
  'custom-openai': new Set(['mock-good', 'mock-good-compatible'])
}

const badKeyModes = new Map([
  ['mock-bad-key', 'invalid'],
  ['mock-expired', 'expired'],
  ['mock-permission-denied', 'permission'],
  ['mock-rate-limited', 'rate'],
  ['mock-quota-exceeded', 'quota'],
  ['mock-server-error', 'server'],
  ['mock-timeout', 'timeout']
])

const klingTasks = new Map()
const fluxTasks = new Map()
const comfyTasks = new Map()
const codexImages = new Map()

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'authorization,content-type,x-dashscope-async,x-goog-api-key,x-key',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8'
  })
  response.end(JSON.stringify(payload, null, 2))
}

function sendStaticAsset(requestUrl, response, method) {
  const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/mock-images\//, '')
  sendFixtureAsset(relativePath, response, method)
}

function sendFixtureAsset(relativePath, response, method) {
  if (!fixtureFiles.includes(relativePath)) {
    sendJson(response, 404, { error: { message: 'Not found', type: 'invalid_request_error', code: 'not_found' } })
    return
  }

  const filePath = path.join(fixtureDir, relativePath)
  if (!existsSync(filePath)) {
    sendJson(response, 404, { error: { message: 'Not found', type: 'invalid_request_error', code: 'not_found' } })
    return
  }

  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'image/jpeg'
  })
  if (method === 'HEAD') {
    response.end()
    return
  }
  response.end(readFileSync(filePath))
}

function sendOptions(response) {
  response.writeHead(204, {
    'Access-Control-Allow-Headers': 'authorization,content-type,x-dashscope-async,x-goog-api-key,x-key',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*'
  })
  response.end()
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function randomGenerationDelay() {
  const min = Math.max(0, Math.min(generationDelayMinMs, generationDelayMaxMs))
  const max = Math.max(min, generationDelayMaxMs)

  return Math.round(min + Math.random() * (max - min))
}

async function sendGeneratedJson(response, status, payload) {
  await wait(randomGenerationDelay())
  sendJson(response, status, payload)
}

function getBearer(headers) {
  const value = headers.authorization ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(value)
  return match?.[1] ?? ''
}

function getGeminiKey(requestUrl, headers) {
  return headers['x-goog-api-key'] ?? requestUrl.searchParams.get('key') ?? ''
}

function getKey(provider, requestUrl, headers) {
  if (provider === 'comfyui') {
    return getBearer(headers)
  }

  if (provider === 'gemini') {
    return getGeminiKey(requestUrl, headers)
  }
  if (provider === 'flux') {
    return headers['x-key'] ?? ''
  }

  return getBearer(headers)
}

function createProviderError(provider, mode) {
  if (provider === 'gemini') {
    const map = {
      expired: [401, 'API key expired. Please renew the API key.', 'UNAUTHENTICATED'],
      invalid: [401, 'API key not valid. Please pass a valid API key.', 'UNAUTHENTICATED'],
      permission: [403, 'Permission denied on resource project.', 'PERMISSION_DENIED'],
      quota: [429, 'Quota exceeded for aiplatform.googleapis.com.', 'RESOURCE_EXHAUSTED'],
      rate: [429, 'Resource has been exhausted. Please try again later.', 'RESOURCE_EXHAUSTED'],
      server: [500, 'Internal error encountered.', 'INTERNAL'],
      timeout: [504, 'Deadline expired before operation could complete.', 'DEADLINE_EXCEEDED']
    }
    const [status, message, code] = map[mode] ?? map.invalid
    return [status, { error: { code: status, message, status: code } }]
  }

  if (provider === 'qwen' || provider === 'kling') {
    const map = {
      expired: [401, 'InvalidApiKey', 'Invalid API-key provided.'],
      invalid: [401, 'InvalidApiKey', 'Invalid API-key provided.'],
      permission: [403, 'AccessDenied', 'Access denied.'],
      quota: [429, 'Arrearage', 'Access denied, please make sure your account is in good standing.'],
      rate: [429, 'Throttling.RateQuota', 'Requests rate limit exceeded.'],
      server: [500, 'InternalError', 'Internal server error.'],
      timeout: [504, 'Timeout', 'The request timed out.']
    }
    const [status, code, message] = map[mode] ?? map.invalid
    return [status, { request_id: randomUUID(), code, message }]
  }

  const map = {
    expired: [401, 'invalid_api_key', 'Incorrect API key provided.'],
    invalid: [401, 'invalid_api_key', 'Incorrect API key provided.'],
    permission: [403, 'insufficient_permissions', 'You do not have permission to perform this action.'],
    quota: [429, 'insufficient_quota', 'You exceeded your current quota, please check your plan and billing details.'],
    rate: [429, 'rate_limit_exceeded', 'Rate limit reached for image generation requests.'],
    server: [500, 'server_error', 'The server had an error while processing your request.'],
    timeout: [504, 'timeout', 'The request timed out.']
  }
  const [status, code, message] = map[mode] ?? map.invalid
  return [
    status,
    {
      error: {
        message,
        type: status === 429 ? 'rate_limit_error' : 'invalid_request_error',
        param: null,
        code
      }
    }
  ]
}

function authorize(provider, requestUrl, headers) {
  const key = getKey(provider, requestUrl, headers)
  if (goodKeys[provider]?.has(key)) {
    return null
  }

  return badKeyModes.get(key) ?? 'invalid'
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const contentType = request.headers['content-type'] ?? ''
  if (!raw || contentType.includes('multipart/form-data')) {
    return { raw, json: {} }
  }

  try {
    return { raw, json: JSON.parse(raw) }
  } catch {
    return { raw, json: {} }
  }
}

function inferProvider(pathname, json, raw) {
  const model = json.model ?? raw.match(/name="model"\r?\n\r?\n([^\r\n]+)/)?.[1] ?? ''
  if (
    pathname === '/healthz' ||
    pathname === '/v1/capabilities' ||
    pathname === '/v1/images/generate' ||
    /^\/v1\/images\/[^/]+\/file$/.test(pathname)
  ) {
    return 'codex-image-server'
  }
  if (
    pathname === '/system_stats' ||
    pathname === '/upload/image' ||
    pathname === '/prompt' ||
    pathname.startsWith('/history') ||
    pathname === '/view'
  ) {
    return 'comfyui'
  }
  if (pathname.includes('/v1beta/models/')) {
    return 'gemini'
  }
  if (pathname.includes('/api/v3/images/')) {
    return 'seedream'
  }
  if (pathname.includes('/api/v1/tasks/')) {
    return 'kling'
  }
  if (pathname.includes('/v1/get_result')) {
    return 'flux'
  }
  if (pathname.includes('/v1/flux-')) {
    return 'flux'
  }
  if (pathname.includes('/api/v1/services/aigc/image-generation/generation')) {
    return 'kling'
  }
  if (pathname.includes('/api/v1/services/aigc/multimodal-generation/generation')) {
    return String(model).startsWith('kling/') ? 'kling' : 'qwen'
  }
  if (pathname.includes('/v1/images/')) {
    return String(model).startsWith('custom') ? 'custom-openai' : 'openai'
  }
  return 'openai'
}

function readCount(provider, json, raw) {
  if (provider === 'codex-image-server') {
    return 1
  }

  if (provider === 'comfyui') {
    return clampCount(Number(json.prompt?.batch_size ?? 1), provider)
  }

  if (provider === 'qwen' || provider === 'kling') {
    return clampCount(Number(json.parameters?.n ?? 1), provider)
  }

  if (provider === 'gemini') {
    return clampCount(Number(json.generationConfig?.candidateCount ?? 1), provider)
  }

  if (provider === 'seedream') {
    return clampCount(Number(json.sequential_image_generation_options?.max_images ?? 1), provider)
  }

  return clampCount(Number(json.n ?? raw.match(/name="n"\r?\n\r?\n(\d+)/)?.[1] ?? 1), provider)
}

function clampCount(count, provider) {
  const limits = {
    'codex-image-server': 1,
    flux: 1,
    comfyui: 8,
    gemini: 10,
    kling: 9,
    openai: 10,
    qwen: 6,
    seedream: 15,
    'custom-openai': 10
  }
  const max = limits[provider] ?? 1
  return Math.max(1, Math.min(Number.isFinite(count) ? count : 1, max))
}

function shuffleIndexes() {
  const indexes = Array.from({ length: fixtureFiles.length }, (_, index) => index)
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]]
  }

  return indexes
}

function selectFixtureIndexes(count) {
  const selected = []
  while (selected.length < count) {
    selected.push(...shuffleIndexes())
  }

  return selected.slice(0, count)
}

function createFixtureUrl(requestUrl, fixtureIndex) {
  return `${requestUrl.origin}/mock-images/${fixtureFiles[fixtureIndex % fixtureFiles.length]}`
}

function createFixtureData(fixtureIndex) {
  const file = readFileSync(path.join(fixtureDir, fixtureFiles[fixtureIndex % fixtureFiles.length]))

  return {
    data: file.toString('base64'),
    mimeType: 'image/jpeg'
  }
}

function createOpenAiResponse(requestUrl, count) {
  const fixtureIndexes = selectFixtureIndexes(count)

  return {
    created: Math.floor(Date.now() / 1000),
    data: Array.from({ length: count }, (_, index) => ({
      url: createFixtureUrl(requestUrl, fixtureIndexes[index]),
      revised_prompt: 'Mock image generated by Lightyear Banana.'
    }))
  }
}

function createSeedreamResponse(requestUrl, count) {
  const fixtureIndexes = selectFixtureIndexes(count)

  return {
    created: Math.floor(Date.now() / 1000),
    data: Array.from({ length: count }, (_, index) => ({ url: createFixtureUrl(requestUrl, fixtureIndexes[index]) }))
  }
}

function createGeminiResponse(model, count) {
  const fixtureIndexes = selectFixtureIndexes(count)

  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            { text: 'Mock image generated.' },
            ...Array.from({ length: count }, (_, index) => {
              const fixture = createFixtureData(fixtureIndexes[index])

              return {
                inlineData: {
                  mimeType: fixture.mimeType,
                  data: fixture.data
                }
              }
            })
          ]
        },
        finishReason: 'STOP',
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 18,
      candidatesTokenCount: 32,
      totalTokenCount: 50
    },
    modelVersion: model
  }
}

function createQwenResponse(requestUrl, count) {
  const fixtureIndexes = selectFixtureIndexes(count)

  return {
    request_id: randomUUID(),
    output: {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: Array.from({ length: count }, (_, index) => ({ image: createFixtureUrl(requestUrl, fixtureIndexes[index]) }))
          }
        }
      ]
    },
    usage: {
      image_count: count
    }
  }
}

function createKlingTask(count) {
  const taskId = `mock-kling-${randomUUID()}`
  klingTasks.set(taskId, selectFixtureIndexes(count))
  return {
    request_id: randomUUID(),
    output: {
      task_id: taskId,
      task_status: 'PENDING'
    }
  }
}

function createKlingResult(requestUrl, taskId) {
  const fixtureIndexes = klingTasks.get(taskId) ?? selectFixtureIndexes(1)

  return {
    request_id: randomUUID(),
    output: {
      task_id: taskId,
      task_status: 'SUCCEEDED',
      submit_time: new Date().toISOString(),
      scheduled_time: new Date().toISOString(),
      end_time: new Date().toISOString(),
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: fixtureIndexes.map((fixtureIndex) => ({
              image: createFixtureUrl(requestUrl, fixtureIndex),
              type: 'image'
            }))
          }
        }
      ]
    },
    usage: {
      image_count: fixtureIndexes.length
    }
  }
}

function createFluxTask(requestUrl) {
  const taskId = `mock-flux-${randomUUID()}`
  fluxTasks.set(taskId, selectFixtureIndexes(1)[0])

  return {
    id: taskId,
    polling_url: `${requestUrl.origin}/v1/get_result?id=${taskId}`,
    cost: 1,
    input_mp: 0,
    output_mp: 1.05
  }
}

function createComfyTask() {
  const promptId = `mock-comfy-${randomUUID()}`
  const indexes = selectFixtureIndexes(1)
  comfyTasks.set(promptId, indexes)

  return {
    prompt_id: promptId,
    number: 1
  }
}

function createComfyHistory(promptId) {
  const indexes = comfyTasks.get(promptId) ?? selectFixtureIndexes(1)
  comfyTasks.set(promptId, indexes)

  return {
    [promptId]: {
      outputs: {
        'lightyear-output': {
          images: indexes.map((index) => ({
            filename: fixtureFiles[index].split('/').at(-1),
            subfolder: 'cats',
            type: 'output'
          }))
        }
      }
    }
  }
}

function sendComfySystemStats(response) {
  sendJson(response, 200, {
    system: {
      os: 'mock',
      python_version: '3.12.0',
      embedded_python: false
    },
    devices: [
      {
        name: 'Lightyear Mock GPU',
        type: 'mock',
        vram_total: 24 * 1024 * 1024 * 1024,
        vram_free: 18 * 1024 * 1024 * 1024
      }
    ]
  })
}

function sendComfyUpload(response) {
  sendJson(response, 200, {
    name: `lightyear-reference-${randomUUID()}.png`,
    subfolder: '',
    type: 'input'
  })
}

function createFluxResult(requestUrl) {
  const taskId = requestUrl.searchParams.get('id') ?? ''
  const fixtureIndex = fluxTasks.get(taskId) ?? selectFixtureIndexes(1)[0]

  return {
    id: taskId,
    status: 'Ready',
    result: {
      sample: createFixtureUrl(requestUrl, fixtureIndex)
    }
  }
}

function createCodexImageServerResponse(requestUrl, json) {
  const id = `mock-codex-${randomUUID()}`
  const fixtureIndex = selectFixtureIndexes(1)[0]
  codexImages.set(id, fixtureIndex)

  return {
    id,
    status: 'completed',
    model: 'gpt-image-2',
    resolved_size: json.size === '4k' ? readCodexResolvedSize(json.aspect) : 'auto',
    mime_type: 'image/jpeg',
    path: `/tmp/lightyear-banana/${id}.jpg`,
    url: `${requestUrl.origin}/v1/images/${id}/file`,
    revised_prompt: json.prompt ?? ''
  }
}

function readCodexResolvedSize(aspect) {
  if (aspect === 'portrait') {
    return '2160x3840'
  }

  if (aspect === 'square') {
    return '2880x2880'
  }

  return '3840x2160'
}

function createCodexCapabilities() {
  return {
    model: 'gpt-image-2',
    output_formats: ['png'],
    sizes: {
      auto: true,
      landscape_4k: '3840x2160',
      portrait_4k: '2160x3840',
      square_4k: '2880x2880'
    }
  }
}

function sendCodexImageFile(requestUrl, response, method) {
  const id = requestUrl.pathname.split('/').at(-2)
  const fixtureIndex = codexImages.get(id) ?? selectFixtureIndexes(1)[0]
  sendFixtureAsset(fixtureFiles[fixtureIndex % fixtureFiles.length], response, method)
}

function sendManual(response) {
  sendJson(response, 200, {
    server: 'Lightyear Banana Image API Mock Server',
    port: defaultMockImageApiPort,
    goodKeys: Object.fromEntries(Object.entries(goodKeys).map(([provider, keys]) => [provider, [...keys]])),
    badKeys: Object.fromEntries(badKeyModes),
    fixtures: fixtureFiles.map((file) => `/mock-images/${file}`),
    endpoints: [
      'POST /v1/images/generations',
      'POST /v1/images/edits',
      'POST /v1/flux-2-*',
      'GET /v1/get_result?id={task_id}',
      'GET /healthz',
      'GET /v1/capabilities',
      'POST /v1/images/generate',
      'GET /v1/images/{id}/file',
      'POST /v1beta/models/{model}:generateContent',
      'POST /api/v1/services/aigc/multimodal-generation/generation',
      'POST /api/v1/services/aigc/image-generation/generation',
      'GET /api/v1/tasks/{task_id}',
      'POST /api/v3/images/generations',
      'GET /system_stats',
      'POST /upload/image',
      'POST /prompt',
      'GET /history/{prompt_id}',
      'GET /view?filename={filename}&type=output'
    ]
  })
}

export function createMockImageApiServer() {
  return createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? `${defaultMockImageApiHost}:${defaultMockImageApiPort}`}`
    )
  const pathname = requestUrl.pathname

  if (request.method === 'OPTIONS') {
    sendOptions(response)
    return
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && pathname.startsWith('/mock-images/')) {
    sendStaticAsset(requestUrl, response, request.method)
    return
  }

  if (request.method === 'GET' && pathname === '/healthz') {
    sendJson(response, 200, { status: 'ok' })
    return
  }

  if (request.method === 'GET' && (pathname === '/health' || pathname === '/mock/manual')) {
    sendManual(response)
    return
  }

  const { raw, json } = request.method === 'POST' ? await readBody(request) : { raw: '', json: {} }
  const provider = inferProvider(pathname, json, raw)
  const authMode = authorize(provider, requestUrl, request.headers)
  if (authMode) {
    const [status, payload] = createProviderError(provider, authMode)
    setTimeout(() => sendJson(response, status, payload), authMode === 'timeout' ? 800 : 0)
    return
  }

  if (request.method === 'GET' && pathname === '/v1/capabilities') {
    sendJson(response, 200, createCodexCapabilities())
    return
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && /^\/v1\/images\/[^/]+\/file$/.test(pathname)) {
    sendCodexImageFile(requestUrl, response, request.method)
    return
  }

  if (request.method === 'GET' && pathname === '/system_stats') {
    sendComfySystemStats(response)
    return
  }

  if (request.method === 'GET' && pathname.startsWith('/history/')) {
    await sendGeneratedJson(response, 200, createComfyHistory(pathname.split('/').at(-1)))
    return
  }

  if (request.method === 'GET' && pathname === '/view') {
    const subfolder = requestUrl.searchParams.get('subfolder')
    const filename = requestUrl.searchParams.get('filename')
    sendFixtureAsset(`${subfolder ? `${subfolder}/` : ''}${filename}`, response, request.method)
    return
  }

  if (request.method === 'GET' && pathname.startsWith('/api/v1/tasks/')) {
    await sendGeneratedJson(response, 200, createKlingResult(requestUrl, pathname.split('/').at(-1)))
    return
  }

  if (request.method === 'GET' && pathname.startsWith('/v1/get_result')) {
    await sendGeneratedJson(response, 200, createFluxResult(requestUrl))
    return
  }

  if (request.method !== 'POST') {
    sendJson(response, 404, { error: { message: 'Not found', type: 'invalid_request_error', code: 'not_found' } })
    return
  }

  if (provider === 'comfyui' && pathname === '/upload/image') {
    sendComfyUpload(response)
    return
  }

  if (provider === 'comfyui' && pathname === '/prompt') {
    await sendGeneratedJson(response, 200, createComfyTask())
    return
  }

  if (provider === 'codex-image-server' && pathname === '/v1/images/generate') {
    await sendGeneratedJson(response, 200, createCodexImageServerResponse(requestUrl, json))
    return
  }

  const count = readCount(provider, json, raw)
  if (provider === 'gemini') {
    await sendGeneratedJson(response, 200, createGeminiResponse(pathname.match(/\/models\/(.+):generateContent/)?.[1] ?? '', count))
    return
  }

  if (provider === 'qwen') {
    await sendGeneratedJson(response, 200, createQwenResponse(requestUrl, count))
    return
  }

  if (provider === 'kling') {
    await sendGeneratedJson(response, 200, createKlingTask(count))
    return
  }

  if (provider === 'seedream') {
    await sendGeneratedJson(response, 200, createSeedreamResponse(requestUrl, count))
    return
  }

  if (provider === 'flux') {
    await sendGeneratedJson(response, 200, createFluxTask(requestUrl))
    return
  }

  await sendGeneratedJson(response, 200, createOpenAiResponse(requestUrl, count))
  })
}

export function listenMockImageApiServer() {
  const server = createMockImageApiServer()

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(defaultMockImageApiPort, defaultMockImageApiHost, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}

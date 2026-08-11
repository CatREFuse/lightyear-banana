import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import test from 'node:test'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, '..')
const serverScript = path.join(scriptsDir, 'mock-image-api-server.mjs')
const fixturePath = path.join(projectRoot, 'public', 'mock-images', 'cats', 'cat-01.jpg')

async function findAvailablePort() {
  const probe = createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const address = probe.address()
  const port = typeof address === 'object' && address ? address.port : 0
  probe.close()
  await once(probe, 'close')
  return port
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const timeout = setTimeout(() => reject(new Error(`Mock server did not start. ${stderr}`)), 5_000)
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.stdout.on('data', (chunk) => {
      if (!chunk.toString().includes('Lightyear Banana Image API Mock Server')) return
      clearTimeout(timeout)
      resolve()
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Mock server exited with code ${code}. ${stderr}`))
    })
  })
}

test('APIMart profile returns the same cat through its async task fixture', async (context) => {
  const port = await findAvailablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, [
    serverScript,
    '--profile', 'apimart',
    '--fixture', 'cats/cat-01.jpg',
    '--delay-min-ms', '0',
    '--delay-max-ms', '0'
  ], {
    cwd: projectRoot,
    env: { ...process.env, LIGHTYEAR_MOCK_IMAGE_API_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  context.after(async () => {
    if (child.exitCode !== null) return
    child.kill()
    await once(child, 'exit')
  })

  await waitForReady(child)
  const headers = { Authorization: 'Bearer mock-good-apimart' }

  const modelsResponse = await fetch(`${baseUrl}/v1/models`, { headers })
  assert.equal(modelsResponse.status, 200)
  const models = await modelsResponse.json()
  assert.ok(models.data.some((model) => model.id === 'gpt-image-2'))

  const uploadBody = new FormData()
  uploadBody.append('file', new Blob([await readFile(fixturePath)], { type: 'image/jpeg' }), 'cat.jpg')
  const uploadResponse = await fetch(`${baseUrl}/v1/uploads/images`, { method: 'POST', headers, body: uploadBody })
  assert.equal(uploadResponse.status, 200)
  assert.match((await uploadResponse.json()).url, /\/mock-images\/cats\/cat-01\.jpg$/)

  const generationResponse = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-2-official', prompt: 'cat fixture', n: 2 })
  })
  assert.equal(generationResponse.status, 200)
  const task = await generationResponse.json()
  assert.match(task.data.task_id, /^mock-apimart-/)

  const resultResponse = await fetch(`${baseUrl}/v1/tasks/${task.data.task_id}?language=zh`, { headers })
  assert.equal(resultResponse.status, 200)
  const result = await resultResponse.json()
  assert.equal(result.data.status, 'succeeded')
  assert.equal(result.data.result.images.length, 2)
  assert.equal(result.data.result.images[0].url, result.data.result.images[1].url)

  const [, base64] = result.data.result.images[0].url.split(',', 2)
  assert.deepEqual(Buffer.from(base64, 'base64'), await readFile(fixturePath))
})

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  parseEnv,
  copyBuildSnapshot,
  resolveInnerReleaseUrl,
  validatePublicLatestJson,
  verifyPublicReleaseIndex
} from './deploy-inner-webui.mjs'

const nginxTemplate = readFileSync(new URL('./deploy/nginx/inner-webui.conf.template', import.meta.url), 'utf8')

test('copies a nested WebUI snapshot without relying on recursive fs.cp', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mugen-webui-copy-'))
  try {
    const source = path.join(directory, 'source')
    const destination = path.join(directory, 'snapshot')
    mkdirSync(path.join(source, 'assets'), { recursive: true })
    writeFileSync(path.join(source, 'index.html'), '<main>Mugen</main>')
    writeFileSync(path.join(source, 'assets', '应用.js'), 'export default 1')
    copyBuildSnapshot(source, destination)
    assert.equal(readFileSync(path.join(destination, 'index.html'), 'utf8'), '<main>Mugen</main>')
    assert.equal(readFileSync(path.join(destination, 'assets', '应用.js'), 'utf8'), 'export default 1')
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('keeps the public WebUI CSP aligned with standalone Provider networking', () => {
  assert.match(nginxTemplate, /img-src 'self' data: blob: http: https:/)
  assert.match(nginxTemplate, /connect-src 'self' http: https:/)
  assert.doesNotMatch(nginxTemplate, /connect-src 'none'/)
})

test('ignores legacy lowercase deployment keys while keeping application settings strict', () => {
  assert.deepEqual(parseEnv([
    'server_ip=192.0.2.1',
    'password=local-only',
    'INNER_WEBUI_URL=https://webui.product.dev/'
  ].join('\n')), {
    INNER_WEBUI_URL: 'https://webui.product.dev/'
  })
  assert.throws(() => parseEnv('Mixed_Name=value'), /Invalid key.env name/)
})

const releaseRoot = new URL('https://downloads.product.dev/releases/')
const latest = {
  version: '1.2.3',
  releaseUrl: 'https://downloads.product.dev/releases/1.2.3/SHA256SUMS.txt',
  updateCheckUrl: 'https://downloads.product.dev/releases/latest.json',
  downloads: {
    windows: { url: 'https://downloads.product.dev/releases/1.2.3/app-win.zip' },
    nested: [{ url: 'https://downloads.product.dev/releases/1.2.3/app.ccx' }]
  }
}

function jsonResponse(value = latest, { status = 200, headers = {} } = {}) {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'application/json; charset=utf-8',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      ...headers
    }
  })
}

async function withMockFetch(response, operation) {
  const originalFetch = globalThis.fetch
  let requestedUrl
  globalThis.fetch = async (url) => {
    requestedUrl = String(url)
    return response
  }
  try {
    await operation(() => requestedUrl)
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('normalizes and validates the configured production release URL', () => {
  assert.equal(resolveInnerReleaseUrl(
    { INNER_RELEASE_URL: ' https://downloads.product.dev/releases ' },
    'https://webui.product.dev'
  ).href, releaseRoot.href)

  for (const value of [
    'http://downloads.product.dev/releases/',
    'https://user:secret@downloads.product.dev/releases/',
    'https://downloads.product.dev/releases/?token=secret',
    'https://downloads.product.dev/releases/#private',
    'https://cake.catrefuse.com/releases/'
  ]) {
    assert.throws(
      () => resolveInnerReleaseUrl({ INNER_RELEASE_URL: value }, 'https://webui.product.dev'),
      (error) => {
        assert.match(error.message, /credential-free approved HTTPS URL/)
        assert.equal(error.message.includes('secret'), false)
        return true
      }
    )
  }
})

test('validates all supported release manifest URL fields against INNER_RELEASE_URL origin', () => {
  assert.equal(validatePublicLatestJson(latest, releaseRoot), latest)

  for (const change of [
    { releaseUrl: 'https://other.product.dev/releases/1.2.3/SHA256SUMS.txt' },
    { updateCheckUrl: 'https://cake.catrefuse.com/releases/latest.json' },
    { downloads: { ccx: { url: 'https://other.product.dev/releases/1.2.3/app.ccx' } } },
    { downloads: { ccx: { url: 'https://user:secret@downloads.product.dev/releases/app.ccx' } } }
  ]) {
    assert.throws(
      () => validatePublicLatestJson({ ...latest, ...change }, releaseRoot),
      /configured INNER_RELEASE_URL origin/
    )
  }
  assert.throws(() => validatePublicLatestJson([], releaseRoot), /JSON object/)
  assert.throws(() => validatePublicLatestJson({ version: '' }, releaseRoot), /non-empty string/)
})

test('verifies latest.json status, security headers, cache policy, JSON, and URL origin', async () => {
  await withMockFetch(jsonResponse(), async (requestedUrl) => {
    const result = await verifyPublicReleaseIndex(releaseRoot)
    assert.equal(result.version, latest.version)
    const target = new URL(requestedUrl())
    assert.equal(target.origin + target.pathname, 'https://downloads.product.dev/releases/latest.json')
    assert.ok(target.searchParams.has('deployed'))
  })

  for (const [response, message] of [
    [jsonResponse(latest, { status: 204 }), /HTTP 204/],
    [jsonResponse(latest, { headers: { 'content-type': 'text/plain' } }), /Content-Type/],
    [jsonResponse(latest, { headers: { 'cache-control': 'private' } }), /no-store/],
    [jsonResponse(latest, { headers: { 'cache-control': 'public, no-store' } }), /public or immutable/],
    [jsonResponse(latest, { headers: { 'cache-control': 'no-store, immutable' } }), /public or immutable/],
    [jsonResponse(latest, { headers: { 'cache-control': 'no-store, max-age=60' } }), /public or immutable/],
    [jsonResponse(latest, { headers: { 'cache-control': 'no-store, max-age="60"' } }), /public or immutable/],
    [jsonResponse(latest, { headers: { 'strict-transport-security': '' } }), /HSTS/],
    [jsonResponse(latest, { headers: { 'x-content-type-options': '' } }), /nosniff/],
    [new Response('{', { status: 200, headers: jsonResponse().headers }), /valid JSON/],
    [jsonResponse({ ...latest, releaseUrl: 'https://other.product.dev/releases/file' }), /configured INNER_RELEASE_URL origin/]
  ]) {
    await withMockFetch(response, async () => {
      await assert.rejects(() => verifyPublicReleaseIndex(releaseRoot), message)
    })
  }
})

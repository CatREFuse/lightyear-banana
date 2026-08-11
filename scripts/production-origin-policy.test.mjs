import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertProductionOrigin,
  isDisallowedProductionHostname,
  normalizeProductionHostname,
  resolveReleaseUrl
} from './production-origin-policy.mjs'

test('normalizes case, whitespace, and one DNS root label', () => {
  assert.equal(normalizeProductionHostname(' WebUI.Product.DEV. '), 'webui.product.dev')
})

test('accepts deployable fully qualified hostnames', () => {
  for (const hostname of ['webui.product.dev', 'staging.product.cn', 'xn--fiqs8s.example.dev']) {
    assert.equal(isDisallowedProductionHostname(hostname), false, hostname)
  }
})

test('rejects documentation, legacy, local, reserved, and address hostnames', () => {
  for (const hostname of [
    '',
    'webui',
    'cake.catrefuse.com',
    'inner.cake.catrefuse.com',
    'webui.catrefuse.com',
    'example.com',
    'webui.example.net',
    'webui.invalid',
    'inner.localhost',
    'inner.local',
    '127.0.0.1',
    '[::1]',
    'bad_label.product.dev',
    '-bad.product.dev'
  ]) {
    assert.equal(isDisallowedProductionHostname(hostname), true, hostname)
  }
})

test('requires one exact approved HTTPS origin', () => {
  assert.equal(assertProductionOrigin('https://webui.product.dev'), 'https://webui.product.dev')

  for (const origin of [
    'http://webui.product.dev',
    'https://webui.product.dev/',
    'https://user@webui.product.dev',
    'https://webui.product.dev/path',
    'https://webui.product.dev?debug=1',
    'https://example.com'
  ]) {
    assert.throws(() => assertProductionOrigin(origin), /exact approved HTTPS origin|exact HTTPS origin/)
  }
})

test('resolves release URL precedence and normalizes its trailing slash', () => {
  const common = {
    webviewOrigin: 'https://webui.product.dev',
    production: true
  }
  assert.equal(resolveReleaseUrl(common).href, 'https://webui.product.dev/releases/')
  assert.equal(resolveReleaseUrl({
    ...common,
    keyEnvironment: { INNER_RELEASE_URL: 'https://releases.key.dev/downloads' }
  }).href, 'https://releases.key.dev/downloads/')
  assert.equal(resolveReleaseUrl({
    ...common,
    processEnvironment: { INNER_RELEASE_URL: 'https://releases.process.dev/current' },
    keyEnvironment: { INNER_RELEASE_URL: 'https://releases.key.dev/downloads/' }
  }).href, 'https://releases.process.dev/current/')
})

test('uses Vite release URL only outside production', () => {
  const viteEnvironment = { INNER_RELEASE_URL: 'https://preview.product.dev/releases/' }
  assert.equal(resolveReleaseUrl({
    webviewOrigin: 'https://webui.product.dev',
    viteEnvironment,
    production: false
  }).href, viteEnvironment.INNER_RELEASE_URL)
  assert.equal(resolveReleaseUrl({
    webviewOrigin: 'https://webui.product.dev',
    viteEnvironment,
    production: true
  }).href, 'https://webui.product.dev/releases/')
})

test('rejects unsafe release URLs without exposing their contents', () => {
  for (const releaseUrl of [
    'http://releases.product.dev/releases/',
    'https://user:password@releases.product.dev/releases/',
    'https://releases.product.dev/releases/?token=secret',
    'https://releases.product.dev/releases/#private',
    'https://cake.catrefuse.com/releases/',
    'https://example.com/releases/'
  ]) {
    assert.throws(
      () => resolveReleaseUrl({
        processEnvironment: { INNER_RELEASE_URL: releaseUrl },
        webviewOrigin: 'https://webui.product.dev',
        production: true
      }),
      (error) => {
        assert.match(error.message, /credential-free approved HTTPS URL/)
        assert.equal(error.message.includes('password'), false)
        assert.equal(error.message.includes('secret'), false)
        return true
      }
    )
  }
})

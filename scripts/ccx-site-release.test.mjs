import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyCcxRelease, verifySiteMetadata } from './verify-release-bundle.mjs'

function write(root, relativePath, contents) {
  const target = path.join(root, relativePath)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

function json(root, relativePath, value) {
  write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'mugen-ccx-site-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const contents = Buffer.from('verified bundled WebUI CCX')
  const sha256 = createHash('sha256').update(contents).digest('hex')
  const filename = 'mugen-1.0.0.ccx'
  const origin = '__MUGEN_RELEASE_ORIGIN__'
  const publishedAt = '2026-08-11T00:00:00.000Z'
  const releaseUrl = `${origin}/releases/1.0.0/SHA256SUMS.txt`

  json(root, 'plugin/manifest.json', { version: '1.0.0' })
  write(root, `dist/${filename}`, contents)
  write(root, `dist/${filename}.sha256`, `${sha256}  ${filename}\n`)
  json(root, 'dist/ccx-release.json', {
    schemaVersion: 1,
    ccxVersion: '1.0.0',
    filename,
    sha256,
    webviewOrigin: 'https://mugen.catrefuse.com',
    releaseUrl: 'https://mugen.catrefuse.com/releases/',
    builtAt: publishedAt,
    sourceCommit: 'a'.repeat(40),
    dirty: false
  })
  json(root, 'site/releases/latest.json', {
    product: 'mugen',
    name: '无幻 Mugen',
    version: '1.0.0',
    tag: 'v1.0.0',
    minimumSupportedVersion: '1.0.0',
    publishedAt,
    releaseUrl,
    updateCheckUrl: `${origin}/releases/latest.json`,
    mandatory: false,
    downloads: {
      ccx: {
        platform: 'photoshop-ccx',
        filename,
        url: `${origin}/releases/1.0.0/${filename}`,
        sha256,
        size: contents.length
      }
    }
  })
  write(root, 'site/index.html', `<a data-download="ccx" href="${origin}/releases/1.0.0/${filename}"><span>Download CCX</span></a><a data-open-webui href="./webui/"><span>Open WebUI</span></a><p>Specimen <span data-ccx-version>1.0.0</span></p>`)
  const llms = `# Mugen\n\nCurrent version: 1.0.0\nMinimum supported version: 1.0.0\nPublished at: ${publishedAt}\n\nVersion check:\nGET ${origin}/releases/latest.json\n\nManifest:\n${origin}/releases/latest.json\n\nRelease checksums:\n${releaseUrl}\n\nAdobe Photoshop plugin:\n${origin}/releases/1.0.0/${filename}\nsha256: ${sha256}\nsize: ${contents.length} bytes\n`
  write(root, 'site/llms.txt', llms)
  write(root, 'site/LLM.TXT', llms)
  return { root }
}

test('verifies a CCX-only website against the independent plugin version', async (t) => {
  const { root } = fixture(t)
  const bundle = await verifyCcxRelease({ root })
  const verified = await verifySiteMetadata({ root, bundle })

  assert.equal(bundle.version, '1.0.0')
  assert.equal(bundle.ccxMetadataPath, path.join(root, 'dist/ccx-release.json'))
  assert.equal(bundle.ccxMetadata.filename, 'mugen-1.0.0.ccx')
  assert.equal('uxpMetadata' in bundle, false)
  assert.equal('uxpMetadataPath' in bundle, false)
  assert.deepEqual(Object.keys(bundle.artifacts), ['ccx'])
  assert.deepEqual(Object.keys(verified.latest.downloads), ['ccx'])
})

test('rejects dirty CCX provenance and desktop downloads', async (t) => {
  const { root } = fixture(t)
  const metadataPath = path.join(root, 'dist/ccx-release.json')
  const metadata = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(metadataPath, 'utf8')))
  json(root, 'dist/ccx-release.json', { ...metadata, dirty: true })
  await assert.rejects(verifyCcxRelease({ root }), /dirty/)

  json(root, 'dist/ccx-release.json', metadata)
  const latestPath = path.join(root, 'site/releases/latest.json')
  const latest = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(latestPath, 'utf8')))
  json(root, 'site/releases/latest.json', { ...latest, downloads: { ...latest.downloads, mac: {} } })
  const bundle = await verifyCcxRelease({ root })
  await assert.rejects(verifySiteMetadata({ root, bundle }), /download keys/)
})

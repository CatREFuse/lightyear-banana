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

  json(root, 'plug-in/manifest.json', { version: '1.0.0' })
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
  write(root, 'homesite/site/index.html', `<a data-download="ccx" href="${origin}/download/${filename}"><span>Download CCX</span></a><a data-open-webui href="./webui/"><span>Open WebUI</span></a><p>Specimen <span data-ccx-version>1.0.0</span></p>`)
  const llms = `# Mugen\n\nCurrent version: 1.0.0\nPackaged at: ${publishedAt}\n\nAdobe Photoshop plugin:\n${origin}/download/${filename}\nsha256: ${sha256}\nsize: ${contents.length} bytes\n`
  write(root, 'homesite/site/llms.txt', llms)
  write(root, 'homesite/site/LLM.TXT', llms)
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
  assert.equal(verified.download.url, 'https://mugen.catrefuse.com/download/mugen-1.0.0.ccx')
})

test('rejects dirty CCX provenance and legacy release download links', async (t) => {
  const { root } = fixture(t)
  const metadataPath = path.join(root, 'dist/ccx-release.json')
  const metadata = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(metadataPath, 'utf8')))
  json(root, 'dist/ccx-release.json', { ...metadata, dirty: true })
  await assert.rejects(verifyCcxRelease({ root }), /dirty/)

  json(root, 'dist/ccx-release.json', metadata)
  write(root, 'homesite/site/index.html', '<a data-download="ccx" href="https://mugen.catrefuse.com/releases/1.0.0/mugen-1.0.0.ccx"><span>Download CCX</span></a><a data-open-webui href="./webui/"><span>Open WebUI</span></a><p>Specimen <span data-ccx-version>1.0.0</span></p>')
  const bundle = await verifyCcxRelease({ root })
  await assert.rejects(verifySiteMetadata({ root, bundle }), /CCX href/)
})

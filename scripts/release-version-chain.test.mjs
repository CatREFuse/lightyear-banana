import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifyReleaseBundle } from './verify-release-bundle.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function writeFixture(root, relativePath, contents) {
  const target = path.join(root, relativePath)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

function writeJsonFixture(root, relativePath, value) {
  writeFixture(root, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

function createTemporaryRoot(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'mugen-version-chain-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('desktop stamping leaves the CCX manifests and Electron package selection independent', (t) => {
  const root = createTemporaryRoot(t)
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  cpSync(path.join(projectRoot, 'scripts', 'stamp-release-version.mjs'), path.join(root, 'scripts', 'stamp-release-version.mjs'))

  writeJsonFixture(root, 'package.json', { version: '0.3.19' })
  writeJsonFixture(root, 'package-lock.json', { version: '0.3.19', packages: { '': { version: '0.3.19' } } })
  writeJsonFixture(root, 'plugin/manifest.json', { version: '1.0.0' })
  writeFixture(root, 'electron/main.js', "const CCX_RELEASE_METADATA_FILE = 'ccx-release.json'\n")
  writeFixture(root, 'src/buildInfo.ts', "export const buildInfo = { version: '0.3.19', buildNumber: '202608090001', displayVersion: 'v0.3.19+202608090001' }\n")
  writeFixture(
    root,
    'README.md',
    'mugen-0.3.19-mac.zip\nmugen-0.3.19-win.zip\nmugen-0.3.19.ccx\ndist/release-0.3.19/\n'
  )

  execFileSync(
    process.execPath,
    [path.join(root, 'scripts', 'stamp-release-version.mjs'), '--version', '9.8.7', '--build-number', '202608100001'],
    { cwd: root, stdio: 'pipe' }
  )

  assert.equal(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version, '9.8.7')
  assert.equal(JSON.parse(readFileSync(path.join(root, 'plugin/manifest.json'), 'utf8')).version, '1.0.0')
  assert.equal(readFileSync(path.join(root, 'electron/main.js'), 'utf8'), "const CCX_RELEASE_METADATA_FILE = 'ccx-release.json'\n")
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.match(readme, /mugen-9\.8\.7-mac\.zip/)
  assert.match(readme, /mugen-1\.0\.0\.ccx/)
  assert.doesNotMatch(readme, /mugen-9\.8\.7\.ccx/)
})

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

function createReleaseFixture(t, { metadataVersion = '1.0.0' } = {}) {
  const root = createTemporaryRoot(t)
  const electronVersion = '0.3.19'
  const ccxVersion = '1.0.0'
  const filenames = {
    mac: `mugen-${electronVersion}-mac.zip`,
    windows: `mugen-${electronVersion}-win.zip`,
    ccx: `mugen-${ccxVersion}.ccx`
  }
  const contents = {
    mac: Buffer.from('native macOS archive'),
    windows: Buffer.from('native Windows archive'),
    ccx: Buffer.from('verified CCX archive')
  }
  const releaseDir = path.join(root, 'dist', `release-${electronVersion}`)

  writeJsonFixture(root, 'package.json', { version: electronVersion })
  writeJsonFixture(root, 'plugin/manifest.json', { version: ccxVersion })
  for (const key of Object.keys(filenames)) {
    writeFixture(root, path.join('dist', `release-${electronVersion}`, filenames[key]), contents[key])
  }
  writeFixture(
    root,
    path.join('dist', `release-${electronVersion}`, 'SHA256SUMS.txt'),
    `${Object.keys(filenames).map((key) => `${sha256(contents[key])}  ${filenames[key]}`).join('\n')}\n`
  )
  writeJsonFixture(root, 'dist/ccx-release.json', {
    schemaVersion: 1,
    ccxVersion: metadataVersion,
    filename: filenames.ccx,
    sha256: sha256(contents.ccx),
    webviewOrigin: 'https://inner.example.dev',
    releaseUrl: 'https://downloads.example.dev/releases/',
    builtAt: '2026-08-10T00:00:00.000Z'
  })

  return { root, releaseDir, filenames }
}

test('release bundle uses desktop and CCX versions for their own filenames', async (t) => {
  const fixture = createReleaseFixture(t)
  const bundle = await verifyReleaseBundle({ root: fixture.root })

  assert.equal(bundle.version, '0.3.19')
  assert.equal(bundle.electronVersion, '0.3.19')
  assert.equal(bundle.ccxVersion, '1.0.0')
  assert.equal(bundle.ccxMetadataPath, path.join(fixture.root, 'dist', 'ccx-release.json'))
  assert.equal(bundle.ccxMetadata.ccxVersion, '1.0.0')
  assert.equal('uxpMetadata' in bundle, false)
  assert.equal('uxpMetadataPath' in bundle, false)
  assert.equal(bundle.releaseDir, fixture.releaseDir)
  assert.equal(bundle.artifacts.mac.filename, 'mugen-0.3.19-mac.zip')
  assert.equal(bundle.artifacts.windows.filename, 'mugen-0.3.19-win.zip')
  assert.equal(bundle.artifacts.ccx.filename, 'mugen-1.0.0.ccx')
})

test('release bundle rejects CCX metadata that disagrees with the manifests', async (t) => {
  const fixture = createReleaseFixture(t, { metadataVersion: '1.0.1' })
  await assert.rejects(
    verifyReleaseBundle({ root: fixture.root }),
    /ccx-release\.json ccxVersion is "1\.0\.1", expected "1\.0\.0"/
  )
})

test('Electron selects the CCX through release metadata and keeps its own version source', () => {
  const source = readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8')
  assert.match(source, /const CCX_PACKAGE_FILE = readCcxPackageFile\(\)/)
  assert.match(source, /metadata\?\.schemaVersion !== 1/)
  assert.match(source, /metadata\.filename !== `mugen-\$\{metadata\.ccxVersion\}\.ccx`/)
  assert.match(source, /new URL\('latest\.json', selectedCcxReleaseMetadata\.releaseUrl\)/)
  assert.doesNotMatch(source, /cake\.catrefuse\.com/)
  assert.doesNotMatch(source, /CCX_PACKAGE_FILE\.match\(/)
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { retentionCommand, verifyThenRetainCurrent } from './release-retention.mjs'

function fixture(t, kind = 'site') {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'mugen-retention-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const marker = kind === 'site' ? 'site-release.json' : 'release.json'
  for (const name of ['old-release', 'current-release']) {
    mkdirSync(`${root}/releases/${name}/assets`, { recursive: true })
    writeFileSync(`${root}/releases/${name}/${marker}`, '{}')
    writeFileSync(`${root}/releases/${name}/index.html`, name)
  }
  const current = `${root}/releases/current-release`
  symlinkSync(current, `${root}/current`)
  symlinkSync(`${root}/releases/old-release`, `${root}/previous`)
  mkdirSync(`${root}/.incoming/this-upload`, { recursive: true })
  mkdirSync(`${root}/.incoming/other-upload`)
  writeFileSync(`${root}/.incoming/this-upload/archive.tar`, 'upload')
  writeFileSync(`${root}/business-data`, 'preserve')
  return { root, current }
}
function run(...args) {
  return execFileSync('sh', ['-c', retentionCommand(...args)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

test('uses a download URL path when filename is descriptive metadata', t => {
  const { root } = fixture(t)
  const source = `${root}/downloads`, target = `${root}/new-downloads`
  mkdirSync(`${source}/0.3.17`, { recursive: true }); mkdirSync(target)
  writeFileSync(`${source}/latest.json`, JSON.stringify({ downloads: {
    ccx: { filename: 'old.ccx', url: 'https://mugen.catrefuse.com/releases/0.3.17/old.ccx' }
  } }))
  writeFileSync(`${source}/0.3.17/old.ccx`, 'original verified package')
  run('copy-downloads', source, target)
  assert.equal(readFileSync(`${target}/0.3.17/old.ccx`, 'utf8'), 'original verified package')
  assert.deepEqual(readdirSync(target).sort(), ['0.3.17', 'latest.json'])
})

test('still rejects a missing standalone filename reference', t => {
  const { root } = fixture(t)
  const source = `${root}/downloads`, target = `${root}/new-downloads`
  mkdirSync(source); mkdirSync(target)
  writeFileSync(`${source}/latest.json`, JSON.stringify({ filename: 'missing.ccx' }))
  assert.throws(() => run('copy-downloads', source, target))
  assert.deepEqual(readdirSync(target), [])
})

test('successful cleanup retains current bytes/downloads, removes history and only this incoming package', t => {
  const { root, current } = fixture(t)
  mkdirSync(`${current}/download`)
  writeFileSync(`${current}/download/current.ccx`, 'current package')
  run('prune', root, current, 'site', `${root}/.incoming/this-upload`)
  assert.deepEqual(readdirSync(`${root}/releases`), ['current-release'])
  assert.equal(readFileSync(`${current}/index.html`, 'utf8'), 'current-release')
  assert.equal(readFileSync(`${current}/download/current.ccx`, 'utf8'), 'current package')
  assert.equal(existsSync(`${root}/previous`), false)
  assert.equal(existsSync(`${root}/.incoming/this-upload`), false)
  assert.equal(existsSync(`${root}/.incoming/other-upload`), true)
  assert.equal(readFileSync(`${root}/business-data`, 'utf8'), 'preserve')
  run('prune', root, current, 'site', `${root}/.incoming/this-upload`)
})

test('a concurrent activation prevents every deletion', t => {
  const { root } = fixture(t)
  assert.throws(() => run('prune', root, `${root}/releases/old-release`, 'site'))
  assert.equal(existsSync(`${root}/releases/old-release/index.html`), true)
  assert.equal(existsSync(`${root}/previous`), true)
})

for (const fault of ['release-symlink', 'unknown-data', 'external-current', 'external-previous', 'root-symlink', 'incoming-symlink']) {
  test(`rejects ${fault} before deleting history`, t => {
    const { root, current } = fixture(t)
    let candidateRoot = root
    if (fault === 'release-symlink') symlinkSync(current, `${root}/releases/alias`)
    if (fault === 'unknown-data') mkdirSync(`${root}/releases/business-data`)
    if (fault === 'external-current') { unlinkSync(`${root}/current`); symlinkSync(root, `${root}/current`) }
    if (fault === 'external-previous') { unlinkSync(`${root}/previous`); symlinkSync(root, `${root}/previous`) }
    if (fault === 'root-symlink') { candidateRoot = `${root}/alias`; symlinkSync(root, candidateRoot) }
    if (fault === 'incoming-symlink') { rmSync(`${root}/.incoming/this-upload`, { recursive: true }); symlinkSync(current, `${root}/.incoming/this-upload`) }
    assert.throws(() => run('prune', candidateRoot, current, 'site', `${root}/.incoming/this-upload`))
    assert.equal(existsSync(`${root}/releases/old-release/index.html`), true)
  })
}

test('WebUI retains current shared assets and drops obsolete hashed resources', t => {
  const { root, current } = fixture(t, 'webui')
  mkdirSync(`${root}/assets`)
  writeFileSync(`${root}/assets/current.js`, 'current')
  writeFileSync(`${current}/assets/current.js`, 'current')
  writeFileSync(`${root}/assets/old.js`, 'old')
  run('prune', root, current, 'webui')
  assert.deepEqual(readdirSync(`${root}/assets`), ['current.js'])
  assert.deepEqual(readdirSync(`${root}/releases`), ['current-release'])
})

test('copies only index references, including nested indexes, without copying old installers', t => {
  const { root } = fixture(t)
  const source = `${root}/downloads`, target = `${root}/new-downloads`
  mkdirSync(source); mkdirSync(target)
  writeFileSync(`${source}/latest.json`, JSON.stringify({ url: 'https://mugen.catrefuse.com/releases/active.json' }))
  writeFileSync(`${source}/active.json`, JSON.stringify({ url: '/releases/active.ccx', checksumUrl: 'SHA256SUMS.txt' }))
  writeFileSync(`${source}/active.ccx`, 'active')
  writeFileSync(`${source}/SHA256SUMS.txt`, 'checksum')
  writeFileSync(`${source}/obsolete.zip`, 'old 2GB installer')
  run('copy-downloads', source, target)
  assert.deepEqual(readdirSync(target).sort(), ['SHA256SUMS.txt', 'active.ccx', 'active.json', 'latest.json'])
  assert.equal(readFileSync(`${target}/active.ccx`, 'utf8'), 'active')
})

for (const url of ['/releases/%2e%2e/private.key', '/releases/missing.ccx']) {
  test(`rejects invalid referenced download ${url} without copying partial output`, t => {
    const { root } = fixture(t)
    const source = `${root}/downloads`, target = `${root}/new-downloads`
    mkdirSync(source); mkdirSync(target)
    writeFileSync(`${source}/latest.json`, JSON.stringify({ url }))
    assert.throws(() => run('copy-downloads', source, target))
    assert.deepEqual(readdirSync(target), [])
  })
}

for (const kind of ['site', 'webui']) {
  test(`${kind}: failed public verification leaves recovery files untouched`, async t => {
    const { root, current } = fixture(t, kind)
    await assert.rejects(verifyThenRetainCurrent(
      async () => { throw new Error('public hash mismatch') },
      () => run('prune', root, current, kind, `${root}/.incoming/this-upload`)
    ), /public hash mismatch/)
    assert.equal(existsSync(`${root}/releases/old-release/index.html`), true)
    assert.equal(existsSync(`${root}/previous`), true)
    assert.equal(existsSync(`${root}/.incoming/this-upload/archive.tar`), true)
  })
}

test('verified rollback uses the same retention step to remove failed snapshot', async t => {
  const { root, current } = fixture(t)
  unlinkSync(`${root}/current`)
  symlinkSync(`${root}/releases/old-release`, `${root}/current`)
  await verifyThenRetainCurrent(async () => 'restored public bytes match',
    () => run('prune', root, `${root}/releases/old-release`, 'site', `${root}/.incoming/this-upload`))
  assert.deepEqual(readdirSync(`${root}/releases`), ['old-release'])
  assert.equal(existsSync(current), false)
})

test('cleanup failure is distinguished from public verification failure to prevent unsafe rollback', async t => {
  const { root, current } = fixture(t)
  mkdirSync(`${root}/releases/unknown-data`)
  await assert.rejects(verifyThenRetainCurrent(async () => 'verified',
    () => run('prune', root, current, 'site')), error => error.code === 'RELEASE_RETENTION_FAILED')
  assert.equal(existsSync(`${current}/index.html`), true)
})

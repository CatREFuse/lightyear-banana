import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  calculateSnapshotHash,
  assertGitSiteProvenanceUnchanged,
  createActivationCommand,
  createActivationReconciliationCommand,
  createCleanupCommand,
  createFileRecords,
  createPrepareCommand,
  createRollbackCommand,
  createRollbackInspectionCommand,
  createRollbackReconciliationCommand,
  createSha256Manifest,
  createSiteSnapshot,
  executeWithStateReconciliation,
  makeSiteId,
  parseActivationOutput,
  parseActivationReconciliationOutput,
  parseEnv,
  parsePrepareOutput,
  parseRollbackOutput,
  parseRollbackReconciliationOutput,
  readCcxDeploymentMetadata,
  resolvePublicSiteUrl,
  resolveSshConfiguration,
  scpArguments,
  sshArguments,
  validateLocalCcxPayload,
  validateRemoteRoot,
  verifyPublicRollback,
  verifyPublicFullSiteManifest,
  verifyPublicSite
} from './deploy-site.mjs'
import {
  createSiteManifest,
  createSiteReleaseMetadata,
  validateSiteReleaseMetadata
} from './site-release-provenance.mjs'

const remoteRoot = '/etc/nginx/static/mugen-site'
const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)

function write(root, relative, contents = relative) {
  const target = path.join(root, ...relative.split('/'))
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
  return target
}

function temporaryRoot(context, prefix = 'mugen-site-deploy-test-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix))
  context.after(() => rmSync(root, { force: true, recursive: true }))
  return root
}

function createSiteFixture(context) {
  const root = temporaryRoot(context)
  for (const file of [
    'index.html',
    'styles.css',
    'app.js',
    'prism-optics.js',
    'prism-scene.js',
    'assets/mugen-wordmark-imagegen-v2-4k.png',
    'vendor/three.module.min.js'
  ]) write(root, file, `fixture:${file}`)
  write(root, 'vendor/THREE-LICENSE.txt', 'license')
  write(root, 'download/mugen-1.0.2-2608140002.ccx', 'current download')
  const release = createSiteReleaseMetadata({
    builtAt: '2026-08-12T03:04:05.000Z',
    commit: '1'.repeat(40),
    directory: root,
    dirty: false
  })
  write(root, 'site-release.json', `${JSON.stringify(release, null, 2)}\n`)
  write(root, 'site-manifest.json', `${JSON.stringify(createSiteManifest(root, release), null, 2)}\n`)
  return root
}

test('root deploy command forwards release arguments to the homesite script', () => {
  const rootPackage = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(rootPackage.scripts['deploy:site'], 'npm --workspace @mugen/homesite run deploy --')
})

test('creates a stable full site snapshot with one versioned download', (context) => {
  const source = createSiteFixture(context)
  const destination = path.join(temporaryRoot(context), 'snapshot')
  const result = createSiteSnapshot(source, destination)

  assert.ok(result.records.length >= 8)
  assert.equal(result.records.some((record) => record.path === 'download/mugen-1.0.2-2608140002.ccx'), true)
  assert.equal(existsSync(path.join(destination, 'releases')), false)
  assert.equal(readFileSync(path.join(destination, 'index.html'), 'utf8'), 'fixture:index.html')
  assert.equal(result.snapshotHash, calculateSnapshotHash(createFileRecords(destination)))
  assert.match(createSha256Manifest(result.records), /^[a-f0-9]{64}  \.\/assets\/mugen-wordmark-imagegen-v2-4k\.png/m)
})

test('refuses a build without the versioned download CCX', (context) => {
  const source = createSiteFixture(context)
  rmSync(path.join(source, 'download', 'mugen-1.0.2-2608140002.ccx'))
  assert.throws(
    () => createSiteSnapshot(source, path.join(temporaryRoot(context), 'snapshot')),
    /exactly one versioned CCX/
  )
})

test('derives and validates the immutable local Mugen 1.0.1 CCX from release metadata', (context) => {
  const root = temporaryRoot(context)
  const contents = Buffer.from('ccx fixture bytes')
  const digest = createHash('sha256').update(contents).digest('hex')
  const fileName = 'mugen-1.0.1.ccx'
  const rootCcx = write(root, `dist/${fileName}`, contents)
  const siteCcx = write(root, `dist/site/releases/1.0.1/${fileName}`, contents)
  const rootSidecar = write(root, `dist/${fileName}.sha256`, `${digest}  ${fileName}\n`)
  const siteSidecar = write(root, 'dist/site/releases/1.0.1/SHA256SUMS.txt', `${digest}  ${fileName}\n`)
  write(root, 'plug-in/manifest.json', JSON.stringify({ version: '1.0.1' }))
  write(root, 'dist/ccx-release.json', JSON.stringify({
    schemaVersion: 1,
    ccxVersion: '1.0.1',
    filename: fileName,
    sha256: digest,
    sourceCommit: 'a'.repeat(40),
    dirty: false
  }))

  assert.equal(readCcxDeploymentMetadata({ projectDirectory: root }).version, '1.0.1')
  assert.deepEqual(validateLocalCcxPayload({ projectDirectory: root, rootCcx, rootSidecar, siteCcx, siteSidecar }), {
    checksum: {
      fileName: 'SHA256SUMS.txt',
      path: siteSidecar,
      sha256: createHash('sha256').update(`${digest}  ${fileName}\n`).digest('hex'),
      size: Buffer.byteLength(`${digest}  ${fileName}\n`)
    },
    destination: 'releases/1.0.1/mugen-1.0.1.ccx',
    fileName,
    path: siteCcx,
    sha256: digest,
    size: contents.length,
    version: '1.0.1'
  })

  writeFileSync(siteCcx, 'changed')
  assert.throws(
    () => validateLocalCcxPayload({ projectDirectory: root, rootCcx, rootSidecar, siteCcx, siteSidecar }),
    /do not match/
  )
})

test('rejects a CCX deployment version that disagrees with the plugin manifest', (context) => {
  const root = temporaryRoot(context)
  write(root, 'plug-in/manifest.json', JSON.stringify({ version: '1.0.1' }))
  write(root, 'dist/ccx-release.json', JSON.stringify({
    schemaVersion: 1,
    ccxVersion: '1.0.0',
    filename: 'mugen-1.0.0.ccx',
    sha256: 'a'.repeat(64),
    sourceCommit: 'b'.repeat(40),
    dirty: false
  }))
  assert.throws(
    () => readCcxDeploymentMetadata({ projectDirectory: root }),
    /does not match the active plugin manifest/
  )
})

test('uses only BatchMode public-key SSH and never consumes unrelated secret settings', () => {
  const environmentWithPassword = parseEnv([
    'DEPLOY_SSH_HOST=host.example',
    'DEPLOY_SSH_USER=deployer',
    'DEPLOY_SSH_PORT=2222',
    'DEPLOY_SSH_PASSWORD=must-not-be-used',
    'password=also-rejected',
    'server_ip=host.example',
    'domain=mugen.product.dev',
    'secondary_domain=www.mugen.product.dev'
  ].join('\n'))
  assert.throws(
    () => resolveSshConfiguration(environmentWithPassword),
    (error) => /Password deployment values are unsupported/.test(error.message) && !/must-not-be-used|also-rejected/.test(error.message)
  )
  const environment = { ...environmentWithPassword }
  delete environment.DEPLOY_SSH_PASSWORD
  delete environment.password
  const configuration = resolveSshConfiguration(environment)
  assert.deepEqual(configuration, {
    host: 'host.example',
    identityFile: undefined,
    port: '2222',
    target: 'deployer@host.example',
    user: 'deployer'
  })
  const argumentsText = [...sshArguments(configuration), ...scpArguments(configuration)].join(' ')
  assert.match(argumentsText, /BatchMode=yes/)
  assert.match(argumentsText, /PasswordAuthentication=no/)
  assert.match(argumentsText, /KbdInteractiveAuthentication=no/)
  assert.match(argumentsText, /PreferredAuthentications=publickey/)
  assert.doesNotMatch(argumentsText, /must-not-be-used|also-ignored/)
  assert.equal(resolveSshConfiguration({ server_ip: 'host.example' }).host, 'host.example')
  assert.throws(
    () => resolveSshConfiguration({ DEPLOY_SSH_HOST: 'one.example', server_ip: 'two.example' }),
    /different deployment hosts/
  )
  assert.throws(() => resolveSshConfiguration({ DEPLOY_SSH_HOST: '-oProxyCommand=bad' }), /unsupported/)
  assert.throws(() => resolveSshConfiguration({ DEPLOY_SSH_HOST: 'host', DEPLOY_SSH_PORT: '0' }), /invalid/)
})

test('pins the official remote root and creates unique immutable site IDs', () => {
  assert.equal(validateRemoteRoot(), remoteRoot)
  assert.throws(() => validateRemoteRoot('/etc/nginx/static'), /must be/)
  assert.equal(
    makeSiteId(hashA, new Date('2026-08-12T03:04:05.000Z'), '1234abcd'),
    '20260812T030405Z-aaaaaaaaaaaa-1234abcd'
  )
})

test('prepares a locked unique incoming directory and captures the protected release state', () => {
  const markerName = 'site-rollback-12345678.sha256.txt'
  const manifest = `${hashB}  ./app.js\n${hashA}  ./index.html\n`
  const markerSha256 = createHash('sha256').update(manifest).digest('hex')
  const command = createPrepareCommand({ incoming: `${remoteRoot}/.incoming/token`, markerName })
  assert.match(command, /flock -n 9/)
  assert.match(command, /current must be an existing symlink/)
  assert.match(command, /current_target\/releases\/latest\.json/)
  assert.match(command, /mkdir .*\.incoming\/token/)
  assert.match(command, /find \. -path \.\/releases -prune/)
  assert.deepEqual(parsePrepareOutput([
    `__MUGEN_CURRENT__${remoteRoot}/releases/old-site`,
    '__MUGEN_PREVIOUS____MUGEN_NONE__',
    `__MUGEN_LATEST_SHA__${hashA}`,
    `__MUGEN_ROLLBACK_MARKER__${markerName}`,
    `__MUGEN_ROLLBACK_MARKER_SHA__${markerSha256}`,
    '__MUGEN_ROLLBACK_MANIFEST_BEGIN__',
    manifest.trimEnd(),
    '__MUGEN_ROLLBACK_MANIFEST_END__'
  ].join('\n')), {
    current: `${remoteRoot}/releases/old-site`,
    latestSha: hashA,
    rollback: {
      manifest,
      markerName,
      markerSha256,
      records: [
        { path: 'app.js', sha256: hashB },
        { path: 'index.html', sha256: hashA }
      ]
    }
  })
})

test('activation preserves current releases, verifies every file, records previous, and atomically switches current', () => {
  const oldTarget = `${remoteRoot}/releases/old-site`
  const siteId = '20260812T030405Z-aaaaaaaaaaaa-1234abcd'
  const incoming = `${remoteRoot}/.incoming/${siteId}-token`
  const command = createActivationCommand({
    archiveSha256: hashA,
    ccx: {
      checksum: {
        fileName: 'SHA256SUMS.txt',
        sha256: hashA,
        size: 82
      },
      fileName: 'mugen-1.0.1.ccx',
      sha256: hashB,
      size: 42,
      version: '1.0.1',
      destination: 'releases/1.0.1/mugen-1.0.1.ccx'
    },
    expectedCurrent: oldTarget,
    expectedLatestSha: hashA,
    incoming,
    manifestSha256: hashB,
    rollback: {
      markerName: 'site-rollback-12345678.sha256.txt',
      markerSha256: hashA
    },
    siteId,
    token: 'token'
  })

  assert.match(command, /flock -n 9/)
  assert.match(command, /site deployment was superseded before activation/)
  assert.match(command, /current_target_release_id=/)
  assert.match(command, /not one immutable release directory/)
  assert.match(command, /find releases -type f -exec sha256sum \{\} \+/)
  assert.match(command, /cp -a .*current_target\/releases\/\./)
  assert.match(command, /inherited-releases\.sha256/)
  assert.match(command, /mugen-1\.0\.1\.ccx/)
  assert.match(command, /SHA256SUMS\.txt/)
  assert.match(command, /sha256sum -c SHA256SUMS\.txt/)
  assert.match(command, /if test -e .*mugen-1\.0\.1\.ccx.*\|\| test -e .*SHA256SUMS\.txt/)
  assert.match(command, /then test -f .*mugen-1\.0\.1\.ccx.*test -f .*SHA256SUMS\.txt/)
  assert.match(command, new RegExp(`${hashA}  .*stage-.*releases/latest\\.json`))
  assert.match(command, /mv .*stage-.*releases\/20260812T030405Z-aaaaaaaaaaaa-1234abcd/)
  assert.match(command, /mv -Tf .*\.previous-token.*\/previous/)
  assert.match(command, /mv -Tf .*\.current-token.*\/current/)
  assert.doesNotMatch(command, /dist\/site\/releases\/latest\.json/)

  assert.deepEqual(parseActivationOutput([
    `__MUGEN_PREVIOUS__${oldTarget}`,
    `__MUGEN_CURRENT__${remoteRoot}/releases/${siteId}`,
    `__MUGEN_LATEST_SHA__${hashA}`
  ].join('\n')), {
    current: `${remoteRoot}/releases/${siteId}`,
    latestSha: hashA,
    previous: oldTarget
  })
})

test('cleanup is locked and restricted to one unique incoming directory', () => {
  const incoming = `${remoteRoot}/.incoming/one-site-token`
  const common = {
    expectedCurrent: `${remoteRoot}/releases/old-site`,
    markerName: 'site-rollback-12345678.sha256.txt'
  }
  const command = createCleanupCommand({ ...common, incoming })
  assert.match(command, /flock -n 9/)
  assert.match(command, /rm -rf .*one-site-token/)
  assert.throws(
    () => createCleanupCommand({ ...common, incoming: `${remoteRoot}/.incoming/../releases` }),
    /outside/
  )
  assert.throws(
    () => createCleanupCommand({ ...common, incoming: `${remoteRoot}/.incoming/` }),
    /outside/
  )
})

test('command generators reject traversal, unsafe release IDs, and unsafe tokens before producing shell', () => {
  const common = {
    archiveSha256: hashA,
    expectedCurrent: `${remoteRoot}/releases/old-site`,
    expectedLatestSha: hashA,
    manifestSha256: hashB,
    rollback: { markerName: 'site-rollback-12345678.sha256.txt', markerSha256: hashA },
    siteId: 'new-site'
  }
  assert.throws(
    () => createPrepareCommand({
      incoming: `${remoteRoot}/.incoming/../../escape`,
      markerName: common.rollback.markerName
    }),
    /outside/
  )
  assert.throws(
    () => createActivationCommand({
      ...common,
      incoming: `${remoteRoot}/.incoming/good-token`,
      token: '../escape'
    }),
    /token is invalid/
  )
  assert.throws(
    () => createRollbackCommand({
      expectedCurrent: `${remoteRoot}/releases/bad release`,
      latestProofName: 'site-rollback-good-token.latest.json',
      markerName: common.rollback.markerName,
      token: 'good-token'
    }),
    /Expected current release/
  )
})

test('rollback is conditional and atomically switches current while retaining a full-site marker', () => {
  const markerName = 'site-rollback-rollback-token.sha256.txt'
  const manifest = `${hashB}  ./app.js\n${hashA}  ./index.html\n`
  const markerSha256 = createHash('sha256').update(manifest).digest('hex')
  const command = createRollbackCommand({
    expectedCurrent: `${remoteRoot}/releases/new-site`,
    expectedLatestSha: hashA,
    expectedPrevious: `${remoteRoot}/releases/old-site`,
    latestProofName: 'site-rollback-rollback-token.latest.json',
    markerName,
    token: 'rollback-token'
  })
  assert.match(command, /flock -n 9/)
  assert.match(command, /site deployment was superseded; rollback stopped/)
  assert.match(command, /previous site release changed; rollback stopped/)
  assert.match(command, /current and previous latest\.json differ; rollback stopped/)
  assert.match(command, /sha256sum -c .*rollback_marker/)
  assert.match(command, /mv -Tf .*rollback-current-rollback-token.*\/current/)
  assert.match(command, /mv -Tf .*rollback-previous-rollback-token.*\/previous/)
  assert.match(command, /rollback-restore-previous-rollback-token/)
  assert.match(command, /rollback current switch failed; previous was restored/)
  assert.match(command, /find \. -path \.\/releases -prune/)
  assert.deepEqual(parseRollbackOutput([
    `__MUGEN_CURRENT__${remoteRoot}/releases/old-site`,
    `__MUGEN_PREVIOUS__${remoteRoot}/releases/new-site`,
    `__MUGEN_LATEST_SHA__${hashA}`,
    `__MUGEN_EXPECTED_LATEST_SHA__${hashA}`,
    `__MUGEN_ROLLBACK_MARKER__${markerName}`,
    `__MUGEN_ROLLBACK_MARKER_SHA__${markerSha256}`,
    '__MUGEN_LATEST_PROOF__site-rollback-rollback-token.latest.json',
    '__MUGEN_ROLLBACK_MANIFEST_BEGIN__',
    manifest.trimEnd(),
    '__MUGEN_ROLLBACK_MANIFEST_END__'
  ].join('\n')), {
    current: `${remoteRoot}/releases/old-site`,
    expectedLatestSha: hashA,
    latestProofName: 'site-rollback-rollback-token.latest.json',
    latestSha: hashA,
    previous: `${remoteRoot}/releases/new-site`,
    rollback: {
      manifest,
      markerName,
      markerSha256,
      records: [
        { path: 'app.js', sha256: hashB },
        { path: 'index.html', sha256: hashA }
      ]
    }
  })
})

test('lost SSH confirmations are reconciled into switched, not-switched, or fail-closed states', () => {
  const markerName = 'site-rollback-reconcile-token.sha256.txt'
  const proofName = 'site-rollback-reconcile-token.latest.json'
  const activationCommand = createActivationReconciliationCommand({
    expectedCurrent: `${remoteRoot}/releases/old-site`,
    expectedLatestSha: hashA,
    markerName,
    markerSha256: hashB,
    siteId: 'new-site'
  })
  assert.match(activationCommand, /__MUGEN_STATE__/)
  assert.match(activationCommand, /sha256sum -c/)
  assert.match(createRollbackInspectionCommand(), /current and previous latest\.json differ/)
  assert.match(createRollbackReconciliationCommand({
    expectedCurrent: `${remoteRoot}/releases/new-site`,
    expectedLatestSha: hashA,
    expectedMarkerSha256: hashB,
    expectedPrevious: `${remoteRoot}/releases/old-site`,
    latestProofName: proofName,
    markerName
  }), /partial or unrelated state/)

  const switchedActivation = [
    '__MUGEN_STATE__switched',
    `__MUGEN_CURRENT__${remoteRoot}/releases/new-site`,
    `__MUGEN_PREVIOUS__${remoteRoot}/releases/old-site`,
    `__MUGEN_LATEST_SHA__${hashA}`
  ].join('\n')
  const recovered = executeWithStateReconciliation({
    execute: () => { throw new Error('simulated disconnect') },
    operation: 'Test activation',
    parseConfirmation: parseActivationOutput,
    parseReconciliation: parseActivationReconciliationOutput,
    reconcile: () => switchedActivation
  })
  assert.equal(recovered.reconciled, true)
  assert.equal(recovered.state, 'switched')
  assert.equal(recovered.result.current, `${remoteRoot}/releases/new-site`)

  const notSwitched = executeWithStateReconciliation({
    execute: () => 'incomplete output',
    operation: 'Test activation',
    parseConfirmation: parseActivationOutput,
    parseReconciliation: parseActivationReconciliationOutput,
    reconcile: () => [
      '__MUGEN_STATE__not-switched',
      `__MUGEN_CURRENT__${remoteRoot}/releases/old-site`,
      '__MUGEN_PREVIOUS____MUGEN_NONE__',
      `__MUGEN_LATEST_SHA__${hashA}`
    ].join('\n')
  })
  assert.equal(notSwitched.state, 'not-switched')

  assert.throws(
    () => executeWithStateReconciliation({
      execute: () => { throw new Error('simulated disconnect') },
      operation: 'Test activation',
      parseConfirmation: parseActivationOutput,
      parseReconciliation: parseActivationReconciliationOutput,
      reconcile: () => { throw new Error('second disconnect') }
    }),
    (error) => error.code === 'REMOTE_STATE_UNCERTAIN' && /no cleanup/.test(error.message)
  )
})

function publicHeaders(fileName) {
  const contentType = fileName.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : fileName.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : fileName.endsWith('.js')
        ? 'application/javascript; charset=utf-8'
        : fileName.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : fileName.endsWith('.png')
          ? 'image/png'
          : fileName.endsWith('.ccx')
            ? 'application/octet-stream'
            : 'text/plain; charset=utf-8'
  return {
    'cache-control': fileName.endsWith('.latest.json') || fileName === 'releases/latest.json' ? 'private, no-store' : 'no-cache',
    'content-security-policy': "default-src 'self'; base-uri 'none'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'none'",
    'content-type': contentType,
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff'
  }
}

test('public verification compares every snapshot byte and proves latest.json stayed unchanged', async (context) => {
  const source = createSiteFixture(context)
  const snapshotDirectory = path.join(temporaryRoot(context), 'snapshot')
  const snapshot = createSiteSnapshot(source, snapshotDirectory)
  const latestBytes = Buffer.from('{"version":"protected"}\n')
  const latestSha = createHash('sha256').update(latestBytes).digest('hex')
  const ccxBytes = Buffer.from('public ccx')
  const ccxSha = createHash('sha256').update(ccxBytes).digest('hex')
  const checksumBytes = Buffer.from(`${ccxSha}  mugen-1.0.1.ccx\n`)
  const ccx = {
    checksum: {
      fileName: 'SHA256SUMS.txt',
      sha256: createHash('sha256').update(checksumBytes).digest('hex'),
      size: checksumBytes.length
    },
    destination: 'releases/1.0.1/mugen-1.0.1.ccx',
    fileName: 'mugen-1.0.1.ccx',
    sha256: ccxSha,
    size: ccxBytes.length,
    version: '1.0.1'
  }
  const originalFetch = globalThis.fetch
  let overrideHeaders = () => ({})
  globalThis.fetch = async (url) => {
    const relative = decodeURIComponent(new URL(url).pathname.slice(1))
    const bytes = relative === 'releases/latest.json'
      ? latestBytes
      : relative === ccx.destination
        ? ccxBytes
        : relative === 'releases/1.0.1/SHA256SUMS.txt'
          ? checksumBytes
          : readFileSync(path.join(snapshotDirectory, ...relative.split('/')))
    return new Response(bytes, {
      status: 200,
      headers: { ...publicHeaders(relative), ...overrideHeaders(relative) }
    })
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const result = await verifyPublicSite({
    baseUrl: new URL('https://mugen.product.dev/'),
    ccx,
    expectedLatestSha: latestSha,
    records: snapshot.records,
    snapshotDirectory
  })
  assert.equal(result.verifiedFiles, snapshot.records.length + 3)
  assert.equal(result.latestSha, latestSha)

  await assert.rejects(
    () => verifyPublicSite({
      baseUrl: new URL('https://mugen.product.dev/'),
      ccx,
      expectedLatestSha: hashB,
      records: snapshot.records,
      snapshotDirectory
    }),
    /latest\.json changed/
  )

  overrideHeaders = () => ({ 'strict-transport-security': 'max-age=0' })
  await assert.rejects(
    () => verifyPublicSite({
      baseUrl: new URL('https://mugen.product.dev/'), ccx, expectedLatestSha: latestSha,
      records: snapshot.records, snapshotDirectory
    }),
    /HSTS/
  )

  overrideHeaders = (relative) => relative.endsWith('.ccx') ? { 'content-type': 'text/plain' } : {}
  await assert.rejects(
    () => verifyPublicSite({
      baseUrl: new URL('https://mugen.product.dev/'), ccx, expectedLatestSha: latestSha,
      records: snapshot.records, snapshotDirectory
    }),
    /\.ccx has an invalid public Content-Type/
  )

  overrideHeaders = (relative) => relative.endsWith('SHA256SUMS.txt') ? { 'x-content-type-options': '' } : {}
  await assert.rejects(
    () => verifyPublicSite({
      baseUrl: new URL('https://mugen.product.dev/'), ccx, expectedLatestSha: latestSha,
      records: snapshot.records, snapshotDirectory
    }),
    /SHA256SUMS\.txt must be served with X-Content-Type-Options/
  )
})

test('rollback verification proves the unique public marker and every restored static asset', async (context) => {
  const indexBytes = Buffer.from('<!doctype html><title>restored</title>')
  const appBytes = Buffer.from('restored app')
  const manifest = [
    `${createHash('sha256').update(appBytes).digest('hex')}  ./app.js`,
    `${createHash('sha256').update(indexBytes).digest('hex')}  ./index.html`,
    ''
  ].join('\n')
  const expected = {
    expectedLatestSha: createHash('sha256').update('{"version":"protected"}\n').digest('hex'),
    latestProofName: 'site-rollback-public-proof.latest.json',
    rollback: {
      manifest,
      markerName: 'site-rollback-public-proof.sha256.txt',
      markerSha256: createHash('sha256').update(manifest).digest('hex'),
      records: [
        { path: 'app.js', sha256: createHash('sha256').update(appBytes).digest('hex') },
        { path: 'index.html', sha256: createHash('sha256').update(indexBytes).digest('hex') }
      ]
    }
  }
  const originalFetch = globalThis.fetch
  let proofBytes = Buffer.from('{"version":"protected"}\n')
  let overrideHeaders = () => ({})
  globalThis.fetch = async (url) => {
    const relative = decodeURIComponent(new URL(url).pathname.slice(1))
    const bytes = relative === expected.rollback.markerName
      ? Buffer.from(manifest)
      : relative === expected.latestProofName
        ? proofBytes
      : relative === 'releases/latest.json'
        ? Buffer.from('{"version":"protected"}\n')
      : relative === 'index.html'
        ? indexBytes
        : appBytes
    return new Response(bytes, {
      status: 200,
      headers: { ...publicHeaders(relative), ...overrideHeaders(relative) }
    })
  }
  context.after(() => { globalThis.fetch = originalFetch })

  await assert.doesNotReject(() => verifyPublicRollback(new URL('https://mugen.product.dev/'), expected))
  await assert.doesNotReject(() => verifyPublicFullSiteManifest(new URL('https://mugen.product.dev/'), expected))
  await assert.rejects(
    () => verifyPublicRollback(new URL('https://mugen.product.dev/'), {
      rollback: { ...expected.rollback, records: [{ path: 'app.js', sha256: hashB }, ...expected.rollback.records.slice(1)] }
    }),
    /app\.js/
  )
  proofBytes = Buffer.from('{"version":"different"}\n')
  await assert.rejects(
    () => verifyPublicRollback(new URL('https://mugen.product.dev/'), expected),
    /differs byte-for-byte/
  )
  proofBytes = Buffer.from('{"version":"protected"}\n')
  overrideHeaders = (relative) => relative === expected.latestProofName ? { 'cache-control': 'public, max-age=3600' } : {}
  await assert.rejects(
    () => verifyPublicRollback(new URL('https://mugen.product.dev/'), expected),
    /must not use public or persistent caching/
  )
})

test('Git provenance must remain clean and identical after archive creation', () => {
  const clean = { commit: '1'.repeat(40), dirty: false }
  assert.doesNotThrow(() => assertGitSiteProvenanceUnchanged(clean, { ...clean }))
  assert.throws(
    () => assertGitSiteProvenanceUnchanged(clean, { commit: '2'.repeat(40), dirty: false }),
    /changed after/
  )
  assert.throws(
    () => assertGitSiteProvenanceUnchanged(clean, { ...clean, dirty: true }),
    /changed after/
  )
})

test('derives a credential-free HTTPS site URL without exposing release path details', () => {
  assert.equal(
    resolvePublicSiteUrl({ INNER_RELEASE_URL: 'https://mugen.product.dev/releases/' }).href,
    'https://mugen.product.dev/'
  )
  assert.equal(
    resolvePublicSiteUrl({}, 'https://mugen.product.dev/preview').href,
    'https://mugen.product.dev/preview/'
  )
  assert.equal(resolvePublicSiteUrl({ domain: 'mugen.product.dev' }).href, 'https://mugen.product.dev/')
  assert.throws(
    () => resolvePublicSiteUrl({}, 'https://user:secret@mugen.product.dev/'),
    /credential-free/
  )
})

test('implementation has no password-helper or alternate interactive transport path', () => {
  const source = readFileSync(new URL('./deploy-site.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /sshpass|plink|pscp|expect\s|\bspawn\b/i)
  assert.match(source, /'tar'/)
  assert.match(source, /'scp'/)
  assert.match(source, /'ssh'/)
})

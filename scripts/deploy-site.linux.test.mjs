import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createActivationCommand,
  createActivationReconciliationCommand,
  createFileRecords,
  createPrepareCommand,
  createRollbackCommand,
  createRollbackInspectionCommand,
  createRollbackReconciliationCommand,
  createSha256Manifest,
  executeWithStateReconciliation,
  parseActivationOutput,
  parseActivationReconciliationOutput,
  parsePrepareOutput,
  parseRollbackOutput,
  parseRollbackReconciliationOutput,
  verifyPublicRollback
} from './deploy-site.mjs'

const logicalRoot = '/etc/nginx/static/mugen-site'
const isLinux = process.platform === 'linux'
const isWindows = process.platform === 'win32'
const gitShell = 'C:\\Program Files\\Git\\bin\\sh.exe'
const shellExecutable = isLinux ? '/bin/sh' : gitShell
const hasDeploymentShell = isLinux || (isWindows && existsSync(gitShell))
const requireLinux = process.env.REQUIRE_SITE_LINUX_TESTS === '1'
const shellOnly = { skip: hasDeploymentShell ? false : 'requires GNU/Linux or Git for Windows shell compatibility runtime' }

if (requireLinux && !isLinux) {
  throw new Error('REQUIRE_SITE_LINUX_TESTS=1 requires a GNU/Linux Node runtime.')
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function write(root, relative, contents) {
  const target = path.join(root, ...relative.split('/'))
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
  return target
}

function tempRoot(context, prefix = 'mugen-site-linux-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function toShellPath(filePath) {
  if (isLinux) return filePath
  return execFileSync(gitShell, ['-lc', 'cygpath -u "$1"', 'mugen-test', filePath], { encoding: 'utf8' }).trim()
}

function createRuntime(context, prefix) {
  const rootFs = tempRoot(context, prefix)
  const root = toShellPath(rootFs)
  assert.match(root, /^\/[A-Za-z0-9._/-]+$/)
  const binFs = path.join(rootFs, '.test-bin')
  mkdirSync(binFs)
  if (isWindows) {
    writeFileSync(path.join(binFs, 'flock'), '#!/bin/sh\ntest "$1" = -n && shift\ntest "$1" = 9\n')
    writeFileSync(path.join(binFs, 'ln'), [
      '#!/bin/sh',
      'test "$1" = -s || exit 64',
      'exec powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$SITE_TEST_LN_PS1" "$3" "$2"'
    ].join('\n') + '\n')
    writeFileSync(
      path.join(binFs, 'ln.ps1'),
      'param([string]$Link, [string]$Target)\r\n[void](New-Item -ItemType Junction -Path $Link -Target $Target)\r\n'
    )
  }
  return { bin: toShellPath(binFs), binFs, root, rootFs }
}

function createDirectoryLink(target, link) {
  symlinkSync(target, link, isWindows ? 'junction' : 'dir')
}

function shellLinkTarget(link) {
  return toShellPath(readlinkSync(link))
}

function publicHeaders(fileName) {
  const contentType = fileName.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : fileName.endsWith('.js')
      ? 'application/javascript; charset=utf-8'
      : fileName.endsWith('.json')
        ? 'application/json; charset=utf-8'
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

function installMvSignalStub(fixture, signalTarget) {
  const state = `${fixture.root}/mv-signal-count.txt`
  writeFileSync(path.join(fixture.binFs, 'mv'), [
    '#!/bin/sh',
    `signal_target=${JSON.stringify(signalTarget)}`,
    `state=${JSON.stringify(state)}`,
    'signal_sent="$state.sent"',
    'destination=',
    'for argument do destination=$argument; done',
    '/usr/bin/mv "$@" || exit $?',
    'count=0',
    'test ! -f "$state" || count=$(cat "$state")',
    'count=$((count + 1))',
    'printf "%s\n" "$count" > "$state"',
    'if test "$destination" = "$signal_target" && test ! -f "$signal_sent"; then printf sent > "$signal_sent"; kill -HUP "$PPID"; exit 0; fi'
  ].join('\n') + '\n')
  chmodSync(path.join(fixture.binFs, 'mv'), 0o755)
}

async function verifyFixtureRollback(fixture, result) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const relative = decodeURIComponent(new URL(url).pathname.slice(1))
    const bytes = readFileSync(path.join(fixture.oldFs, ...relative.split('/')))
    return new Response(bytes, { status: 200, headers: publicHeaders(relative) })
  }
  try {
    return await verifyPublicRollback(new URL('https://mugen.product.dev/'), result)
  } finally {
    globalThis.fetch = originalFetch
  }
}

function localize(command, physicalRoot) {
  assert.ok(command.includes(logicalRoot), 'generated command must retain the pinned production root')
  const localized = command.replaceAll(logicalRoot, physicalRoot)
  assert.equal(localized.includes(logicalRoot), false)
  return localized
}

function runRuntimeShell(script, runtime, { fail = false } = {}) {
  const prefixed = `PATH='${runtime.bin}':$PATH; SITE_TEST_LN_PS1='${runtime.bin}/ln.ps1'; export PATH SITE_TEST_LN_PS1; ${script}`
  const result = spawnSync(shellExecutable, ['-s'], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
    input: prefixed
  })
  if (fail) {
    assert.notEqual(result.status, 0, `shell command unexpectedly succeeded:\n${result.stdout}`)
  } else {
    assert.equal(result.status, 0, `shell command failed:\n${result.stderr}\n${result.stdout}`)
  }
  return result
}

function runShell(command, runtime, options) {
  return runRuntimeShell(localize(command, runtime.root), runtime, options)
}

function createRemoteFixture(context, { withPrevious = false } = {}) {
  const runtime = createRuntime(context)
  const oldFs = path.join(runtime.rootFs, 'releases', 'old-site')
  mkdirSync(path.join(oldFs, 'releases', '0.9.0'), { recursive: true })
  write(oldFs, 'index.html', '<!doctype html><title>old</title>\n')
  write(oldFs, 'app.js', 'console.log("old")\n')
  write(oldFs, 'releases/latest.json', '{"version":"0.9.0"}\n')
  write(oldFs, 'releases/0.9.0/old.ccx', 'old ccx bytes')
  createDirectoryLink(oldFs, path.join(runtime.rootFs, 'current'))
  let older
  let olderFs
  if (withPrevious) {
    older = `${runtime.root}/releases/older-site`
    olderFs = path.join(runtime.rootFs, 'releases', 'older-site')
    write(olderFs, 'index.html', '<!doctype html><title>older</title>\n')
    write(olderFs, 'app.js', 'console.log("older")\n')
    write(olderFs, 'releases/latest.json', '{"version":"0.8.0"}\n')
    createDirectoryLink(olderFs, path.join(runtime.rootFs, 'previous'))
  }
  return { ...runtime, old: `${runtime.root}/releases/old-site`, oldFs, older, olderFs }
}

function createPayload(context) {
  const payload = tempRoot(context, 'mugen-site-payload-')
  write(payload, 'index.html', '<!doctype html><title>new</title>\n')
  write(payload, 'app.js', 'console.log("new")\n')
  const records = createFileRecords(payload)
  const archive = path.join(payload, '..', `${path.basename(payload)}.tar.gz`)
  const manifest = path.join(payload, '..', `${path.basename(payload)}.sha256`)
  writeFileSync(manifest, createSha256Manifest(records))
  execFileSync('tar', ['-czf', archive, '-C', payload, '.'])
  context.after(() => {
    rmSync(archive, { force: true })
    rmSync(manifest, { force: true })
  })
  return {
    archive,
    archiveSha256: digest(readFileSync(archive)),
    manifest,
    manifestSha256: digest(readFileSync(manifest))
  }
}

function prepare(context, fixture, suffix = 'happy') {
  const markerName = `site-rollback-linux-${suffix}-marker.sha256.txt`
  const incomingLogical = `${logicalRoot}/.incoming/${suffix}-incoming-token`
  const result = runShell(createPrepareCommand({
    incoming: incomingLogical,
    markerName
  }), fixture)
  return {
    incomingLogical,
    markerName,
    parsed: parsePrepareOutput(result.stdout)
  }
}

function uploadPayload(fixture, prepared, payload) {
  const incoming = path.join(fixture.rootFs, '.incoming', path.posix.basename(prepared.incomingLogical))
  copyFileSync(payload.archive, path.join(incoming, 'site.tar.gz'))
  copyFileSync(payload.manifest, path.join(incoming, 'site.sha256'))
}

function activate(context, fixture, prepared, payload, suffix = 'happy', { loseConfirmation = false } = {}) {
  uploadPayload(fixture, prepared, payload)
  const siteId = `${suffix}-new-site`
  const command = createActivationCommand({
    archiveSha256: payload.archiveSha256,
    expectedCurrent: `${logicalRoot}/releases/old-site`,
    expectedLatestSha: prepared.parsed.latestSha,
    expectedPrevious: prepared.parsed.previous,
    incoming: prepared.incomingLogical,
    manifestSha256: payload.manifestSha256,
    rollback: prepared.parsed.rollback,
    siteId,
    token: `${suffix}-activation-token`
  })
  const transition = executeWithStateReconciliation({
    execute: () => {
      const output = runShell(command, fixture).stdout
      if (loseConfirmation) throw new Error('simulated SSH confirmation loss after activation')
      return output
    },
    operation: 'Test activation',
    parseConfirmation: parseActivationOutput,
    parseReconciliation: parseActivationReconciliationOutput,
    reconcile: () => runShell(createActivationReconciliationCommand({
      expectedCurrent: `${logicalRoot}/releases/old-site`,
      expectedLatestSha: prepared.parsed.latestSha,
      expectedPrevious: prepared.parsed.previous,
      markerName: prepared.markerName,
      markerSha256: prepared.parsed.rollback.markerSha256,
      siteId
    }), fixture).stdout
  })
  assert.equal(transition.state, 'switched')
  return { parsed: transition.result, reconciled: transition.reconciled, siteId }
}

test('deployment shell executes required state transitions and cleanup', shellOnly, (context) => {
  const fixture = createRemoteFixture(context)
  runRuntimeShell([
    'set -eu',
    'for command in flock sha256sum realpath readlink tar find sort cp mv ln; do command -v "$command" >/dev/null; done'
  ].join('; '), fixture)
  if (isLinux) execFileSync('/bin/sh', ['-c', [
    'set -eu',
    'work=$(mktemp -d)',
    'trap \'rm -rf "$work"\' 0',
    'mkdir "$work/a"',
    'cp -a "$work/a/." "$work/b"',
    'ln -s "$work/a" "$work/link"',
    'ln -s "$work/b" "$work/next"',
    'mv -Tf "$work/next" "$work/link"',
    'tar -czf "$work/archive.tar.gz" --no-same-owner -C "$work/a" .'
  ].join('; ')])

  const payload = createPayload(context)
  const prepared = prepare(context, fixture)
  const inheritedLatest = readFileSync(path.join(fixture.oldFs, 'releases', 'latest.json'))
  const activated = activate(context, fixture, prepared, payload, 'happy', { loseConfirmation: true })
  assert.equal(activated.reconciled, true)
  const newTarget = `${fixture.root}/releases/${activated.siteId}`
  const newTargetFs = path.join(fixture.rootFs, 'releases', activated.siteId)

  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'current')), newTarget)
  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'previous')), fixture.old)
  assert.equal(readFileSync(path.join(newTargetFs, 'app.js'), 'utf8'), 'console.log("new")\n')
  assert.deepEqual(readFileSync(path.join(newTargetFs, 'releases', 'latest.json')), inheritedLatest)
  assert.equal(existsSync(path.join(fixture.rootFs, '.incoming', 'happy-incoming-token')), false)

  const rollbackPlan = parseActivationOutput(runShell(createRollbackInspectionCommand(), fixture).stdout)
  assert.equal(rollbackPlan.current, newTarget)
  assert.equal(rollbackPlan.previous, fixture.old)
  assert.equal(rollbackPlan.latestSha, prepared.parsed.latestSha)
  const proofName = 'site-rollback-linux-happy-proof.latest.json'
  const manualMarkerName = 'site-rollback-linux-manual-lost-output.sha256.txt'
  const rollbackTransition = executeWithStateReconciliation({
    execute: () => {
      runShell(createRollbackCommand({
        expectedCurrent: `${logicalRoot}/releases/${activated.siteId}`,
        expectedLatestSha: prepared.parsed.latestSha,
        expectedPrevious: `${logicalRoot}/releases/old-site`,
        latestProofName: proofName,
        markerName: manualMarkerName,
        token: 'happy-rollback-token'
      }), fixture)
      throw new Error('simulated SSH confirmation loss after rollback')
    },
    operation: 'Test manual rollback',
    parseConfirmation: parseRollbackOutput,
    parseReconciliation: parseRollbackReconciliationOutput,
    reconcile: () => runShell(createRollbackReconciliationCommand({
      expectedCurrent: `${logicalRoot}/releases/${activated.siteId}`,
      expectedLatestSha: prepared.parsed.latestSha,
      expectedPrevious: `${logicalRoot}/releases/old-site`,
      latestProofName: proofName,
      markerName: manualMarkerName
    }), fixture).stdout
  })
  assert.equal(rollbackTransition.reconciled, true)
  const rolledBack = rollbackTransition.result

  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'current')), fixture.old)
  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'previous')), newTarget)
  assert.equal(rolledBack.expectedLatestSha, prepared.parsed.latestSha)
  assert.deepEqual(readFileSync(path.join(fixture.oldFs, proofName)), inheritedLatest)
})

test('deployment shell rejects a releases-parent symlink without escaping or leaving incoming state', shellOnly, (context) => {
  const runtime = createRuntime(context)
  const outside = tempRoot(context, 'mugen-site-outside-')
  const old = path.join(outside, 'old-site')
  mkdirSync(path.join(old, 'releases'), { recursive: true })
  write(old, 'index.html', 'outside index')
  write(old, 'app.js', 'outside app')
  write(old, 'releases/latest.json', '{}\n')
  createDirectoryLink(outside, path.join(runtime.rootFs, 'releases'))
  createDirectoryLink(path.join(runtime.rootFs, 'releases', 'old-site'), path.join(runtime.rootFs, 'current'))
  const markerName = 'site-rollback-linux-escape-marker.sha256.txt'

  runShell(createPrepareCommand({
    incoming: `${logicalRoot}/.incoming/escape-incoming-token`,
    markerName
  }), runtime, { fail: true })

  assert.equal(existsSync(path.join(old, markerName)), false)
  assert.equal(existsSync(path.join(runtime.rootFs, '.incoming')), false)
  assert.equal(shellLinkTarget(path.join(runtime.rootFs, 'current')), `${runtime.root}/releases/old-site`)
})

test('deployment shell rejects a changed latest.json and removes only its unique transient state', shellOnly, (context) => {
  const fixture = createRemoteFixture(context)
  const payload = createPayload(context)
  const prepared = prepare(context, fixture, 'latest-change')
  uploadPayload(fixture, prepared, payload)
  writeFileSync(path.join(fixture.oldFs, 'releases', 'latest.json'), '{"version":"tampered"}\n')

  runShell(createActivationCommand({
    archiveSha256: payload.archiveSha256,
    expectedCurrent: `${logicalRoot}/releases/old-site`,
    expectedLatestSha: prepared.parsed.latestSha,
    expectedPrevious: prepared.parsed.previous,
    incoming: prepared.incomingLogical,
    manifestSha256: payload.manifestSha256,
    rollback: prepared.parsed.rollback,
    siteId: 'latest-change-new-site',
    token: 'latest-change-activation'
  }), fixture, { fail: true })

  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'current')), fixture.old)
  assert.equal(existsSync(path.join(fixture.rootFs, 'previous')), false)
  assert.equal(existsSync(path.join(fixture.rootFs, 'releases', 'latest-change-new-site')), false)
  assert.equal(existsSync(path.join(fixture.rootFs, '.incoming', 'latest-change-incoming-token')), false)
})

test('deployment shell rejects marker injection before changing either active link', shellOnly, (context) => {
  const fixture = createRemoteFixture(context)
  const payload = createPayload(context)
  const prepared = prepare(context, fixture, 'marker-injection')
  const activated = activate(context, fixture, prepared, payload, 'marker-injection')
  const newTarget = `${fixture.root}/releases/${activated.siteId}`
  writeFileSync(path.join(fixture.oldFs, prepared.markerName), `${digest('forged')}  ./index.html\n`)

  runShell(createRollbackCommand({
    expectedCurrent: `${logicalRoot}/releases/${activated.siteId}`,
    expectedLatestSha: prepared.parsed.latestSha,
    expectedMarkerSha256: prepared.parsed.rollback.markerSha256,
    expectedPrevious: `${logicalRoot}/releases/old-site`,
    latestProofName: 'site-rollback-linux-injection-proof.latest.json',
    markerName: prepared.markerName,
    token: 'marker-injection-rollback'
  }), fixture, { fail: true })

  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'current')), newTarget)
  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'previous')), fixture.old)
  assert.equal(existsSync(path.join(fixture.oldFs, 'site-rollback-linux-injection-proof.latest.json')), false)
})

test('rollback compensates previous when the current-link rename fails and reconciliation stays retryable', shellOnly, (context) => {
  const fixture = createRemoteFixture(context)
  const payload = createPayload(context)
  const prepared = prepare(context, fixture, 'second-mv-failure')
  const activated = activate(context, fixture, prepared, payload, 'second-mv-failure')
  const newTarget = `${fixture.root}/releases/${activated.siteId}`
  const moveCount = `${fixture.root}/mv-count.txt`
  writeFileSync(path.join(fixture.binFs, 'mv'), [
    '#!/bin/sh',
    `state=${JSON.stringify(moveCount)}`,
    'count=0',
    'test ! -f "$state" || count=$(cat "$state")',
    'count=$((count + 1))',
    'printf "%s\n" "$count" > "$state"',
    'test "$count" -ne 2 || exit 74',
    'exec /usr/bin/mv "$@"'
  ].join('\n') + '\n')
  chmodSync(path.join(fixture.binFs, 'mv'), 0o755)
  const markerName = 'site-rollback-linux-second-mv-marker.sha256.txt'
  const proofName = 'site-rollback-linux-second-mv-proof.latest.json'
  const transition = executeWithStateReconciliation({
    execute: () => runShell(createRollbackCommand({
      expectedCurrent: `${logicalRoot}/releases/${activated.siteId}`,
      expectedLatestSha: prepared.parsed.latestSha,
      expectedPrevious: `${logicalRoot}/releases/old-site`,
      latestProofName: proofName,
      markerName,
      token: 'second-mv-failure-token'
    }), fixture).stdout,
    operation: 'Injected rollback failure',
    parseConfirmation: parseRollbackOutput,
    parseReconciliation: parseRollbackReconciliationOutput,
    reconcile: () => runShell(createRollbackReconciliationCommand({
      expectedCurrent: `${logicalRoot}/releases/${activated.siteId}`,
      expectedLatestSha: prepared.parsed.latestSha,
      expectedPrevious: `${logicalRoot}/releases/old-site`,
      latestProofName: proofName,
      markerName
    }), fixture).stdout
  })

  assert.equal(transition.state, 'not-switched')
  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'current')), newTarget)
  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'previous')), fixture.old)
  assert.equal(existsSync(path.join(fixture.oldFs, markerName)), false)
  assert.equal(existsSync(path.join(fixture.oldFs, proofName)), false)
  assert.equal(existsSync(path.join(fixture.rootFs, '.rollback-current-second-mv-failure-token')), false)
  assert.equal(existsSync(path.join(fixture.rootFs, '.rollback-previous-second-mv-failure-token')), false)
  assert.equal(existsSync(path.join(fixture.rootFs, '.rollback-restore-previous-second-mv-failure-token')), false)
})

test('activation HUP after previous changes restores the recorded older previous target', shellOnly, (context) => {
  const fixture = createRemoteFixture(context, { withPrevious: true })
  const payload = createPayload(context)
  const prepared = prepare(context, fixture, 'activation-first-mv-hup')
  assert.equal(prepared.parsed.previous, fixture.older)
  uploadPayload(fixture, prepared, payload)
  installMvSignalStub(fixture, `${fixture.root}/previous`)
  const siteId = 'activation-first-mv-hup-site'

  runShell(createActivationCommand({
    archiveSha256: payload.archiveSha256,
    expectedCurrent: `${logicalRoot}/releases/old-site`,
    expectedLatestSha: prepared.parsed.latestSha,
    expectedPrevious: `${logicalRoot}/releases/older-site`,
    incoming: prepared.incomingLogical,
    manifestSha256: payload.manifestSha256,
    rollback: prepared.parsed.rollback,
    siteId,
    token: 'activation-first-mv-hup-token'
  }), fixture, { fail: true })

  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'current')), fixture.old)
  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'previous')), fixture.older)
  const reconciled = parseActivationReconciliationOutput(runShell(createActivationReconciliationCommand({
    expectedCurrent: `${logicalRoot}/releases/old-site`,
    expectedLatestSha: prepared.parsed.latestSha,
    expectedPrevious: `${logicalRoot}/releases/older-site`,
    markerName: prepared.markerName,
    markerSha256: prepared.parsed.rollback.markerSha256,
    siteId
  }), fixture).stdout)
  assert.equal(reconciled.state, 'not-switched')
  assert.equal(reconciled.previous, fixture.older)
})

test('rollback HUP after previous changes restores the pair and remains retryable', shellOnly, (context) => {
  const fixture = createRemoteFixture(context)
  const payload = createPayload(context)
  const prepared = prepare(context, fixture, 'rollback-first-mv-hup')
  const activated = activate(context, fixture, prepared, payload, 'rollback-first-mv-hup')
  const newTarget = `${fixture.root}/releases/${activated.siteId}`
  installMvSignalStub(fixture, `${fixture.root}/previous`)
  const markerName = 'site-rollback-linux-first-mv-hup-marker.sha256.txt'
  const proofName = 'site-rollback-linux-first-mv-hup-proof.latest.json'

  runShell(createRollbackCommand({
    expectedCurrent: `${logicalRoot}/releases/${activated.siteId}`,
    expectedLatestSha: prepared.parsed.latestSha,
    expectedPrevious: `${logicalRoot}/releases/old-site`,
    latestProofName: proofName,
    markerName,
    token: 'rollback-first-mv-hup-token'
  }), fixture, { fail: true })

  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'current')), newTarget)
  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'previous')), fixture.old)
  assert.equal(existsSync(path.join(fixture.oldFs, markerName)), false)
  assert.equal(existsSync(path.join(fixture.oldFs, proofName)), false)
  const reconciled = parseRollbackReconciliationOutput(runShell(createRollbackReconciliationCommand({
    expectedCurrent: `${logicalRoot}/releases/${activated.siteId}`,
    expectedLatestSha: prepared.parsed.latestSha,
    expectedPrevious: `${logicalRoot}/releases/old-site`,
    latestProofName: proofName,
    markerName
  }), fixture).stdout)
  assert.equal(reconciled.state, 'not-switched')
})

test('rollback HUP after current changes preserves proofs for reconciliation and public verification', shellOnly, async (context) => {
  const fixture = createRemoteFixture(context)
  const payload = createPayload(context)
  const prepared = prepare(context, fixture, 'rollback-current-mv-hup')
  const activated = activate(context, fixture, prepared, payload, 'rollback-current-mv-hup')
  const newTarget = `${fixture.root}/releases/${activated.siteId}`
  installMvSignalStub(fixture, `${fixture.root}/current`)
  const markerName = 'site-rollback-linux-current-mv-hup-marker.sha256.txt'
  const proofName = 'site-rollback-linux-current-mv-hup-proof.latest.json'

  runShell(createRollbackCommand({
    expectedCurrent: `${logicalRoot}/releases/${activated.siteId}`,
    expectedLatestSha: prepared.parsed.latestSha,
    expectedPrevious: `${logicalRoot}/releases/old-site`,
    latestProofName: proofName,
    markerName,
    token: 'rollback-current-mv-hup-token'
  }), fixture, { fail: true })

  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'current')), fixture.old)
  assert.equal(shellLinkTarget(path.join(fixture.rootFs, 'previous')), newTarget)
  assert.equal(existsSync(path.join(fixture.oldFs, markerName)), true)
  assert.equal(existsSync(path.join(fixture.oldFs, proofName)), true)
  const reconciled = parseRollbackReconciliationOutput(runShell(createRollbackReconciliationCommand({
    expectedCurrent: `${logicalRoot}/releases/${activated.siteId}`,
    expectedLatestSha: prepared.parsed.latestSha,
    expectedPrevious: `${logicalRoot}/releases/old-site`,
    latestProofName: proofName,
    markerName
  }), fixture).stdout)
  assert.equal(reconciled.state, 'switched')
  await assert.doesNotReject(() => verifyFixtureRollback(fixture, reconciled))
})

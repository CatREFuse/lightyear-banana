import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  activateReviewedPolicy,
  createRemoteCanonicalPreflight,
  revalidateApprovedManifest
} from './apply-nginx-security-policy.mjs'
import {
  parseCsp,
  readPublicSecuritySnapshot,
  validateNginxSecurityPolicyChange,
  WEBUI_CSP,
  verifyPublicSecurityPolicy,
  verifyPublicSecuritySnapshot
} from './nginx-security-policy.mjs'

const host = 'mugen.example.test'
const webUiCspNone = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; worker-src 'none'; media-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'"
const webUiCspNetwork = webUiCspNone
  .replace("img-src 'self' data: blob:", "img-src 'self' data: blob: http: https:")
  .replace("connect-src 'none'", "connect-src 'self' http: https:")
const homepageCsp = "default-src 'self'; base-uri 'none'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'none'"
const transactionScript = fileURLToPath(new URL('../deploy/nginx/apply-verified-config.sh', import.meta.url))

function configuration({
  homepageExtra = '',
  root = '/etc/nginx/static/mugen-site/current',
  serverExtra = '',
  webUiCsp = webUiCspNone
} = {}) {
  return `server {
  listen 80;
  server_name ${host};
  return 308 https://${host}$request_uri;
}

server {
  listen 443 ssl http2;
  server_name ${host};
  root ${root};
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
${serverExtra}

  location / {
    try_files $uri $uri/ =404;
${homepageExtra}  }

  location ^~ /webui/ {
    alias /etc/nginx/static/mugen-inner-webui/current/;
    add_header Content-Security-Policy "${webUiCsp}" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
  }
}
`
}

const homepageHeaders = `    add_header Content-Security-Policy "${homepageCsp}" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
`
const homepageCurrentHeaders = `    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
`

function reviewedManifest() {
  return validateNginxSecurityPolicyChange(
    configuration(),
    configuration({ homepageExtra: homepageHeaders, webUiCsp: webUiCspNetwork }),
    host,
    `https://${host}`
  )
}

function localReviewedManifest() {
  const directory = mkdtempSync(path.join(tmpdir(), 'mugen-nginx-review-'))
  const currentPath = path.join(directory, 'active.conf')
  const candidatePath = path.join(directory, 'candidate.conf')
  const currentSource = configuration()
  const candidateSource = configuration({ homepageExtra: homepageHeaders, webUiCsp: webUiCspNetwork })
  writeFileSync(currentPath, currentSource, 'utf8')
  writeFileSync(candidatePath, candidateSource, 'utf8')
  return {
    candidatePath,
    candidateSource,
    currentPath,
    currentSource,
    directory,
    manifest: {
      ...validateNginxSecurityPolicyChange(currentSource, candidateSource, host, `https://${host}`),
      candidatePath,
      currentPath,
      validatedAt: new Date().toISOString()
    }
  }
}

test('keeps the local Nginx template aligned with the exact public WebUI gate', () => {
  const template = readFileSync(new URL('../deploy/nginx/inner-webui.conf.template', import.meta.url), 'utf8')
  const match = template.match(/add_header Content-Security-Policy "([^"]+)" always;/)
  assert.ok(match)
  assert.deepEqual([...parseCsp(match[1])], [...WEBUI_CSP])
})

test('accepts only the exact WebUI network and strict homepage policy change', () => {
  const current = configuration()
  const candidate = configuration({ homepageExtra: homepageHeaders, webUiCsp: webUiCspNetwork })
  const result = validateNginxSecurityPolicyChange(current, candidate, host, `https://${host}`)
  assert.equal(result.serverName, host)
  assert.equal(result.homepageLocation, '/')
  assert.deepEqual(result.webUiConnectSrc, ["'self'", 'http:', 'https:'])
  assert.match(result.activeSha256, /^[a-f0-9]{64}$/)
  assert.match(result.candidateSha256, /^[a-f0-9]{64}$/)
})

test('rejects an unrelated root or route change', () => {
  const current = configuration()
  const candidate = configuration({
    homepageExtra: homepageHeaders,
    root: '/srv/unreviewed',
    webUiCsp: webUiCspNetwork
  })
  assert.throws(
    () => validateNginxSecurityPolicyChange(current, candidate, host, `https://${host}`),
    /outside the approved homepage and WebUI security headers/
  )
})

test('rejects broader WebUI networking than the approved three tokens', () => {
  const current = configuration()
  const candidate = configuration({
    homepageExtra: homepageHeaders,
    webUiCsp: webUiCspNetwork.replace("connect-src 'self' http: https:", "connect-src 'self' http: https: wss:")
  })
  assert.throws(
    () => validateNginxSecurityPolicyChange(current, candidate, host, `https://${host}`),
    /invalid connect-src/
  )
})

test('rejects a permissive or incomplete homepage CSP', () => {
  const current = configuration()
  const permissive = homepageHeaders.replace("connect-src 'self'", "connect-src 'self' https:")
  assert.throws(
    () => validateNginxSecurityPolicyChange(current, configuration({ homepageExtra: permissive, webUiCsp: webUiCspNetwork }), host, `https://${host}`),
    /Homepage CSP has an invalid connect-src/
  )
  const incomplete = homepageHeaders.replace(/^.*X-Content-Type-Options.*\n/m, '')
  assert.throws(
    () => validateNginxSecurityPolicyChange(current, configuration({ homepageExtra: incomplete, webUiCsp: webUiCspNetwork }), host, `https://${host}`),
    /exactly one x-content-type-options/
  )
})

test('rejects an ambiguous target server', () => {
  const current = configuration()
  const candidate = configuration({ homepageExtra: homepageHeaders, webUiCsp: webUiCspNetwork })
  assert.throws(
    () => validateNginxSecurityPolicyChange(`${current}\n${current}`, `${candidate}\n${candidate}`, host, `https://${host}`),
    /Expected exactly one TLS server block/
  )
})

test('preserves the current effective HSTS value exactly', () => {
  const candidateHeaders = homepageHeaders.replace('max-age=31536000', 'max-age=63072000')
  assert.throws(
    () => validateNginxSecurityPolicyChange(
      configuration(),
      configuration({ homepageExtra: candidateHeaders, webUiCsp: webUiCspNetwork }),
      host,
      `https://${host}`
    ),
    /must preserve the current effective value/
  )
})

test('rejects header inheritance constructs that cannot be proven from the reviewed file', () => {
  const current = configuration({ serverExtra: '  include /etc/nginx/snippets/security.conf;' })
  const candidate = configuration({
    homepageExtra: homepageHeaders,
    serverExtra: '  include /etc/nginx/snippets/security.conf;',
    webUiCsp: webUiCspNetwork
  })
  assert.throws(
    () => validateNginxSecurityPolicyChange(current, candidate, host, `https://${host}`),
    /uses an include directive/
  )
  assert.throws(
    () => validateNginxSecurityPolicyChange(
      `add_header_inherit merge;\n${configuration()}`,
      `add_header_inherit merge;\n${configuration({ homepageExtra: homepageHeaders, webUiCsp: webUiCspNetwork })}`,
      host,
      `https://${host}`
    ),
    /uses add_header_inherit/
  )
})

test('allows an unchanged server TLS include when both target locations define their own headers', () => {
  const serverExtra = '  include /etc/letsencrypt/options-ssl-nginx.conf;'
  const current = configuration({ homepageExtra: homepageCurrentHeaders, serverExtra })
  const candidate = configuration({ homepageExtra: homepageHeaders, serverExtra, webUiCsp: webUiCspNetwork })
  const result = validateNginxSecurityPolicyChange(current, candidate, host, `https://${host}`)
  assert.equal(result.serverName, host)
  assert.deepEqual(result.webUiConnectSrc, ["'self'", 'http:', 'https:'])
})

test('revalidates complete Nginx semantics before any approved apply', () => {
  const fixture = localReviewedManifest()
  try {
    const result = revalidateApprovedManifest(fixture.manifest)
    assert.equal(result.currentSource, fixture.currentSource)
    assert.equal(result.candidateSource, fixture.candidateSource)
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true })
  }
})

test('rejects local manifest files reached through a symlink or junction', () => {
  const fixture = localReviewedManifest()
  const linkedDirectory = `${fixture.directory}-link`
  try {
    symlinkSync(fixture.directory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(
      () => revalidateApprovedManifest({
        ...fixture.manifest,
        candidatePath: path.join(linkedDirectory, 'candidate.conf'),
        currentPath: path.join(linkedDirectory, 'active.conf')
      }),
      /must already be canonical and must not be a symlink/
    )
  } finally {
    rmSync(linkedDirectory, { force: true, recursive: true })
    rmSync(fixture.directory, { force: true, recursive: true })
  }
})

test('remote active-config preflight is read-only and rejects non-production paths', () => {
  const command = createRemoteCanonicalPreflight('/etc/nginx/conf.d/mugen.conf')
  assert.match(command, /test ! -L '\/etc\/nginx\/conf\.d\/mugen\.conf'/)
  assert.match(command, /canonical_active=\$\(readlink -f -- '\/etc\/nginx\/conf\.d\/mugen\.conf'\)/)
  assert.match(command, /test "\$canonical_active" = '\/etc\/nginx\/conf\.d\/mugen\.conf'/)
  assert.match(command, /; nginx -t;/)
  assert.match(command, /nginx -T 2>&1 \| grep -Eq/)
  assert.match(command, /add_header_inherit/)
  assert.doesNotMatch(command, /(?:^|; )(?:cp|mkdir|mv|reload|rm|systemctl)\b/)
  assert.doesNotThrow(() => createRemoteCanonicalPreflight('/etc/nginx/sites-enabled/mugen.catrefuse.com.conf'))
  assert.throws(
    () => createRemoteCanonicalPreflight('/etc/nginx/sites-enabled/mugen'),
    /dedicated file/
  )
})

test('rejects root, proxy, or certificate tampering even when candidate SHA is forged to match', () => {
  for (const mutate of [
    (source) => source.replace('/etc/nginx/static/mugen-site/current', '/srv/forged-root'),
    (source) => source.replace('    try_files $uri $uri/ =404;', '    try_files $uri $uri/ =404;\n    proxy_pass http://127.0.0.1:9999;'),
    (source) => source.replace('  root /etc/nginx/static/mugen-site/current;', '  ssl_certificate /tmp/forged.pem;\n  root /etc/nginx/static/mugen-site/current;')
  ]) {
    const fixture = localReviewedManifest()
    try {
      const tamperedCandidate = mutate(fixture.candidateSource)
      writeFileSync(fixture.candidatePath, tamperedCandidate, 'utf8')
      const forgedManifest = {
        ...fixture.manifest,
        candidateSha256: sha256Text(tamperedCandidate)
      }
      assert.throws(
        () => revalidateApprovedManifest(forgedManifest),
        /outside the approved homepage and WebUI security headers/
      )
    } finally {
      rmSync(fixture.directory, { force: true, recursive: true })
    }
  }
})

test('rejects synchronized approval-field forgery after recomputing valid files', () => {
  const fixture = localReviewedManifest()
  try {
    const forgedManifest = {
      ...fixture.manifest,
      homepageLocation: '= /',
      preservedHeaders: {
        ...fixture.manifest.preservedHeaders,
        homepageStrictTransportSecurity: 'max-age=63072000; includeSubDomains'
      }
    }
    assert.throws(
      () => revalidateApprovedManifest(forgedManifest),
      /does not exactly match the security semantics recomputed/
    )
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true })
  }
})

test('requires the canonical default-port HTTPS origin during review and public verification', async () => {
  assert.throws(
    () => validateNginxSecurityPolicyChange(
      configuration(),
      configuration({ homepageExtra: homepageHeaders, webUiCsp: webUiCspNetwork }),
      host,
      `https://${host}:8443`
    ),
    /default HTTPS port/
  )
  await assert.rejects(
    () => verifyPublicSecurityPolicy({ ...reviewedManifest(), origin: `https://${host}:8443` }),
    /default HTTPS port/
  )
})

test('transaction script pins both hashes and restores before reloading on failure', () => {
  const script = readFileSync(new URL('../deploy/nginx/apply-verified-config.sh', import.meta.url), 'utf8')
  assert.match(script, /sha256sum/)
  assert.match(script, /backup_path=/)
  assert.match(script, /nginx -t/)
  assert.match(script, /systemctl reload nginx/)
  assert.match(script, /rollback_required=1/)
  assert.match(script, /restore_previous/)
  assert.match(script, /active_after=/)
  assert.match(script, /active_pre_swap=/)
  assert.match(script, /test -s "\$restore_path"/)
  assert.doesNotMatch(script, /if ! restore_previous/)
})

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex')
}

function toPosixPath(value) {
  const normalized = path.resolve(value).replaceAll('\\', '/')
  if (process.platform !== 'win32') return normalized
  return normalized.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
}

function resolveBash() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe'),
        path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'usr', 'bin', 'bash.exe')
      ]
    : ['bash']
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !existsSync(candidate)) continue
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
    if (result.status === 0) return candidate
  }
  throw new Error('A POSIX Bash runtime is required for executable Nginx transaction tests.')
}

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, 'utf8')
  chmodSync(filePath, 0o755)
}

function runShellTransaction({
  activeDirectory = 'conf.d',
  activeInputKind = 'canonical',
  candidate = 'candidate nginx config\n',
  candidateInputKind = 'staging',
  expectedActiveSha256,
  expectedCandidateSha256,
  failNginxAt = '',
  failReloadAt = '',
  failRestoreStage = '',
  tamperBeforeSwap = false,
  unsafeActive = false,
  unsafeCandidate = false
} = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'mugen-nginx-policy-'))
  try {
    const testRoot = path.join(directory, 'nginx')
    const configDirectory = path.join(testRoot, 'etc', 'nginx', activeDirectory)
    const fixtureDirectory = path.join(testRoot, 'fixtures')
    const stagingDirectory = path.join(testRoot, 'tmp', 'mugen-nginx-policy-0123456789abcdef01234567')
    const mockBin = path.join(directory, 'bin')
    const stateDirectory = path.join(directory, 'state')
    mkdirSync(configDirectory, { recursive: true })
    mkdirSync(fixtureDirectory)
    mkdirSync(stagingDirectory, { recursive: true })
    mkdirSync(mockBin)
    mkdirSync(stateDirectory)
    let activePath = path.join(configDirectory, 'mugen.conf')
    if (activeInputKind === 'wide') {
      activePath = path.join(configDirectory, 'nested', 'mugen.conf')
      mkdirSync(path.dirname(activePath))
    }
    let candidatePath = path.join(stagingDirectory, 'candidate.conf')
    const tamperPath = path.join(fixtureDirectory, 'external.conf')
    const logPath = path.join(directory, 'calls.log')
    const active = 'active nginx config\n'
    writeFileSync(activePath, active, 'utf8')
    if (candidateInputKind === 'backup' || candidateInputKind === 'backup-wrong-prefix') {
      const reviewedPrefix = sha256Text(candidate).slice(0, 12)
      const backupPrefix = candidateInputKind === 'backup-wrong-prefix'
        ? `${reviewedPrefix[0] === '0' ? '1' : '0'}${reviewedPrefix.slice(1)}`
        : reviewedPrefix
      candidatePath = `${activePath}.mugen-policy-abcdefabcdefabcdefabcdef-${backupPrefix}.bak`
    } else if (candidateInputKind === 'outside-backup') {
      candidatePath = path.join(testRoot, 'etc', 'nginx', `other.conf.mugen-policy-abcdefabcdefabcdefabcdef-${sha256Text(active).slice(0, 12)}.bak`)
    }
    writeFileSync(candidatePath, candidate, 'utf8')
    writeFileSync(tamperPath, 'external concurrent config\n', 'utf8')
    let activeInput = activePath
    let candidateInput = candidatePath
    if (activeInputKind === 'symlink') {
      const activeLinkDirectory = path.join(testRoot, 'etc', 'nginx', 'conf-link')
      symlinkSync(configDirectory, activeLinkDirectory, process.platform === 'win32' ? 'junction' : 'dir')
      activeInput = path.join(activeLinkDirectory, 'mugen.conf')
    }
    if (candidateInputKind === 'symlink') {
      const candidateLinkDirectory = path.join(testRoot, 'tmp', 'mugen-nginx-policy-fedcbafedcbafedcbafedcba')
      symlinkSync(stagingDirectory, candidateLinkDirectory, process.platform === 'win32' ? 'junction' : 'dir')
      candidateInput = path.join(candidateLinkDirectory, 'candidate.conf')
    }

    const counterPrelude = `
counter_file="$MOCK_STATE/$MOCK_NAME.count"
count=0
if test -f "$counter_file"; then count=$(/usr/bin/cat "$counter_file"); fi
count=$((count + 1))
/usr/bin/printf '%s\\n' "$count" > "$counter_file"
/usr/bin/printf '%s:%s\\n' "$MOCK_NAME" "$count" >> "$MOCK_LOG"
`
    writeExecutable(path.join(mockBin, 'nginx'), `#!/bin/sh
set -eu
MOCK_NAME=nginx
${counterPrelude}
case ",${'${FAIL_NGINX_AT:-}'}," in *,$count,*) exit 41 ;; esac
exit 0
`)
    writeExecutable(path.join(mockBin, 'systemctl'), `#!/bin/sh
set -eu
test "$1" = reload
test "$2" = nginx
MOCK_NAME=reload
${counterPrelude}
case ",${'${FAIL_RELOAD_AT:-}'}," in *,$count,*) exit 42 ;; esac
exit 0
`)
    writeExecutable(path.join(mockBin, 'flock'), `#!/bin/sh
set -eu
test "$1" = -n
test "$2" = 9
exit 0
`)

    const result = spawnSync(resolveBash(), [
      toPosixPath(transactionScript),
      toPosixPath(activeInput),
      toPosixPath(candidateInput),
      expectedActiveSha256 || sha256Text(active),
      expectedCandidateSha256 || sha256Text(candidate),
      '0123456789abcdef01234567'
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAIL_NGINX_AT: failNginxAt,
        FAIL_RELOAD_AT: failReloadAt,
        MOCK_LOG: toPosixPath(logPath),
        MOCK_STATE: toPosixPath(stateDirectory),
        MUGEN_NGINX_TEST_FAIL_STAGE: failRestoreStage,
        MUGEN_NGINX_TEST_MODE: '1',
        MUGEN_NGINX_TEST_ROOT: toPosixPath(testRoot),
        MUGEN_NGINX_TEST_TAMPER_BEFORE_SWAP: tamperBeforeSwap ? '1' : '0',
        MUGEN_NGINX_TEST_TAMPER_FILE: toPosixPath(tamperPath),
        MUGEN_NGINX_TEST_UNSAFE_ACTIVE: unsafeActive ? '1' : '0',
        MUGEN_NGINX_TEST_UNSAFE_CANDIDATE: unsafeCandidate ? '1' : '0',
        PATH: `${toPosixPath(mockBin)}:/usr/bin:/bin`,
      }
    })
    return {
      active,
      activeAfter: readFileSync(activePath, 'utf8'),
      candidate,
      log: existsSync(logPath) ? readFileSync(logPath, 'utf8') : '',
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout
    }
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

test('executable transaction activates only a complete reviewed candidate', () => {
  const result = runShellTransaction()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.activeAfter, result.candidate)
  assert.match(result.stdout, /Nginx policy activated/)
  assert.match(result.log, /nginx:1/)
  assert.match(result.log, /reload:1/)
})

test('executable transaction accepts only the active-specific reviewed backup branch', () => {
  const result = runShellTransaction({ candidateInputKind: 'backup' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.activeAfter, result.candidate)
  assert.match(result.stdout, /Nginx policy activated/)
})

test('executable transaction accepts a physical sites-enabled conf file', () => {
  const result = runShellTransaction({ activeDirectory: 'sites-enabled' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.activeAfter, result.candidate)
  assert.match(result.stdout, /Nginx policy activated/)
})

test('executable production-equivalent path gates reject symlinks, escaped backups, bad digests, and wide active paths', () => {
  for (const [options, expectedMessage] of [
    [{ activeInputKind: 'symlink' }, /active config path must already be canonical/],
    [{ candidateInputKind: 'symlink' }, /candidate config path must already be canonical/],
    [{ candidateInputKind: 'outside-backup' }, /unique uploaded candidate or a backup of this active config/],
    [{ candidateInputKind: 'backup-wrong-prefix' }, /backup hash prefix does not match its reviewed digest/],
    [{ expectedActiveSha256: 'b'.repeat(64) }, /active config changed after review/],
    [{ expectedCandidateSha256: 'a'.repeat(64) }, /candidate config changed after review/],
    [{ activeInputKind: 'wide' }, /direct child of an approved Nginx directory/]
  ]) {
    const result = runShellTransaction(options)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, expectedMessage)
    assert.equal(result.activeAfter, result.active)
    assert.doesNotMatch(result.log, /nginx:/)
    assert.doesNotMatch(result.log, /reload:/)
  }
})

test('executable permission gate rejects a group- or world-writable active config', () => {
  const result = runShellTransaction({ unsafeActive: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must not be group- or world-writable/)
  assert.equal(result.activeAfter, result.active)
  assert.doesNotMatch(result.log, /nginx:/)
})

test('executable transaction restores the reviewed config after candidate test or reload failure', () => {
  for (const failure of [{ failNginxAt: '1' }, { failReloadAt: '1' }]) {
    const result = runShellTransaction(failure)
    assert.notEqual(result.status, 0)
    assert.equal(result.activeAfter, result.active)
    assert.match(result.stderr, /reviewed active config restored and reloaded/)
  }
})

test('executable restoration never swaps an empty or partial file when a restore step fails', () => {
  for (const failure of [
    { failReloadAt: '1', failRestoreStage: 'restore-create' },
    { failReloadAt: '1', failRestoreStage: 'restore-copy' },
    { failReloadAt: '1', failRestoreStage: 'restore-hash' },
    { failReloadAt: '1', failRestoreStage: 'restore-mode' },
    { failReloadAt: '1', failRestoreStage: 'restore-move' },
    { failReloadAt: '1', failRestoreStage: 'restore-nginx-test' },
    { failReloadAt: '1', failRestoreStage: 'restore-reload' }
  ]) {
    const result = runShellTransaction(failure)
    assert.equal(result.status, 90, JSON.stringify({ failure, log: result.log, stderr: result.stderr }, null, 2))
    assert.ok(result.activeAfter.length > 0)
    assert.ok(result.activeAfter === result.active || result.activeAfter === result.candidate)
    assert.match(result.stderr, /automatic restoration stopped safely/)
  }
})

test('executable transaction rechecks active SHA immediately before the atomic swap', () => {
  const result = runShellTransaction({ tamperBeforeSwap: true })
  assert.notEqual(result.status, 0, JSON.stringify({ log: result.log, stderr: result.stderr }, null, 2))
  assert.equal(result.activeAfter, 'external concurrent config\n')
  assert.doesNotMatch(result.log, /nginx:/)
  assert.doesNotMatch(result.log, /reload:/)
})

test('executable transaction rejects an empty candidate before creating an active swap', () => {
  const result = runShellTransaction({ candidate: '' })
  assert.notEqual(result.status, 0)
  assert.equal(result.activeAfter, result.active)
  assert.doesNotMatch(result.log, /nginx:/)
})

function publicResponse(csp) {
  return new Response('<!doctype html>', {
    status: 200,
    headers: {
      'content-security-policy': csp,
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-content-type-options': 'nosniff'
    }
  })
}

test('public readback gate checks the complete policies on both exact paths', async (context) => {
  const originalFetch = globalThis.fetch
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(new URL(url).pathname)
    return publicResponse(new URL(url).pathname === '/' ? homepageCsp : webUiCspNetwork)
  }
  context.after(() => { globalThis.fetch = originalFetch })
  const manifest = reviewedManifest()
  const result = await verifyPublicSecurityPolicy(manifest)
  assert.deepEqual(requested.sort(), ['/', '/webui/'])
  assert.deepEqual(result.verified, ['/', '/webui/'])
})

test('public readback gate rejects the old WebUI connect-src policy', async (context) => {
  const originalFetch = globalThis.fetch
  const oldConnectPolicy = webUiCspNetwork.replace("connect-src 'self' http: https:", "connect-src 'none'")
  globalThis.fetch = async (url) => publicResponse(new URL(url).pathname === '/' ? homepageCsp : oldConnectPolicy)
  context.after(() => { globalThis.fetch = originalFetch })
  const manifest = reviewedManifest()
  await assert.rejects(
    () => verifyPublicSecurityPolicy(manifest),
    /Public WebUI CSP has an invalid connect-src/
  )
})

test('public readback gate rejects the old WebUI img-src policy', async (context) => {
  const originalFetch = globalThis.fetch
  const oldImagePolicy = webUiCspNetwork.replace("img-src 'self' data: blob: http: https:", "img-src 'self' data: blob:")
  globalThis.fetch = async (url) => publicResponse(new URL(url).pathname === '/' ? homepageCsp : oldImagePolicy)
  context.after(() => { globalThis.fetch = originalFetch })
  await assert.rejects(
    () => verifyPublicSecurityPolicy(reviewedManifest()),
    /Public WebUI CSP has an invalid img-src/
  )
})

test('public readback requires the exact HSTS value preserved by the review manifest', async (context) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const response = publicResponse(new URL(url).pathname === '/' ? homepageCsp : webUiCspNetwork)
    response.headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains')
    return response
  }
  context.after(() => { globalThis.fetch = originalFetch })
  await assert.rejects(
    () => verifyPublicSecurityPolicy(reviewedManifest()),
    /preserve its reviewed Strict-Transport-Security value/
  )
})

test('public readback refuses an origin that is not bound to the reviewed server name', async () => {
  const manifest = reviewedManifest()
  await assert.rejects(
    () => verifyPublicSecurityPolicy({ ...manifest, origin: 'https://other.example.test' }),
    /default HTTPS port/
  )
})

test('previous public policy snapshot is manifest-bound and detects rollback drift', async (context) => {
  const originalFetch = globalThis.fetch
  let drift = false
  globalThis.fetch = async (url) => {
    const pathname = new URL(url).pathname
    const csp = pathname === '/' ? '' : webUiCspNone
    return new Response('<!doctype html>', {
      status: 200,
      headers: {
        'content-security-policy': drift && pathname === '/' ? "default-src 'none'" : csp,
        'referrer-policy': pathname === '/' ? 'strict-origin' : 'no-referrer',
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'x-content-type-options': 'nosniff'
      }
    })
  }
  context.after(() => { globalThis.fetch = originalFetch })
  const manifest = reviewedManifest()
  const snapshot = await readPublicSecuritySnapshot(manifest)
  await assert.doesNotReject(() => verifyPublicSecuritySnapshot(manifest, snapshot))
  drift = true
  await assert.rejects(
    () => verifyPublicSecuritySnapshot(manifest, snapshot),
    /do not match the policy that was active before/
  )
  await assert.rejects(
    () => verifyPublicSecuritySnapshot({ ...manifest, origin: 'https://other.example.test' }, snapshot),
    /default HTTPS port/
  )
})

test('public target failure runs a reverse transaction and confirms the previous policy', async () => {
  const manifest = reviewedManifest()
  const calls = []
  const previousSnapshot = { origin: manifest.origin, responses: {}, schemaVersion: 1, serverName: manifest.serverName }
  await assert.rejects(
    () => activateReviewedPolicy({
      manifest,
      transition: async (request) => {
        calls.push(request)
        return request.direction === 'activate'
          ? { activeSha256: manifest.candidateSha256, backupPath: '/etc/nginx/conf.d/mugen.conf.mugen-policy-20260811T000000Z-aaaaaaaaaaaa.bak' }
          : { activeSha256: manifest.activeSha256, backupPath: '/etc/nginx/conf.d/mugen.conf.mugen-policy-20260811T000001Z-bbbbbbbbbbbb.bak' }
      },
      verificationAttempts: 1
    }, {
      readPublicSecuritySnapshot: async () => previousSnapshot,
      verifyPublicSecurityPolicy: async () => { throw new Error('new headers did not propagate') },
      verifyPublicSecuritySnapshot: async (value, snapshot) => {
        assert.equal(value, manifest)
        assert.equal(snapshot, previousSnapshot)
      }
    }),
    /automatically restored and confirmed/
  )
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    activeSha256: manifest.activeSha256,
    candidateSha256: manifest.candidateSha256,
    direction: 'activate'
  })
  assert.equal(calls[1].direction, 'rollback')
  assert.equal(calls[1].activeSha256, manifest.candidateSha256)
  assert.equal(calls[1].candidateSha256, manifest.activeSha256)
  assert.match(calls[1].candidatePath, /\.bak$/)
})

test('automatic rollback fails closed when restoration or old-policy readback fails', async () => {
  const manifest = reviewedManifest()
  const previousSnapshot = { origin: manifest.origin, responses: {}, schemaVersion: 1, serverName: manifest.serverName }
  await assert.rejects(
    () => activateReviewedPolicy({
      manifest,
      transition: async ({ direction }) => {
        if (direction === 'rollback') throw new Error('rollback transport failed')
        return { backupPath: '/etc/nginx/conf.d/mugen.conf.mugen-policy-20260811T000000Z-aaaaaaaaaaaa.bak' }
      },
      verificationAttempts: 1
    }, {
      readPublicSecuritySnapshot: async () => previousSnapshot,
      verifyPublicSecurityPolicy: async () => { throw new Error('target readback failed') }
    }),
    /automatic Nginx rollback failed/
  )

  await assert.rejects(
    () => activateReviewedPolicy({
      manifest,
      transition: async ({ direction }) => ({
        backupPath: direction === 'activate'
          ? '/etc/nginx/conf.d/mugen.conf.mugen-policy-20260811T000000Z-aaaaaaaaaaaa.bak'
          : '/etc/nginx/conf.d/mugen.conf.mugen-policy-20260811T000001Z-bbbbbbbbbbbb.bak'
      }),
      verificationAttempts: 1
    }, {
      readPublicSecuritySnapshot: async () => previousSnapshot,
      verifyPublicSecurityPolicy: async () => { throw new Error('target readback failed') },
      verifyPublicSecuritySnapshot: async () => { throw new Error('old policy drifted') }
    }),
    /previous public policy could not be read back/
  )
})

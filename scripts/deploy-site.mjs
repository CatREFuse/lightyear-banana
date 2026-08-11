import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDisallowedProductionHostname } from './production-origin-policy.mjs'
import {
  readGitSiteProvenance,
  siteManifestFileName,
  siteReleaseFileName,
  validateSiteReleaseMetadata
} from './site-release-provenance.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultEnvPath = path.join(projectRoot, 'key.env')
const defaultSiteDirectory = path.join(projectRoot, 'dist', 'site')
const defaultRemoteRoot = '/etc/nginx/static/mugen-site'
const protectedReleaseIndex = 'releases/latest.json'
const ccxVersion = '1.0.0'
const ccxFileName = `mugen-${ccxVersion}.ccx`
const localCcxPath = path.join(projectRoot, 'dist', 'site', 'releases', ccxVersion, ccxFileName)
const rootCcxPath = path.join(projectRoot, 'dist', ccxFileName)
const rootCcxSidecarPath = `${rootCcxPath}.sha256`
const siteCcxSidecarPath = path.join(projectRoot, 'dist', 'site', 'releases', ccxVersion, 'SHA256SUMS.txt')

function readOption(name) {
  const prefix = `${name}=`
  const inline = process.argv.find((argument) => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function required(environment, key) {
  const value = environment[key]?.trim()
  if (!value) throw new Error(`Missing required deployment value: ${key}.`)
  return value
}

export function parseEnv(contents) {
  const result = {}
  const supportedLowercaseNames = new Set(['server_ip', 'password', 'domain', 'secondary_domain'])
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
    const separator = normalized.indexOf('=')
    if (separator < 1) throw new Error(`Invalid key.env line: ${rawLine}`)
    const key = normalized.slice(0, separator).trim()
    let value = normalized.slice(separator + 1).trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      if (/^[a-z][a-z0-9_]*$/.test(key) && !supportedLowercaseNames.has(key)) continue
      if (supportedLowercaseNames.has(key)) {
        // AGENTS.md defines these deployment aliases; all other lowercase settings stay out of scope.
      } else {
      throw new Error(`Invalid key.env name: ${key}`)
      }
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

export function validateRemoteRoot(value = defaultRemoteRoot) {
  if (value !== defaultRemoteRoot) {
    throw new Error(`The official site deployment root must be ${defaultRemoteRoot}.`)
  }
  return value
}

function validateConnectionPart(value, label, optional = false) {
  const normalized = value?.trim()
  if (!normalized && optional) return undefined
  if (!normalized) throw new Error(`Missing required deployment value: ${label}.`)
  if (!/^[A-Za-z0-9._-]+$/.test(normalized) || normalized.startsWith('-')) {
    throw new Error(`${label} contains unsupported characters.`)
  }
  return normalized
}

export function resolveSshConfiguration(environment) {
  const passwordConfigured = [
    environment.password,
    environment.PASSWORD,
    environment.DEPLOY_SSH_PASSWORD
  ].some((value) => Boolean(value?.trim()))
  if (passwordConfigured) {
    throw new Error('Password deployment values are unsupported. Remove them and configure SSH public-key or agent authentication.')
  }
  const primaryHost = environment.DEPLOY_SSH_HOST?.trim()
  const aliasHost = environment.server_ip?.trim()
  if (primaryHost && aliasHost && primaryHost !== aliasHost) {
    throw new Error('DEPLOY_SSH_HOST and server_ip identify different deployment hosts.')
  }
  const host = validateConnectionPart(primaryHost || aliasHost, 'DEPLOY_SSH_HOST/server_ip')
  const user = validateConnectionPart(environment.DEPLOY_SSH_USER, 'DEPLOY_SSH_USER', true)
  const port = environment.DEPLOY_SSH_PORT?.trim() || '22'
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('DEPLOY_SSH_PORT is invalid.')
  }
  const identityValue = environment.DEPLOY_SSH_IDENTITY_FILE?.trim()
  const identityFile = identityValue ? path.resolve(projectRoot, identityValue) : undefined
  if (identityFile && !existsSync(identityFile)) {
    throw new Error('DEPLOY_SSH_IDENTITY_FILE does not exist.')
  }
  return {
    host,
    identityFile,
    port,
    target: user ? `${user}@${host}` : host,
    user
  }
}

export function sshArguments(configuration) {
  const argumentsList = [
    '-o', 'BatchMode=yes',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=2',
    '-p', configuration.port
  ]
  if (configuration.identityFile) argumentsList.push('-i', configuration.identityFile)
  return argumentsList
}

export function scpArguments(configuration) {
  const argumentsList = [
    '-B',
    '-o', 'BatchMode=yes',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'ConnectTimeout=15',
    '-P', configuration.port
  ]
  if (configuration.identityFile) argumentsList.push('-i', configuration.identityFile)
  return argumentsList
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function runSsh(configuration, command, captureOutput = false) {
  return execFileSync(
    'ssh',
    [...sshArguments(configuration), configuration.target, `sh -c ${shellQuote(command)}`],
    {
      cwd: projectRoot,
      ...(captureOutput ? { encoding: 'utf8' } : {}),
      stdio: captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit'
    }
  )
}

function captureSsh(configuration, command) {
  return String(runSsh(configuration, command, true) ?? '').trim()
}

export function executeWithStateReconciliation({
  execute,
  operation,
  parseConfirmation,
  parseReconciliation,
  reconcile
}) {
  try {
    return { reconciled: false, result: parseConfirmation(execute()), state: 'switched' }
  } catch {
    let state
    try {
      state = parseReconciliation(reconcile())
    } catch {
      const error = new Error(`${operation} state is uncertain after confirmation was lost; no cleanup or additional switch is safe.`)
      error.code = 'REMOTE_STATE_UNCERTAIN'
      throw error
    }
    if (state.state === 'switched') return { reconciled: true, result: state, state: 'switched' }
    if (state.state === 'not-switched') return { reconciled: true, result: state, state: 'not-switched' }
    const error = new Error(`${operation} reconciliation returned an unsupported state.`)
    error.code = 'REMOTE_STATE_UNCERTAIN'
    throw error
  }
}

function uploadFile(configuration, localPath, remotePath) {
  execFileSync(
    'scp',
    [...scpArguments(configuration), localPath, `${configuration.target}:${remotePath}`],
    { cwd: projectRoot, stdio: 'inherit' }
  )
}

function normalizeRelativePath(value) {
  const normalized = value.split(path.sep).join('/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('../') ||
    normalized.endsWith('/..') ||
    !/^[A-Za-z0-9._/-]+$/.test(normalized)
  ) {
    throw new Error(`Unsupported site output path: ${value}`)
  }
  return normalized
}

export function listRegularFiles(directory, prefix = '') {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = normalizeRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name)
    const fullPath = path.join(directory, entry.name)
    const stat = lstatSync(fullPath)
    if (stat.isSymbolicLink()) throw new Error(`Site output must not contain symbolic links: ${relative}`)
    if (stat.isDirectory()) {
      files.push(...listRegularFiles(fullPath, relative))
    } else if (stat.isFile()) {
      files.push(relative)
    } else {
      throw new Error(`Site output contains an unsupported filesystem entry: ${relative}`)
    }
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'))
}

function fileDigest(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export function createFileRecords(directory, { excludeReleases = false } = {}) {
  return listRegularFiles(directory)
    .filter((relative) => !excludeReleases || (relative !== 'releases' && !relative.startsWith('releases/')))
    .map((relative) => {
      const fullPath = path.join(directory, ...relative.split('/'))
      const bytes = readFileSync(fullPath)
      return {
        path: relative,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.byteLength
      }
    })
}

export function createSha256Manifest(records) {
  if (!records.length) throw new Error('The site deployment snapshot is empty.')
  return records.map((record) => `${record.sha256}  ./${record.path}`).join('\n') + '\n'
}

export function parseSha256Manifest(contents) {
  const records = []
  const seen = new Set()
  for (const rawLine of contents.split(/\r?\n/)) {
    if (!rawLine) continue
    const match = rawLine.match(/^([a-f0-9]{64}) [ *]\.\/([A-Za-z0-9._/-]+)$/)
    if (!match) throw new Error('Rollback full-site manifest contains an invalid checksum line.')
    const relative = normalizeRelativePath(match[2])
    if (relative.startsWith('releases/') || relative === 'releases') {
      throw new Error('Rollback full-site manifest must describe site assets outside releases/.')
    }
    if (seen.has(relative)) throw new Error(`Rollback full-site manifest repeats ${relative}.`)
    seen.add(relative)
    records.push({ path: relative, sha256: match[1] })
  }
  if (!seen.has('index.html') || records.length < 2) {
    throw new Error('Rollback full-site manifest must include index.html and the complete site asset set.')
  }
  return records
}

export function calculateSnapshotHash(records) {
  const hash = createHash('sha256')
  for (const record of records) {
    hash.update(record.path)
    hash.update('\0')
    hash.update(record.sha256)
    hash.update('\0')
    hash.update(String(record.size))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function sameRecords(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function assertGitSiteProvenanceUnchanged(expected, actual) {
  if (
    !expected ||
    !actual ||
    expected.commit !== actual.commit ||
    expected.dirty !== actual.dirty ||
    actual.dirty
  ) {
    throw new Error('Git provenance changed after the official site snapshot was created; upload stopped.')
  }
}

export function validateSiteBuild(directory = defaultSiteDirectory) {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    throw new Error('Official site build not found. Run npm run build:site first.')
  }
  const allFiles = listRegularFiles(directory)
  for (const requiredFile of [
    'index.html',
    'styles.css',
    'app.js',
    'prism-optics.js',
    'prism-scene.js',
    'assets/mugen-wordmark-4k.png',
    'vendor/three.module.min.js',
    siteReleaseFileName,
    siteManifestFileName
  ]) {
    if (!allFiles.includes(requiredFile)) throw new Error(`Official site build is missing ${requiredFile}.`)
  }
  if (!allFiles.includes(protectedReleaseIndex)) {
    throw new Error(`Official site build is missing ${protectedReleaseIndex}; it is validated locally but never uploaded.`)
  }
  const records = createFileRecords(directory, { excludeReleases: true })
  if (records.some((record) => record.path === protectedReleaseIndex || record.path.startsWith('releases/'))) {
    throw new Error('The protected releases tree entered the site deployment snapshot.')
  }
  const provenance = validateSiteReleaseMetadata({ directory })
  return { allFiles, provenance, records, snapshotHash: calculateSnapshotHash(records) }
}

export function createSiteSnapshot(sourceDirectory, destinationDirectory) {
  const before = validateSiteBuild(sourceDirectory)
  mkdirSync(destinationDirectory, { recursive: true })
  for (const record of before.records) {
    const sourcePath = path.join(sourceDirectory, ...record.path.split('/'))
    const destinationPath = path.join(destinationDirectory, ...record.path.split('/'))
    mkdirSync(path.dirname(destinationPath), { recursive: true })
    cpSync(sourcePath, destinationPath, { errorOnExist: true, force: false })
  }
  const afterSource = createFileRecords(sourceDirectory, { excludeReleases: true })
  const snapshotRecords = createFileRecords(destinationDirectory)
  if (!sameRecords(before.records, afterSource)) {
    throw new Error('Official site output changed while the deployment snapshot was being created.')
  }
  if (!sameRecords(before.records, snapshotRecords)) {
    throw new Error('The stable site deployment snapshot does not match dist/site.')
  }
  if (existsSync(path.join(destinationDirectory, 'releases'))) {
    throw new Error('The local releases tree must not be copied into the site deployment snapshot.')
  }
  validateSiteReleaseMetadata({ directory: destinationDirectory })
  return { records: snapshotRecords, snapshotHash: before.snapshotHash }
}

function parseSingleChecksum(contents, expectedFile, label) {
  const lines = contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length !== 1) throw new Error(`${label} must contain exactly one checksum.`)
  const match = lines[0].match(/^([a-f0-9]{64})\s+\*?([A-Za-z0-9._-]+)$/i)
  if (!match || match[2] !== expectedFile) throw new Error(`${label} must name only ${expectedFile}.`)
  return match[1].toLowerCase()
}

export function validateLocalCcxPayload({
  siteCcx = localCcxPath,
  rootCcx = rootCcxPath,
  rootSidecar = rootCcxSidecarPath,
  siteSidecar = siteCcxSidecarPath
} = {}) {
  for (const [label, filePath] of [
    ['site CCX', siteCcx],
    ['root CCX', rootCcx],
    ['root CCX checksum', rootSidecar],
    ['site CCX checksum', siteSidecar]
  ]) {
    if (!existsSync(filePath) || !lstatSync(filePath).isFile()) throw new Error(`Missing ${label}: ${filePath}`)
  }
  if (path.basename(siteCcx) !== ccxFileName || path.basename(rootCcx) !== ccxFileName) {
    throw new Error(`The optional site payload must be ${ccxFileName}.`)
  }
  const rootDigest = fileDigest(rootCcx)
  const siteDigest = fileDigest(siteCcx)
  const expectedFromRoot = parseSingleChecksum(readFileSync(rootSidecar, 'utf8'), ccxFileName, 'Root CCX checksum')
  const expectedFromSite = parseSingleChecksum(readFileSync(siteSidecar, 'utf8'), ccxFileName, 'Site CCX checksum')
  if (rootDigest !== siteDigest || rootDigest !== expectedFromRoot || rootDigest !== expectedFromSite) {
    throw new Error('The root CCX, site CCX, and checksum records do not match.')
  }
  const size = lstatSync(siteCcx).size
  if (!size) throw new Error('The optional site CCX is empty.')
  const checksumSize = lstatSync(siteSidecar).size
  const checksumSha256 = fileDigest(siteSidecar)
  return {
    checksum: {
      fileName: 'SHA256SUMS.txt',
      path: siteSidecar,
      sha256: checksumSha256,
      size: checksumSize
    },
    destination: `releases/${ccxVersion}/${ccxFileName}`,
    fileName: ccxFileName,
    path: siteCcx,
    sha256: siteDigest,
    size,
    version: ccxVersion
  }
}

export function makeSiteId(snapshotHash, date = new Date(), entropy = randomBytes(4).toString('hex')) {
  if (!/^[a-f0-9]{64}$/.test(snapshotHash)) throw new Error('Snapshot hash is invalid.')
  if (!/^[a-f0-9]{8}$/.test(entropy)) throw new Error('Site ID entropy is invalid.')
  const timestamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `${timestamp}-${snapshotHash.slice(0, 12)}-${entropy}`
}

export function validateSiteId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,95}$/.test(value) || value.startsWith('-') || value.includes('..')) {
    throw new Error('Site release ID contains unsupported characters.')
  }
  return value
}

function withRemoteLock(remoteRoot, command) {
  const lockFile = `${remoteRoot}/.deploy.lock`
  return [
    'set -eu',
    'umask 022',
    'command -v realpath >/dev/null 2>&1 || { echo "realpath is required for site deployment" >&2; exit 69; }',
    `test -d ${shellQuote(remoteRoot)}`,
    `test ! -L ${shellQuote(remoteRoot)} || { echo "site root must not be a symlink" >&2; exit 77; }`,
    `root_physical=$(realpath -e -- ${shellQuote(remoteRoot)})`,
    `test "$root_physical" = ${shellQuote(remoteRoot)} || { echo "site root or one of its ancestors resolves through a symlink" >&2; exit 77; }`,
    'command -v flock >/dev/null 2>&1 || { echo "flock is required for site deployment" >&2; exit 69; }',
    `if test -e ${shellQuote(lockFile)} || test -L ${shellQuote(lockFile)}; then test -f ${shellQuote(lockFile)} && test ! -L ${shellQuote(lockFile)} || { echo "deployment lock is not a regular file" >&2; exit 77; }; fi`,
    `exec 9>${shellQuote(lockFile)}`,
    'flock -n 9 || { echo "another site deployment is active" >&2; exit 75; }',
    command
  ].join('; ')
}

function assertLiteralDirectoryShell(value, label, variable) {
  return [
    `test -d ${shellQuote(value)} || { echo "${label} does not exist" >&2; exit 77; }`,
    `test ! -L ${shellQuote(value)} || { echo "${label} must not be a symlink" >&2; exit 77; }`,
    `${variable}=$(realpath -e -- ${shellQuote(value)})`,
    `test "$${variable}" = ${shellQuote(value)} || { echo "${label} or one of its ancestors resolves through a symlink" >&2; exit 77; }`
  ].join('; ')
}

function assertDynamicDirectoryShell(variable, label) {
  const physicalVariable = `${variable}_physical`
  return [
    `test -d "$${variable}" || { echo "${label} does not exist" >&2; exit 77; }`,
    `test ! -L "$${variable}" || { echo "${label} must not be a symlink" >&2; exit 77; }`,
    `${physicalVariable}=$(realpath -e -- "$${variable}")`,
    `test "$${physicalVariable}" = "$${variable}" || { echo "${label} or one of its ancestors resolves through a symlink" >&2; exit 77; }`
  ].join('; ')
}

function assertReleaseTargetShell(variable, remoteRoot, label) {
  const releaseIdVariable = `${variable}_release_id`
  return [
    `case "$${variable}" in ${shellQuote(`${remoteRoot}/releases/`)}*) ;; *) echo "${label} is outside the site release root" >&2; exit 77 ;; esac`,
    `${releaseIdVariable}=\${${variable}#${shellQuote(`${remoteRoot}/releases/`)}}`,
    `case "$${releaseIdVariable}" in ''|.|..|*..*|*/*|*[!A-Za-z0-9._-]*) echo "${label} is not one immutable release directory" >&2; exit 77 ;; esac`,
    assertDynamicDirectoryShell(variable, label)
  ].join('; ')
}

function validateCommandToken(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(value || '') || value.includes('..')) {
    throw new Error('Deployment command token is invalid.')
  }
  return value
}

function validateExpectedReleasePath(value, remoteRoot, label) {
  const prefix = `${remoteRoot}/releases/`
  const releaseId = value?.slice(prefix.length)
  if (
    typeof value !== 'string' ||
    !value.startsWith(prefix) ||
    !releaseId ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(releaseId) ||
    releaseId.includes('..')
  ) {
    throw new Error(`${label} is outside the site releases directory.`)
  }
  return value
}

function validateRollbackMarkerName(value) {
  if (!/^site-rollback-[A-Za-z0-9._-]{8,120}\.sha256\.txt$/.test(value || '') || value.includes('..')) {
    throw new Error('Rollback marker name is invalid.')
  }
  return value
}

function validateRollbackLatestProofName(value) {
  if (!/^site-rollback-[A-Za-z0-9._-]{8,120}\.latest\.json$/.test(value || '') || value.includes('..')) {
    throw new Error('Rollback latest proof name is invalid.')
  }
  return value
}

export function createPrepareCommand({ incoming, markerName, remoteRoot = defaultRemoteRoot }) {
  validateRemoteRoot(remoteRoot)
  validateRollbackMarkerName(markerName)
  validateIncomingPath(incoming, remoteRoot)
  const current = `${remoteRoot}/current`
  const previous = `${remoteRoot}/previous`
  const releases = `${remoteRoot}/releases`
  const incomingRoot = `${remoteRoot}/.incoming`
  const command = [
    'command -v readlink >/dev/null 2>&1',
    'command -v sha256sum >/dev/null 2>&1',
    assertLiteralDirectoryShell(releases, 'site releases directory', 'releases_physical'),
    `test -L ${shellQuote(current)} || { echo "current must be an existing symlink" >&2; exit 73; }`,
    `current_target=$(readlink ${shellQuote(current)})`,
    assertReleaseTargetShell('current_target', remoteRoot, 'current target'),
    `previous_target=${shellQuote('__MUGEN_NONE__')}`,
    `if test -e ${shellQuote(previous)} || test -L ${shellQuote(previous)}; then test -L ${shellQuote(previous)} || { echo "previous is not a symlink" >&2; exit 73; }; previous_target=$(readlink ${shellQuote(previous)}); ${assertReleaseTargetShell('previous_target', remoteRoot, 'previous target')}; fi`,
    'current_releases="$current_target/releases"',
    assertDynamicDirectoryShell('current_releases', 'current release downloads directory'),
    'test -z "$(find "$current_releases" -type l -print -quit)" || { echo "current release downloads must not contain symlinks" >&2; exit 78; }',
    'test -f "$current_releases/latest.json"',
    `rollback_marker="$current_target/${markerName}"`,
    'test ! -e "$rollback_marker" && test ! -L "$rollback_marker"',
    `test -z "$(find "$current_target" -path "$current_target/releases" -prune -o -type l -print -quit)" || { echo "rollback site assets must not contain symlinks" >&2; exit 78; }`,
    'prepare_complete=0',
    [
      'prepare_cleanup() { if test "$prepare_complete" != 1; then :',
      'if test -f "$rollback_marker" && test ! -L "$rollback_marker"; then if current_cleanup_physical=$(realpath -e -- "$current_target") && test "$current_cleanup_physical" = "$current_target"; then rm -f -- "$rollback_marker" || :; fi; fi',
      `if test -e ${shellQuote(incoming)} || test -L ${shellQuote(incoming)}; then if test -d ${shellQuote(incoming)} && test ! -L ${shellQuote(incoming)}; then if incoming_cleanup_physical=$(realpath -e -- ${shellQuote(incoming)}) && test "$incoming_cleanup_physical" = ${shellQuote(incoming)}; then rm -rf -- ${shellQuote(incoming)} || :; fi; fi; fi`,
      'fi; }',
      'prepare_abort() { abort_status=$1; prepare_cleanup; trap - 0 1 2 15; exit "$abort_status"; }'
    ].join('; '),
    'trap prepare_cleanup 0',
    'trap "prepare_abort 129" 1',
    'trap "prepare_abort 130" 2',
    'trap "prepare_abort 143" 15',
    `if test ! -e ${shellQuote(incomingRoot)} && test ! -L ${shellQuote(incomingRoot)}; then mkdir ${shellQuote(incomingRoot)}; fi`,
    assertLiteralDirectoryShell(incomingRoot, 'site incoming directory', 'incoming_root_physical'),
    `test ! -e ${shellQuote(incoming)} && test ! -L ${shellQuote(incoming)}`,
    `mkdir ${shellQuote(incoming)}`,
    assertLiteralDirectoryShell(incoming, 'unique incoming directory', 'incoming_physical'),
    `(cd "$current_target" && find . -path ./releases -prune -o -type f ! -name ${shellQuote('site-rollback-*')} -exec sha256sum {} + | LC_ALL=C sort) > "$rollback_marker"`,
    'test -s "$rollback_marker"',
    'set -- $(sha256sum "$current_target/releases/latest.json")',
    'latest_sha=$1',
    'set -- $(sha256sum "$rollback_marker")',
    'rollback_marker_sha=$1',
    'prepare_complete=1',
    'trap - 0 1 2 15',
    'printf "__MUGEN_CURRENT__%s\\n" "$current_target"',
    'printf "__MUGEN_PREVIOUS__%s\\n" "$previous_target"',
    'printf "__MUGEN_LATEST_SHA__%s\\n" "$latest_sha"',
    `printf ${shellQuote(`__MUGEN_ROLLBACK_MARKER__${markerName}\n`)}`,
    'printf "__MUGEN_ROLLBACK_MARKER_SHA__%s\\n" "$rollback_marker_sha"',
    'printf "__MUGEN_ROLLBACK_MANIFEST_BEGIN__\\n"',
    'cat "$rollback_marker"',
    'printf "__MUGEN_ROLLBACK_MANIFEST_END__\\n"'
  ].join('; ')
  return withRemoteLock(remoteRoot, command)
}

export function parsePrepareOutput(value) {
  const current = value.match(/^__MUGEN_CURRENT__(.+)$/m)?.[1]?.trim()
  const previousValue = value.match(/^__MUGEN_PREVIOUS__(.+)$/m)?.[1]?.trim()
  const latestSha = value.match(/^__MUGEN_LATEST_SHA__([a-f0-9]{64})$/m)?.[1]
  const markerName = value.match(/^__MUGEN_ROLLBACK_MARKER__(.+)$/m)?.[1]?.trim()
  const markerSha256 = value.match(/^__MUGEN_ROLLBACK_MARKER_SHA__([a-f0-9]{64})$/m)?.[1]
  const begin = value.indexOf('__MUGEN_ROLLBACK_MANIFEST_BEGIN__\n')
  const end = value.indexOf('__MUGEN_ROLLBACK_MANIFEST_END__', begin)
  const manifest = begin >= 0 && end > begin
    ? value.slice(begin + '__MUGEN_ROLLBACK_MANIFEST_BEGIN__\n'.length, end)
    : ''
  if (!current || !previousValue || !latestSha || !markerName || !markerSha256 || !manifest) {
    throw new Error('The server did not return its protected release state and full rollback manifest.')
  }
  validateRollbackMarkerName(markerName)
  const records = parseSha256Manifest(manifest)
  const previous = previousValue === '__MUGEN_NONE__' ? undefined : previousValue
  return { current, ...(previous ? { previous } : {}), latestSha, rollback: { manifest, markerName, markerSha256, records } }
}

function validateIncomingPath(incoming, remoteRoot) {
  const prefix = `${remoteRoot}/.incoming/`
  if (
    typeof incoming !== 'string' ||
    !incoming.startsWith(prefix) ||
    incoming === prefix ||
    incoming.includes('/../') ||
    incoming.endsWith('/..') ||
    path.posix.normalize(incoming) !== incoming ||
    !/^[A-Za-z0-9._/-]+$/.test(incoming)
  ) throw new Error('Incoming target is outside the official site incoming directory.')
  return prefix
}

export function createCleanupCommand({ expectedCurrent, incoming, markerName, remoteRoot = defaultRemoteRoot }) {
  validateRemoteRoot(remoteRoot)
  validateRollbackMarkerName(markerName)
  validateExpectedReleasePath(expectedCurrent, remoteRoot, 'Rollback marker cleanup target')
  const prefix = validateIncomingPath(incoming, remoteRoot)
  const incomingRoot = `${remoteRoot}/.incoming`
  return withRemoteLock(remoteRoot, [
    assertLiteralDirectoryShell(`${remoteRoot}/releases`, 'site releases directory', 'releases_physical'),
    `test -L ${shellQuote(`${remoteRoot}/current`)} && test "$(readlink ${shellQuote(`${remoteRoot}/current`)})" = ${shellQuote(expectedCurrent)} || { echo "cleanup current target changed; cleanup stopped" >&2; exit 76; }`,
    assertLiteralDirectoryShell(incomingRoot, 'site incoming directory', 'incoming_root_physical'),
    assertLiteralDirectoryShell(expectedCurrent, 'cleanup release target', 'cleanup_release_physical'),
    `case ${shellQuote(incoming)} in ${shellQuote(prefix)}*) ;; *) echo "invalid incoming cleanup target" >&2; exit 77 ;; esac`,
    `if test -e ${shellQuote(incoming)} || test -L ${shellQuote(incoming)}; then ${assertLiteralDirectoryShell(incoming, 'unique incoming cleanup directory', 'cleanup_incoming_physical')}; rm -rf -- ${shellQuote(incoming)}; fi`,
    assertLiteralDirectoryShell(expectedCurrent, 'cleanup release target', 'cleanup_release_physical_again'),
    `rm -f -- ${shellQuote(`${expectedCurrent}/${markerName}`)}`
  ].join('; '))
}

export function createActivationCommand({
  archiveSha256,
  ccx,
  expectedCurrent,
  expectedLatestSha,
  expectedPrevious,
  incoming,
  manifestSha256,
  remoteRoot = defaultRemoteRoot,
  rollback,
  siteId,
  token
}) {
  validateRemoteRoot(remoteRoot)
  validateIncomingPath(incoming, remoteRoot)
  validateSiteId(siteId)
  validateCommandToken(token)
  validateExpectedReleasePath(expectedCurrent, remoteRoot, 'Expected current release')
  if (expectedPrevious !== undefined) validateExpectedReleasePath(expectedPrevious, remoteRoot, 'Expected previous release')
  if (!/^[a-f0-9]{64}$/.test(archiveSha256) || !/^[a-f0-9]{64}$/.test(manifestSha256)) {
    throw new Error('Upload checksum is invalid.')
  }
  if (!/^[a-f0-9]{64}$/.test(expectedLatestSha)) throw new Error('Protected latest.json checksum is invalid.')
  validateRollbackMarkerName(rollback?.markerName)
  if (!/^[a-f0-9]{64}$/.test(rollback?.markerSha256 || '')) throw new Error('Rollback marker checksum is invalid.')
  const current = `${remoteRoot}/current`
  const previous = `${remoteRoot}/previous`
  const releases = `${remoteRoot}/releases`
  const incomingRoot = `${remoteRoot}/.incoming`
  const remoteRelease = `${remoteRoot}/releases/${siteId}`
  const stage = `${remoteRoot}/.stage-${siteId}-${token}`
  const nextCurrent = `${remoteRoot}/.current-${token}`
  const nextPrevious = `${remoteRoot}/.previous-${token}`
  const restorePrevious = `${remoteRoot}/.activation-restore-previous-${token}`
  const archive = `${incoming}/site.tar.gz`
  const manifest = `${incoming}/site.sha256`
  const inheritedManifest = `${incoming}/inherited-releases.sha256`
  const finalManifest = `${incoming}/final-release.sha256`
  const expectedPreviousValue = expectedPrevious || '__MUGEN_NONE__'
  const restoreActivationPrevious = expectedPrevious
    ? [
        `restore_previous_physical=$(realpath -e -- ${shellQuote(expectedPrevious)}) || return 77`,
        `test "$restore_previous_physical" = ${shellQuote(expectedPrevious)} || return 77`,
        `safe_remove_link ${shellQuote(restorePrevious)} || return 77`,
        `ln -s ${shellQuote(expectedPrevious)} ${shellQuote(restorePrevious)} || return 77`,
        `mv -Tf ${shellQuote(restorePrevious)} ${shellQuote(previous)} || return 77`,
        `test -L ${shellQuote(previous)} && test "$(readlink ${shellQuote(previous)} 2>/dev/null || :)" = ${shellQuote(expectedPrevious)}`
      ].join('; ')
    : [
        `test -L ${shellQuote(previous)} && test "$(readlink ${shellQuote(previous)} 2>/dev/null || :)" = ${shellQuote(expectedCurrent)} || return 77`,
        `rm -f -- ${shellQuote(previous)} || return 77`,
        `test ! -e ${shellQuote(previous)} && test ! -L ${shellQuote(previous)}`
      ].join('; ')
  const safeCleanupFunctions = [
    'safe_remove_tree() { target=$1',
    `case "$target" in ${shellQuote(`${remoteRoot}/.stage-`)}*|${shellQuote(`${remoteRoot}/.incoming/`)}*) ;; *) echo "refusing unsafe deployment cleanup" >&2; return 77 ;; esac`,
    'if test -e "$target" || test -L "$target"; then test -d "$target" && test ! -L "$target" || return 77; target_physical=$(realpath -e -- "$target") || return 77; test "$target_physical" = "$target" || return 77; rm -rf -- "$target"; fi; }',
    'safe_remove_link() { target=$1',
    `case "$target" in ${shellQuote(`${remoteRoot}/.current-`)}*|${shellQuote(`${remoteRoot}/.previous-`)}*|${shellQuote(restorePrevious)}) ;; *) return 77 ;; esac`,
    'if test -e "$target" || test -L "$target"; then test -L "$target" || return 77; rm -f -- "$target"; fi; }',
    `restore_activation_previous() { restore_root_physical=$(realpath -e -- ${shellQuote(remoteRoot)}) || return 77; test "$restore_root_physical" = ${shellQuote(remoteRoot)} || return 77; ${restoreActivationPrevious}; }`,
    `cleanup_deployment() { trap - 1 2 15; actual_current=$(readlink ${shellQuote(current)} 2>/dev/null || :); actual_previous=${shellQuote('__MUGEN_NONE__')}; if test -L ${shellQuote(previous)}; then actual_previous=$(readlink ${shellQuote(previous)} 2>/dev/null || :); fi; activation_cleanup_safe=0; if test "$actual_current" = ${shellQuote(remoteRelease)} && test "$actual_previous" = ${shellQuote(expectedCurrent)}; then activation_cleanup_safe=1; elif test "$actual_current" = ${shellQuote(expectedCurrent)} && test "$actual_previous" = ${shellQuote(expectedPreviousValue)}; then activation_cleanup_safe=1; elif test "$actual_current" = ${shellQuote(expectedCurrent)} && test "$actual_previous" = ${shellQuote(expectedCurrent)}; then if restore_activation_previous; then activation_cleanup_safe=1; else echo "activation interrupted after previous changed; compensation failed and transient evidence was preserved" >&2; fi; else echo "activation links are uncertain; transient evidence was preserved" >&2; fi; if test "$activation_cleanup_safe" = 1; then safe_remove_tree ${shellQuote(stage)} || :; safe_remove_tree ${shellQuote(incoming)} || :; safe_remove_link ${shellQuote(nextCurrent)} || :; safe_remove_link ${shellQuote(nextPrevious)} || :; safe_remove_link ${shellQuote(restorePrevious)} || :; fi; }`,
    'abort_deployment() { abort_status=$1; cleanup_deployment; trap - 0 1 2 15; exit "$abort_status"; }'
  ].join('; ')
  const commands = [
    safeCleanupFunctions,
    'trap cleanup_deployment 0',
    'trap "abort_deployment 129" 1',
    'trap "abort_deployment 130" 2',
    'trap "abort_deployment 143" 15',
    'command -v tar >/dev/null 2>&1',
    'command -v sha256sum >/dev/null 2>&1',
    'command -v find >/dev/null 2>&1',
    'command -v sort >/dev/null 2>&1',
    'command -v cp >/dev/null 2>&1',
    'command -v mv >/dev/null 2>&1',
    'command -v ln >/dev/null 2>&1',
    assertLiteralDirectoryShell(releases, 'site releases directory', 'releases_physical'),
    assertLiteralDirectoryShell(incomingRoot, 'site incoming directory', 'incoming_root_physical'),
    assertLiteralDirectoryShell(incoming, 'unique incoming directory', 'incoming_physical'),
    `test -L ${shellQuote(current)}`,
    `current_target=$(readlink ${shellQuote(current)})`,
    `test "$current_target" = ${shellQuote(expectedCurrent)} || { echo "site deployment was superseded before activation" >&2; exit 76; }`,
    assertReleaseTargetShell('current_target', remoteRoot, 'current target'),
    `test -f ${shellQuote(`${expectedCurrent}/${rollback.markerName}`)}`,
    `printf ${shellQuote(`${rollback.markerSha256}  ${expectedCurrent}/${rollback.markerName}\n`)} | sha256sum -c - >/dev/null`,
    `(cd ${shellQuote(expectedCurrent)} && sha256sum -c ${shellQuote(`${expectedCurrent}/${rollback.markerName}`)} >/dev/null)`,
    ...(expectedPrevious
      ? [
          `test -L ${shellQuote(previous)} || { echo "expected previous symlink is missing" >&2; exit 76; }`,
          `previous_target=$(readlink ${shellQuote(previous)})`,
          `test "$previous_target" = ${shellQuote(expectedPrevious)} || { echo "previous changed before activation" >&2; exit 76; }`,
          assertReleaseTargetShell('previous_target', remoteRoot, 'previous target')
        ]
      : [`test ! -e ${shellQuote(previous)} && test ! -L ${shellQuote(previous)} || { echo "previous appeared before activation" >&2; exit 76; }`]),
    `test -f ${shellQuote(archive)}`,
    `test -f ${shellQuote(manifest)}`,
    `printf ${shellQuote(`${archiveSha256}  ${archive}\n`)} | sha256sum -c - >/dev/null`,
    `printf ${shellQuote(`${manifestSha256}  ${manifest}\n`)} | sha256sum -c - >/dev/null`,
    `test ! -e ${shellQuote(remoteRelease)} && test ! -L ${shellQuote(remoteRelease)}`,
    `test ! -e ${shellQuote(stage)} && test ! -L ${shellQuote(stage)}`,
    `mkdir ${shellQuote(stage)}`,
    assertLiteralDirectoryShell(stage, 'unique site stage', 'stage_physical'),
    `tar -xzf ${shellQuote(archive)} -C ${shellQuote(stage)} --no-same-owner`,
    `test -f ${shellQuote(`${stage}/index.html`)}`,
    `test ! -e ${shellQuote(`${stage}/releases`)}`,
    `test -z "$(find ${shellQuote(stage)} -type l -print -quit)" || { echo "site archive must not contain symlinks" >&2; exit 78; }`,
    `(cd ${shellQuote(stage)} && sha256sum -c ${shellQuote(manifest)} >/dev/null)`,
    'current_releases="$current_target/releases"',
    assertDynamicDirectoryShell('current_releases', 'current release downloads directory'),
    'test -f "$current_releases/latest.json"',
    'test -z "$(find "$current_releases" -type l -print -quit)" || { echo "inherited releases must not contain symlinks" >&2; exit 78; }',
    `(cd "$current_target" && find releases -type f -exec sha256sum {} + | LC_ALL=C sort > ${shellQuote(inheritedManifest)})`,
    `test -s ${shellQuote(inheritedManifest)}`,
    `mkdir ${shellQuote(`${stage}/releases`)}`,
    `cp -a "$current_target/releases/." ${shellQuote(`${stage}/releases/`)}`,
    `(cd ${shellQuote(stage)} && sha256sum -c ${shellQuote(inheritedManifest)} >/dev/null)`,
    `printf ${shellQuote(`${expectedLatestSha}  ${stage}/releases/latest.json\n`)} | sha256sum -c - >/dev/null`
  ]
  if (ccx) {
    if (
      ccx.version !== ccxVersion ||
      ccx.fileName !== ccxFileName ||
      !/^[a-f0-9]{64}$/.test(ccx.sha256) ||
      !Number.isSafeInteger(ccx.size) ||
      ccx.size < 1 ||
      ccx.checksum?.fileName !== 'SHA256SUMS.txt' ||
      !/^[a-f0-9]{64}$/.test(ccx.checksum.sha256) ||
      !Number.isSafeInteger(ccx.checksum.size) ||
      ccx.checksum.size < 1
    ) {
      throw new Error('Optional CCX deployment metadata is invalid.')
    }
    const remoteCcx = `${incoming}/${ccxFileName}`
    const remoteChecksum = `${incoming}/SHA256SUMS.txt`
    const destinationDirectory = `${stage}/releases/${ccxVersion}`
    const destination = `${destinationDirectory}/${ccxFileName}`
    const checksumDestination = `${destinationDirectory}/SHA256SUMS.txt`
    const temporaryCcx = `${destinationDirectory}/.${ccxFileName}.${token}`
    const temporaryChecksum = `${destinationDirectory}/.SHA256SUMS.txt.${token}`
    const verifyDestination = [
      `printf ${shellQuote(`${ccx.sha256}  ${destination}\n`)} | sha256sum -c - >/dev/null`,
      `printf ${shellQuote(`${ccx.checksum.sha256}  ${checksumDestination}\n`)} | sha256sum -c - >/dev/null`,
      `test "$(wc -c < ${shellQuote(destination)})" -eq ${shellQuote(String(ccx.size))}`,
      `test "$(wc -c < ${shellQuote(checksumDestination)})" -eq ${shellQuote(String(ccx.checksum.size))}`,
      `(cd ${shellQuote(destinationDirectory)} && sha256sum -c SHA256SUMS.txt >/dev/null)`
    ].join('; ')
    commands.push(
      `test -f ${shellQuote(remoteCcx)}`,
      `test -f ${shellQuote(remoteChecksum)}`,
      `printf ${shellQuote(`${ccx.sha256}  ${remoteCcx}\n`)} | sha256sum -c - >/dev/null`,
      `printf ${shellQuote(`${ccx.checksum.sha256}  ${remoteChecksum}\n`)} | sha256sum -c - >/dev/null`,
      `test "$(wc -c < ${shellQuote(remoteCcx)})" -eq ${shellQuote(String(ccx.size))}`,
      `test "$(wc -c < ${shellQuote(remoteChecksum)})" -eq ${shellQuote(String(ccx.checksum.size))}`,
      `mkdir -p ${shellQuote(destinationDirectory)}`,
      [
        `if test -e ${shellQuote(destination)} || test -e ${shellQuote(checksumDestination)}`,
        `then test -f ${shellQuote(destination)} && test -f ${shellQuote(checksumDestination)} && ${verifyDestination}`,
        `else cp ${shellQuote(remoteCcx)} ${shellQuote(temporaryCcx)}`,
        `cp ${shellQuote(remoteChecksum)} ${shellQuote(temporaryChecksum)}`,
        `mv ${shellQuote(temporaryCcx)} ${shellQuote(destination)}`,
        `mv ${shellQuote(temporaryChecksum)} ${shellQuote(checksumDestination)}`,
        'fi'
      ].join('; '),
      verifyDestination
    )
  }
  commands.push(
    `printf ${shellQuote(`${expectedLatestSha}  ${stage}/releases/latest.json\n`)} | sha256sum -c - >/dev/null`,
    `(cd ${shellQuote(stage)} && find . -type f -exec sha256sum {} + | LC_ALL=C sort > ${shellQuote(finalManifest)})`,
    `test -s ${shellQuote(finalManifest)}`,
    `(cd ${shellQuote(stage)} && sha256sum -c ${shellQuote(finalManifest)} >/dev/null)`,
    assertLiteralDirectoryShell(stage, 'unique site stage before activation', 'stage_physical_before_activation'),
    assertLiteralDirectoryShell(releases, 'site releases directory before activation', 'releases_physical_before_activation'),
    `mv ${shellQuote(stage)} ${shellQuote(remoteRelease)}`,
    assertLiteralDirectoryShell(remoteRelease, 'immutable site release', 'remote_release_physical'),
    `test ! -e ${shellQuote(nextPrevious)} && test ! -L ${shellQuote(nextPrevious)}`,
    `ln -s "$current_target" ${shellQuote(nextPrevious)}`,
    `mv -Tf ${shellQuote(nextPrevious)} ${shellQuote(previous)}`,
    `test ! -e ${shellQuote(nextCurrent)} && test ! -L ${shellQuote(nextCurrent)}`,
    `ln -s ${shellQuote(remoteRelease)} ${shellQuote(nextCurrent)}`,
    assertLiteralDirectoryShell(remoteRoot, 'site root before current activation', 'root_physical_before_activation'),
    `mv -Tf ${shellQuote(nextCurrent)} ${shellQuote(current)}`,
    'trap - 0 1 2 15',
    `safe_remove_tree ${shellQuote(incoming)}`,
    'printf "__MUGEN_PREVIOUS__%s\\n" "$current_target"',
    `printf ${shellQuote(`__MUGEN_CURRENT__${remoteRelease}\n`)}`,
    `printf ${shellQuote(`__MUGEN_LATEST_SHA__${expectedLatestSha}\n`)}`
  )
  return withRemoteLock(remoteRoot, commands.join('; '))
}

export function parseActivationOutput(value) {
  const previous = value.match(/^__MUGEN_PREVIOUS__(.+)$/m)?.[1]?.trim()
  const current = value.match(/^__MUGEN_CURRENT__(.+)$/m)?.[1]?.trim()
  const latestSha = value.match(/^__MUGEN_LATEST_SHA__([a-f0-9]{64})$/m)?.[1]
  if (!previous || !current || !latestSha) throw new Error('The server did not confirm site activation.')
  return { current, latestSha, previous }
}

export function createActivationReconciliationCommand({
  expectedCurrent,
  expectedLatestSha,
  expectedPrevious,
  markerName,
  markerSha256,
  remoteRoot = defaultRemoteRoot,
  siteId
}) {
  validateRemoteRoot(remoteRoot)
  validateExpectedReleasePath(expectedCurrent, remoteRoot, 'Expected current release')
  if (expectedPrevious !== undefined) validateExpectedReleasePath(expectedPrevious, remoteRoot, 'Expected previous release')
  validateSiteId(siteId)
  validateRollbackMarkerName(markerName)
  if (!/^[a-f0-9]{64}$/.test(expectedLatestSha || '')) throw new Error('Protected latest.json checksum is invalid.')
  if (!/^[a-f0-9]{64}$/.test(markerSha256 || '')) throw new Error('Rollback marker checksum is invalid.')
  const current = `${remoteRoot}/current`
  const previous = `${remoteRoot}/previous`
  const releases = `${remoteRoot}/releases`
  const desiredCurrent = `${releases}/${siteId}`
  const marker = `${expectedCurrent}/${markerName}`
  const expectedPreviousValue = expectedPrevious || '__MUGEN_NONE__'
  return withRemoteLock(remoteRoot, [
    assertLiteralDirectoryShell(releases, 'site releases directory', 'releases_physical'),
    assertLiteralDirectoryShell(expectedCurrent, 'expected pre-activation release', 'expected_current_physical'),
    `test -f ${shellQuote(marker)} && test ! -L ${shellQuote(marker)}`,
    `printf ${shellQuote(`${markerSha256}  ${marker}\n`)} | sha256sum -c - >/dev/null`,
    `(cd ${shellQuote(expectedCurrent)} && sha256sum -c ${shellQuote(marker)} >/dev/null)`,
    `printf ${shellQuote(`${expectedLatestSha}  ${expectedCurrent}/releases/latest.json\n`)} | sha256sum -c - >/dev/null`,
    `test -L ${shellQuote(current)} || { echo "current is not a symlink during activation reconciliation" >&2; exit 81; }`,
    `current_target=$(readlink ${shellQuote(current)})`,
    assertReleaseTargetShell('current_target', remoteRoot, 'reconciled current target'),
    `previous_target=${shellQuote('__MUGEN_NONE__')}`,
    `if test -e ${shellQuote(previous)} || test -L ${shellQuote(previous)}; then test -L ${shellQuote(previous)} || exit 81; previous_target=$(readlink ${shellQuote(previous)}); ${assertReleaseTargetShell('previous_target', remoteRoot, 'reconciled previous target')}; fi`,
    [
      `if test "$current_target" = ${shellQuote(desiredCurrent)}`,
      `then test "$previous_target" = ${shellQuote(expectedCurrent)} || { echo "activation links are partially switched" >&2; exit 81; }`,
      assertLiteralDirectoryShell(desiredCurrent, 'activated immutable release', 'desired_current_physical'),
      `printf ${shellQuote(`${expectedLatestSha}  ${desiredCurrent}/releases/latest.json\n`)} | sha256sum -c - >/dev/null`,
      'reconciled_state=switched',
      `elif test "$current_target" = ${shellQuote(expectedCurrent)}`,
      `then test "$previous_target" = ${shellQuote(expectedPreviousValue)} || { echo "activation previous target was not restored" >&2; exit 81; }`,
      `if test -e ${shellQuote(desiredCurrent)} || test -L ${shellQuote(desiredCurrent)}; then ${assertLiteralDirectoryShell(desiredCurrent, 'unactivated immutable release', 'unactivated_release_physical')}; printf ${shellQuote(`${expectedLatestSha}  ${desiredCurrent}/releases/latest.json\n`)} | sha256sum -c - >/dev/null; fi`,
      'reconciled_state=not-switched',
      'else echo "activation current target is neither expected state" >&2; exit 81',
      'fi'
    ].join('; '),
    'printf "__MUGEN_STATE__%s\n" "$reconciled_state"',
    'printf "__MUGEN_CURRENT__%s\n" "$current_target"',
    'printf "__MUGEN_PREVIOUS__%s\n" "$previous_target"',
    `printf ${shellQuote(`__MUGEN_LATEST_SHA__${expectedLatestSha}\n`)}`
  ].join('; '))
}

export function parseActivationReconciliationOutput(value) {
  const state = value.match(/^__MUGEN_STATE__(switched|not-switched)$/m)?.[1]
  const current = value.match(/^__MUGEN_CURRENT__(.+)$/m)?.[1]?.trim()
  const previousValue = value.match(/^__MUGEN_PREVIOUS__(.+)$/m)?.[1]?.trim()
  const latestSha = value.match(/^__MUGEN_LATEST_SHA__([a-f0-9]{64})$/m)?.[1]
  if (!state || !current || !previousValue || !latestSha) {
    throw new Error('Activation reconciliation did not return a complete remote state.')
  }
  const previous = previousValue === '__MUGEN_NONE__' ? undefined : previousValue
  if (state === 'switched' && !previous) throw new Error('Activated site has no verified previous release.')
  return { current, latestSha, previous, state }
}

export function createRollbackInspectionCommand({ remoteRoot = defaultRemoteRoot } = {}) {
  validateRemoteRoot(remoteRoot)
  const current = `${remoteRoot}/current`
  const previous = `${remoteRoot}/previous`
  return withRemoteLock(remoteRoot, [
    assertLiteralDirectoryShell(`${remoteRoot}/releases`, 'site releases directory', 'releases_physical'),
    `test -L ${shellQuote(current)} && test -L ${shellQuote(previous)} || { echo "rollback requires current and previous symlinks" >&2; exit 73; }`,
    `current_target=$(readlink ${shellQuote(current)})`,
    `previous_target=$(readlink ${shellQuote(previous)})`,
    assertReleaseTargetShell('current_target', remoteRoot, 'rollback current target'),
    assertReleaseTargetShell('previous_target', remoteRoot, 'rollback previous target'),
    'test "$current_target" != "$previous_target" || { echo "rollback current and previous targets are identical" >&2; exit 76; }',
    'current_releases="$current_target/releases"',
    'previous_releases="$previous_target/releases"',
    assertDynamicDirectoryShell('current_releases', 'current release downloads directory'),
    assertDynamicDirectoryShell('previous_releases', 'previous release downloads directory'),
    'set -- $(sha256sum "$current_releases/latest.json")',
    'current_latest_sha=$1',
    'set -- $(sha256sum "$previous_releases/latest.json")',
    'previous_latest_sha=$1',
    'test "$current_latest_sha" = "$previous_latest_sha" || { echo "current and previous latest.json differ; rollback stopped" >&2; exit 79; }',
    'printf "__MUGEN_CURRENT__%s\n" "$current_target"',
    'printf "__MUGEN_PREVIOUS__%s\n" "$previous_target"',
    'printf "__MUGEN_LATEST_SHA__%s\n" "$current_latest_sha"'
  ].join('; '))
}

export function createRollbackCommand({
  expectedCurrent,
  expectedLatestSha,
  expectedMarkerSha256,
  expectedPrevious,
  latestProofName,
  markerName,
  remoteRoot = defaultRemoteRoot,
  token
}) {
  validateRemoteRoot(remoteRoot)
  validateRollbackMarkerName(markerName)
  validateRollbackLatestProofName(latestProofName)
  validateCommandToken(token)
  validateExpectedReleasePath(expectedCurrent, remoteRoot, 'Expected current release')
  validateExpectedReleasePath(expectedPrevious, remoteRoot, 'Expected previous release')
  if (expectedCurrent === expectedPrevious) throw new Error('Rollback current and previous releases must differ.')
  if (!/^[a-f0-9]{64}$/.test(expectedLatestSha || '')) {
    throw new Error('Expected rollback latest.json checksum is invalid.')
  }
  if (expectedMarkerSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedMarkerSha256)) {
    throw new Error('Expected rollback marker checksum is invalid.')
  }
  const current = `${remoteRoot}/current`
  const previous = `${remoteRoot}/previous`
  const releases = `${remoteRoot}/releases`
  const nextCurrent = `${remoteRoot}/.rollback-current-${token}`
  const nextPrevious = `${remoteRoot}/.rollback-previous-${token}`
  const restorePrevious = `${remoteRoot}/.rollback-restore-previous-${token}`
  const commands = [
    assertLiteralDirectoryShell(releases, 'site releases directory', 'releases_physical'),
    `test -L ${shellQuote(current)}`,
    `test -L ${shellQuote(previous)}`,
    `current_target=$(readlink ${shellQuote(current)})`,
    `previous_target=$(readlink ${shellQuote(previous)})`,
    assertReleaseTargetShell('current_target', remoteRoot, 'current target'),
    assertReleaseTargetShell('previous_target', remoteRoot, 'previous target'),
    'test "$current_target" != "$previous_target" || { echo "rollback current and previous targets are identical" >&2; exit 76; }',
    `test "$current_target" = ${shellQuote(expectedCurrent)} || { echo "site deployment was superseded; rollback stopped" >&2; exit 76; }`,
    `test "$previous_target" = ${shellQuote(expectedPrevious)} || { echo "previous site release changed; rollback stopped" >&2; exit 76; }`,
    `test -f "$previous_target/index.html"`,
    'current_releases="$current_target/releases"',
    'previous_releases="$previous_target/releases"',
    assertDynamicDirectoryShell('current_releases', 'current release downloads directory'),
    assertDynamicDirectoryShell('previous_releases', 'previous release downloads directory'),
    'test -z "$(find "$current_releases" -type l -print -quit)" || { echo "current release downloads must not contain symlinks" >&2; exit 78; }',
    'test -z "$(find "$previous_releases" -type l -print -quit)" || { echo "previous release downloads must not contain symlinks" >&2; exit 78; }',
    'test -f "$current_releases/latest.json"',
    'test -f "$previous_releases/latest.json"',
    'set -- $(sha256sum "$current_releases/latest.json")',
    'current_latest_sha=$1',
    'set -- $(sha256sum "$previous_releases/latest.json")',
    'previous_latest_sha=$1',
    'test "$current_latest_sha" = "$previous_latest_sha" || { echo "current and previous latest.json differ; rollback stopped" >&2; exit 79; }',
    `test "$current_latest_sha" = ${shellQuote(expectedLatestSha)} || { echo "protected latest.json changed; rollback stopped" >&2; exit 79; }`,
    `rollback_marker="$previous_target/${markerName}"`,
    `latest_proof="$previous_target/${latestProofName}"`,
    `test -z "$(find "$previous_target" -path "$previous_target/releases" -prune -o -type l -print -quit)" || { echo "rollback site assets must not contain symlinks" >&2; exit 78; }`,
    'rollback_complete=0',
    'rollback_marker_created=0',
    'latest_proof_created=0',
    [
      'safe_remove_rollback_link() { target=$1',
      `case "$target" in ${shellQuote(nextCurrent)}|${shellQuote(nextPrevious)}|${shellQuote(restorePrevious)}) ;; *) return 77 ;; esac`,
      'if test -e "$target" || test -L "$target"; then test -L "$target" || return 77; rm -f -- "$target"; fi; }',
      'safe_remove_rollback_file() { target=$1',
      'case "$target" in "$previous_target"/site-rollback-*) ;; *) return 77 ;; esac',
      'if test -e "$target" || test -L "$target"; then test -f "$target" && test ! -L "$target" || return 77; previous_cleanup_physical=$(realpath -e -- "$previous_target") || return 77; test "$previous_cleanup_physical" = "$previous_target" || return 77; rm -f -- "$target"; fi; }',
      `safe_restore_rollback_previous() { test -L ${shellQuote(current)} && test -L ${shellQuote(previous)} || return 77; test "$(readlink ${shellQuote(current)} 2>/dev/null || :)" = "$current_target" || return 77; test "$(readlink ${shellQuote(previous)} 2>/dev/null || :)" = "$current_target" || return 77; restore_root_physical=$(realpath -e -- ${shellQuote(remoteRoot)}) || return 77; test "$restore_root_physical" = ${shellQuote(remoteRoot)} || return 77; restore_target_physical=$(realpath -e -- "$previous_target") || return 77; test "$restore_target_physical" = "$previous_target" || return 77; safe_remove_rollback_link ${shellQuote(restorePrevious)} || return 77; ln -s "$previous_target" ${shellQuote(restorePrevious)} || return 77; mv -Tf ${shellQuote(restorePrevious)} ${shellQuote(previous)} || return 77; test -L ${shellQuote(previous)} && test "$(readlink ${shellQuote(previous)} 2>/dev/null || :)" = "$previous_target"; }`,
      `rollback_cleanup() { trap - 1 2 15; safe_remove_rollback_link ${shellQuote(nextCurrent)} || :; safe_remove_rollback_link ${shellQuote(nextPrevious)} || :; safe_remove_rollback_link ${shellQuote(restorePrevious)} || :; actual_current=$(readlink ${shellQuote(current)} 2>/dev/null || :); actual_previous=$(readlink ${shellQuote(previous)} 2>/dev/null || :); rollback_cleanup_evidence=0; if test "$actual_current" = "$previous_target" && test "$actual_previous" = "$current_target"; then :; elif test "$actual_current" = "$current_target" && test "$actual_previous" = "$previous_target"; then rollback_cleanup_evidence=1; elif test "$actual_current" = "$current_target" && test "$actual_previous" = "$current_target"; then if safe_restore_rollback_previous; then rollback_cleanup_evidence=1; else echo "rollback interrupted after previous changed; compensation failed and evidence was preserved" >&2; fi; else echo "rollback links are uncertain; evidence was preserved" >&2; fi; if test "$rollback_complete" != 1 && test "$rollback_cleanup_evidence" = 1; then if test "$latest_proof_created" = 1; then safe_remove_rollback_file "$latest_proof" || :; fi; if test "$rollback_marker_created" = 1; then safe_remove_rollback_file "$rollback_marker" || :; fi; fi; }`,
      'rollback_abort() { abort_status=$1; rollback_cleanup; trap - 0 1 2 15; exit "$abort_status"; }'
    ].join('; '),
    'trap rollback_cleanup 0',
    'trap "rollback_abort 129" 1',
    'trap "rollback_abort 130" 2',
    'trap "rollback_abort 143" 15',
    ...(expectedMarkerSha256
      ? [
          'test -f "$rollback_marker" && test ! -L "$rollback_marker"',
          `printf ${shellQuote('%s  %s\n')} ${shellQuote(expectedMarkerSha256)} "$rollback_marker" | sha256sum -c - >/dev/null`
        ]
      : [
          'test ! -e "$rollback_marker" && test ! -L "$rollback_marker"',
          `(cd "$previous_target" && find . -path ./releases -prune -o -type f ! -name ${shellQuote('site-rollback-*')} -exec sha256sum {} + | LC_ALL=C sort) > "$rollback_marker"`,
          'rollback_marker_created=1'
        ]),
    'test -s "$rollback_marker"',
    'set -- $(sha256sum "$rollback_marker")',
    'rollback_marker_sha=$1',
    '(cd "$previous_target" && sha256sum -c "$rollback_marker" >/dev/null)',
    'test ! -e "$latest_proof" && test ! -L "$latest_proof"',
    'cp "$previous_releases/latest.json" "$latest_proof"',
    'latest_proof_created=1',
    'test -f "$latest_proof" && test ! -L "$latest_proof"',
    'set -- $(sha256sum "$latest_proof")',
    'test "$1" = "$previous_latest_sha"',
    assertDynamicDirectoryShell('current_target', 'current target before rollback switch'),
    assertDynamicDirectoryShell('previous_target', 'previous target before rollback switch'),
    assertDynamicDirectoryShell('current_releases', 'current downloads before rollback switch'),
    assertDynamicDirectoryShell('previous_releases', 'previous downloads before rollback switch'),
    'set -- $(sha256sum "$current_releases/latest.json")',
    'test "$1" = "$current_latest_sha" || { echo "current latest.json changed during rollback" >&2; exit 79; }',
    'set -- $(sha256sum "$previous_releases/latest.json")',
    'test "$1" = "$previous_latest_sha" || { echo "previous latest.json changed during rollback" >&2; exit 79; }',
    assertLiteralDirectoryShell(remoteRoot, 'site root before rollback switch', 'root_physical_before_rollback'),
    `test ! -e ${shellQuote(nextCurrent)} && test ! -L ${shellQuote(nextCurrent)}`,
    `test ! -e ${shellQuote(nextPrevious)} && test ! -L ${shellQuote(nextPrevious)}`,
    `test ! -e ${shellQuote(restorePrevious)} && test ! -L ${shellQuote(restorePrevious)}`,
    `ln -s "$previous_target" ${shellQuote(nextCurrent)}`,
    `ln -s "$current_target" ${shellQuote(nextPrevious)}`,
    `mv -Tf ${shellQuote(nextPrevious)} ${shellQuote(previous)}`,
    [
      `if mv -Tf ${shellQuote(nextCurrent)} ${shellQuote(current)}`,
      'then rollback_complete=1',
      'trap - 0 1 2 15',
      'else test -L ' + shellQuote(current) + ' && test "$(readlink ' + shellQuote(current) + ')" = "$current_target" || { echo "rollback current state became uncertain" >&2; exit 82; }',
      assertDynamicDirectoryShell('previous_target', 'rollback target during previous compensation'),
      assertLiteralDirectoryShell(remoteRoot, 'site root during previous compensation', 'root_physical_during_compensation'),
      `test ! -e ${shellQuote(restorePrevious)} && test ! -L ${shellQuote(restorePrevious)}`,
      `ln -s "$previous_target" ${shellQuote(restorePrevious)}`,
      `mv -Tf ${shellQuote(restorePrevious)} ${shellQuote(previous)}`,
      `test -L ${shellQuote(previous)} && test "$(readlink ${shellQuote(previous)})" = "$previous_target" || { echo "rollback previous compensation failed" >&2; exit 82; }`,
      'echo "rollback current switch failed; previous was restored" >&2',
      'exit 74',
      'fi'
    ].join('; '),
    'printf "__MUGEN_CURRENT__%s\\n" "$previous_target"',
    'printf "__MUGEN_PREVIOUS__%s\\n" "$current_target"',
    'printf "__MUGEN_LATEST_SHA__%s\\n" "$previous_latest_sha"',
    'printf "__MUGEN_EXPECTED_LATEST_SHA__%s\\n" "$previous_latest_sha"',
    `printf ${shellQuote(`__MUGEN_ROLLBACK_MARKER__${markerName}\n`)}`,
    'printf "__MUGEN_ROLLBACK_MARKER_SHA__%s\\n" "$rollback_marker_sha"',
    `printf ${shellQuote(`__MUGEN_LATEST_PROOF__${latestProofName}\n`)}`,
    'printf "__MUGEN_ROLLBACK_MANIFEST_BEGIN__\\n"',
    'cat "$rollback_marker"',
    'printf "__MUGEN_ROLLBACK_MANIFEST_END__\\n"'
  ].join('; ')
  return withRemoteLock(remoteRoot, commands)
}

export function parseRollbackOutput(value) {
  const activation = parseActivationOutput(value)
  const markerName = value.match(/^__MUGEN_ROLLBACK_MARKER__(.+)$/m)?.[1]?.trim()
  const markerSha256 = value.match(/^__MUGEN_ROLLBACK_MARKER_SHA__([a-f0-9]{64})$/m)?.[1]
  const expectedLatestSha = value.match(/^__MUGEN_EXPECTED_LATEST_SHA__([a-f0-9]{64})$/m)?.[1]
  const latestProofName = value.match(/^__MUGEN_LATEST_PROOF__(.+)$/m)?.[1]?.trim()
  const begin = value.indexOf('__MUGEN_ROLLBACK_MANIFEST_BEGIN__\n')
  const end = value.indexOf('__MUGEN_ROLLBACK_MANIFEST_END__', begin)
  const manifest = begin >= 0 && end > begin
    ? value.slice(begin + '__MUGEN_ROLLBACK_MANIFEST_BEGIN__\n'.length, end)
    : ''
  validateRollbackMarkerName(markerName)
  validateRollbackLatestProofName(latestProofName)
  if (!markerSha256 || !expectedLatestSha || !manifest) throw new Error('Rollback did not return its public full-site and latest.json proof.')
  return {
    ...activation,
    rollback: {
      manifest,
      markerName,
      markerSha256,
      records: parseSha256Manifest(manifest)
    },
    expectedLatestSha,
    latestProofName
  }
}

export function createRollbackReconciliationCommand({
  expectedCurrent,
  expectedLatestSha,
  expectedMarkerSha256,
  expectedPrevious,
  latestProofName,
  markerName,
  remoteRoot = defaultRemoteRoot
}) {
  validateRemoteRoot(remoteRoot)
  validateExpectedReleasePath(expectedCurrent, remoteRoot, 'Expected current release')
  validateExpectedReleasePath(expectedPrevious, remoteRoot, 'Expected previous release')
  if (expectedCurrent === expectedPrevious) throw new Error('Rollback current and previous releases must differ.')
  validateRollbackMarkerName(markerName)
  validateRollbackLatestProofName(latestProofName)
  if (!/^[a-f0-9]{64}$/.test(expectedLatestSha || '')) throw new Error('Expected rollback latest.json checksum is invalid.')
  if (expectedMarkerSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedMarkerSha256)) {
    throw new Error('Expected rollback marker checksum is invalid.')
  }
  const current = `${remoteRoot}/current`
  const previous = `${remoteRoot}/previous`
  const marker = `${expectedPrevious}/${markerName}`
  const proof = `${expectedPrevious}/${latestProofName}`
  const commands = [
    assertLiteralDirectoryShell(`${remoteRoot}/releases`, 'site releases directory', 'releases_physical'),
    assertLiteralDirectoryShell(expectedCurrent, 'expected rollback current release', 'expected_current_physical'),
    assertLiteralDirectoryShell(expectedPrevious, 'expected rollback previous release', 'expected_previous_physical'),
    `test -L ${shellQuote(current)} && test -L ${shellQuote(previous)} || { echo "rollback reconciliation requires both links" >&2; exit 81; }`,
    `current_target=$(readlink ${shellQuote(current)})`,
    `previous_target=$(readlink ${shellQuote(previous)})`,
    assertReleaseTargetShell('current_target', remoteRoot, 'reconciled rollback current target'),
    assertReleaseTargetShell('previous_target', remoteRoot, 'reconciled rollback previous target'),
    [
      `if test "$current_target" = ${shellQuote(expectedPrevious)} && test "$previous_target" = ${shellQuote(expectedCurrent)}`,
      'then reconciled_state=switched',
      `elif test "$current_target" = ${shellQuote(expectedCurrent)} && test "$previous_target" = ${shellQuote(expectedPrevious)}`,
      'then reconciled_state=not-switched',
      'else echo "rollback links are in a partial or unrelated state" >&2; exit 81',
      'fi'
    ].join('; '),
    'current_releases="$current_target/releases"',
    'previous_releases="$previous_target/releases"',
    assertDynamicDirectoryShell('current_releases', 'reconciled current release downloads'),
    assertDynamicDirectoryShell('previous_releases', 'reconciled previous release downloads'),
    'test -z "$(find "$current_releases" -type l -print -quit)"',
    'test -z "$(find "$previous_releases" -type l -print -quit)"',
    'set -- $(sha256sum "$current_releases/latest.json")',
    'current_latest_sha=$1',
    'set -- $(sha256sum "$previous_releases/latest.json")',
    'previous_latest_sha=$1',
    'test "$current_latest_sha" = "$previous_latest_sha"',
    `test "$current_latest_sha" = ${shellQuote(expectedLatestSha)}`,
    `rollback_marker=${shellQuote(marker)}`,
    `latest_proof=${shellQuote(proof)}`,
    ...(expectedMarkerSha256
      ? [
          'test -f "$rollback_marker" && test ! -L "$rollback_marker"',
          `printf ${shellQuote('%s  %s\n')} ${shellQuote(expectedMarkerSha256)} "$rollback_marker" | sha256sum -c - >/dev/null`
        ]
      : [
          'if test "$reconciled_state" = switched; then test -f "$rollback_marker" && test ! -L "$rollback_marker"; fi',
          'if test -e "$rollback_marker" || test -L "$rollback_marker"; then test -f "$rollback_marker" && test ! -L "$rollback_marker"; fi'
        ]),
    'if test -f "$rollback_marker"; then test -s "$rollback_marker"; (cd "$expected_previous_physical" && sha256sum -c "$rollback_marker" >/dev/null); set -- $(sha256sum "$rollback_marker"); rollback_marker_sha=$1; else rollback_marker_sha=; fi',
    'if test -e "$latest_proof" || test -L "$latest_proof"; then test -f "$latest_proof" && test ! -L "$latest_proof"; set -- $(sha256sum "$latest_proof"); test "$1" = "$current_latest_sha"; proof_present=1; else proof_present=0; fi',
    'if test "$reconciled_state" = switched; then test "$proof_present" = 1 && test -n "$rollback_marker_sha"; fi',
    'printf "__MUGEN_STATE__%s\n" "$reconciled_state"',
    'printf "__MUGEN_CURRENT__%s\n" "$current_target"',
    'printf "__MUGEN_PREVIOUS__%s\n" "$previous_target"',
    'printf "__MUGEN_LATEST_SHA__%s\n" "$current_latest_sha"',
    `if test "$reconciled_state" = switched; then printf "__MUGEN_EXPECTED_LATEST_SHA__%s\\n" "$current_latest_sha"; printf ${shellQuote(`__MUGEN_ROLLBACK_MARKER__${markerName}\n`)}; printf "__MUGEN_ROLLBACK_MARKER_SHA__%s\\n" "$rollback_marker_sha"; printf ${shellQuote(`__MUGEN_LATEST_PROOF__${latestProofName}\n`)}; printf "__MUGEN_ROLLBACK_MANIFEST_BEGIN__\\n"; cat "$rollback_marker"; printf "__MUGEN_ROLLBACK_MANIFEST_END__\\n"; fi`
  ]
  return withRemoteLock(remoteRoot, commands.join('; '))
}

export function parseRollbackReconciliationOutput(value) {
  const state = value.match(/^__MUGEN_STATE__(switched|not-switched)$/m)?.[1]
  if (state === 'switched') return { ...parseRollbackOutput(value), state }
  if (state !== 'not-switched') throw new Error('Rollback reconciliation did not return a supported remote state.')
  const activation = parseActivationOutput(value)
  return { ...activation, state }
}

export function resolvePublicSiteUrl(environment, override) {
  const domain = environment.domain?.trim()
  const configured = override?.trim() || environment.SITE_PUBLIC_URL?.trim() || (
    domain ? (/^https?:\/\//i.test(domain) ? domain : `https://${domain}/`) : undefined
  )
  let url
  try {
    url = configured
      ? new URL(configured)
      : new URL('/', required(environment, 'INNER_RELEASE_URL'))
  } catch {
    throw new Error('The public site URL must be a valid production HTTPS URL.')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    isDisallowedProductionHostname(url.hostname)
  ) {
    throw new Error('The public site URL must be a credential-free production HTTPS URL.')
  }
  url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  return url
}

function cacheBust(url) {
  const target = new URL(url)
  target.searchParams.set('deployed', `${Date.now()}-${randomBytes(4).toString('hex')}`)
  return target
}

async function fetchPublicFile(baseUrl, relative, maximumBytes = 24 * 1024 * 1024) {
  const target = cacheBust(new URL(relative.split('/').map(encodeURIComponent).join('/'), baseUrl))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(target, {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache' },
      redirect: 'error',
      signal: controller.signal
    })
    if (response.status !== 200) throw new Error(`${relative} returned HTTP ${response.status}.`)
    const declaredLengthHeader = response.headers.get('content-length')
    const declaredLength = declaredLengthHeader === null ? undefined : Number(declaredLengthHeader)
    if (declaredLength !== undefined && Number.isFinite(declaredLength) && (declaredLength < 1 || declaredLength > maximumBytes)) {
      throw new Error(`${relative} has an invalid public content length.`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.byteLength || bytes.byteLength > maximumBytes) throw new Error(`${relative} is empty or too large.`)
    return { bytes, response }
  } finally {
    clearTimeout(timeout)
  }
}

function assertPublicHeaders(response, fileName) {
  if (response.headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff') {
    throw new Error(`${fileName} must be served with X-Content-Type-Options: nosniff.`)
  }
  const hstsMatch = (response.headers.get('strict-transport-security') || '').match(/(?:^|;)\s*max-age=(\d+)(?:;|$)/i)
  if (!hstsMatch || Number(hstsMatch[1]) <= 0) {
    throw new Error(`${fileName} must be served with HSTS.`)
  }
}

function assertNoStore(response, fileName) {
  const cacheDirectives = (response.headers.get('cache-control') || '')
    .toLowerCase()
    .split(',')
    .map((token) => token.trim())
  if (!cacheDirectives.includes('no-store')) {
    throw new Error(`${fileName} must be served with Cache-Control: no-store.`)
  }
}

function sameBytes(left, right) {
  return left.byteLength === right.byteLength && Buffer.from(left).equals(Buffer.from(right))
}

function parseCsp(value) {
  return new Map(
    value
      .split(';')
      .map((directive) => directive.trim().split(/\s+/).filter(Boolean))
      .filter((parts) => parts.length)
      .map(([name, ...tokens]) => [name.toLowerCase(), tokens.map((token) => token.toLowerCase())])
  )
}

function assertIndexSecurityHeaders(response) {
  assertPublicHeaders(response, 'index.html')
  if (response.headers.get('referrer-policy')?.toLowerCase() !== 'no-referrer') {
    throw new Error('index.html must be served with Referrer-Policy: no-referrer.')
  }
  const csp = parseCsp(response.headers.get('content-security-policy') || '')
  for (const [directive, expected] of [
    ['default-src', ["'self'"]],
    ['base-uri', ["'none'"]],
    ['object-src', ["'none'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'"]],
    ['img-src', ["'self'", 'data:']],
    ['connect-src', ["'self'"]],
    ['font-src', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['form-action', ["'none'"]]
  ]) {
    const actual = csp.get(directive)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`index.html has an invalid CSP ${directive} directive.`)
    }
  }
}

function assertContentType(response, fileName) {
  const contentType = response.headers.get('content-type')?.toLowerCase() || ''
  const expected = fileName.endsWith('.html')
    ? /^text\/html\b/
    : fileName.endsWith('.css')
      ? /^text\/css\b/
      : fileName.endsWith('.js')
        ? /^(application|text)\/javascript\b/
        : fileName.endsWith('.json')
          ? /^application\/json\b/
          : fileName.endsWith('.png')
            ? /^image\/png\b/
            : fileName.endsWith('.txt') || fileName.endsWith('.TXT')
              ? /^text\/plain\b/
              : undefined
  if (expected && !expected.test(contentType)) throw new Error(`${fileName} has an invalid public Content-Type.`)
}

export async function verifyPublicSite({ baseUrl, ccx, expectedLatestSha, records, snapshotDirectory }) {
  for (const record of records) {
    const { bytes, response } = await fetchPublicFile(baseUrl, record.path)
    assertContentType(response, record.path)
    if (record.path === 'index.html') assertIndexSecurityHeaders(response)
    const expectedBytes = readFileSync(path.join(snapshotDirectory, ...record.path.split('/')))
    const actualDigest = createHash('sha256').update(bytes).digest('hex')
    if (bytes.byteLength !== expectedBytes.byteLength || actualDigest !== record.sha256) {
      throw new Error(`Public ${record.path} does not match the local site deployment snapshot.`)
    }
  }
  const latest = await fetchPublicFile(baseUrl, protectedReleaseIndex, 64 * 1024)
  assertPublicHeaders(latest.response, protectedReleaseIndex)
  assertContentType(latest.response, protectedReleaseIndex)
  assertNoStore(latest.response, protectedReleaseIndex)
  const latestDigest = createHash('sha256').update(latest.bytes).digest('hex')
  if (latestDigest !== expectedLatestSha) {
    throw new Error('Public releases/latest.json changed during the site deployment.')
  }
  if (ccx) {
    const publicCcx = await fetchPublicFile(baseUrl, ccx.destination)
    assertPublicHeaders(publicCcx.response, ccx.destination)
    const ccxContentType = publicCcx.response.headers.get('content-type')?.toLowerCase() || ''
    if (!/^application\/(?:octet-stream|zip|x-zip-compressed|x-uxp-plugin|vnd\.adobe\.uxp-plugin)\b/.test(ccxContentType)) {
      throw new Error('Public Mugen 1.0.0 CCX has an invalid Content-Type.')
    }
    const digest = createHash('sha256').update(publicCcx.bytes).digest('hex')
    if (publicCcx.bytes.byteLength !== ccx.size || digest !== ccx.sha256) {
      throw new Error('Public Mugen 1.0.0 CCX does not match the local immutable payload.')
    }
    const checksumPath = `releases/${ccx.version}/${ccx.checksum.fileName}`
    const publicChecksum = await fetchPublicFile(baseUrl, checksumPath, 64 * 1024)
    assertPublicHeaders(publicChecksum.response, checksumPath)
    assertContentType(publicChecksum.response, checksumPath)
    const checksumDigest = createHash('sha256').update(publicChecksum.bytes).digest('hex')
    if (publicChecksum.bytes.byteLength !== ccx.checksum.size || checksumDigest !== ccx.checksum.sha256) {
      throw new Error('Public Mugen 1.0.0 SHA256SUMS.txt does not match the local immutable payload.')
    }
  }
  return { latestSha: latestDigest, verifiedFiles: records.length + 1 + (ccx ? 2 : 0) }
}

export async function verifyPublicFullSiteManifest(baseUrl, { rollback }) {
  if (!rollback?.records?.length) throw new Error('Rollback has no full-site verification manifest.')
  const marker = await fetchPublicFile(baseUrl, rollback.markerName, 1024 * 1024)
  assertPublicHeaders(marker.response, rollback.markerName)
  assertContentType(marker.response, rollback.markerName)
  const markerDigest = createHash('sha256').update(marker.bytes).digest('hex')
  const markerText = new TextDecoder().decode(marker.bytes)
  if (markerDigest !== rollback.markerSha256 || markerText !== rollback.manifest) {
    throw new Error('Public rollback marker does not match the server full-site manifest.')
  }
  for (const record of rollback.records) {
    const file = await fetchPublicFile(baseUrl, record.path)
    assertPublicHeaders(file.response, record.path)
    assertContentType(file.response, record.path)
    if (record.path === 'index.html') assertIndexSecurityHeaders(file.response)
    const actual = createHash('sha256').update(file.bytes).digest('hex')
    if (actual !== record.sha256) throw new Error(`Public ${record.path} does not match the restored full-site manifest.`)
  }
  return { verifiedFiles: rollback.records.length + 1 }
}

export async function verifyPublicRollback(baseUrl, result) {
  const manifestVerification = await verifyPublicFullSiteManifest(baseUrl, result)
  validateRollbackLatestProofName(result?.latestProofName)
  if (!/^[a-f0-9]{64}$/.test(result?.expectedLatestSha || '')) {
    throw new Error('Rollback has no protected latest.json checksum proof.')
  }
  const latestProof = await fetchPublicFile(baseUrl, result.latestProofName, 64 * 1024)
  const activeLatest = await fetchPublicFile(baseUrl, protectedReleaseIndex, 64 * 1024)
  for (const [fileName, file] of [
    [result.latestProofName, latestProof],
    [protectedReleaseIndex, activeLatest]
  ]) {
    assertPublicHeaders(file.response, fileName)
    assertContentType(file.response, fileName)
    assertNoStore(file.response, fileName)
  }
  if (!sameBytes(latestProof.bytes, activeLatest.bytes)) {
    throw new Error('Public rollback latest.json differs byte-for-byte from its unique release proof.')
  }
  const latestDigest = createHash('sha256').update(activeLatest.bytes).digest('hex')
  if (latestDigest !== result.expectedLatestSha) {
    throw new Error('Public rollback latest.json does not match the protected checksum.')
  }
  return { latestSha: latestDigest, verifiedFiles: manifestVerification.verifiedFiles + 2 }
}

function printUsage() {
  console.log([
    'Usage: node scripts/deploy-site.mjs [options]',
    '',
    '  --dry-run                 build and validate a stable local snapshot only',
    '  --include-ccx             merge dist/site/releases/1.0.0/mugen-1.0.0.ccx',
    '  --rollback                restore previous with an atomic current-link switch',
    '  --env <path>              deployment environment file (default: key.env)',
    '  --site-id <id>            explicit immutable site release ID',
    '  --public-url <https-url>  public website root; otherwise use domain/INNER_RELEASE_URL'
  ].join('\n'))
}

function rejectUnsupportedArguments() {
  const optionsWithValues = new Set(['--env', '--site-id', '--public-url'])
  const flags = new Set(['--dry-run', '--include-ccx', '--rollback', '--help'])
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index]
    const option = argument.includes('=') ? argument.slice(0, argument.indexOf('=')) : argument
    if (flags.has(option)) {
      if (argument.includes('=')) throw new Error(`${option} does not take a value.`)
      continue
    }
    if (!optionsWithValues.has(option)) throw new Error(`Unsupported site deployment option: ${option}`)
    if (!argument.includes('=')) {
      index += 1
      if (index >= process.argv.length || process.argv[index].startsWith('--')) throw new Error(`${option} requires a value.`)
    }
  }
}

async function main() {
  rejectUnsupportedArguments()
  if (process.argv.includes('--help')) {
    printUsage()
    return
  }
  const envPath = path.resolve(projectRoot, readOption('--env') || defaultEnvPath)
  if (!existsSync(envPath)) throw new Error(`Deployment environment file not found: ${envPath}`)
  const fileEnvironment = parseEnv(readFileSync(envPath, 'utf8'))
  const environment = { ...fileEnvironment, ...process.env }
  const configuration = resolveSshConfiguration(environment)
  const remoteRoot = validateRemoteRoot()
  const publicUrl = resolvePublicSiteUrl(environment, readOption('--public-url'))
  const dryRun = process.argv.includes('--dry-run')
  const rollback = process.argv.includes('--rollback')
  const includeCcx = process.argv.includes('--include-ccx')
  const token = `${Date.now()}-${randomBytes(4).toString('hex')}`
  const rollbackMarkerName = `site-rollback-${token}.sha256.txt`
  const rollbackLatestProofName = `site-rollback-${token}.latest.json`

  if (rollback && includeCcx) throw new Error('--include-ccx cannot be used with --rollback.')
  if (rollback) {
    console.log(`Official site rollback target: ${configuration.target}:${remoteRoot}`)
    if (dryRun) return
    const plan = parseActivationOutput(captureSsh(configuration, createRollbackInspectionCommand({ remoteRoot })))
    const transition = executeWithStateReconciliation({
      execute: () => captureSsh(configuration, createRollbackCommand({
        expectedCurrent: plan.current,
        expectedLatestSha: plan.latestSha,
        expectedPrevious: plan.previous,
        latestProofName: rollbackLatestProofName,
        markerName: rollbackMarkerName,
        remoteRoot,
        token
      })),
      operation: 'Manual site rollback',
      parseConfirmation: parseRollbackOutput,
      parseReconciliation: parseRollbackReconciliationOutput,
      reconcile: () => captureSsh(configuration, createRollbackReconciliationCommand({
        expectedCurrent: plan.current,
        expectedLatestSha: plan.latestSha,
        expectedPrevious: plan.previous,
        latestProofName: rollbackLatestProofName,
        markerName: rollbackMarkerName,
        remoteRoot
      }))
    })
    if (transition.state !== 'switched') {
      throw new Error('Manual site rollback was confirmed not switched; public verification was not claimed.')
    }
    const result = transition.result
    await verifyPublicRollback(publicUrl, result)
    console.log(`Official site rolled back to ${result.current}.`)
    return
  }

  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'mugen-site-deploy-'))
  const snapshotDirectory = path.join(temporaryDirectory, 'snapshot')
  const archivePath = path.join(temporaryDirectory, 'site.tar.gz')
  const manifestPath = path.join(temporaryDirectory, 'site.sha256')
  try {
    const currentGit = readGitSiteProvenance(projectRoot)
    validateSiteReleaseMetadata({
      currentGit,
      directory: defaultSiteDirectory,
      requireClean: true
    })
    const snapshot = createSiteSnapshot(defaultSiteDirectory, snapshotDirectory)
    const manifest = createSha256Manifest(snapshot.records)
    writeFileSync(manifestPath, manifest, 'utf8')
    execFileSync('tar', ['-czf', archivePath, '-C', snapshotDirectory, '.'], { cwd: projectRoot, stdio: 'inherit' })
    const archiveSha256 = fileDigest(archivePath)
    const manifestSha256 = fileDigest(manifestPath)
    const ccx = includeCcx ? validateLocalCcxPayload() : undefined
    const afterArchiveGit = readGitSiteProvenance(projectRoot)
    assertGitSiteProvenanceUnchanged(currentGit, afterArchiveGit)
    validateSiteReleaseMetadata({
      currentGit: afterArchiveGit,
      directory: defaultSiteDirectory,
      requireClean: true
    })
    const siteId = validateSiteId(readOption('--site-id') || makeSiteId(snapshot.snapshotHash))
    const incoming = `${remoteRoot}/.incoming/${siteId}-${token}`
    console.log(`Official site deployment target: ${configuration.target}:${remoteRoot}/releases/${siteId}`)
    console.log(`Public URL: ${publicUrl.href}`)
    console.log(`Snapshot: ${snapshot.records.length} files, sha256:${snapshot.snapshotHash}`)
    console.log(`Protected path: ${protectedReleaseIndex} is inherited from the active release.`)
    if (ccx) console.log(`Optional CCX: ${ccx.destination} (${ccx.size} bytes, ${ccx.sha256})`)
    if (dryRun) return

    const prepared = parsePrepareOutput(captureSsh(configuration, createPrepareCommand({
      incoming,
      markerName: rollbackMarkerName,
      remoteRoot
    })))
    let cleanupAllowed = true
    try {
      await verifyPublicFullSiteManifest(publicUrl, prepared)
      const beforeUploadGit = readGitSiteProvenance(projectRoot)
      assertGitSiteProvenanceUnchanged(afterArchiveGit, beforeUploadGit)
      validateSiteReleaseMetadata({
        currentGit: beforeUploadGit,
        directory: defaultSiteDirectory,
        requireClean: true
      })
      if (!sameRecords(snapshot.records, createFileRecords(defaultSiteDirectory, { excludeReleases: true }))) {
        throw new Error('Official site output changed after archive creation; upload stopped.')
      }
      uploadFile(configuration, archivePath, `${incoming}/site.tar.gz`)
      uploadFile(configuration, manifestPath, `${incoming}/site.sha256`)
      if (ccx) {
        uploadFile(configuration, ccx.path, `${incoming}/${ccx.fileName}`)
        uploadFile(configuration, ccx.checksum.path, `${incoming}/${ccx.checksum.fileName}`)
      }
      let activation
      try {
        activation = executeWithStateReconciliation({
          execute: () => captureSsh(configuration, createActivationCommand({
          archiveSha256,
          ccx,
          expectedCurrent: prepared.current,
          expectedLatestSha: prepared.latestSha,
          expectedPrevious: prepared.previous,
          incoming,
          manifestSha256,
          remoteRoot,
          rollback: prepared.rollback,
          siteId,
          token
        })),
          operation: 'Official site activation',
          parseConfirmation: parseActivationOutput,
          parseReconciliation: parseActivationReconciliationOutput,
          reconcile: () => captureSsh(configuration, createActivationReconciliationCommand({
          expectedCurrent: prepared.current,
          expectedLatestSha: prepared.latestSha,
          expectedPrevious: prepared.previous,
          markerName: prepared.rollback.markerName,
          markerSha256: prepared.rollback.markerSha256,
          remoteRoot,
          siteId
          }))
        })
      } catch (activationError) {
        if (activationError?.code === 'REMOTE_STATE_UNCERTAIN') cleanupAllowed = false
        throw activationError
      }
      if (activation.state !== 'switched') {
        throw new Error('Official site activation was confirmed not switched; cleanup is permitted.')
      }
      const activated = activation.result
      cleanupAllowed = false
      try {
        const verification = await verifyPublicSite({
          baseUrl: publicUrl,
          ccx,
          expectedLatestSha: prepared.latestSha,
          records: snapshot.records,
          snapshotDirectory
        })
        console.log(`Official site ${siteId} verified (${verification.verifiedFiles} public files).`)
      } catch (error) {
        console.error('Public site verification failed; restoring the previous immutable release.')
        try {
          const automaticProofName = `site-rollback-${token}-verify.latest.json`
          const rollbackTransition = executeWithStateReconciliation({
            execute: () => captureSsh(configuration, createRollbackCommand({
              expectedCurrent: activated.current,
              expectedLatestSha: prepared.latestSha,
              expectedMarkerSha256: prepared.rollback.markerSha256,
              expectedPrevious: activated.previous,
              latestProofName: automaticProofName,
              markerName: prepared.rollback.markerName,
              remoteRoot,
              token: `${token}-verify`
            })),
            operation: 'Automatic site rollback',
            parseConfirmation: parseRollbackOutput,
            parseReconciliation: parseRollbackReconciliationOutput,
            reconcile: () => captureSsh(configuration, createRollbackReconciliationCommand({
              expectedCurrent: activated.current,
              expectedLatestSha: prepared.latestSha,
              expectedMarkerSha256: prepared.rollback.markerSha256,
              expectedPrevious: activated.previous,
              latestProofName: automaticProofName,
              markerName: prepared.rollback.markerName,
              remoteRoot
            }))
          })
          if (rollbackTransition.state !== 'switched') {
            throw new Error('Automatic site rollback was confirmed not switched; the activated site remains current.')
          }
          const restored = rollbackTransition.result
          await verifyPublicRollback(publicUrl, restored)
          cleanupAllowed = true
          console.error(`Previous site release restored: ${restored.current}`)
        } catch (rollbackError) {
          console.error('Automatic site rollback failed or a concurrent deployment superseded this release.')
          if (rollbackError instanceof Error) console.error(rollbackError.message)
        }
        throw error
      }
    } catch (error) {
      if (cleanupAllowed) {
        try {
          captureSsh(configuration, createCleanupCommand({
            expectedCurrent: prepared.current,
            incoming,
            markerName: prepared.rollback.markerName,
            remoteRoot
          }))
        } catch (cleanupError) {
          console.error('Could not remove this deployment\'s unique incoming directory.')
          if (cleanupError instanceof Error) console.error(cleanupError.message)
        }
      } else {
        console.error('Remote state may be active or unverified; destructive cleanup was skipped.')
      }
      if (error instanceof Error) error.message = `Official site deployment failed: ${error.message}`
      throw error
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}

import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDisallowedProductionHostname, resolveReleaseUrl } from './production-origin-policy.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultEnvPath = path.join(projectRoot, 'key.env')
const webUiRoot = path.join(projectRoot, 'apps', 'inner-webui')
const webUiDist = path.join(webUiRoot, 'dist')
const webUiPackage = JSON.parse(readFileSync(path.join(webUiRoot, 'package.json'), 'utf8'))

function readOption(name) {
  const prefix = `${name}=`
  const inline = process.argv.find((argument) => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

export function parseEnv(contents) {
  const result = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
    const separator = normalized.indexOf('=')
    if (separator < 1) throw new Error(`Invalid key.env line: ${rawLine}`)
    const key = normalized.slice(0, separator).trim()
    let value = normalized.slice(separator + 1).trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      if (/^[a-z][a-z0-9_]*$/.test(key)) continue
      throw new Error(`Invalid key.env name: ${key}`)
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

function required(environment, key) {
  const value = environment[key]?.trim()
  if (!value) throw new Error(`Missing required deployment value: ${key}.`)
  return value
}

function validateRemotePath(value) {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value) || value.includes('/../') || value.endsWith('/..')) {
    throw new Error('DEPLOY_WEB_ROOT must be a simple absolute server path without spaces or parent traversal.')
  }
  const withoutTrailingSlash = value.length > 1 ? value.replace(/\/+$/, '') : value
  const normalized = path.posix.normalize(withoutTrailingSlash)
  if (normalized !== withoutTrailingSlash) {
    throw new Error('DEPLOY_WEB_ROOT must already be a normalized absolute path.')
  }
  if (['/', '/etc', '/home', '/opt', '/root', '/srv', '/tmp', '/usr', '/var'].includes(normalized)) {
    throw new Error('DEPLOY_WEB_ROOT is too broad; use a dedicated WebUI directory.')
  }
  return normalized
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function sshArguments(configuration) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=2',
    '-p', configuration.port
  ]
  if (configuration.identityFile) args.push('-i', configuration.identityFile)
  return args
}

function executeSsh(configuration, command, inputFile, captureOutput) {
  let input = 'inherit'
  let inputDescriptor
  if (inputFile) {
    inputDescriptor = openSync(inputFile, 'r')
    input = inputDescriptor
  }
  try {
    return execFileSync('ssh', [...sshArguments(configuration), configuration.target, `sh -c ${shellQuote(command)}`], {
      cwd: projectRoot,
      ...(captureOutput ? { encoding: 'utf8' } : {}),
      stdio: [input, captureOutput ? 'pipe' : 'inherit', 'inherit']
    })
  } finally {
    if (inputDescriptor !== undefined) closeSync(inputDescriptor)
  }
}

function runSsh(configuration, command, inputFile) {
  executeSsh(configuration, command, inputFile, false)
}

function captureSsh(configuration, command, inputFile) {
  return String(executeSsh(configuration, command, inputFile, true) ?? '').trim()
}

function withRemoteLock(remoteRoot, command) {
  const lockFile = `${remoteRoot}/.deploy.lock`
  return [
    'set -eu',
    `mkdir -p ${shellQuote(remoteRoot)}`,
    'command -v flock >/dev/null 2>&1 || { echo "flock is required for deployment" >&2; exit 69; }',
    `exec 9>${shellQuote(lockFile)}`,
    'flock -n 9 || { echo "another WebUI deployment is active" >&2; exit 75; }',
    command
  ].join('; ')
}

function createRollbackCommand(remoteRoot, token, expectedCurrent) {
  const current = `${remoteRoot}/current`
  const previous = `${remoteRoot}/previous`
  const next = `${remoteRoot}/.rollback-${token}`
  const old = `${remoteRoot}/.previous-${token}`
  const commands = [
    `test -L ${shellQuote(current)}`,
    `test -L ${shellQuote(previous)}`,
    `current_target=$(readlink ${shellQuote(current)})`,
    ...(expectedCurrent
      ? [`test "$current_target" = ${shellQuote(expectedCurrent)} || { echo "deployment was superseded; current was not changed" >&2; exit 76; }`]
      : []),
    `previous_target=$(readlink ${shellQuote(previous)})`,
    `case "$current_target" in ${shellQuote(`${remoteRoot}/releases/`)}*) ;; *) echo "current release target is outside releases" >&2; exit 77 ;; esac`,
    `case "$previous_target" in ${shellQuote(`${remoteRoot}/releases/`)}*) ;; *) echo "previous release target is outside releases" >&2; exit 77 ;; esac`,
    'test -d "$current_target"',
    'test -f "$current_target/release.json"',
    'test -d "$previous_target"',
    'test -f "$previous_target/release.json"',
    `grep -Eq ${shellQuote('"protocolVersion"[[:space:]]*:[[:space:]]*1([,}])')} "$current_target/release.json"`,
    `grep -Eq ${shellQuote('"protocolVersion"[[:space:]]*:[[:space:]]*1([,}])')} "$previous_target/release.json"`,
    `ln -s "$previous_target" ${shellQuote(next)}`,
    `ln -s "$current_target" ${shellQuote(old)}`,
    `mv -Tf ${shellQuote(next)} ${shellQuote(current)}`,
    `mv -Tf ${shellQuote(old)} ${shellQuote(previous)}`,
    `printf ${shellQuote('__MUGEN_TARGET__%s\\n')} "$previous_target"`,
    'cat "$previous_target/release.json"'
  ].join('; ')
  return withRemoteLock(remoteRoot, commands)
}

function createRemoveCurrentCommand(remoteRoot, expectedCurrent) {
  const current = `${remoteRoot}/current`
  return withRemoteLock(remoteRoot, [
    `test -L ${shellQuote(current)}`,
    `current_target=$(readlink ${shellQuote(current)})`,
    `test "$current_target" = ${shellQuote(expectedCurrent)} || { echo "deployment was superseded; current was not changed" >&2; exit 76; }`,
    `rm ${shellQuote(current)}`
  ].join('; '))
}

function validateReleaseMetadata(value, label) {
  if (!value || typeof value !== 'object') throw new Error(`${label} is not an object.`)
  if (value.schemaVersion !== 1) throw new Error(`${label} has an invalid schemaVersion.`)
  if (!/^\d+\.\d+\.\d+$/.test(value.webVersion || '')) throw new Error(`${label} has an invalid webVersion.`)
  if (value.protocolVersion !== 1) throw new Error(`${label} must use inner-host protocolVersion 1.`)
  if (
    !Array.isArray(value.compatibleHostProtocolVersions) ||
    value.compatibleHostProtocolVersions.length !== 1 ||
    value.compatibleHostProtocolVersions[0] !== value.protocolVersion
  ) throw new Error(`${label} has invalid compatibleHostProtocolVersions.`)
  if (!/^sha256:[a-f0-9]{64}$/.test(value.contentHash || '')) throw new Error(`${label} has an invalid contentHash.`)
  const expectedBuildId = `${value.webVersion}-${value.contentHash.slice(7, 19)}`
  if (value.buildId !== expectedBuildId) throw new Error(`${label} has an invalid buildId.`)
  if (typeof value.commit !== 'string' || !/^[a-f0-9]{7,64}$/i.test(value.commit)) throw new Error(`${label} has no source commit.`)
  if (typeof value.dirty !== 'boolean') throw new Error(`${label} has no dirty-tree state.`)
  if (typeof value.builtAt !== 'string' || Number.isNaN(Date.parse(value.builtAt))) throw new Error(`${label} has an invalid builtAt.`)
  return value
}

function parseRollbackOutput(value, label) {
  const separator = value.indexOf('\n')
  if (separator < 0 || !value.startsWith('__MUGEN_TARGET__')) {
    throw new Error(`${label} did not return a release target.`)
  }
  const target = value.slice('__MUGEN_TARGET__'.length, separator).trim()
  const release = validateReleaseMetadata(JSON.parse(value.slice(separator + 1)), `${label} release.json`)
  return { target, release }
}

function outputFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? outputFiles(path.join(directory, entry.name), name) : [name]
  })
}

function calculateWebUiContentHash(directory) {
  const hash = createHash('sha256')
  const files = outputFiles(directory).filter((file) => file !== 'release.json').sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(path.join(directory, file)))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function readLocalBuild() {
  if (!existsSync(path.join(webUiDist, 'index.html'))) {
    throw new Error('WebUI build not found. Run npm run verify:inner-webui first.')
  }
  const compatibility = JSON.parse(readFileSync(path.join(webUiDist, 'compatibility.json'), 'utf8'))
  const localRelease = validateReleaseMetadata(
    JSON.parse(readFileSync(path.join(webUiDist, 'release.json'), 'utf8')),
    'Local release.json'
  )
  if (localRelease.dirty) {
    throw new Error('Refusing to use a WebUI build created from a dirty Git worktree.')
  }
  if (calculateWebUiContentHash(webUiDist) !== localRelease.contentHash) {
    throw new Error('Local WebUI files do not match release.json contentHash.')
  }
  if (
    !/^\d+\.\d+\.\d+$/.test(webUiPackage.version) ||
    webUiPackage.version === '0.1.0' ||
    compatibility.schemaVersion !== 1 ||
    compatibility.webVersion !== webUiPackage.version ||
    localRelease.webVersion !== webUiPackage.version ||
    compatibility.protocolVersion !== localRelease.protocolVersion ||
    JSON.stringify(compatibility.compatibleHostProtocolVersions) !== JSON.stringify(localRelease.compatibleHostProtocolVersions)
  ) {
    throw new Error('WebUI package and compatibility metadata must use the same active version; WebUI 0.1.0 is retired.')
  }
  return { compatibility, localRelease }
}

function createSnapshotChecksums(directory) {
  return outputFiles(directory)
    .filter((file) => file !== '.deploy-sha256sums')
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    .map((file) => {
      if (!/^[A-Za-z0-9._/-]+$/.test(file)) throw new Error(`Unsupported WebUI output filename: ${file}`)
      const digest = createHash('sha256').update(readFileSync(path.join(directory, file))).digest('hex')
      return `${digest}  ./${file}`
    })
    .join('\n') + '\n'
}

export function copyBuildSnapshot(source, destination) {
  mkdirSync(destination)
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      copyBuildSnapshot(sourcePath, destinationPath)
    } else if (entry.isFile()) {
      copyFileSync(sourcePath, destinationPath)
    } else {
      throw new Error(`WebUI build contains an unsupported entry: ${entry.name}`)
    }
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function fetchPublic(url, fileName) {
  const target = new URL(fileName, url)
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    target.searchParams.set('deployed', `${Date.now()}-${randomBytes(4).toString('hex')}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(target, {
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache' },
        redirect: 'error',
        signal: controller.signal
      })
      if (response.ok) return response
      lastError = new Error(`${fileName} returned HTTP ${response.status}.`)
      if (![429, 502, 503, 504].includes(response.status)) throw lastError
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
    }
    if (attempt < 2) await wait(500 * (attempt + 1))
  }
  throw lastError instanceof Error ? lastError : new Error(`${fileName} is unavailable.`)
}

function assertCommonPublicHeaders(response, fileName) {
  if (response.headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff') {
    throw new Error(`${fileName} must be served with X-Content-Type-Options: nosniff.`)
  }
  if (!/^max-age=\d+/i.test(response.headers.get('strict-transport-security') || '')) {
    throw new Error(`${fileName} must be served with HSTS.`)
  }
}

function assertCacheControl(response, fileName, expected) {
  const tokens = (response.headers.get('cache-control') || '')
    .toLowerCase()
    .split(',')
    .map((token) => token.trim())
  for (const token of expected) {
    if (!tokens.includes(token)) throw new Error(`${fileName} has an invalid Cache-Control policy.`)
  }
}

function assertReleaseIndexCacheControl(response, fileName) {
  const directives = (response.headers.get('cache-control') || '')
    .toLowerCase()
    .split(',')
    .map((directive) => directive.trim())
    .filter(Boolean)
  if (!directives.includes('no-store')) {
    throw new Error(`${fileName} must be served with Cache-Control: no-store.`)
  }
  if (
    directives.includes('public') ||
    directives.includes('immutable') ||
    directives.some((directive) => {
      const match = directive.match(/^max-age\s*=\s*"?(\d+)"?$/)
      return match && Number(match[1]) > 0
    })
  ) {
    throw new Error(`${fileName} must not be served with a public or immutable cache policy.`)
  }
}

function assertReleaseUrlOrigin(value, label, releaseRootUrl) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be an absolute URL.`)
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be an absolute URL.`)
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    isDisallowedProductionHostname(url.hostname) ||
    url.origin !== releaseRootUrl.origin
  ) {
    throw new Error(`${label} must use the configured INNER_RELEASE_URL origin.`)
  }
}

function assertDownloadUrls(value, label, releaseRootUrl) {
  if (!value || typeof value !== 'object') throw new Error(`${label} must be an object or array.`)
  for (const [key, entry] of Object.entries(value)) {
    const entryLabel = Array.isArray(value) ? `${label}[${key}]` : `${label}.${key}`
    if (key === 'url') {
      assertReleaseUrlOrigin(entry, entryLabel, releaseRootUrl)
    } else if (entry && typeof entry === 'object') {
      assertDownloadUrls(entry, entryLabel, releaseRootUrl)
    }
  }
}

export function validatePublicLatestJson(value, releaseRootUrl) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('latest.json must contain a JSON object.')
  }
  if ('version' in value && (typeof value.version !== 'string' || !value.version.trim())) {
    throw new Error('latest.json version must be a non-empty string.')
  }
  for (const key of ['releaseUrl', 'updateCheckUrl']) {
    if (key in value) assertReleaseUrlOrigin(value[key], `latest.json ${key}`, releaseRootUrl)
  }
  if ('downloads' in value) assertDownloadUrls(value.downloads, 'latest.json downloads', releaseRootUrl)
  return value
}

export function resolveInnerReleaseUrl(environment, webviewOrigin) {
  return resolveReleaseUrl({
    processEnvironment: { INNER_RELEASE_URL: required(environment, 'INNER_RELEASE_URL') },
    webviewOrigin,
    production: true
  })
}

export async function verifyPublicReleaseIndex(url) {
  const fileName = 'latest.json'
  const response = await fetchPublic(url, fileName)
  if (response.status !== 200) throw new Error(`${fileName} returned HTTP ${response.status}.`)
  assertCommonPublicHeaders(response, fileName)
  assertReleaseIndexCacheControl(response, fileName)
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new Error(`${fileName} has an invalid Content-Type.`)
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) throw new Error(`${fileName} is too large.`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.length || bytes.byteLength > 64 * 1024) throw new Error(`${fileName} is empty or too large.`)
  let value
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error(`${fileName} is not valid JSON.`)
  }
  validatePublicLatestJson(value, url)
  console.log(`Public release index verified at ${new URL(fileName, url).href}`)
  return value
}

async function readPublicJson(url, fileName, expectedDirectory) {
  const response = await fetchPublic(url, fileName)
  assertCommonPublicHeaders(response, fileName)
  assertCacheControl(response, fileName, ['no-cache'])
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new Error(`${fileName} has an invalid Content-Type.`)
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) throw new Error(`${fileName} is too large.`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.length || bytes.byteLength > 64 * 1024) throw new Error(`${fileName} is empty or too large.`)
  if (expectedDirectory && !sameBytes(bytes, readFileSync(path.join(expectedDirectory, fileName)))) {
    throw new Error(`Public ${fileName} does not match the local deployment snapshot.`)
  }
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${fileName} is not valid JSON.`)
  }
}

function parseCsp(value) {
  return new Map(
    value
      .split(';')
      .map((directive) => directive.trim().split(/\s+/).filter(Boolean))
      .filter((parts) => parts.length > 0)
      .map(([name, ...tokens]) => [name.toLowerCase(), tokens.map((token) => token.toLowerCase())])
  )
}

function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

async function verifyPublicAssets(url, expectedDirectory) {
  const indexResponse = await fetchPublic(url, 'index.html')
  assertCommonPublicHeaders(indexResponse, 'index.html')
  assertCacheControl(indexResponse, 'index.html', ['no-cache'])
  const indexContentType = indexResponse.headers.get('content-type')?.toLowerCase() || ''
  if (!indexContentType.startsWith('text/html')) throw new Error('index.html has an invalid Content-Type.')
  const csp = parseCsp(indexResponse.headers.get('content-security-policy') || '')
  for (const [directive, expectedTokens] of [
    ['script-src', ["'self'"]],
    ['style-src', ["'self'"]],
    ['connect-src', ["'self'", 'http:', 'https:']],
    ['frame-ancestors', ["'none'"]]
  ]) {
    const actualTokens = csp.get(directive)
    if (JSON.stringify(actualTokens) !== JSON.stringify(expectedTokens)) {
      throw new Error(`index.html has an invalid CSP ${directive} directive.`)
    }
  }
  if (indexResponse.headers.get('referrer-policy')?.toLowerCase() !== 'no-referrer') {
    throw new Error('index.html must be served with Referrer-Policy: no-referrer.')
  }
  const indexBytes = new Uint8Array(await indexResponse.arrayBuffer())
  if (!indexBytes.length || indexBytes.byteLength > 256 * 1024) throw new Error('index.html is empty or too large.')
  if (expectedDirectory && !sameBytes(indexBytes, readFileSync(path.join(expectedDirectory, 'index.html')))) {
    throw new Error('Public index.html does not match the local deployment snapshot.')
  }
  const indexHtml = new TextDecoder().decode(indexBytes)
  const assetPaths = [...indexHtml.matchAll(/\b(?:src|href)=["']\.\/(assets\/[A-Za-z0-9._/-]+)["']/g)].map((match) => match[1])
  if (!assetPaths.some((file) => file.endsWith('.js')) || !assetPaths.some((file) => file.endsWith('.css'))) {
    throw new Error('index.html does not reference the expected JavaScript and CSS assets.')
  }
  const filesToVerify = expectedDirectory
    ? outputFiles(expectedDirectory).filter((file) => file.startsWith('assets/'))
    : assetPaths
  if (!filesToVerify.length) throw new Error('The deployment snapshot contains no WebUI assets.')
  for (const fileName of [...new Set(filesToVerify)]) {
    const response = await fetchPublic(url, fileName)
    assertCommonPublicHeaders(response, fileName)
    assertCacheControl(response, fileName, ['public', 'max-age=31536000', 'immutable'])
    const contentType = response.headers.get('content-type')?.toLowerCase() || ''
    if (fileName.endsWith('.js') && !/^(application|text)\/javascript\b/.test(contentType)) {
      throw new Error(`${fileName} has an invalid JavaScript Content-Type.`)
    }
    if (fileName.endsWith('.css') && !contentType.startsWith('text/css')) {
      throw new Error(`${fileName} has an invalid CSS Content-Type.`)
    }
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && (declaredLength <= 0 || declaredLength > 10 * 1024 * 1024)) {
      throw new Error(`${fileName} has an invalid content length.`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.length || bytes.byteLength > 10 * 1024 * 1024) throw new Error(`${fileName} is empty or too large.`)
    if (expectedDirectory && !sameBytes(bytes, readFileSync(path.join(expectedDirectory, fileName)))) {
      throw new Error(`Public ${fileName} does not match the local deployment snapshot.`)
    }
  }
}

async function verifyPublicDeployment(url, releaseUrl, expectedRelease, expectedDirectory) {
  const [compatibility, publicReleaseValue] = await Promise.all([
    readPublicJson(url, 'compatibility.json', expectedDirectory),
    readPublicJson(url, 'release.json', expectedDirectory),
    verifyPublicAssets(url, expectedDirectory),
    verifyPublicReleaseIndex(releaseUrl)
  ])
  const publicRelease = validateReleaseMetadata(publicReleaseValue, 'Public release.json')
  if (
    compatibility.schemaVersion !== 1 ||
    compatibility.webVersion !== publicRelease.webVersion ||
    compatibility.protocolVersion !== publicRelease.protocolVersion ||
    JSON.stringify(compatibility.compatibleHostProtocolVersions) !== JSON.stringify(publicRelease.compatibleHostProtocolVersions)
  ) {
    throw new Error('Public compatibility.json does not match release.json.')
  }
  if (expectedRelease) {
    for (const key of ['schemaVersion', 'webVersion', 'protocolVersion', 'compatibleHostProtocolVersions', 'buildId', 'contentHash', 'commit', 'dirty', 'builtAt']) {
      const actual = Array.isArray(publicRelease[key]) ? JSON.stringify(publicRelease[key]) : publicRelease[key]
      const expected = Array.isArray(expectedRelease[key]) ? JSON.stringify(expectedRelease[key]) : expectedRelease[key]
      if (actual !== expected) {
        throw new Error(`Public release.json ${key} does not match the local build.`)
      }
    }
  }
  console.log(`Public WebUI ${publicRelease.webVersion} (${publicRelease.contentHash.slice(0, 12)}) verified at ${url.href}`)
  return publicRelease
}

async function main() {
const envOption = readOption('--env')
const envPath = path.resolve(projectRoot, envOption || defaultEnvPath)
if (!existsSync(envPath) && (envOption || !process.env.INNER_WEBUI_URL?.trim())) {
  throw new Error(`Deployment environment file not found: ${envPath}`)
}

const fileEnvironment = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}
const environment = { ...fileEnvironment, ...process.env }
const innerWebUiUrl = new URL(required(environment, 'INNER_WEBUI_URL'))
if (
  innerWebUiUrl.protocol !== 'https:' ||
  innerWebUiUrl.username ||
  innerWebUiUrl.password ||
  innerWebUiUrl.search ||
  innerWebUiUrl.hash ||
  isDisallowedProductionHostname(innerWebUiUrl.hostname)
) {
  throw new Error('INNER_WEBUI_URL must be a credential-free production HTTPS URL on the new domain.')
}
if (!innerWebUiUrl.pathname.endsWith('/')) {
  throw new Error('INNER_WEBUI_URL must end with /.')
}
if (innerWebUiUrl.href !== 'https://mugen.catrefuse.com/webui/') {
  throw new Error('INNER_WEBUI_URL must be https://mugen.catrefuse.com/webui/.')
}
const innerReleaseUrl = resolveInnerReleaseUrl(environment, innerWebUiUrl.origin)
const verifyOnly = process.argv.includes('--verify-only')
if (verifyOnly) {
  const { localRelease } = readLocalBuild()
  await verifyPublicDeployment(innerWebUiUrl, innerReleaseUrl, localRelease, webUiDist)
  return
}
const host = required(environment, 'DEPLOY_SSH_HOST')
const user = environment.DEPLOY_SSH_USER?.trim()
const port = environment.DEPLOY_SSH_PORT?.trim() || '22'
if (!/^[A-Za-z0-9._-]+$/.test(host) || host.startsWith('-')) throw new Error('DEPLOY_SSH_HOST contains unsupported characters.')
if (user && (!/^[A-Za-z0-9._-]+$/.test(user) || user.startsWith('-'))) throw new Error('DEPLOY_SSH_USER contains unsupported characters.')
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('DEPLOY_SSH_PORT is invalid.')

const remoteRoot = validateRemotePath(required(environment, 'DEPLOY_WEB_ROOT'))
const identityValue = environment.DEPLOY_SSH_IDENTITY_FILE?.trim()
const identityFile = identityValue ? path.resolve(projectRoot, identityValue) : undefined
if (identityFile && !existsSync(identityFile)) {
  throw new Error('DEPLOY_SSH_IDENTITY_FILE does not exist.')
}

const configuration = {
  port,
  identityFile,
  target: user ? `${user}@${host}` : host
}
const dryRun = process.argv.includes('--dry-run')
const rollback = process.argv.includes('--rollback')
const skipPublicVerify = process.argv.includes('--skip-public-verify')
const token = `${Date.now()}-${randomBytes(4).toString('hex')}`

if (rollback && skipPublicVerify) {
  throw new Error('--skip-public-verify cannot be used with --rollback.')
}

if (rollback) {
  console.log(`Rollback target: ${configuration.target}:${remoteRoot}`)
  if (!dryRun) {
    const rolledBack = parseRollbackOutput(
      captureSsh(configuration, createRollbackCommand(remoteRoot, token)),
      'Rollback'
    )
    try {
      await verifyPublicDeployment(innerWebUiUrl, innerReleaseUrl, rolledBack.release)
    } catch (error) {
      console.error('Rollback verification failed; restoring the release that was active before rollback.')
      const restored = parseRollbackOutput(
        captureSsh(configuration, createRollbackCommand(remoteRoot, `${token}-restore`, rolledBack.target)),
        'Rollback restoration'
      )
      await verifyPublicDeployment(innerWebUiUrl, innerReleaseUrl, restored.release)
      throw error
    }
  }
  return
}

const { localRelease } = readLocalBuild()

const releaseId = localRelease.buildId
const remoteRelease = `${remoteRoot}/releases/${releaseId}-${token}`
const remoteStage = `${remoteRoot}/.stage-${releaseId}-${token}`
const nextLink = `${remoteRoot}/.current-${token}`
const previousLink = `${remoteRoot}/.previous-${token}`

console.log(`WebUI ${webUiPackage.version} deployment target: ${configuration.target}:${remoteRelease}`)
console.log(`Public URL: ${innerWebUiUrl.href}`)
if (dryRun) return

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'mugen-inner-webui-'))
const snapshotRoot = path.join(temporaryDirectory, 'snapshot')
const archivePath = path.join(temporaryDirectory, `${releaseId}-${token}.tar.gz`)

try {
  copyBuildSnapshot(webUiDist, snapshotRoot)
  if (calculateWebUiContentHash(snapshotRoot) !== localRelease.contentHash) {
    throw new Error('WebUI output changed while the deployment snapshot was being created.')
  }
  writeFileSync(path.join(snapshotRoot, '.deploy-sha256sums'), createSnapshotChecksums(snapshotRoot), 'utf8')
  execFileSync('tar', ['-czf', archivePath, '-C', snapshotRoot, '.'], {
    cwd: projectRoot,
    stdio: 'inherit'
  })
  const cleanupStage = `rm -rf ${shellQuote(remoteStage)}`
  const activateCommand = [
    'umask 022',
    `mkdir -p ${shellQuote(`${remoteRoot}/releases`)}`,
    `mkdir -p ${shellQuote(`${remoteRoot}/assets`)}`,
    'command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required for deployment" >&2; exit 69; }',
    'command -v cp >/dev/null 2>&1 || { echo "cp is required for deployment" >&2; exit 69; }',
    `test ! -e ${shellQuote(remoteRelease)}`,
    `test ! -e ${shellQuote(remoteStage)}`,
    `mkdir ${shellQuote(remoteStage)}`,
    `trap ${shellQuote(cleanupStage)} 0 1 2 15`,
    `tar -xzf - -C ${shellQuote(remoteStage)}`,
    `test -f ${shellQuote(`${remoteStage}/index.html`)}`,
    `test -f ${shellQuote(`${remoteStage}/compatibility.json`)}`,
    `test -f ${shellQuote(`${remoteStage}/release.json`)}`,
    `(cd ${shellQuote(remoteStage)} && sha256sum -c .deploy-sha256sums >/dev/null)`,
    `grep -F ${shellQuote(localRelease.contentHash)} ${shellQuote(`${remoteStage}/release.json`)} >/dev/null`,
    `if test -e ${shellQuote(`${remoteRoot}/current`)} && test ! -L ${shellQuote(`${remoteRoot}/current`)}; then echo "current is not a symlink" >&2; exit 73; fi`,
    `if test -e ${shellQuote(`${remoteRoot}/previous`)} && test ! -L ${shellQuote(`${remoteRoot}/previous`)}; then echo "previous is not a symlink" >&2; exit 73; fi`,
    ...(skipPublicVerify ? [`if test -e ${shellQuote(`${remoteRoot}/current`)} || test -L ${shellQuote(`${remoteRoot}/current`)}; then echo "--skip-public-verify is only allowed for the first deployment" >&2; exit 74; fi`] : []),
    'old_target=',
    `if test -L ${shellQuote(`${remoteRoot}/current`)}; then old_target=$(readlink ${shellQuote(`${remoteRoot}/current`)}); case "$old_target" in ${shellQuote(`${remoteRoot}/releases/`)}*) ;; *) echo "current release target is outside releases" >&2; exit 77 ;; esac; test -d "$old_target"; test -f "$old_target/release.json"; grep -Eq ${shellQuote('"protocolVersion"[[:space:]]*:[[:space:]]*1([,}])')} "$old_target/release.json"; fi`,
    `cp -nR ${shellQuote(`${remoteStage}/assets/.`)} ${shellQuote(`${remoteRoot}/assets/`)}`,
    `asset_checks=$(grep -F ${shellQuote('  ./assets/')} ${shellQuote(`${remoteStage}/.deploy-sha256sums`)})`,
    'test -n "$asset_checks"',
    `(cd ${shellQuote(remoteRoot)} && printf ${shellQuote('%s\\n')} "$asset_checks" | sha256sum -c - >/dev/null)`,
    `rm ${shellQuote(`${remoteStage}/.deploy-sha256sums`)}`,
    `mv ${shellQuote(remoteStage)} ${shellQuote(remoteRelease)}`,
    'trap - 0 1 2 15',
    `if test -n "$old_target"; then ln -s "$old_target" ${shellQuote(previousLink)}; mv -Tf ${shellQuote(previousLink)} ${shellQuote(`${remoteRoot}/previous`)}; fi`,
    `ln -s ${shellQuote(remoteRelease)} ${shellQuote(nextLink)}`,
    `mv -Tf ${shellQuote(nextLink)} ${shellQuote(`${remoteRoot}/current`)}`,
    'printf "%s\\n" "$old_target"'
  ].join('; ')
  const previousTarget = captureSsh(configuration, withRemoteLock(remoteRoot, activateCommand), archivePath)
  if (!skipPublicVerify) {
    try {
      await verifyPublicDeployment(innerWebUiUrl, innerReleaseUrl, localRelease, snapshotRoot)
    } catch (error) {
      console.error('Public verification failed; restoring the previous WebUI release.')
      try {
        if (previousTarget) {
          const rolledBack = parseRollbackOutput(
            captureSsh(configuration, createRollbackCommand(remoteRoot, `${token}-verify`, remoteRelease)),
            'Automatic rollback'
          )
          await verifyPublicDeployment(innerWebUiUrl, innerReleaseUrl, rolledBack.release)
        } else {
          runSsh(configuration, createRemoveCurrentCommand(remoteRoot, remoteRelease))
          console.error('The failed first deployment was deactivated; no previous release existed.')
        }
      } catch (rollbackError) {
        console.error('Automatic rollback failed. Run the rollback command after checking the server.')
        if (rollbackError instanceof Error) console.error(rollbackError.message)
      }
      throw error
    }
  }
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}

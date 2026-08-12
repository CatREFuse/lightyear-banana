import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const WEBUI_CONNECT_SRC = ["'self'", 'http:', 'https:']
export const WEBUI_CSP = new Map([
  ['default-src', ["'self'"]],
  ['script-src', ["'self'"]],
  ['style-src', ["'self'"]],
  ['img-src', ["'self'", 'data:', 'blob:', 'http:', 'https:']],
  ['font-src', ["'self'", 'data:']],
  ['connect-src', WEBUI_CONNECT_SRC],
  ['object-src', ["'none'"]],
  ['frame-src', ["'none'"]],
  ['frame-ancestors', ["'none'"]],
  ['worker-src', ["'none'"]],
  ['media-src', ["'none'"]],
  ['manifest-src', ["'none'"]],
  ['base-uri', ["'none'"]],
  ['form-action', ["'none'"]]
])
export const HOMEPAGE_CSP = new Map([
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
])

const allowedWebUiHeaders = new Set(['content-security-policy'])

function maskQuotedAndCommentText(source) {
  let quote = ''
  let comment = false
  let escaped = false
  let result = ''
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (comment) {
      if (character === '\n') {
        comment = false
        result += character
      } else {
        result += ' '
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = ''
      }
      result += character === '\n' ? '\n' : ' '
      continue
    }
    if (character === '#') {
      comment = true
      result += ' '
    } else if (character === '"' || character === "'") {
      quote = character
      result += ' '
    } else {
      result += character
    }
  }
  if (quote) throw new Error('Nginx configuration contains an unterminated quoted string.')
  return result
}

function matchingBrace(masked, open) {
  let depth = 0
  for (let index = open; index < masked.length; index += 1) {
    if (masked[index] === '{') depth += 1
    if (masked[index] === '}') {
      depth -= 1
      if (depth === 0) return index
      if (depth < 0) break
    }
  }
  throw new Error('Nginx configuration contains an unbalanced block.')
}

function findBlocks(source, keyword, start = 0, end = source.length) {
  const masked = maskQuotedAndCommentText(source)
  const expression = new RegExp(`\\b${keyword}\\b([^;{}]*)\\{`, 'g')
  expression.lastIndex = start
  const blocks = []
  let match
  while ((match = expression.exec(masked)) && match.index < end) {
    const open = expression.lastIndex - 1
    const close = matchingBrace(masked, open)
    if (close >= end) {
      expression.lastIndex = close + 1
      continue
    }
    blocks.push({
      close,
      header: match[1].trim().replace(/\s+/g, ' '),
      open,
      start: match.index
    })
    expression.lastIndex = close + 1
  }
  return blocks
}

function serverNames(source, server) {
  const masked = maskQuotedAndCommentText(source.slice(server.open + 1, server.close))
  return [...masked.matchAll(/\bserver_name\s+([^;]+);/g)]
    .flatMap((match) => match[1].trim().split(/\s+/))
}

function isTlsServer(source, server) {
  const masked = maskQuotedAndCommentText(source.slice(server.open + 1, server.close))
  return /\blisten\s+[^;]*\b443\b[^;]*;/.test(masked)
}

function findTargetServer(source, serverName) {
  if (!/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)$/.test(serverName)) {
    throw new Error('Server name must be a plain hostname.')
  }
  const matches = findBlocks(source, 'server').filter((server) => (
    isTlsServer(source, server) && serverNames(source, server).includes(serverName)
  ))
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one TLS server block for ${serverName}; found ${matches.length}.`)
  }
  return matches[0]
}

function findLocations(source, server) {
  return findBlocks(source, 'location', server.open + 1, server.close)
}

function findTargetLocations(source, server) {
  const locations = findLocations(source, server)
  const webUi = locations.filter((location) => location.header === '^~ /webui/')
  const homepage = locations.filter((location) => location.header === '/' || location.header === '= /')
  if (webUi.length !== 1) throw new Error(`Expected exactly one "location ^~ /webui/" block; found ${webUi.length}.`)
  if (homepage.length !== 1) throw new Error(`Expected exactly one homepage location block; found ${homepage.length}.`)
  return { homepage: homepage[0], webUi: webUi[0] }
}

function directStatements(source, block) {
  const masked = maskQuotedAndCommentText(source)
  const statements = []
  let depth = 0
  let start = block.open + 1
  for (let index = block.open + 1; index < block.close; index += 1) {
    if (masked[index] === '{') depth += 1
    if (masked[index] === '}') {
      depth -= 1
      if (depth === 0) start = index + 1
    }
    if (masked[index] === ';' && depth === 0) {
      statements.push({ end: index + 1, start, text: source.slice(start, index + 1).trim() })
      start = index + 1
    }
  }
  return statements
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function addHeaders(source, block) {
  return directStatements(source, block).flatMap((statement) => {
    const match = statement.text.match(/^add_header\s+([^\s]+)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;]+)(?:\s+(always))?\s*;$/i)
    if (!match) return []
    return [{
      ...statement,
      always: Boolean(match[3]),
      name: match[1].toLowerCase(),
      value: unquote(match[2])
    }]
  })
}

function effectiveAddHeaders(source, server, location) {
  const localHeaders = addHeaders(source, location)
  return localHeaders.length ? localHeaders : addHeaders(source, server)
}

function assertSupportedHeaderInheritance(source, server, locations, label) {
  if (/\badd_header_inherit\b/.test(maskQuotedAndCommentText(source))) {
    throw new Error(`${label} uses add_header_inherit, which this exact policy gate cannot safely model.`)
  }
  for (const [blockLabel, block] of [['homepage', locations.homepage], ['WebUI', locations.webUi]]) {
    if (directStatements(source, block).some((statement) => /^include\s+/i.test(statement.text))) {
      throw new Error(`${label} ${blockLabel} block uses an include directive, so effective response headers cannot be proven locally.`)
    }
  }
  const serverUsesInclude = directStatements(source, server).some((statement) => /^include\s+/i.test(statement.text))
  if (serverUsesInclude) {
    for (const [blockLabel, block] of [['homepage', locations.homepage], ['WebUI', locations.webUi]]) {
      if (addHeaders(source, block).length === 0) {
        throw new Error(`${label} server uses an include directive while the ${blockLabel} location inherits response headers.`)
      }
    }
  }
}

function oneHeader(headers, name, label) {
  const matches = headers.filter((header) => header.name === name)
  if (matches.length !== 1) throw new Error(`${label} must define exactly one ${name} add_header directive.`)
  if (!matches[0].always) throw new Error(`${label} ${name} must use the always parameter.`)
  return matches[0]
}

export function parseCsp(value) {
  const result = new Map()
  for (const rawDirective of value.split(';')) {
    const parts = rawDirective.trim().split(/\s+/).filter(Boolean)
    if (!parts.length) continue
    const name = parts.shift().toLowerCase()
    if (result.has(name)) throw new Error(`CSP contains duplicate ${name} directives.`)
    result.set(name, parts.map((token) => token.toLowerCase()))
  }
  return result
}

function assertExactCsp(actual, expected, label) {
  if (actual.size !== expected.size) throw new Error(`${label} has an unexpected directive set.`)
  for (const [directive, expectedTokens] of expected) {
    const actualTokens = actual.get(directive)
    if (JSON.stringify(actualTokens) !== JSON.stringify(expectedTokens)) {
      throw new Error(`${label} has an invalid ${directive} directive.`)
    }
  }
}

function webUiExpectedFromCurrent(currentValue) {
  const current = parseCsp(currentValue)
  const connect = current.get('connect-src')
  if (JSON.stringify(connect) !== JSON.stringify(["'none'"])) {
    throw new Error("Current WebUI CSP connect-src must be exactly 'none'.")
  }
  const images = current.get('img-src')
  if (JSON.stringify(images) !== JSON.stringify(["'self'", 'data:', 'blob:'])) {
    throw new Error("Current WebUI CSP img-src must be exactly 'self' data: blob:.")
  }
  const expected = new Map(current)
  expected.set('connect-src', WEBUI_CONNECT_SRC)
  expected.set('img-src', WEBUI_CSP.get('img-src'))
  return expected
}

function lineExpandedRanges(source, headers, allowedNames) {
  return headers
    .filter((header) => allowedNames.has(header.name))
    .map((header) => {
      let start = source.lastIndexOf('\n', header.start - 1) + 1
      let end = source.indexOf('\n', header.end)
      if (end < 0) end = source.length
      else end += 1
      const before = source.slice(start, header.start)
      const after = source.slice(header.end, end).replace(/\r?\n$/, '')
      if (before.trim() || after.trim()) return { start: header.start, end: header.end }
      return { start, end }
    })
}

function stripAllowedHeaderChanges(source, serverName, allowedHomepageHeaders) {
  const server = findTargetServer(source, serverName)
  const locations = findTargetLocations(source, server)
  const ranges = [
    ...lineExpandedRanges(source, addHeaders(source, locations.webUi), allowedWebUiHeaders),
    ...lineExpandedRanges(source, addHeaders(source, locations.homepage), allowedHomepageHeaders)
  ].sort((left, right) => right.start - left.start)
  let result = source
  for (const range of ranges) result = result.slice(0, range.start) + result.slice(range.end)
  return result
}

function assertNoDuplicateHeaders(headers, label) {
  const names = new Set()
  for (const header of headers) {
    if (names.has(header.name)) throw new Error(`${label} defines duplicate ${header.name} add_header directives.`)
    names.add(header.name)
  }
}

function assertHomepageHeaders(currentHeaders, candidateHeaders) {
  assertNoDuplicateHeaders(currentHeaders, 'Current homepage policy')
  assertNoDuplicateHeaders(candidateHeaders, 'Candidate homepage policy')

  const csp = oneHeader(candidateHeaders, 'content-security-policy', 'Homepage')
  assertExactCsp(parseCsp(csp.value), HOMEPAGE_CSP, 'Homepage CSP')

  const referrer = oneHeader(candidateHeaders, 'referrer-policy', 'Homepage')
  if (referrer.value.toLowerCase() !== 'no-referrer') {
    throw new Error('Homepage Referrer-Policy must be exactly no-referrer.')
  }

  const currentNosniff = oneHeader(currentHeaders, 'x-content-type-options', 'Current homepage')
  const nosniff = oneHeader(candidateHeaders, 'x-content-type-options', 'Homepage')
  if (nosniff.value.toLowerCase() !== 'nosniff') {
    throw new Error('Homepage X-Content-Type-Options must be exactly nosniff.')
  }
  if (nosniff.value !== currentNosniff.value || nosniff.always !== currentNosniff.always) {
    throw new Error('Homepage X-Content-Type-Options must preserve the current effective value and always parameter.')
  }

  const currentHsts = oneHeader(currentHeaders, 'strict-transport-security', 'Current homepage')
  const hsts = oneHeader(candidateHeaders, 'strict-transport-security', 'Homepage')
  assertStrictTransportValue(hsts.value, 'Homepage')
  if (hsts.value !== currentHsts.value || hsts.always !== currentHsts.always) {
    throw new Error('Homepage Strict-Transport-Security must preserve the current effective value and always parameter.')
  }

  const currentByName = new Map(currentHeaders.map((header) => [header.name, header]))
  const candidateByName = new Map(candidateHeaders.map((header) => [header.name, header]))
  const expectedNames = new Set([...currentByName.keys(), 'content-security-policy', 'referrer-policy'])
  if (candidateByName.size !== expectedNames.size || [...expectedNames].some((name) => !candidateByName.has(name))) {
    throw new Error('Candidate homepage headers must preserve every current effective header and add only CSP or Referrer-Policy.')
  }
  for (const [name, current] of currentByName) {
    if (name === 'content-security-policy' || name === 'referrer-policy') continue
    const candidate = candidateByName.get(name)
    if (candidate.value !== current.value || candidate.always !== current.always) {
      throw new Error(`Candidate homepage ${name} must preserve the current effective value and always parameter.`)
    }
  }
  return {
    allowedNames: expectedNames,
    strictTransportSecurity: hsts.value,
    xContentTypeOptions: nosniff.value
  }
}

function assertStrictTransportValue(value, label) {
  const match = value.match(/^max-age=(\d+)(?:;\s*includeSubDomains)?$/i)
  if (!match || Number(match[1]) < 31_536_000) {
    throw new Error(`${label} Strict-Transport-Security max-age must be at least 31536000 seconds.`)
  }
  return value
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function validatePolicyOrigin(value, serverName) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Policy origin must be an absolute HTTPS origin.')
  }
  const expectedOrigin = `https://${serverName}`
  if (
    value !== expectedOrigin ||
    url.protocol !== 'https:' ||
    url.hostname !== serverName ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== expectedOrigin
  ) {
    throw new Error(`Policy origin must be exactly ${expectedOrigin} on the default HTTPS port.`)
  }
  return url.origin
}

export function validateNginxSecurityPolicyChange(currentSource, candidateSource, serverName, originValue) {
  if (currentSource === candidateSource) throw new Error('Candidate Nginx configuration does not contain a policy change.')

  const currentServer = findTargetServer(currentSource, serverName)
  const currentLocations = findTargetLocations(currentSource, currentServer)
  const candidateServer = findTargetServer(candidateSource, serverName)
  const candidateLocations = findTargetLocations(candidateSource, candidateServer)
  assertSupportedHeaderInheritance(currentSource, currentServer, currentLocations, 'Current config')
  assertSupportedHeaderInheritance(candidateSource, candidateServer, candidateLocations, 'Candidate config')

  const currentWebUiHeaders = addHeaders(currentSource, currentLocations.webUi)
  const candidateWebUiHeaders = addHeaders(candidateSource, candidateLocations.webUi)
  const currentWebUiCsp = oneHeader(currentWebUiHeaders, 'content-security-policy', 'Current WebUI')
  const candidateWebUiCsp = oneHeader(candidateWebUiHeaders, 'content-security-policy', 'Candidate WebUI')
  assertExactCsp(
    parseCsp(candidateWebUiCsp.value),
    webUiExpectedFromCurrent(currentWebUiCsp.value),
    'Candidate WebUI CSP'
  )
  assertExactCsp(parseCsp(candidateWebUiCsp.value), WEBUI_CSP, 'Candidate WebUI CSP')

  const webUiReferrer = oneHeader(candidateWebUiHeaders, 'referrer-policy', 'Candidate WebUI')
  if (webUiReferrer.value.toLowerCase() !== 'no-referrer') {
    throw new Error('Candidate WebUI Referrer-Policy must be exactly no-referrer.')
  }
  const webUiHsts = oneHeader(candidateWebUiHeaders, 'strict-transport-security', 'Candidate WebUI')
  assertStrictTransportValue(webUiHsts.value, 'Candidate WebUI')
  const webUiNosniff = oneHeader(candidateWebUiHeaders, 'x-content-type-options', 'Candidate WebUI')
  if (webUiNosniff.value.toLowerCase() !== 'nosniff') {
    throw new Error('Candidate WebUI X-Content-Type-Options must be exactly nosniff.')
  }
  const currentHomepageHeaders = effectiveAddHeaders(currentSource, currentServer, currentLocations.homepage)
  const candidateHomepageHeaders = addHeaders(candidateSource, candidateLocations.homepage)
  const homepagePolicy = assertHomepageHeaders(currentHomepageHeaders, candidateHomepageHeaders)

  const currentWithoutAllowedHeaders = stripAllowedHeaderChanges(currentSource, serverName, homepagePolicy.allowedNames)
  const candidateWithoutAllowedHeaders = stripAllowedHeaderChanges(candidateSource, serverName, homepagePolicy.allowedNames)
  if (currentWithoutAllowedHeaders !== candidateWithoutAllowedHeaders) {
    throw new Error('Candidate changes content outside the approved homepage and WebUI security headers.')
  }

  return {
    activeSha256: sha256(currentSource),
    candidateSha256: sha256(candidateSource),
    homepageLocation: candidateLocations.homepage.header,
    origin: validatePolicyOrigin(originValue, serverName),
    preservedHeaders: {
      homepageStrictTransportSecurity: homepagePolicy.strictTransportSecurity,
      homepageXContentTypeOptions: homepagePolicy.xContentTypeOptions,
      webUiStrictTransportSecurity: webUiHsts.value,
      webUiXContentTypeOptions: webUiNosniff.value
    },
    schemaVersion: 1,
    serverName,
    webUiConnectSrc: WEBUI_CONNECT_SRC
  }
}

export function validateReviewManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Policy manifest must be an object.')
  if (value.schemaVersion !== 1) throw new Error('Policy manifest has an invalid schemaVersion.')
  if (!/^[a-f0-9]{64}$/.test(value.activeSha256 || '')) throw new Error('Policy manifest has an invalid activeSha256.')
  if (!/^[a-f0-9]{64}$/.test(value.candidateSha256 || '')) throw new Error('Policy manifest has an invalid candidateSha256.')
  if (value.activeSha256 === value.candidateSha256) throw new Error('Policy manifest hashes must describe a real change.')
  if (!/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)$/.test(value.serverName || '')) {
    throw new Error('Policy manifest has an invalid serverName.')
  }
  validatePolicyOrigin(value.origin, value.serverName)
  if (value.homepageLocation !== '/' && value.homepageLocation !== '= /') {
    throw new Error('Policy manifest has an invalid homepageLocation.')
  }
  if (JSON.stringify(value.webUiConnectSrc) !== JSON.stringify(WEBUI_CONNECT_SRC)) {
    throw new Error('Policy manifest has an invalid WebUI connect-src policy.')
  }
  const preserved = value.preservedHeaders
  if (!preserved || typeof preserved !== 'object' || Array.isArray(preserved)) {
    throw new Error('Policy manifest has no preserved security header values.')
  }
  for (const key of ['homepageStrictTransportSecurity', 'webUiStrictTransportSecurity']) {
    assertStrictTransportValue(preserved[key] || '', `Policy manifest ${key}`)
  }
  for (const key of ['homepageXContentTypeOptions', 'webUiXContentTypeOptions']) {
    if (preserved[key]?.toLowerCase() !== 'nosniff') throw new Error(`Policy manifest ${key} must be nosniff.`)
  }
  return value
}

function assertPublicCommonHeaders(response, label, expectedHsts, expectedNosniff) {
  if (response.headers.get('x-content-type-options') !== expectedNosniff) {
    throw new Error(`${label} must preserve its reviewed X-Content-Type-Options value.`)
  }
  if (response.headers.get('referrer-policy')?.toLowerCase() !== 'no-referrer') {
    throw new Error(`${label} must return Referrer-Policy: no-referrer.`)
  }
  if (response.headers.get('strict-transport-security') !== expectedHsts) {
    throw new Error(`${label} must preserve its reviewed Strict-Transport-Security value.`)
  }
}

function policyUrls(manifestValue) {
  const manifest = validateReviewManifest(manifestValue)
  return {
    manifest,
    siteUrl: new URL('/', manifest.origin),
    webUiUrl: new URL('/webui/', manifest.origin)
  }
}

async function fetchPolicyResponse(url, label) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache' },
      redirect: 'error',
      signal: controller.signal
    })
    if (response.status !== 200) throw new Error(`${label} returned HTTP ${response.status}.`)
    return response
  } finally {
    clearTimeout(timeout)
  }
}

function responsePolicySnapshot(response) {
  return {
    contentSecurityPolicy: response.headers.get('content-security-policy') || '',
    referrerPolicy: response.headers.get('referrer-policy') || '',
    status: response.status,
    strictTransportSecurity: response.headers.get('strict-transport-security') || '',
    xContentTypeOptions: response.headers.get('x-content-type-options') || ''
  }
}

async function readPolicyResponses(manifestValue) {
  const { manifest, siteUrl, webUiUrl } = policyUrls(manifestValue)
  const [siteResponse, webUiResponse] = await Promise.all([
    fetchPolicyResponse(siteUrl, 'Homepage'),
    fetchPolicyResponse(webUiUrl, 'WebUI')
  ])
  return { manifest, siteResponse, siteUrl, webUiResponse, webUiUrl }
}

export async function readPublicSecuritySnapshot(manifestValue) {
  const { manifest, siteResponse, webUiResponse } = await readPolicyResponses(manifestValue)
  try {
    return {
      origin: manifest.origin,
      responses: {
        '/': responsePolicySnapshot(siteResponse),
        '/webui/': responsePolicySnapshot(webUiResponse)
      },
      schemaVersion: 1,
      serverName: manifest.serverName
    }
  } finally {
    await Promise.all([siteResponse.body?.cancel(), webUiResponse.body?.cancel()])
  }
}

export async function verifyPublicSecuritySnapshot(manifestValue, expectedSnapshot) {
  const manifest = validateReviewManifest(manifestValue)
  if (
    !expectedSnapshot ||
    expectedSnapshot.schemaVersion !== 1 ||
    expectedSnapshot.origin !== manifest.origin ||
    expectedSnapshot.serverName !== manifest.serverName
  ) {
    throw new Error('Previous public policy snapshot is not bound to the reviewed manifest origin.')
  }
  const actualSnapshot = await readPublicSecuritySnapshot(manifest)
  if (JSON.stringify(actualSnapshot) !== JSON.stringify(expectedSnapshot)) {
    throw new Error('Public security headers do not match the policy that was active before the transaction.')
  }
  return actualSnapshot
}

export async function verifyPublicSecurityPolicy(manifestValue) {
  const { manifest, siteResponse, webUiResponse } = await readPolicyResponses(manifestValue)
  try {
    assertPublicCommonHeaders(
      siteResponse,
      'Homepage',
      manifest.preservedHeaders.homepageStrictTransportSecurity,
      manifest.preservedHeaders.homepageXContentTypeOptions
    )
    assertPublicCommonHeaders(
      webUiResponse,
      'WebUI',
      manifest.preservedHeaders.webUiStrictTransportSecurity,
      manifest.preservedHeaders.webUiXContentTypeOptions
    )
    assertExactCsp(
      parseCsp(siteResponse.headers.get('content-security-policy') || ''),
      HOMEPAGE_CSP,
      'Public homepage CSP'
    )
    assertExactCsp(
      parseCsp(webUiResponse.headers.get('content-security-policy') || ''),
      WEBUI_CSP,
      'Public WebUI CSP'
    )
    return { origin: manifest.origin, serverName: manifest.serverName, verified: ['/', '/webui/'] }
  } finally {
    await Promise.all([siteResponse.body?.cancel(), webUiResponse.body?.cancel()])
  }
}

function readOption(name) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  if (process.argv.includes('--verify-public')) {
    const reviewManifestPath = readOption('--manifest')
    if (!reviewManifestPath) {
      throw new Error('Usage: node scripts/nginx-security-policy.mjs --verify-public --manifest <approval.json>')
    }
    const reviewManifest = validateReviewManifest(JSON.parse(readFileSync(path.resolve(reviewManifestPath), 'utf8')))
    const result = await verifyPublicSecurityPolicy(reviewManifest)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exit(0)
  }
  const currentPath = readOption('--current')
  const candidatePath = readOption('--candidate')
  const serverName = readOption('--server-name')
  const origin = readOption('--origin')
  const manifestPath = readOption('--manifest')
  if (!currentPath || !candidatePath || !serverName || !origin) {
    throw new Error('Usage: node scripts/nginx-security-policy.mjs --current <active.conf> --candidate <candidate.conf> --server-name <hostname> --origin <https://hostname> [--manifest <approval.json>]')
  }
  const currentSource = readFileSync(path.resolve(currentPath), 'utf8')
  const candidateSource = readFileSync(path.resolve(candidatePath), 'utf8')
  const manifest = {
    ...validateNginxSecurityPolicyChange(currentSource, candidateSource, serverName, origin),
    currentPath: path.resolve(currentPath),
    candidatePath: path.resolve(candidatePath),
    validatedAt: new Date().toISOString()
  }
  const output = `${JSON.stringify(manifest, null, 2)}\n`
  if (manifestPath) writeFileSync(path.resolve(manifestPath), output, { encoding: 'utf8', flag: 'wx' })
  process.stdout.write(output)
}

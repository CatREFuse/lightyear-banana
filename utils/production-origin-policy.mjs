import { isIP } from 'node:net'

const blockedDomains = ['cake.catrefuse.com', 'webui.catrefuse.com', 'example.com', 'example.net', 'example.org']
const blockedSuffixes = ['invalid', 'test', 'example', 'localhost', 'local']
const dnsLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function normalizeProductionHostname(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\.$/, '')
}

function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

export function isDisallowedProductionHostname(value) {
  const hostname = normalizeProductionHostname(value)
  const addressCandidate = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  const labels = hostname.split('.')

  return (
    !hostname
    || hostname.length > 253
    || labels.length < 2
    || labels.some((label) => !dnsLabelPattern.test(label))
    || isIP(addressCandidate) !== 0
    || hostname.includes(':')
    || blockedDomains.some((domain) => matchesDomain(hostname, domain))
    || blockedSuffixes.some((suffix) => matchesDomain(hostname, suffix))
  )
}

export function assertProductionOrigin(value, label = 'Production origin') {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be one exact HTTPS origin.`)
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== '/'
    || url.origin !== value
    || isDisallowedProductionHostname(url.hostname)
  ) {
    throw new Error(`${label} must be one exact approved HTTPS origin.`)
  }

  return url.origin
}

export function resolveReleaseUrl({
  processEnvironment = {},
  keyEnvironment = {},
  viteEnvironment = {},
  webviewOrigin,
  production = true
}) {
  const configured = processEnvironment.INNER_RELEASE_URL
    ?? keyEnvironment.INNER_RELEASE_URL
    ?? (production ? undefined : viteEnvironment.INNER_RELEASE_URL)
  if (configured !== undefined && typeof configured !== 'string') {
    throw new Error('INNER_RELEASE_URL must be a string.')
  }

  let url
  try {
    url = new URL(configured?.trim() || '/releases/', webviewOrigin)
  } catch {
    throw new Error('INNER_RELEASE_URL must be a valid HTTPS URL.')
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (production && isDisallowedProductionHostname(url.hostname))
  ) {
    throw new Error('INNER_RELEASE_URL must be a credential-free approved HTTPS URL without query parameters or fragments.')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

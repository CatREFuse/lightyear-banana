import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import {
  readPublicSecuritySnapshot,
  validateNginxSecurityPolicyChange,
  validateReviewManifest,
  verifyPublicSecurityPolicy,
  verifyPublicSecuritySnapshot
} from './nginx-security-policy.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const transactionScript = path.join(projectRoot, 'deploy', 'nginx', 'apply-verified-config.sh')
const defaultEnvPath = path.join(projectRoot, 'key.env')

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function verifyWithRetry(action, attempts, delayMilliseconds) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      if (attempt + 1 < attempts) await wait(delayMilliseconds * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Public security policy verification failed.')
}

function failure(message, causes) {
  return new AggregateError(causes.filter(Boolean), message)
}

export async function activateReviewedPolicy({
  manifest: manifestValue,
  transition,
  verificationAttempts = 4,
  verificationDelayMilliseconds = 500
}, dependencies = {}) {
  const manifest = validateReviewManifest(manifestValue)
  if (typeof transition !== 'function') throw new Error('A Nginx transition function is required.')
  if (!Number.isInteger(verificationAttempts) || verificationAttempts < 1 || verificationAttempts > 10) {
    throw new Error('verificationAttempts must be an integer from 1 through 10.')
  }
  if (!Number.isInteger(verificationDelayMilliseconds) || verificationDelayMilliseconds < 0 || verificationDelayMilliseconds > 5_000) {
    throw new Error('verificationDelayMilliseconds must be an integer from 0 through 5000.')
  }
  const captureSnapshot = dependencies.readPublicSecuritySnapshot || readPublicSecuritySnapshot
  const verifyTarget = dependencies.verifyPublicSecurityPolicy || verifyPublicSecurityPolicy
  const verifySnapshot = dependencies.verifyPublicSecuritySnapshot || verifyPublicSecuritySnapshot
  const previousSnapshot = await captureSnapshot(manifest)
  let activation

  try {
    activation = await transition({
      activeSha256: manifest.activeSha256,
      candidateSha256: manifest.candidateSha256,
      direction: 'activate'
    })
  } catch (activationError) {
    try {
      await verifyWithRetry(
        () => verifySnapshot(manifest, previousSnapshot),
        verificationAttempts,
        verificationDelayMilliseconds
      )
    } catch (snapshotError) {
      throw failure('Nginx activation failed and the previous public policy could not be confirmed.', [activationError, snapshotError])
    }
    throw failure('Nginx activation failed; the previous public policy remains active and was confirmed.', [activationError])
  }

  if (!activation || typeof activation.backupPath !== 'string' || !activation.backupPath) {
    throw new Error('Nginx transaction did not return a reviewed backup path.')
  }

  try {
    const publicResult = await verifyWithRetry(
      () => verifyTarget(manifest),
      verificationAttempts,
      verificationDelayMilliseconds
    )
    return { activation, publicResult, previousSnapshot }
  } catch (publicError) {
    let rollback
    try {
      rollback = await transition({
        activeSha256: manifest.candidateSha256,
        candidatePath: activation.backupPath,
        candidateSha256: manifest.activeSha256,
        direction: 'rollback'
      })
    } catch (rollbackError) {
      throw failure('Public policy verification failed and automatic Nginx rollback failed.', [publicError, rollbackError])
    }

    try {
      await verifyWithRetry(
        () => verifySnapshot(manifest, previousSnapshot),
        verificationAttempts,
        verificationDelayMilliseconds
      )
    } catch (snapshotError) {
      throw failure('Nginx rollback completed, but the previous public policy could not be read back.', [publicError, snapshotError])
    }
    throw failure('Public policy verification failed; the reviewed configuration was automatically restored and confirmed.', [publicError, Object.assign(new Error('Rollback transaction completed.'), { rollback })])
  }
}

function readOption(name) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function parseEnv(contents) {
  const result = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
    const separator = normalized.indexOf('=')
    if (separator < 1) throw new Error(`Invalid deployment environment line: ${rawLine}`)
    const key = normalized.slice(0, separator).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid deployment environment key: ${key}`)
    let value = normalized.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

function required(value, label) {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${label} is required.`)
  return normalized
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function validateRemoteConfigPath(value) {
  if (!/^\/etc\/nginx\/(?:conf\.d\/[A-Za-z0-9_.-]+\.conf|sites-(?:available|enabled)\/[A-Za-z0-9_.-]+\.conf)$/.test(value || '')) {
    throw new Error('Active config must be one dedicated file ending in .conf under /etc/nginx/conf.d, /etc/nginx/sites-available, or /etc/nginx/sites-enabled.')
  }
  return value
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

export function createRemoteCanonicalPreflight(activeConfigValue) {
  const activeConfig = validateRemoteConfigPath(activeConfigValue)
  return [
    'set -eu',
    `test ! -L ${shellQuote(activeConfig)}`,
    `canonical_active=$(readlink -f -- ${shellQuote(activeConfig)})`,
    `test "$canonical_active" = ${shellQuote(activeConfig)}`,
    `test -f ${shellQuote(activeConfig)}`,
    `test -s ${shellQuote(activeConfig)}`,
    `nginx -t`,
    `if nginx -T 2>&1 | grep -Eq '(^|[[:space:]])add_header_inherit[[:space:]]'; then echo 'expanded Nginx config uses unsupported add_header_inherit' >&2; exit 65; fi`
  ].join('; ')
}

function sshArguments(configuration) {
  const result = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=2',
    '-p', configuration.port
  ]
  if (configuration.identityFile) result.push('-i', configuration.identityFile)
  return result
}

function scpArguments(configuration) {
  const result = [
    '-q',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-P', configuration.port
  ]
  if (configuration.identityFile) result.push('-i', configuration.identityFile)
  return result
}

function executeSsh(configuration, command) {
  return execFileSync('ssh', [
    ...sshArguments(configuration),
    configuration.target,
    `sh -c ${shellQuote(command)}`
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function parseTransactionOutput(output, expectedBackupPath, expectedSha256) {
  const lines = String(output).trim().split(/\r?\n/)
  if (!lines.includes('Nginx policy activated')) throw new Error('Remote transaction did not report activation success.')
  const activeLine = lines.find((line) => line.startsWith('active_sha256='))
  const backupLine = lines.find((line) => line.startsWith('backup='))
  if (activeLine !== `active_sha256=${expectedSha256}`) throw new Error('Remote transaction returned an unexpected active digest.')
  const backupPath = backupLine?.slice('backup='.length) || ''
  if (backupPath !== expectedBackupPath) {
    throw new Error('Remote transaction returned an invalid backup path.')
  }
  return { activeSha256: expectedSha256, backupPath }
}

function deploymentConfiguration(environment, manifest) {
  const configuredDomain = required(environment.domain || environment.DOMAIN || new URL(required(environment.INNER_WEBUI_URL, 'domain or INNER_WEBUI_URL')).hostname, 'domain')
  if (configuredDomain !== manifest.serverName) throw new Error('Reviewed manifest serverName does not match the deployment domain.')
  const host = required(environment.DEPLOY_SSH_HOST || environment.server_ip, 'DEPLOY_SSH_HOST or server_ip')
  const user = (environment.DEPLOY_SSH_USER || 'root').trim()
  const port = (environment.DEPLOY_SSH_PORT || '22').trim()
  if (!/^[A-Za-z0-9._-]+$/.test(host) || host.startsWith('-')) throw new Error('Deployment SSH host contains unsupported characters.')
  if (!/^[A-Za-z0-9._-]+$/.test(user) || user.startsWith('-')) throw new Error('Deployment SSH user contains unsupported characters.')
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Deployment SSH port is invalid.')
  const identityValue = environment.DEPLOY_SSH_IDENTITY_FILE?.trim()
  const identityFile = identityValue ? path.resolve(projectRoot, identityValue) : undefined
  if (identityFile && !existsSync(identityFile)) throw new Error('Deployment SSH identity file does not exist.')
  return { host, identityFile, port, target: `${user}@${host}` }
}

function validateLocalManifestFiles(manifest) {
  for (const key of ['currentPath', 'candidatePath']) {
    const value = manifest[key]
    if (
      typeof value !== 'string' ||
      !path.isAbsolute(value) ||
      value !== path.resolve(value) ||
      !existsSync(value) ||
      !statSync(value).isFile()
    ) {
      throw new Error(`Policy manifest ${key} must be an existing absolute local file.`)
    }
    if (realpathSync.native(value) !== value) {
      throw new Error(`Policy manifest ${key} must already be canonical and must not be a symlink.`)
    }
  }
}

export function reviewManifestSecurityFields(value) {
  const manifest = validateReviewManifest(value)
  return {
    activeSha256: manifest.activeSha256,
    candidateSha256: manifest.candidateSha256,
    homepageLocation: manifest.homepageLocation,
    origin: manifest.origin,
    preservedHeaders: {
      homepageStrictTransportSecurity: manifest.preservedHeaders.homepageStrictTransportSecurity,
      homepageXContentTypeOptions: manifest.preservedHeaders.homepageXContentTypeOptions,
      webUiStrictTransportSecurity: manifest.preservedHeaders.webUiStrictTransportSecurity,
      webUiXContentTypeOptions: manifest.preservedHeaders.webUiXContentTypeOptions
    },
    schemaVersion: manifest.schemaVersion,
    serverName: manifest.serverName,
    webUiConnectSrc: [...manifest.webUiConnectSrc]
  }
}

export function revalidateApprovedManifest(manifestValue) {
  const manifest = validateReviewManifest(manifestValue)
  validateLocalManifestFiles(manifest)
  const currentSource = readFileSync(manifest.currentPath, 'utf8')
  const candidateSource = readFileSync(manifest.candidatePath, 'utf8')
  const recomputed = validateNginxSecurityPolicyChange(
    currentSource,
    candidateSource,
    manifest.serverName,
    manifest.origin
  )
  if (!isDeepStrictEqual(reviewManifestSecurityFields(recomputed), reviewManifestSecurityFields(manifest))) {
    throw new Error('Policy approval manifest does not exactly match the security semantics recomputed from active and candidate files.')
  }
  return { candidateSource, currentSource, manifest, recomputed }
}

function createRemoteTransition(configuration, activeConfig, remoteCandidate, remoteScript, scriptSha256) {
  const escapedActive = activeConfig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const backupPattern = new RegExp(`^${escapedActive}\\.mugen-policy-[a-f0-9]{24}-[a-f0-9]{12}\\.bak$`)
  return async ({ activeSha256, candidatePath, candidateSha256 }) => {
    const selectedCandidate = candidatePath || remoteCandidate
    if (selectedCandidate !== remoteCandidate && !backupPattern.test(selectedCandidate)) {
      throw new Error('Remote candidate path is outside the approved transaction paths.')
    }
    const transactionId = randomBytes(12).toString('hex')
    const expectedBackupPath = `${activeConfig}.mugen-policy-${transactionId}-${activeSha256.slice(0, 12)}.bak`
    const command = [
      'set -eu',
      `test "$(sha256sum ${shellQuote(remoteScript)} | awk '{print $1}')" = ${shellQuote(scriptSha256)}`,
      `sh ${shellQuote(remoteScript)} ${shellQuote(activeConfig)} ${shellQuote(selectedCandidate)} ${shellQuote(activeSha256)} ${shellQuote(candidateSha256)} ${shellQuote(transactionId)}`
    ].join('; ')
    try {
      return parseTransactionOutput(executeSsh(configuration, command), expectedBackupPath, candidateSha256)
    } catch (transactionError) {
      try {
        const recoveredOutput = executeSsh(configuration, [
          'set -eu',
          `test "$(sha256sum ${shellQuote(activeConfig)} | awk '{print $1}')" = ${shellQuote(candidateSha256)}`,
          `test "$(sha256sum ${shellQuote(expectedBackupPath)} | awk '{print $1}')" = ${shellQuote(activeSha256)}`,
          `printf ${shellQuote('Nginx policy activated\\nactive_sha256=%s\\nbackup=%s\\n')} ${shellQuote(candidateSha256)} ${shellQuote(expectedBackupPath)}`
        ].join('; '))
        return parseTransactionOutput(recoveredOutput, expectedBackupPath, candidateSha256)
      } catch (recoveryError) {
        throw failure('Remote Nginx transaction failed and no complete activation state could be recovered.', [transactionError, recoveryError])
      }
    }
  }
}

async function main() {
  if (!process.argv.includes('--apply')) {
    throw new Error('Use --apply with a reviewed manifest to run the Nginx policy transaction.')
  }
  const manifestPath = path.resolve(required(readOption('--manifest'), '--manifest'))
  const envPath = path.resolve(readOption('--env') || defaultEnvPath)
  const activeConfig = validateRemoteConfigPath(required(readOption('--active-config'), '--active-config'))
  const manifestInput = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const { manifest } = revalidateApprovedManifest(manifestInput)
  const environment = { ...parseEnv(readFileSync(envPath, 'utf8')), ...process.env }
  const configuration = deploymentConfiguration(environment, manifest)
  const token = randomBytes(12).toString('hex')
  const remoteDirectory = `/tmp/mugen-nginx-policy-${token}`
  const remoteCandidate = `${remoteDirectory}/candidate.conf`
  const remoteScript = `${remoteDirectory}/apply-verified-config.sh`
  const scriptSha256 = sha256File(transactionScript)

  executeSsh(configuration, createRemoteCanonicalPreflight(activeConfig))
  executeSsh(configuration, `set -eu; umask 077; test ! -e ${shellQuote(remoteDirectory)}; mkdir ${shellQuote(remoteDirectory)}`)
  try {
    execFileSync('scp', [
      ...scpArguments(configuration),
      manifest.candidatePath,
      `${configuration.target}:${remoteCandidate}`
    ], { cwd: projectRoot, stdio: ['ignore', 'inherit', 'inherit'] })
    execFileSync('scp', [
      ...scpArguments(configuration),
      transactionScript,
      `${configuration.target}:${remoteScript}`
    ], { cwd: projectRoot, stdio: ['ignore', 'inherit', 'inherit'] })
    executeSsh(configuration, [
      'set -eu',
      `test "$(sha256sum ${shellQuote(remoteScript)} | awk '{print $1}')" = ${shellQuote(scriptSha256)}`,
      `test "$(sha256sum ${shellQuote(remoteCandidate)} | awk '{print $1}')" = ${shellQuote(manifest.candidateSha256)}`
    ].join('; '))
    const transition = createRemoteTransition(configuration, activeConfig, remoteCandidate, remoteScript, scriptSha256)
    const result = await activateReviewedPolicy({ manifest, transition })
    process.stdout.write(`${JSON.stringify({
      activeSha256: result.activation.activeSha256,
      backupPath: result.activation.backupPath,
      origin: result.publicResult.origin,
      verified: result.publicResult.verified
    }, null, 2)}\n`)
  } finally {
    try {
      executeSsh(configuration, `set -eu; rm -f ${shellQuote(remoteCandidate)} ${shellQuote(remoteScript)}; rmdir ${shellQuote(remoteDirectory)}`)
    } catch (cleanupError) {
      process.stderr.write(`Remote temporary policy files require cleanup: ${remoteDirectory}\n`)
      if (cleanupError instanceof Error) process.stderr.write(`${cleanupError.message}\n`)
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}

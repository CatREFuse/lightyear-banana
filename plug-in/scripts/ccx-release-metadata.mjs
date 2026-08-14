import path from 'node:path'
import { assertProductionOrigin, resolveReleaseUrl } from '../../utils/production-origin-policy.mjs'

export function createCcxReleaseMetadata({
  ccxVersion,
  buildNumber,
  filename,
  sha256,
  webviewOrigin,
  releaseUrl,
  builtAt,
  sourceCommit,
  dirty
}) {
  if (!/^\d+\.\d+\.\d+$/.test(ccxVersion || '')) throw new Error('CCX release metadata has an invalid version.')
  if (!/^\d{6}(?!0000)\d{4}$/.test(buildNumber || '')) throw new Error('CCX release metadata has an invalid build number.')
  const expectedFilename = `mugen-${ccxVersion}-${buildNumber}.ccx`
  if (
    typeof filename !== 'string'
    || filename !== path.basename(filename)
    || filename !== expectedFilename
  ) throw new Error('CCX release metadata has an invalid filename.')
  if (!/^[a-f0-9]{64}$/.test(sha256 || '')) throw new Error('CCX release metadata has an invalid SHA256.')

  const normalizedWebviewOrigin = assertProductionOrigin(webviewOrigin, 'CCX release WebView origin')
  const normalizedReleaseUrl = resolveReleaseUrl({
    processEnvironment: { INNER_RELEASE_URL: releaseUrl },
    webviewOrigin: normalizedWebviewOrigin,
    production: true
  }).href
  if (normalizedReleaseUrl !== releaseUrl) {
    throw new Error('CCX release URL must be normalized and end with /.')
  }
  if (typeof builtAt !== 'string' || Number.isNaN(Date.parse(builtAt))) {
    throw new Error('CCX release metadata has an invalid build time.')
  }
  if (!/^[a-f0-9]{40,64}$/.test(sourceCommit || '')) {
    throw new Error('CCX release metadata has an invalid source commit.')
  }
  if (dirty !== false) throw new Error('CCX release metadata must come from a clean Git worktree.')

  return {
    schemaVersion: 2,
    ccxVersion,
    buildNumber,
    filename,
    sha256,
    webviewOrigin: normalizedWebviewOrigin,
    releaseUrl: normalizedReleaseUrl,
    builtAt,
    sourceCommit,
    dirty: false
  }
}

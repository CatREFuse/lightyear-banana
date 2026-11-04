import { readFileSync } from 'node:fs'

const retentionScript = readFileSync(new URL('./release-retention.py', import.meta.url), 'utf8')
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`

// Both callers wrap this command in their activation lock.
export function retentionCommand(...args) {
  return `python3 -c ${quote(retentionScript)} ${args.map(quote).join(' ')}`
}

export async function verifyThenRetainCurrent(verify, cleanup) {
  const result = await verify()
  try {
    await cleanup()
  } catch (cause) {
    const error = new Error('Public verification passed, but release retention cleanup failed.', { cause })
    error.code = 'RELEASE_RETENTION_FAILED'
    throw error
  }
  return result
}

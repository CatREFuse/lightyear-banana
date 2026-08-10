import { existsSync, renameSync, rmSync } from 'node:fs'

const defaultOperations = {
  exists: existsSync,
  rename: renameSync,
  remove(filePath) {
    rmSync(filePath, { force: true })
  }
}

export function publishReleaseFileSet(entries, operationOverrides = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('A release file set must contain at least one entry.')
  }

  const operations = { ...defaultOperations, ...operationOverrides }
  const allPaths = entries.flatMap((entry) => [entry.temporaryPath, entry.finalPath, entry.backupPath])
  if (allPaths.some((filePath) => typeof filePath !== 'string' || !filePath)) {
    throw new Error('Every release file entry must define temporary, final, and backup paths.')
  }
  if (new Set(allPaths).size !== allPaths.length) {
    throw new Error('Release file temporary, final, and backup paths must be unique.')
  }

  for (const entry of entries) {
    if (!operations.exists(entry.temporaryPath)) {
      throw new Error(`Release temporary file is missing: ${entry.temporaryPath}`)
    }
    if (operations.exists(entry.backupPath)) {
      throw new Error(`Release backup path already exists: ${entry.backupPath}`)
    }
  }

  const backedUp = []
  const activated = []

  try {
    for (const entry of entries) {
      if (!operations.exists(entry.finalPath)) continue
      operations.rename(entry.finalPath, entry.backupPath)
      backedUp.push(entry)
    }

    for (const entry of entries) {
      operations.rename(entry.temporaryPath, entry.finalPath)
      activated.push(entry)
    }
  } catch (error) {
    const restorationErrors = []
    for (const entry of [...activated].reverse()) {
      try {
        operations.remove(entry.finalPath)
      } catch (restorationError) {
        restorationErrors.push(restorationError)
      }
    }
    for (const entry of [...backedUp].reverse()) {
      try {
        if (operations.exists(entry.finalPath)) operations.remove(entry.finalPath)
        operations.rename(entry.backupPath, entry.finalPath)
      } catch (restorationError) {
        restorationErrors.push(restorationError)
      }
    }

    if (restorationErrors.length) {
      throw new AggregateError(
        [error, ...restorationErrors],
        'Publishing the release file set failed and its previous state could not be fully restored.',
        { cause: error }
      )
    }
    throw error
  }

  const cleanupErrors = []
  for (const entry of backedUp) {
    try {
      operations.remove(entry.backupPath)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  return cleanupErrors
}

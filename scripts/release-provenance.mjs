import { execFileSync } from 'node:child_process'

function runGit(projectRoot, args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true
  })
}

export function resolveReleaseProvenance(projectRoot, executeGit = runGit) {
  const sourceCommit = executeGit(projectRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).trim().toLowerCase()
  if (!/^[0-9a-f]{40,64}$/.test(sourceCommit)) {
    throw new Error('CCX packaging requires a valid Git HEAD commit.')
  }

  const worktreeStatus = executeGit(projectRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all'
  ]).trim()
  if (worktreeStatus) {
    const preview = worktreeStatus.split(/\r?\n/).slice(0, 20).join('\n')
    throw new Error(
      'CCX packaging requires a clean Git worktree, including tracked and untracked source files.\n' +
      preview
    )
  }

  return { sourceCommit, dirty: false }
}

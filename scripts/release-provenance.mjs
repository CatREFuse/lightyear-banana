import { execFileSync } from 'node:child_process'

function runGit(projectRoot, args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true
  })
}

export function inspectGitProvenance(projectRoot, executeGit = runGit) {
  const sourceCommit = executeGit(projectRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).trim().toLowerCase()
  if (!/^[0-9a-f]{40,64}$/.test(sourceCommit)) {
    throw new Error('Build provenance requires a valid Git HEAD commit.')
  }

  const worktreeStatus = executeGit(projectRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all'
  ]).trimEnd()
  return {
    sourceCommit,
    dirty: Boolean(worktreeStatus),
    worktreeStatus
  }
}

export function resolveReleaseProvenance(projectRoot, executeGit = runGit) {
  const provenance = inspectGitProvenance(projectRoot, executeGit)
  if (provenance.dirty) {
    const preview = provenance.worktreeStatus.split(/\r?\n/).slice(0, 20).join('\n')
    throw new Error(
      'CCX packaging requires a clean Git worktree, including tracked and untracked source files.\n' +
      preview
    )
  }

  return { sourceCommit: provenance.sourceCommit, dirty: false }
}

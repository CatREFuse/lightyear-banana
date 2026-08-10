import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveReleaseProvenance } from './release-provenance.mjs'

function gitResult(commit, status = '') {
  return (_projectRoot, args) => args[0] === 'rev-parse' ? `${commit}\n` : status
}

test('returns a verified clean Git provenance record', () => {
  const sourceCommit = 'a'.repeat(40)
  assert.deepEqual(resolveReleaseProvenance('repo', gitResult(sourceCommit)), {
    sourceCommit,
    dirty: false
  })
})

test('rejects an invalid Git HEAD', () => {
  assert.throws(
    () => resolveReleaseProvenance('repo', gitResult('not-a-commit')),
    /valid Git HEAD/
  )
})

test('rejects tracked and untracked worktree changes', () => {
  assert.throws(
    () => resolveReleaseProvenance('repo', gitResult('b'.repeat(40), ' M src/main.ts\n?? new-file.ts\n')),
    /clean Git worktree[\s\S]*src\/main\.ts[\s\S]*new-file\.ts/
  )
})

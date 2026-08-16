import assert from 'node:assert/strict'
import test from 'node:test'

import { reviewChecksum } from '../src/review-format'
import {
  discoverVerifiedReviewProjectContext,
  normalizeRepositoryRemote
} from '../src/review-project-context'

function artifact(
  source: string,
  sourcePath: string | null = '/repo/docs/plan.md'
): ReviewArtifact {
  return {
    sourceDocument: {
      name: 'plan.md',
      path: sourcePath,
      content: source,
      checksum: reviewChecksum(source)
    },
    review: { id: 'mko_verify01' }
  } as ReviewArtifact
}

test('derives private remote identity only from a matching live source', async () => {
  const calls: string[] = []
  const review = artifact('# Plan\n')
  assert.deepEqual(await discoverVerifiedReviewProjectContext(review, {
    readSource(sourcePath) {
      calls.push(`read:${sourcePath}`)
      return Promise.resolve('# Plan\n')
    },
    discoverRepository(sourcePath) {
      calls.push(`git:${sourcePath}`)
      return Promise.resolve({
        root: '/worktrees/markover-one',
        remoteUrl: 'git@github.com:Lastobelus/Markover.git',
        commonGitDirectory: '/repos/markover/.git'
      })
    }
  }), {
    key: 'remote:github.com/lastobelus/markover',
    name: 'markover',
    root: '/worktrees/markover-one'
  })
  assert.deepEqual(calls, [
    'read:/repo/docs/plan.md',
    'git:/repo/docs/plan.md'
  ])
})

test('normalizes clone transports while preserving fork ownership', () => {
  assert.equal(
    normalizeRepositoryRemote('git@github.com:Lastobelus/Markover.git'),
    'github.com/lastobelus/markover'
  )
  assert.equal(
    normalizeRepositoryRemote('https://github.com/lastobelus/markover/'),
    'github.com/lastobelus/markover'
  )
  assert.equal(
    normalizeRepositoryRemote('ssh://git@github.com/lastobelus/markover.git'),
    'github.com/lastobelus/markover'
  )
  assert.equal(
    normalizeRepositoryRemote('git@github.com:fork-owner/markover.git'),
    'github.com/fork-owner/markover'
  )
  assert.equal(normalizeRepositoryRemote('/repos/markover.git'), null)
  assert.equal(normalizeRepositoryRemote('file:///repos/markover.git'), null)
})

test('groups independent clones, keeps forks distinct, and falls back finitely', async () => {
  const review = artifact('# Plan\n')
  const project = (
    root: string,
    remoteUrl: string | null,
    commonGitDirectory: string | null
  ) => discoverVerifiedReviewProjectContext(review, {
    readSource: () => Promise.resolve('# Plan\n'),
    discoverRepository: () => Promise.resolve({
      root,
      remoteUrl,
      commonGitDirectory
    })
  })

  const cloneOne = await project(
    '/clones/markover-one',
    'git@github.com:lastobelus/markover.git',
    '/clones/markover-one/.git'
  )
  const cloneTwo = await project(
    '/clones/markover-two',
    'https://github.com/lastobelus/markover',
    '/clones/markover-two/.git'
  )
  const fork = await project(
    '/clones/markover-fork',
    'git@github.com:fork-owner/markover.git',
    '/clones/markover-fork/.git'
  )
  assert.equal(cloneOne?.key, cloneTwo?.key)
  assert.notEqual(cloneOne?.key, fork?.key)

  const linkedOne = await project(
    '/worktrees/local-one',
    null,
    '/repos/local/.git'
  )
  const linkedTwo = await project(
    '/worktrees/local-two',
    '/repos/local.git',
    '/repos/local/.git'
  )
  assert.equal(linkedOne?.key, linkedTwo?.key)
  assert.equal(linkedOne?.key, 'git:/repos/local/.git')
  assert.equal(linkedOne.name, 'local')
  assert.equal(
    (await project('/clones/root-only', null, null))?.key,
    'root:/clones/root-only'
  )
})

test('stale, missing, and non-file source locators yield no project evidence', async () => {
  let discoveryCalls = 0
  const discoverRepository = () => {
    discoveryCalls += 1
    return Promise.resolve({
      root: '/unrelated',
      remoteUrl: null,
      commonGitDirectory: null
    })
  }
  assert.equal(await discoverVerifiedReviewProjectContext(artifact('# Original\n'), {
    readSource: () => Promise.resolve('# Replaced\n'),
    discoverRepository
  }), null)
  assert.equal(await discoverVerifiedReviewProjectContext(artifact('# Original\n'), {
    readSource: () => Promise.reject(new Error('missing')),
    discoverRepository
  }), null)
  assert.equal(await discoverVerifiedReviewProjectContext(
    artifact('# Original\n', null),
    { discoverRepository }
  ), null)
  assert.equal(discoveryCalls, 0)
})

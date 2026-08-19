import assert from 'node:assert/strict'
import test from 'node:test'

import { reviewChecksum } from '../src/review-format'
import {
  discoverReviewProjectContext,
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

test('derives live project identity and source freshness independently', async () => {
  const calls: string[] = []
  const review = artifact('# Plan\n')
  review.review.git = {
    repositoryUrl: 'https://github.com/lastobelus/markover/'
  }
  assert.deepEqual(await discoverReviewProjectContext(review, {
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
    project: {
      key: 'remote:github.com/lastobelus/markover',
      name: 'markover',
      root: '/worktrees/markover-one'
    },
    projectEvidence: 'verified',
    sourceState: 'unchanged'
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
  assert.equal(
    normalizeRepositoryRemote('alice@example.com:project.git'),
    'example.com/project'
  )
  assert.equal(
    normalizeRepositoryRemote('ssh://bob@example.com/project.git'),
    'example.com/project'
  )
  assert.equal(
    normalizeRepositoryRemote('alice@example.com:project.git'),
    normalizeRepositoryRemote('bob@example.com:project.git')
  )
  assert.equal(normalizeRepositoryRemote('/repos/markover.git'), null)
  assert.equal(normalizeRepositoryRemote('file:///repos/markover.git'), null)
})

test('sanitized and live URL-form SSH origins retain one project', async () => {
  const review = artifact('# Original\n')
  review.review.git = {
    repositoryUrl: 'ssh://gitlab.com/group/repo.git'
  }
  assert.deepEqual(await discoverReviewProjectContext(review, {
    readSource: () => Promise.resolve('# Original\n'),
    discoverRepository: () => Promise.resolve({
      root: '/worktrees/repo',
      remoteUrl: 'ssh://git@gitlab.com/group/repo.git',
      commonGitDirectory: '/worktrees/repo/.git'
    })
  }), {
    project: {
      key: 'remote:gitlab.com/group/repo',
      name: 'repo',
      root: '/worktrees/repo'
    },
    projectEvidence: 'verified',
    sourceState: 'unchanged'
  })
})

test('groups independent clones, keeps forks distinct, and falls back finitely', async () => {
  const review = artifact('# Plan\n')
  const project = (
    root: string,
    remoteUrl: string | null,
    commonGitDirectory: string | null
  ) => discoverReviewProjectContext(review, {
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
  assert.equal(cloneOne.project?.key, cloneTwo.project?.key)
  assert.notEqual(cloneOne.project?.key, fork.project?.key)

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
  assert.equal(linkedOne.project?.key, linkedTwo.project?.key)
  assert.equal(linkedOne.project?.key, 'git:/repos/local/.git')
  assert.equal(linkedOne.project.name, 'local')
  assert.equal(
    (await project('/clones/root-only', null, null)).project?.key,
    'root:/clones/root-only'
  )
})

test('changed and missing sources retain live project evidence', async () => {
  let discoveryCalls = 0
  const discoverRepository = () => {
    discoveryCalls += 1
    return Promise.resolve({
      root: '/unrelated',
      remoteUrl: null,
      commonGitDirectory: null
    })
  }
  assert.deepEqual(await discoverReviewProjectContext(artifact('# Original\n'), {
    readSource: () => Promise.resolve('# Replaced\n'),
    discoverRepository
  }), {
    project: {
      key: 'root:/unrelated',
      name: 'unrelated',
      root: '/unrelated'
    },
    projectEvidence: 'verified',
    sourceState: 'changed'
  })
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
  assert.deepEqual(await discoverReviewProjectContext(artifact('# Original\n'), {
    readSource: () => Promise.reject(missing),
    discoverRepository
  }), {
    project: {
      key: 'root:/unrelated',
      name: 'unrelated',
      root: '/unrelated'
    },
    projectEvidence: 'verified',
    sourceState: 'missing'
  })
  assert.deepEqual(await discoverReviewProjectContext(
    artifact('# Original\n', null),
    { discoverRepository }
  ), {
    project: null,
    projectEvidence: 'unavailable',
    sourceState: 'unavailable'
  })
  assert.equal(discoveryCalls, 2)
})

test('unreadable source retains live project evidence', async () => {
  const review = artifact('# Original\n')
  assert.deepEqual(await discoverReviewProjectContext(review, {
    readSource: () => Promise.reject(new Error('permission denied')),
    discoverRepository: () => Promise.resolve({
      root: '/worktrees/markover',
      remoteUrl: 'git@github.com:lastobelus/markover.git',
      commonGitDirectory: '/worktrees/markover/.git'
    })
  }), {
    project: {
      key: 'remote:github.com/lastobelus/markover',
      name: 'markover',
      root: '/worktrees/markover'
    },
    projectEvidence: 'verified',
    sourceState: 'unavailable'
  })
})

test('keeps source state truthful when live repository evidence is unavailable', async () => {
  assert.deepEqual(await discoverReviewProjectContext(artifact('# Original\n'), {
    readSource: () => Promise.resolve('# Replaced\n'),
    discoverRepository: () => Promise.resolve(null)
  }), {
    project: null,
    projectEvidence: 'unavailable',
    sourceState: 'changed'
  })
})

test('fails closed when opening and live repository origins conflict', async () => {
  const review = artifact('# Original\n')
  review.review.git = {
    repositoryUrl: 'git@github.com:lastobelus/markover.git'
  }
  assert.deepEqual(await discoverReviewProjectContext(review, {
    readSource: () => Promise.resolve('# Replaced\n'),
    discoverRepository: () => Promise.resolve({
      root: '/worktrees/replacement',
      remoteUrl: 'https://github.com/other/replacement.git',
      commonGitDirectory: '/worktrees/replacement/.git'
    })
  }), {
    project: null,
    projectEvidence: 'conflict',
    sourceState: 'changed'
  })
})

test('a null source locator performs no source or repository I/O', async () => {
  let calls = 0
  assert.deepEqual(await discoverReviewProjectContext(
    artifact('# Original\n', null),
    {
      readSource: () => {
        calls += 1
        return Promise.resolve('# Original\n')
      },
      discoverRepository: () => {
        calls += 1
        return Promise.resolve(null)
      }
    }
  ), {
    project: null,
    projectEvidence: 'unavailable',
    sourceState: 'unavailable'
  })
  assert.equal(calls, 0)
})

test('remote-agent origin makes a colliding local path unavailable without I/O', async () => {
  let calls = 0
  const review = artifact('# Remote source\n', '/repo/docs/plan.md')
  review.review.origin = 'remote-agent'
  review.review.git = {
    repositoryUrl: 'https://github.com/lastobelus/markover'
  }
  assert.deepEqual(await discoverReviewProjectContext(review, {
    readSource: () => {
      calls += 1
      return Promise.resolve('# Different local source\n')
    },
    discoverRepository: () => {
      calls += 1
      return Promise.resolve({
        root: '/repo',
        remoteUrl: 'https://github.com/lastobelus/markover',
        commonGitDirectory: '/repo/.git'
      })
    }
  }), {
    project: null,
    projectEvidence: 'unavailable',
    sourceState: 'unavailable'
  })
  assert.equal(calls, 0)
})

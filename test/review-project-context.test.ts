import assert from 'node:assert/strict'
import test from 'node:test'

import { reviewChecksum } from '../src/review-format'
import { discoverVerifiedReviewProjectRoot } from '../src/review-project-context'

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

test('derives private project context only from a matching live source', async () => {
  const calls: string[] = []
  const review = artifact('# Plan\n')
  assert.equal(await discoverVerifiedReviewProjectRoot(review, {
    readSource(sourcePath) {
      calls.push(`read:${sourcePath}`)
      return Promise.resolve('# Plan\n')
    },
    discoverRoot(sourcePath) {
      calls.push(`git:${sourcePath}`)
      return Promise.resolve('/repo')
    }
  }), '/repo')
  assert.deepEqual(calls, [
    'read:/repo/docs/plan.md',
    'git:/repo/docs/plan.md'
  ])
})

test('stale, missing, and non-file source locators yield no project evidence', async () => {
  let discoveryCalls = 0
  const discoverRoot = () => {
    discoveryCalls += 1
    return Promise.resolve('/unrelated')
  }
  assert.equal(await discoverVerifiedReviewProjectRoot(artifact('# Original\n'), {
    readSource: () => Promise.resolve('# Replaced\n'),
    discoverRoot
  }), null)
  assert.equal(await discoverVerifiedReviewProjectRoot(artifact('# Original\n'), {
    readSource: () => Promise.reject(new Error('missing')),
    discoverRoot
  }), null)
  assert.equal(await discoverVerifiedReviewProjectRoot(
    artifact('# Original\n', null),
    { discoverRoot }
  ), null)
  assert.equal(discoveryCalls, 0)
})

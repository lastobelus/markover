import assert from 'node:assert/strict'
import test from 'node:test'

import { restoreReviewProjectContexts } from '../src/review-project-context'

test('review restoration bounds project discovery and preserves order', async () => {
  const artifacts = Array.from({ length: 11 }, (_, index) => ({
    review: { id: `mko_restore${String(index)}` }
  })) as ReviewArtifact[]
  let active = 0
  let maximumActive = 0

  const contexts = await restoreReviewProjectContexts(
    artifacts,
    async (artifact) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise<void>((resolve) => setImmediate(resolve))
      active -= 1
      return {
        key: artifact.review.id,
        name: artifact.review.id,
        root: null
      }
    }
  )

  assert.equal(maximumActive, 4)
  assert.deepEqual(
    contexts.map((context) => context?.key),
    artifacts.map((artifact) => artifact.review.id)
  )
})

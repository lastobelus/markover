import assert from 'node:assert/strict'
import test from 'node:test'

import { copyCanonicalReviewLink } from '../src/review-link-copy'

test('copies the exact canonical review URL', async () => {
  const writes: string[] = []
  const outcome = await copyCanonicalReviewLink('mko_aaa11111', {
    writeText: (text) => { writes.push(text) },
    chooseAfterFailure: () => Promise.resolve('cancel')
  })

  assert.equal(outcome, 'copied')
  assert.deepEqual(writes, ['markover://review/mko_aaa11111'])
})

test('offers a retry with the canonical URL after clipboard failure', async () => {
  const writes: string[] = []
  const failures: Array<{ message: string; url: string }> = []
  const outcome = await copyCanonicalReviewLink('mko_bbb22222', {
    writeText: (text) => {
      writes.push(text)
      if (writes.length === 1) throw new Error('Clipboard unavailable')
    },
    chooseAfterFailure: (failure) => {
      failures.push(failure)
      return Promise.resolve('retry')
    }
  })

  assert.equal(outcome, 'copied')
  assert.deepEqual(writes, [
    'markover://review/mko_bbb22222',
    'markover://review/mko_bbb22222'
  ])
  assert.deepEqual(failures, [{
    message: 'Clipboard unavailable',
    url: 'markover://review/mko_bbb22222'
  }])
})

test('leaves a failed copy cancelled when the user declines retry', async () => {
  const outcome = await copyCanonicalReviewLink('mko_ccc33333', {
    writeText: () => { throw new Error('Clipboard unavailable') },
    chooseAfterFailure: () => Promise.resolve('cancel')
  })

  assert.equal(outcome, 'cancelled')
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendIncomingReview,
  incomingReviewAction,
  removeIncomingReview,
  retainIncomingReviewsAfter
} from '../src/incoming-review-policy'

const focused: MarkoverWindowFocusState = {
  focused: true,
  blurredAt: null
}

test('an incoming review activates when no document is open for every policy', () => {
  for (const policy of ['never', 'always', 'warn', 'when-idle'] as const) {
    assert.equal(incomingReviewAction({
      focusState: focused,
      hasActiveDocument: false,
      idleMinutes: 5,
      now: 1_000_000,
      policy
    }), 'activate')
  }
})

test('never notifies, always activates, and warn asks before replacing', () => {
  const base = {
    focusState: focused,
    hasActiveDocument: true,
    idleMinutes: 5,
    now: 1_000_000
  }
  assert.equal(incomingReviewAction({ ...base, policy: 'never' }), 'notify')
  assert.equal(incomingReviewAction({ ...base, policy: 'always' }), 'activate')
  assert.equal(incomingReviewAction({ ...base, policy: 'warn' }), 'warn')
})

test('idle activation requires Markover to be backgrounded for the full duration', () => {
  const base = {
    hasActiveDocument: true,
    idleMinutes: 5,
    now: 1_000_000,
    policy: 'when-idle' as const
  }
  assert.equal(incomingReviewAction({
    ...base,
    focusState: focused
  }), 'notify')
  assert.equal(incomingReviewAction({
    ...base,
    focusState: { focused: false, blurredAt: 700_001 }
  }), 'notify')
  assert.equal(incomingReviewAction({
    ...base,
    focusState: { focused: false, blurredAt: 700_000 }
  }), 'activate')
})

test('concurrent arrivals consolidate while retaining the newest review action', () => {
  const first = appendIncomingReview([], 'mko_first', 1)
  const batch = appendIncomingReview(first, 'mko_latest', 2)
  assert.deepEqual(batch, [
    { reviewId: 'mko_first', sequence: 1 },
    { reviewId: 'mko_latest', sequence: 2 }
  ])
  assert.deepEqual(removeIncomingReview(batch, 'mko_latest'), first)
})

test('activation clears older prompts without dismissing newer arrivals', () => {
  const prompts = [
    { reviewId: 'mko_first', sequence: 1 },
    { reviewId: 'mko_activated', sequence: 2 },
    { reviewId: 'mko_newer', sequence: 3 }
  ]
  assert.deepEqual(retainIncomingReviewsAfter(prompts, 2), [prompts[2]])
})

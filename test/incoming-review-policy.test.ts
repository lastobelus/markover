import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendIncomingReview,
  incomingReviewAction
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
  const first = appendIncomingReview(null, 'mko_first')
  assert.deepEqual(first, {
    count: 1,
    latestReviewId: 'mko_first'
  })
  assert.deepEqual(appendIncomingReview(first, 'mko_latest'), {
    count: 2,
    latestReviewId: 'mko_latest'
  })
})

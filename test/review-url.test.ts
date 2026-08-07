import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isReviewInstanceScheme,
  parseReviewUrl,
  reviewUrl
} from '../src/review-url'

test('constructs canonical and PR-scoped review URLs', () => {
  assert.equal(
    reviewUrl('markover', 'mko_aaa11111'),
    'markover://review/mko_aaa11111'
  )
  assert.equal(
    reviewUrl('markover-76', 'mko_bbb22222'),
    'markover-76://review/mko_bbb22222'
  )
  assert.equal(isReviewInstanceScheme('markover'), true)
  assert.equal(isReviewInstanceScheme('markover-76'), true)
  assert.equal(isReviewInstanceScheme('markover-0'), false)
})

test('parses only the exact review route for the expected instance', () => {
  assert.deepEqual(
    parseReviewUrl('markover-76://review/mko_aaa11111', 'markover-76'),
    {
      reviewId: 'mko_aaa11111',
      scheme: 'markover-76',
      url: 'markover-76://review/mko_aaa11111'
    }
  )
  assert.equal(
    parseReviewUrl('markover-76://review/mko_aaa11111', 'markover'),
    null
  )
})

test('rejects alternate authorities, actions, encodings, queries, and fragments', () => {
  const invalid = [
    'MARKOVER://review/mko_aaa11111',
    'markover:/review/mko_aaa11111',
    'markover://other/mko_aaa11111',
    'markover://user@review/mko_aaa11111',
    'markover://review:80/mko_aaa11111',
    'markover://review/mko_aaa11111/edit',
    'markover://review/mko_aaa11111/',
    'markover://review/mko_aaa11111?source=agent',
    'markover://review/mko_aaa11111#block',
    'markover://review/mko_%61aa11111',
    'markover://review/not-a-review',
    'markover-01://review/mko_aaa11111',
    'markover-dev://review/mko_aaa11111'
  ]
  for (const candidate of invalid) {
    assert.equal(parseReviewUrl(candidate), null, candidate)
  }
  assert.throws(() => reviewUrl('https', 'mko_aaa11111'), /Invalid Markover/)
  assert.throws(() => reviewUrl('markover', 'missing'), /Invalid review ID/)
})

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import path from 'node:path'
import test from 'node:test'

import {
  arbitrateReviewError,
  arbitrateReviewSnapshot,
  arbitrateTitleObservation,
  futureInboxThreadKey,
  parseReviewEnrichment,
  parseThreadEnrichment,
  PRIVATE_ENRICHMENT_VERSION,
  PrivateEnrichmentFormatError,
  projectKey,
  resolvedThreadTitle,
  REVIEW_ENRICHMENT_FORMAT,
  reviewEnrichmentProjection,
  stableThreadIdentity,
  THREAD_ENRICHMENT_FORMAT,
  threadIdentityDigest,
  type EnrichmentProjectionError,
  type ReviewEnrichmentFile,
  type ReviewEnrichmentSnapshot,
  type StableThreadIdentity,
  type ThreadEnrichmentFile,
  type ThreadTitleObservation
} from '../src/private-enrichment'

const firstTime = '2026-08-12T12:00:00.000Z'
const secondTime = '2026-08-12T12:01:00.000Z'
const thirdTime = '2026-08-12T12:02:00.000Z'

function snapshot(
  observedAt = firstTime,
  canonicalPath = path.resolve('/projects/markover/doc/plan.md')
): ReviewEnrichmentSnapshot {
  return {
    observedAt,
    source: {
      canonicalPath,
      verifiedChecksum: `sha256:${'a'.repeat(64)}`
    },
    repository: {
      identityKind: 'remote',
      identity: 'https://github.com/lastobelus/markover',
      checkoutRoot: path.resolve('/projects/markover'),
      repositoryRelativePath: 'doc/plan.md',
      projectName: 'markover'
    }
  }
}

function reviewFile(
  value = snapshot()
): ReviewEnrichmentFile {
  return {
    format: REVIEW_ENRICHMENT_FORMAT,
    version: PRIVATE_ENRICHMENT_VERSION,
    reviewId: 'mko_review1',
    snapshot: value,
    error: null
  }
}

function identity(): StableThreadIdentity {
  return { threadHostKind: 't3code', threadId: 'thread-123' }
}

function observation(
  sourceKey: string,
  authority: 'thread-host' | 'provider',
  title: string,
  observedAt: string
): ThreadTitleObservation {
  return { sourceKey, authority, title, observedAt }
}

function threadFile(): ThreadEnrichmentFile {
  return {
    format: THREAD_ENRICHMENT_FORMAT,
    version: PRIVATE_ENRICHMENT_VERSION,
    identity: identity(),
    titleObservations: [
      observation('codex', 'provider', 'Provider title', thirdTime),
      observation('t3code', 'thread-host', 'Thread-host title', firstTime)
    ]
  }
}

test('strict private formats accept exact values and reject additions', () => {
  assert.deepEqual(parseReviewEnrichment(reviewFile()), reviewFile())
  assert.deepEqual(parseThreadEnrichment(threadFile()), threadFile())

  const extraReview = { ...reviewFile(), future: true }
  assert.throws(
    () => parseReviewEnrichment(extraReview),
    PrivateEnrichmentFormatError
  )
  const duplicateSources = threadFile()
  duplicateSources.titleObservations.push(
    observation('codex', 'provider', 'Duplicate', thirdTime)
  )
  assert.throws(
    () => parseThreadEnrichment(duplicateSources),
    /unique sourceKey/
  )
})

test('review private format enforces repository and error coherence', () => {
  const escaping = reviewFile()
  assert.ok(escaping.snapshot.repository)
  escaping.snapshot.repository.repositoryRelativePath = '../outside.md'
  assert.throws(() => parseReviewEnrichment(escaping), /contained/)

  const wrongCheckoutIdentity = reviewFile()
  assert.ok(wrongCheckoutIdentity.snapshot.repository)
  wrongCheckoutIdentity.snapshot.repository.identityKind = 'checkout-root'
  wrongCheckoutIdentity.snapshot.repository.identity = path.resolve('/other')
  assert.throws(
    () => parseReviewEnrichment(wrongCheckoutIdentity),
    /equal checkoutRoot/
  )

  const staleError = reviewFile()
  staleError.error = {
    code: 'source-missing',
    observedAt: firstTime,
    detail: 'Stale.'
  }
  assert.throws(() => parseReviewEnrichment(staleError), /must be newer/)
})

test('stable thread identity prefers host ID, accepts equality, and excludes provider', () => {
  const fallback = stableThreadIdentity({
    id: 'provider-id',
    threadHost: { kind: 't3code', provider: 'codex' }
  })
  const distinct = stableThreadIdentity({
    id: 'provider-id',
    threadHost: {
      kind: 't3code',
      provider: 'codex',
      threadId: 'host-id'
    }
  })
  const equal = stableThreadIdentity({
    id: 'provider-id',
    threadHost: {
      kind: 't3code',
      provider: 'claude',
      threadId: 'provider-id'
    }
  })
  assert.deepEqual(fallback, { threadHostKind: 't3code', threadId: 'provider-id' })
  assert.deepEqual(distinct, { threadHostKind: 't3code', threadId: 'host-id' })
  assert.deepEqual(equal, fallback)
  assert.equal(stableThreadIdentity(null), null)
  assert.equal(threadIdentityDigest(equal), threadIdentityDigest(
    fallback
  ))
})

test('thread digest uses exact JSON UTF-8 encoding and future key prefix', () => {
  const value = identity()
  const expected = createHash('sha256')
    .update(JSON.stringify(['t3code', 'thread-123']), 'utf8')
    .digest('hex')
  assert.equal(threadIdentityDigest(value), expected)
  assert.equal(futureInboxThreadKey(value), `agent:${expected}`)
})

test('review snapshots reject stale/conflicting observations and retain later errors', () => {
  const initial = arbitrateReviewSnapshot(null, 'mko_review1', snapshot())
  assert.equal(initial.outcome, 'write')
  assert.ok(initial.value)

  const replay = arbitrateReviewSnapshot(initial.value, 'mko_review1', snapshot())
  assert.equal(replay.outcome, 'idempotent')
  const conflict = arbitrateReviewSnapshot(
    initial.value,
    'mko_review1',
    snapshot(firstTime, path.resolve('/projects/markover/doc/other.md'))
  )
  assert.equal(conflict.outcome, 'conflict')

  const failed = arbitrateReviewError(
    initial.value,
    firstTime,
    'repository-unavailable',
    thirdTime
  )
  assert.equal(failed.outcome, 'write')
  assert.equal(failed.value.error?.detail.includes('repository'), true)

  const middleSuccess = arbitrateReviewSnapshot(
    failed.value,
    'mko_review1',
    snapshot(secondTime)
  )
  assert.equal(middleSuccess.outcome, 'write')
  assert.equal(middleSuccess.value.error?.observedAt, thirdTime)
})

test('review errors require the expected current snapshot generation', () => {
  const current = reviewFile(snapshot(secondTime))
  const lateOldFailure = arbitrateReviewError(
    current,
    firstTime,
    'source-changed',
    thirdTime
  )
  assert.equal(lateOldFailure.outcome, 'ignored')
  assert.equal(lateOldFailure.value?.error, null)

  const currentFailure = arbitrateReviewError(
    current,
    secondTime,
    'source-changed',
    thirdTime
  )
  assert.equal(currentFailure.outcome, 'write')
  const replay = arbitrateReviewError(
    currentFailure.value,
    secondTime,
    'source-changed',
    thirdTime
  )
  assert.equal(replay.outcome, 'idempotent')
  const conflict = arbitrateReviewError(
    currentFailure.value,
    secondTime,
    'source-missing',
    thirdTime
  )
  assert.equal(conflict.outcome, 'conflict')
  assert.equal(arbitrateReviewError(
    null,
    null,
    'source-missing',
    thirdTime
  ).outcome, 'ignored')
})

test('title observations arbitrate per source and resolve by authority then recency', () => {
  const first = arbitrateTitleObservation(
    null,
    identity(),
    observation('codex', 'provider', 'Provider title', thirdTime)
  )
  assert.equal(first.outcome, 'write')
  const host = arbitrateTitleObservation(
    first.value,
    identity(),
    observation('t3code', 'thread-host', 'Host title', firstTime)
  )
  assert.equal(resolvedThreadTitle(host.value)?.title, 'Host title')

  const stale = arbitrateTitleObservation(
    host.value,
    identity(),
    observation('codex', 'provider', 'Old provider title', firstTime)
  )
  assert.equal(stale.outcome, 'ignored')
  const conflict = arbitrateTitleObservation(
    host.value,
    identity(),
    observation('t3code', 'thread-host', 'Other host title', firstTime)
  )
  assert.equal(conflict.outcome, 'conflict')
})

test('projection derives project key and applies runtime error precedence', () => {
  const review = reviewFile()
  review.error = {
    code: 'source-missing',
    observedAt: secondTime,
    detail: 'The previously verified source path no longer exists.'
  }
  const runtime: EnrichmentProjectionError = {
    code: 'private-write-failed',
    observedAt: thirdTime,
    detail: 'Private state could not be saved.'
  }
  const projection = reviewEnrichmentProjection(review, threadFile(), runtime)
  assert.ok(review.snapshot.repository)
  assert.equal(projection.project?.key, projectKey(review.snapshot.repository))
  assert.equal(projection.requestingThreadTitle?.title, 'Thread-host title')
  assert.equal(projection.error?.code, 'private-write-failed')
})

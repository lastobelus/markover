import { createHash } from 'node:crypto'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import {
  isCanonicalReviewTimestamp,
  isPortableRepositoryUrl
} from './review-format'

export const REVIEW_ENRICHMENT_FORMAT =
  'markover-review-enrichment' as const
export const THREAD_ENRICHMENT_FORMAT =
  'markover-thread-enrichment' as const
export const PRIVATE_ENRICHMENT_VERSION = 1 as const

const REVIEW_ID_PATTERN = /^mko_[a-zA-Z0-9]{6,32}$/
const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/
const REVIEW_ERROR_CODES = new Set<ReviewEnrichmentErrorCode>([
  'source-missing',
  'source-changed',
  'repository-unavailable'
])
const REPOSITORY_IDENTITY_KINDS = new Set<RepositoryIdentityKind>([
  'remote',
  'common-git-directory',
  'checkout-root'
])
const TITLE_AUTHORITIES = new Set<ThreadTitleAuthority>([
  'thread-host',
  'provider'
])

export type RepositoryIdentityKind =
  | 'remote'
  | 'common-git-directory'
  | 'checkout-root'

export type ReviewEnrichmentErrorCode =
  | 'source-missing'
  | 'source-changed'
  | 'repository-unavailable'

export type RuntimeEnrichmentErrorCode =
  | 'invalid-private-state'
  | 'private-write-failed'

export type ThreadTitleAuthority = 'thread-host' | 'provider'

export interface ReviewSourceSnapshot {
  canonicalPath: string
  verifiedChecksum: string
}

export interface ReviewRepositorySnapshot {
  identityKind: RepositoryIdentityKind
  identity: string
  checkoutRoot: string
  repositoryRelativePath: string
  projectName: string
}

export interface ReviewEnrichmentSnapshot {
  observedAt: string
  source: ReviewSourceSnapshot
  repository: ReviewRepositorySnapshot | null
}

export interface ReviewEnrichmentError {
  code: ReviewEnrichmentErrorCode
  observedAt: string
  detail: string
}

export interface ReviewEnrichmentFile {
  format: typeof REVIEW_ENRICHMENT_FORMAT
  version: typeof PRIVATE_ENRICHMENT_VERSION
  reviewId: string
  snapshot: ReviewEnrichmentSnapshot
  error: ReviewEnrichmentError | null
}

export interface StableThreadIdentity {
  threadHostKind: string
  threadId: string
}

export interface ThreadTitleObservation {
  sourceKey: string
  authority: ThreadTitleAuthority
  title: string
  observedAt: string
}

export interface ThreadEnrichmentFile {
  format: typeof THREAD_ENRICHMENT_FORMAT
  version: typeof PRIVATE_ENRICHMENT_VERSION
  identity: StableThreadIdentity
  titleObservations: ThreadTitleObservation[]
}

export interface EnrichmentProjectionError {
  code: ReviewEnrichmentErrorCode | RuntimeEnrichmentErrorCode
  observedAt: string
  detail: string
}

export interface ReviewEnrichmentProjection {
  project: null | {
    key: string
    name: string
    root: string | null
    repositoryRelativePath: string | null
  }
  requestingThreadTitle: null | ThreadTitleObservation
  error: EnrichmentProjectionError | null
}

export type EnrichmentArbitration<T> =
  | { outcome: 'write'; value: T }
  | { outcome: 'idempotent'; value: T }
  | { outcome: 'ignored'; value: T | null }
  | { outcome: 'conflict'; value: T | null }

export class PrivateEnrichmentFormatError extends Error {
  readonly code = 'INVALID_PRIVATE_ENRICHMENT'

  constructor(message: string) {
    super(message)
    this.name = 'PrivateEnrichmentFormatError'
  }
}

function invalid(message: string): never {
  throw new PrivateEnrichmentFormatError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const expected = new Set(keys)
  const actual = Object.keys(value)
  return actual.length === expected.size && actual.every((key) => expected.has(key))
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function normalizedAbsolute(value: unknown): value is string {
  return nonblank(value) && path.isAbsolute(value) && path.normalize(value) === value
}

function normalizedRelative(value: unknown): value is string {
  return nonblank(value) &&
    !path.isAbsolute(value) &&
    path.normalize(value) === value &&
    value !== '..' &&
    !value.startsWith(`..${path.sep}`)
}

export function compareCanonicalTimestamps(
  left: string,
  right: string
): -1 | 0 | 1 {
  const leftInstant = Date.parse(left)
  const rightInstant = Date.parse(right)
  return leftInstant === rightInstant ? 0 : leftInstant < rightInstant ? -1 : 1
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function assertSource(value: unknown): asserts value is ReviewSourceSnapshot {
  if (!exactRecord(value, ['canonicalPath', 'verifiedChecksum'])) {
    invalid('Private review source evidence has invalid fields.')
  }
  if (!normalizedAbsolute(value.canonicalPath)) {
    invalid('Private canonicalPath must be a normalized absolute path.')
  }
  if (
    typeof value.verifiedChecksum !== 'string' ||
    !CHECKSUM_PATTERN.test(value.verifiedChecksum)
  ) {
    invalid('Private verifiedChecksum is invalid.')
  }
}

function assertRepository(
  value: unknown
): asserts value is ReviewRepositorySnapshot | null {
  if (value === null) return
  if (!exactRecord(value, [
    'identityKind',
    'identity',
    'checkoutRoot',
    'repositoryRelativePath',
    'projectName'
  ])) invalid('Private repository evidence has invalid fields.')
  if (
    typeof value.identityKind !== 'string' ||
    !REPOSITORY_IDENTITY_KINDS.has(value.identityKind as RepositoryIdentityKind)
  ) invalid('Private repository identityKind is invalid.')
  if (!nonblank(value.identity) || !normalizedAbsolute(value.checkoutRoot)) {
    invalid('Private repository identity and checkoutRoot must be valid.')
  }
  if (!normalizedRelative(value.repositoryRelativePath)) {
    invalid('Private repositoryRelativePath must be normalized and contained.')
  }
  if (!nonblank(value.projectName)) {
    invalid('Private projectName must be nonblank.')
  }
  if (value.identityKind === 'remote') {
    if (!isPortableRepositoryUrl(value.identity)) {
      invalid('Private remote repository identity must be credential-free and portable.')
    }
  } else if (!normalizedAbsolute(value.identity)) {
    invalid('Private path repository identity must be normalized and absolute.')
  }
  if (
    value.identityKind === 'checkout-root' &&
    value.identity !== value.checkoutRoot
  ) invalid('checkout-root identity must equal checkoutRoot.')
}

function assertSnapshot(value: unknown): asserts value is ReviewEnrichmentSnapshot {
  if (!exactRecord(value, ['observedAt', 'source', 'repository'])) {
    invalid('Private review snapshot has invalid fields.')
  }
  if (!isCanonicalReviewTimestamp(value.observedAt)) {
    invalid('Private review snapshot observedAt must be canonical UTC.')
  }
  assertSource(value.source)
  assertRepository(value.repository)
}

function assertReviewError(
  value: unknown
): asserts value is ReviewEnrichmentError | null {
  if (value === null) return
  if (!exactRecord(value, ['code', 'observedAt', 'detail'])) {
    invalid('Private review error has invalid fields.')
  }
  if (
    typeof value.code !== 'string' ||
    !REVIEW_ERROR_CODES.has(value.code as ReviewEnrichmentErrorCode) ||
    !isCanonicalReviewTimestamp(value.observedAt) ||
    !nonblank(value.detail) ||
    value.detail !== reviewErrorDetail(value.code as ReviewEnrichmentErrorCode)
  ) invalid('Private review error is invalid.')
}

function assertThreadIdentity(
  value: unknown
): asserts value is StableThreadIdentity {
  if (!exactRecord(value, ['threadHostKind', 'threadId'])) {
    invalid('Private thread identity has invalid fields.')
  }
  if (!nonblank(value.threadHostKind) || !nonblank(value.threadId)) {
    invalid('Private thread identity values must be nonblank.')
  }
}

function assertTitleObservation(
  value: unknown
): asserts value is ThreadTitleObservation {
  if (!exactRecord(value, ['sourceKey', 'authority', 'title', 'observedAt'])) {
    invalid('Private title observation has invalid fields.')
  }
  if (
    !nonblank(value.sourceKey) ||
    typeof value.authority !== 'string' ||
    !TITLE_AUTHORITIES.has(value.authority as ThreadTitleAuthority) ||
    !nonblank(value.title) ||
    !isCanonicalReviewTimestamp(value.observedAt)
  ) invalid('Private title observation is invalid.')
}

export function parseReviewEnrichment(value: unknown): ReviewEnrichmentFile {
  if (!exactRecord(value, ['format', 'version', 'reviewId', 'snapshot', 'error'])) {
    invalid('Review enrichment uses an unsupported or invalid private format.')
  }
  if (
    value.format !== REVIEW_ENRICHMENT_FORMAT ||
    value.version !== PRIVATE_ENRICHMENT_VERSION ||
    typeof value.reviewId !== 'string' ||
    !REVIEW_ID_PATTERN.test(value.reviewId)
  ) invalid('Review enrichment uses an unsupported or invalid private format.')
  assertSnapshot(value.snapshot)
  assertReviewError(value.error)
  if (
    value.error &&
    compareCanonicalTimestamps(
      value.error.observedAt,
      value.snapshot.observedAt
    ) <= 0
  ) {
    invalid('A persisted review error must be newer than its successful snapshot.')
  }
  return clone(value as unknown as ReviewEnrichmentFile)
}

export function parseThreadEnrichment(value: unknown): ThreadEnrichmentFile {
  if (!exactRecord(value, ['format', 'version', 'identity', 'titleObservations'])) {
    invalid('Thread enrichment uses an unsupported or invalid private format.')
  }
  if (
    value.format !== THREAD_ENRICHMENT_FORMAT ||
    value.version !== PRIVATE_ENRICHMENT_VERSION ||
    !Array.isArray(value.titleObservations)
  ) invalid('Thread enrichment uses an unsupported or invalid private format.')
  assertThreadIdentity(value.identity)
  const sourceKeys: string[] = []
  for (const observation of value.titleObservations) {
    assertTitleObservation(observation)
    sourceKeys.push(observation.sourceKey)
  }
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    invalid('Private title observations require unique sourceKey values.')
  }
  return clone(value as unknown as ThreadEnrichmentFile)
}

export function stableThreadIdentity(
  agentThread: ReviewAgentThread | null
): StableThreadIdentity | null {
  if (!agentThread) return null
  return {
    threadHostKind: agentThread.threadHost.kind,
    threadId: agentThread.threadHost.threadId || agentThread.id
  }
}

export function threadIdentityDigest(identity: StableThreadIdentity): string {
  return createHash('sha256')
    .update(JSON.stringify([identity.threadHostKind, identity.threadId]), 'utf8')
    .digest('hex')
}

export function futureInboxThreadKey(identity: StableThreadIdentity): string {
  return `agent:${threadIdentityDigest(identity)}`
}

export function projectKey(repository: ReviewRepositorySnapshot): string {
  return `${repository.identityKind}:${repository.identity}`
}

export function reviewErrorDetail(code: ReviewEnrichmentErrorCode): string {
  switch (code) {
    case 'source-missing':
      return 'The previously verified source path no longer exists.'
    case 'source-changed':
      return 'The source at the previously verified path no longer matches this review.'
    case 'repository-unavailable':
      return 'The previously verified repository is currently unavailable.'
  }
}

export function arbitrateReviewSnapshot(
  current: ReviewEnrichmentFile | null,
  reviewId: string,
  candidate: ReviewEnrichmentSnapshot
): EnrichmentArbitration<ReviewEnrichmentFile> {
  assertSnapshot(candidate)
  if (!REVIEW_ID_PATTERN.test(reviewId)) invalid('Review ID is invalid.')
  if (!current) {
    return {
      outcome: 'write',
      value: {
        format: REVIEW_ENRICHMENT_FORMAT,
        version: PRIVATE_ENRICHMENT_VERSION,
        reviewId,
        snapshot: clone(candidate),
        error: null
      }
    }
  }
  const snapshotOrder = compareCanonicalTimestamps(
    candidate.observedAt,
    current.snapshot.observedAt
  )
  if (snapshotOrder < 0) {
    return { outcome: 'ignored', value: clone(current) }
  }
  if (snapshotOrder === 0) {
    return {
      outcome: isDeepStrictEqual(candidate, current.snapshot)
        ? 'idempotent'
        : 'conflict',
      value: clone(current)
    }
  }
  if (
    current.error &&
    compareCanonicalTimestamps(
      current.error.observedAt,
      candidate.observedAt
    ) === 0
  ) {
    return { outcome: 'conflict', value: clone(current) }
  }
  return {
    outcome: 'write',
    value: {
      ...clone(current),
      snapshot: clone(candidate),
      error: current.error && compareCanonicalTimestamps(
        current.error.observedAt,
        candidate.observedAt
      ) > 0
        ? clone(current.error)
        : null
    }
  }
}

export function arbitrateReviewError(
  current: ReviewEnrichmentFile | null,
  expectedSnapshotObservedAt: string | null,
  code: ReviewEnrichmentErrorCode,
  observedAt: string
): EnrichmentArbitration<ReviewEnrichmentFile> {
  if (
    !REVIEW_ERROR_CODES.has(code) ||
    !isCanonicalReviewTimestamp(observedAt) ||
    (
      expectedSnapshotObservedAt !== null &&
      !isCanonicalReviewTimestamp(expectedSnapshotObservedAt)
    )
  ) {
    invalid('Review validation failure is invalid.')
  }
  if (!current) return { outcome: 'ignored', value: null }
  if (current.snapshot.observedAt !== expectedSnapshotObservedAt) {
    return { outcome: 'ignored', value: clone(current) }
  }
  const snapshotOrder = compareCanonicalTimestamps(
    observedAt,
    current.snapshot.observedAt
  )
  if (snapshotOrder < 0) {
    return { outcome: 'ignored', value: clone(current) }
  }
  if (snapshotOrder === 0) {
    return { outcome: 'conflict', value: clone(current) }
  }
  const error: ReviewEnrichmentError = {
    code,
    observedAt,
    detail: reviewErrorDetail(code)
  }
  if (current.error) {
    const errorOrder = compareCanonicalTimestamps(
      observedAt,
      current.error.observedAt
    )
    if (errorOrder < 0) {
      return { outcome: 'ignored', value: clone(current) }
    }
    if (errorOrder === 0) {
      return {
        outcome: isDeepStrictEqual(error, current.error)
          ? 'idempotent'
          : 'conflict',
        value: clone(current)
      }
    }
  }
  return {
    outcome: 'write',
    value: { ...clone(current), error }
  }
}

export function arbitrateTitleObservation(
  current: ThreadEnrichmentFile | null,
  identity: StableThreadIdentity,
  candidate: ThreadTitleObservation
): EnrichmentArbitration<ThreadEnrichmentFile> {
  assertThreadIdentity(identity)
  assertTitleObservation(candidate)
  if (current && !isDeepStrictEqual(current.identity, identity)) {
    invalid('Thread enrichment identity does not match its addressed thread.')
  }
  const base: ThreadEnrichmentFile = current
    ? clone(current)
    : {
        format: THREAD_ENRICHMENT_FORMAT,
        version: PRIVATE_ENRICHMENT_VERSION,
        identity: clone(identity),
        titleObservations: []
      }
  const index = base.titleObservations.findIndex(
    ({ sourceKey }) => sourceKey === candidate.sourceKey
  )
  const previous = base.titleObservations[index]
  if (previous) {
    const observationOrder = compareCanonicalTimestamps(
      candidate.observedAt,
      previous.observedAt
    )
    if (observationOrder < 0) {
      return { outcome: 'ignored', value: base }
    }
    if (observationOrder === 0) {
      return {
        outcome: isDeepStrictEqual(candidate, previous)
          ? 'idempotent'
          : 'conflict',
        value: base
      }
    }
    base.titleObservations[index] = clone(candidate)
  } else {
    base.titleObservations.push(clone(candidate))
  }
  base.titleObservations.sort(({ sourceKey: left }, { sourceKey: right }) => (
    left.localeCompare(right)
  ))
  return { outcome: 'write', value: base }
}

export function resolvedThreadTitle(
  value: ThreadEnrichmentFile | null
): ThreadTitleObservation | null {
  if (!value?.titleObservations.length) return null
  return clone([...value.titleObservations].sort((left, right) => {
    const authority = Number(right.authority === 'thread-host') -
      Number(left.authority === 'thread-host')
    return authority ||
      compareCanonicalTimestamps(right.observedAt, left.observedAt) ||
      left.sourceKey.localeCompare(right.sourceKey)
  })[0] as ThreadTitleObservation)
}

export function reviewEnrichmentProjection(
  review: ReviewEnrichmentFile | null,
  thread: ThreadEnrichmentFile | null,
  runtimeError: EnrichmentProjectionError | null = null
): ReviewEnrichmentProjection {
  const repository = review?.snapshot.repository || null
  const persistedError = review?.error || null
  const error = runtimeError || persistedError
  return {
    project: repository
      ? {
          key: projectKey(repository),
          name: repository.projectName,
          root: repository.checkoutRoot,
          repositoryRelativePath: repository.repositoryRelativePath
        }
      : null,
    requestingThreadTitle: resolvedThreadTitle(thread),
    error: error ? clone(error) : null
  }
}

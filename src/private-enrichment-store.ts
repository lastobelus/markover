import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  arbitrateReviewError,
  arbitrateReviewSnapshot,
  arbitrateTitleObservation,
  parseReviewEnrichment,
  parseThreadEnrichment,
  PrivateEnrichmentFormatError,
  reviewEnrichmentProjection,
  reviewErrorDetail,
  stableThreadIdentity,
  threadIdentityDigest,
  type EnrichmentArbitration,
  type EnrichmentProjectionError,
  type ReviewEnrichmentErrorCode,
  type ReviewEnrichmentFile,
  type ReviewEnrichmentProjection,
  type ReviewEnrichmentSnapshot,
  type StableThreadIdentity,
  type ThreadEnrichmentFile,
  type ThreadTitleObservation
} from './private-enrichment'
import { reviewChecksum } from './review-format'
import type { ReviewListResult, ReviewStore } from './review-store'

type PrivateJsonWriter = (
  filePath: string,
  value: unknown
) => Promise<void>

export interface PrivateEnrichmentStoreOptions {
  now?: () => string | number | Date
  platform?: NodeJS.Platform
  readSource?: (filePath: string) => Promise<string>
  realpath?: (filePath: string) => Promise<string>
  writeJson?: PrivateJsonWriter
}

export type ThreadCleanupOutcome =
  | 'removed'
  | 'retained-reference'
  | 'retained-uncertain'

export class PrivateEnrichmentStoreError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PrivateEnrichmentStoreError'
    this.code = code
  }
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object'
    ? Reflect.get(error, 'code')
    : null
}

function canonicalTimestamp(now: () => string | number | Date): string {
  return new Date(now()).toISOString()
}

async function secureDirectory(
  directory: string,
  platform: NodeJS.Platform
): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  if (platform !== 'win32') await fs.chmod(directory, 0o700)
}

export async function writePrivateEnrichmentJson(
  filePath: string,
  value: unknown,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  const directory = path.dirname(filePath)
  await secureDirectory(directory, platform)
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}-${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`
  )
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      flush: true,
      mode: 0o600
    })
    if (platform !== 'win32') await fs.chmod(temporaryPath, 0o600)
    await fs.rename(temporaryPath, filePath)
    if (platform !== 'win32') await fs.chmod(filePath, 0o600)
  } finally {
    await fs.unlink(temporaryPath).catch((error: unknown) => {
      if (errorCode(error) !== 'ENOENT') throw error
    })
  }
}

class EnrichmentAdmissionGate {
  private blocked = false
  private readonly active = new Set<Promise<unknown>>()

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.blocked) {
      return Promise.reject(new PrivateEnrichmentStoreError(
        'ENRICHMENT_PAUSED',
        'Private review enrichment changes are unavailable right now.'
      ))
    }
    const tracked = Promise.resolve().then(operation).finally(() => {
      this.active.delete(tracked)
    })
    this.active.add(tracked)
    return tracked
  }

  async pauseAndDrain(): Promise<void> {
    this.blocked = true
    while (this.active.size) await Promise.allSettled([...this.active])
  }

  resume(): void {
    this.blocked = false
  }

  async drain(): Promise<void> {
    while (this.active.size) await Promise.allSettled([...this.active])
  }

  get isBlocked(): boolean {
    return this.blocked
  }
}

interface PrivateRead<T> {
  invalid: boolean
  value: T | null
}

function mutationValue<T>(result: EnrichmentArbitration<T>): T | null {
  return result.value ? structuredClone(result.value) : null
}

export class PrivateEnrichmentStore {
  readonly reviewsDirectory: string
  readonly threadsDirectory: string
  private readonly reviewStore: Pick<
    ReviewStore,
    'load' | 'listWithWarnings' | 'directory'
  >
  private readonly now: () => string | number | Date
  private readonly platform: NodeJS.Platform
  private readonly readSource: (filePath: string) => Promise<string>
  private readonly realpath: (filePath: string) => Promise<string>
  private readonly writeJson: PrivateJsonWriter
  private readonly gate = new EnrichmentAdmissionGate()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly runtimeReviewErrors = new Map<
    string,
    EnrichmentProjectionError
  >()
  private readonly runtimeThreadErrors = new Map<string, Error>()

  constructor(
    applicationDataDirectory: string,
    reviewStore: Pick<ReviewStore, 'load' | 'listWithWarnings' | 'directory'>,
    options: PrivateEnrichmentStoreOptions = {}
  ) {
    this.reviewsDirectory = path.resolve(reviewStore.directory)
    this.threadsDirectory = path.resolve(applicationDataDirectory, 'threads')
    this.reviewStore = reviewStore
    this.now = options.now || (() => new Date())
    this.platform = options.platform || process.platform
    this.readSource = options.readSource || (
      (filePath) => fs.readFile(filePath, 'utf8')
    )
    this.realpath = options.realpath || fs.realpath
    this.writeJson = options.writeJson || (
      (filePath, value) => writePrivateEnrichmentJson(
        filePath,
        value,
        this.platform
      )
    )
  }

  reviewPath(reviewId: string): string {
    return path.join(this.reviewsDirectory, reviewId, 'enrichment.json')
  }

  threadDirectory(identity: StableThreadIdentity): string {
    return path.join(this.threadsDirectory, threadIdentityDigest(identity))
  }

  threadPath(identity: StableThreadIdentity): string {
    return path.join(this.threadDirectory(identity), 'enrichment.json')
  }

  private runtimeError(
    reviewId: string,
    code: EnrichmentProjectionError['code'],
    detail: string
  ): void {
    this.runtimeReviewErrors.set(reviewId, {
      code,
      observedAt: canonicalTimestamp(this.now),
      detail
    })
  }

  private async readPrivate<T>(
    filePath: string,
    parse: (value: unknown) => T
  ): Promise<PrivateRead<T>> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'))
      return { invalid: false, value: parse(parsed) }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { invalid: false, value: null }
      if (error instanceof SyntaxError || error instanceof PrivateEnrichmentFormatError) {
        return { invalid: true, value: null }
      }
      throw error
    }
  }

  private async reviewRead(reviewId: string): Promise<PrivateRead<ReviewEnrichmentFile>> {
    const result = await this.readPrivate(
      this.reviewPath(reviewId),
      parseReviewEnrichment
    )
    if (result.value && result.value.reviewId !== reviewId) {
      return { invalid: true, value: null }
    }
    return result
  }

  private async threadRead(
    identity: StableThreadIdentity
  ): Promise<PrivateRead<ThreadEnrichmentFile>> {
    const result = await this.readPrivate(
      this.threadPath(identity),
      parseThreadEnrichment
    )
    if (
      result.value &&
      (
        result.value.identity.threadHostKind !== identity.threadHostKind ||
        result.value.identity.threadId !== identity.threadId
      )
    ) return { invalid: true, value: null }
    return result
  }

  private serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) || Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const queued = result.then(() => undefined, () => undefined)
    this.queues.set(key, queued)
    return result.finally(() => {
      if (this.queues.get(key) === queued) this.queues.delete(key)
    })
  }

  private async coherentSnapshot(
    artifact: ReviewArtifact,
    candidate: ReviewEnrichmentSnapshot
  ): Promise<void> {
    const parsed = arbitrateReviewSnapshot(
      null,
      artifact.review.id,
      candidate
    ).value?.snapshot
    if (!parsed) {
      throw new PrivateEnrichmentStoreError(
        'INVALID_SNAPSHOT',
        'Private review snapshot is invalid.'
      )
    }
    if (parsed.source.verifiedChecksum !== artifact.sourceDocument.checksum) {
      throw new PrivateEnrichmentStoreError(
        'SOURCE_MISMATCH',
        'Private source checksum does not match the portable review.'
      )
    }
    const canonicalSource = await this.realpath(parsed.source.canonicalPath)
    if (canonicalSource !== parsed.source.canonicalPath) {
      throw new PrivateEnrichmentStoreError(
        'SOURCE_MISMATCH',
        'Private canonicalPath is not the canonical source path.'
      )
    }
    const source = await this.readSource(canonicalSource)
    if (reviewChecksum(source) !== parsed.source.verifiedChecksum) {
      throw new PrivateEnrichmentStoreError(
        'SOURCE_MISMATCH',
        'Private source bytes do not match the portable review.'
      )
    }
    if (!parsed.repository) return
    const repositorySource = await this.realpath(path.resolve(
      parsed.repository.checkoutRoot,
      parsed.repository.repositoryRelativePath
    ))
    if (repositorySource !== canonicalSource) {
      throw new PrivateEnrichmentStoreError(
        'REPOSITORY_MISMATCH',
        'Private repository evidence does not identify the canonical source.'
      )
    }
    if (parsed.repository.identityKind !== 'remote') {
      const canonicalIdentity = await this.realpath(parsed.repository.identity)
      if (canonicalIdentity !== parsed.repository.identity) {
        throw new PrivateEnrichmentStoreError(
          'REPOSITORY_MISMATCH',
          'Private repository path identity is not canonical.'
        )
      }
    }
  }

  private conflict(message: string): never {
    throw new PrivateEnrichmentStoreError('ENRICHMENT_CONFLICT', message)
  }

  async loadReview(reviewId: string): Promise<ReviewEnrichmentFile | null> {
    const result = await this.reviewRead(reviewId)
    if (result.invalid) {
      this.runtimeError(
        reviewId,
        'invalid-private-state',
        'The private review enrichment file is malformed or incompatible.'
      )
      return null
    }
    if (this.runtimeReviewErrors.get(reviewId)?.code === 'invalid-private-state') {
      this.runtimeReviewErrors.delete(reviewId)
    }
    return result.value
  }

  async loadThread(
    identity: StableThreadIdentity
  ): Promise<ThreadEnrichmentFile | null> {
    const digest = threadIdentityDigest(identity)
    const result = await this.threadRead(identity)
    if (result.invalid) {
      this.runtimeThreadErrors.set(
        digest,
        new PrivateEnrichmentStoreError(
          'INVALID_THREAD_ENRICHMENT',
          'The private thread enrichment file is malformed, incompatible, or mismatched.'
        )
      )
      return null
    }
    if (errorCode(this.runtimeThreadErrors.get(digest)) === 'INVALID_THREAD_ENRICHMENT') {
      this.runtimeThreadErrors.delete(digest)
    }
    return result.value
  }

  threadError(identity: StableThreadIdentity): Error | null {
    return this.runtimeThreadErrors.get(threadIdentityDigest(identity)) || null
  }

  async projection(artifact: ReviewArtifact): Promise<ReviewEnrichmentProjection> {
    const review = await this.loadReview(artifact.review.id)
    const identity = stableThreadIdentity(artifact.review.agentThread)
    const thread = identity ? await this.loadThread(identity) : null
    return reviewEnrichmentProjection(
      review,
      thread,
      this.runtimeReviewErrors.get(artifact.review.id) || null
    )
  }

  acceptReviewSnapshot(
    reviewId: string,
    candidate: ReviewEnrichmentSnapshot
  ): Promise<ReviewEnrichmentFile> {
    return this.gate.run(() => this.serialize(`review:${reviewId}`, async () => {
      const artifact = await this.reviewStore.load(reviewId)
      await this.coherentSnapshot(artifact, candidate)
      const current = await this.reviewRead(reviewId)
      if (current.invalid) {
        this.runtimeError(
          reviewId,
          'invalid-private-state',
          'The private review enrichment file is malformed or incompatible.'
        )
        throw new PrivateEnrichmentStoreError(
          'INVALID_PRIVATE_STATE',
          'Refusing to overwrite invalid private review enrichment.'
        )
      }
      const result = arbitrateReviewSnapshot(current.value, reviewId, candidate)
      if (result.outcome === 'conflict') this.conflict(
        'A review snapshot conflicts with another observation at the same time.'
      )
      let value = mutationValue(result)
      if (!value) throw new PrivateEnrichmentStoreError(
        'INVALID_SNAPSHOT',
        'A review snapshot did not produce private state.'
      )
      let shouldWrite = result.outcome === 'write'
      const runtimeError = this.runtimeReviewErrors.get(reviewId)
      if (
        !current.value &&
        runtimeError &&
        runtimeError.code !== 'invalid-private-state' &&
        runtimeError.code !== 'private-write-failed'
      ) {
        const retainedFailure = arbitrateReviewError(
          value,
          candidate.observedAt,
          runtimeError.code,
          runtimeError.observedAt
        )
        if (retainedFailure.outcome === 'conflict') this.conflict(
          'A review snapshot conflicts with an initial validation failure at the same time.'
        )
        value = mutationValue(retainedFailure) || value
        shouldWrite ||= retainedFailure.outcome === 'write'
      }
      if (shouldWrite) {
        const latest = await this.reviewStore.load(reviewId)
        if (
          latest.review.id !== artifact.review.id ||
          latest.sourceDocument.checksum !== artifact.sourceDocument.checksum
        ) throw new PrivateEnrichmentStoreError(
          'REVIEW_CHANGED',
          'The portable review changed before private enrichment could commit.'
        )
        try {
          await this.writeJson(this.reviewPath(reviewId), value)
        } catch (error) {
          this.runtimeError(
            reviewId,
            'private-write-failed',
            'Private review enrichment could not be saved.'
          )
          throw new PrivateEnrichmentStoreError(
            'PRIVATE_WRITE_FAILED',
            'Private review enrichment could not be saved.',
            { cause: error }
          )
        }
      }
      if (result.outcome !== 'ignored') {
        this.runtimeReviewErrors.delete(reviewId)
      }
      return value
    }))
  }

  recordReviewValidationFailure(
    reviewId: string,
    expectedSnapshotObservedAt: string | null,
    code: ReviewEnrichmentErrorCode,
    observedAt: string
  ): Promise<ReviewEnrichmentFile | null> {
    return this.gate.run(() => this.serialize(`review:${reviewId}`, async () => {
      await this.reviewStore.load(reviewId)
      const current = await this.reviewRead(reviewId)
      if (current.invalid) {
        this.runtimeError(
          reviewId,
          'invalid-private-state',
          'The private review enrichment file is malformed or incompatible.'
        )
        throw new PrivateEnrichmentStoreError(
          'INVALID_PRIVATE_STATE',
          'Refusing to overwrite invalid private review enrichment.'
        )
      }
      arbitrateReviewError(
        null,
        expectedSnapshotObservedAt,
        code,
        observedAt
      )
      if (!current.value && expectedSnapshotObservedAt === null) {
        const candidate: EnrichmentProjectionError = {
          code,
          observedAt,
          detail: reviewErrorDetail(code)
        }
        const previous = this.runtimeReviewErrors.get(reviewId)
        if (
          previous &&
          previous.code !== 'invalid-private-state' &&
          previous.code !== 'private-write-failed'
        ) {
          if (candidate.observedAt < previous.observedAt) return null
          if (candidate.observedAt === previous.observedAt) {
            if (
              candidate.code !== previous.code ||
              candidate.detail !== previous.detail
            ) this.conflict(
              'An initial review validation failure conflicts with another observation at the same time.'
            )
            return null
          }
        }
        if (!previous || (
          previous.code !== 'invalid-private-state' &&
          previous.code !== 'private-write-failed'
        )) this.runtimeReviewErrors.set(reviewId, candidate)
        return null
      }
      const result = arbitrateReviewError(
        current.value,
        expectedSnapshotObservedAt,
        code,
        observedAt
      )
      if (result.outcome === 'conflict') this.conflict(
        'A review validation failure conflicts with another observation at the same time.'
      )
      const value = mutationValue(result)
      if (result.outcome === 'write' && value) {
        try {
          await this.writeJson(this.reviewPath(reviewId), value)
        } catch (error) {
          this.runtimeError(
            reviewId,
            'private-write-failed',
            'Private review enrichment could not be saved.'
          )
          throw new PrivateEnrichmentStoreError(
            'PRIVATE_WRITE_FAILED',
            'Private review enrichment could not be saved.',
            { cause: error }
          )
        }
      }
      if (
        result.outcome !== 'ignored' &&
        this.runtimeReviewErrors.get(reviewId)?.code === 'private-write-failed'
      ) this.runtimeReviewErrors.delete(reviewId)
      return value
    }))
  }

  observeThreadTitle(
    identity: StableThreadIdentity,
    candidate: ThreadTitleObservation
  ): Promise<ThreadEnrichmentFile> {
    const digest = threadIdentityDigest(identity)
    return this.gate.run(() => this.serialize(`thread:${digest}`, async () => {
      const current = await this.threadRead(identity)
      if (current.invalid) {
        const error = new PrivateEnrichmentStoreError(
          'INVALID_THREAD_ENRICHMENT',
          'Refusing to overwrite invalid or mismatched private thread enrichment.'
        )
        this.runtimeThreadErrors.set(digest, error)
        throw error
      }
      const result = arbitrateTitleObservation(current.value, identity, candidate)
      if (result.outcome === 'conflict') {
        const error = new PrivateEnrichmentStoreError(
          'ENRICHMENT_CONFLICT',
          'A thread-title observation conflicts with another observation at the same time.'
        )
        this.runtimeThreadErrors.set(digest, error)
        throw error
      }
      const value = mutationValue(result)
      if (!value) throw new PrivateEnrichmentStoreError(
        'INVALID_TITLE_OBSERVATION',
        'A thread-title observation did not produce private state.'
      )
      if (result.outcome === 'write') {
        try {
          await this.writeJson(this.threadPath(identity), value)
        } catch (error) {
          const failure = new PrivateEnrichmentStoreError(
            'PRIVATE_WRITE_FAILED',
            'Private thread enrichment could not be saved.',
            { cause: error }
          )
          this.runtimeThreadErrors.set(digest, failure)
          throw failure
        }
      }
      if (result.outcome !== 'ignored') this.runtimeThreadErrors.delete(digest)
      return value
    }))
  }

  async pauseAndDrain(): Promise<void> {
    await this.gate.pauseAndDrain()
  }

  resume(): void {
    this.gate.resume()
  }

  async flush(): Promise<void> {
    await this.gate.drain()
    while (this.queues.size) {
      await Promise.allSettled([...this.queues.values()])
    }
  }

  async cleanupThreadAfterTrash(
    identity: StableThreadIdentity
  ): Promise<ThreadCleanupOutcome> {
    if (!this.gate.isBlocked) {
      throw new PrivateEnrichmentStoreError(
        'ENRICHMENT_NOT_PAUSED',
        'Private thread cleanup requires paused enrichment mutations.'
      )
    }
    const digest = threadIdentityDigest(identity)
    return this.serialize(`thread:${digest}`, async () => {
      let listing: ReviewListResult
      try {
        listing = await this.reviewStore.listWithWarnings()
      } catch {
        return 'retained-uncertain'
      }
      if (listing.warnings.length || listing.incompatible.length) {
        return 'retained-uncertain'
      }
      const referenced = listing.reviews.some((artifact) => {
        const candidate = stableThreadIdentity(artifact.review.agentThread)
        return candidate?.threadHostKind === identity.threadHostKind &&
          candidate.threadId === identity.threadId
      })
      if (referenced) return 'retained-reference'
      await fs.rm(this.threadDirectory(identity), { recursive: true, force: true })
      this.runtimeThreadErrors.delete(digest)
      return 'removed'
    })
  }
}

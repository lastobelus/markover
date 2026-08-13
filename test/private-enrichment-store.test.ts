import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  PrivateEnrichmentStore,
  PrivateEnrichmentStoreError,
  writePrivateEnrichmentJson
} from '../src/private-enrichment-store'
import {
  parseReviewEnrichment,
  type ReviewEnrichmentSnapshot,
  type StableThreadIdentity,
  type ThreadTitleObservation
} from '../src/private-enrichment'
import { reviewChecksum } from '../src/review-format'
import { ReviewStore } from '../src/review-store'

const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi

const firstTime = '2026-08-12T12:00:00.000Z'
const secondTime = '2026-08-12T12:01:00.000Z'
const thirdTime = '2026-08-12T12:02:00.000Z'

interface Fixture {
  applicationData: string
  reviewStore: ReviewStore
  sourcePath: string
  store: PrivateEnrichmentStore
}

async function fixture(
  options: ConstructorParameters<typeof PrivateEnrichmentStore>[2] = {}
): Promise<Fixture> {
  const applicationData = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-enrichment-test-')
  )
  const reviewStore = new ReviewStore(path.join(applicationData, 'reviews'), {
    idFactory: () => 'mko_review1',
    now: () => firstTime
  })
  const requestedSourcePath = path.join(
    applicationData,
    'project',
    'doc',
    'plan.md'
  )
  await fs.mkdir(path.dirname(requestedSourcePath), { recursive: true })
  await fs.writeFile(requestedSourcePath, '# Plan\n', 'utf8')
  const sourcePath = await fs.realpath(requestedSourcePath)
  const store = new PrivateEnrichmentStore(
    applicationData,
    reviewStore,
    options
  )
  return { applicationData, reviewStore, sourcePath, store }
}

async function createReview(
  value: Fixture,
  id = 'thread-123'
): Promise<ReviewArtifact> {
  const source = await fs.readFile(value.sourcePath, 'utf8')
  const tree = parseMarkdown(source, reviewChecksum(source), {
    name: 'plan.md',
    path: value.sourcePath
  })
  return value.reviewStore.create({
    tree,
    contextSummary: 'Review the plan.',
    agentThread: {
      id,
      threadHost: { kind: 't3code', provider: 'codex' }
    }
  })
}

function snapshot(value: Fixture, observedAt = firstTime): ReviewEnrichmentSnapshot {
  return {
    observedAt,
    source: {
      canonicalPath: value.sourcePath,
      verifiedChecksum: reviewChecksum('# Plan\n')
    },
    repository: {
      identityKind: 'remote',
      identity: 'https://github.com/lastobelus/markover',
      checkoutRoot: path.dirname(path.dirname(value.sourcePath)),
      repositoryRelativePath: 'doc/plan.md',
      projectName: 'markover'
    }
  }
}

function identity(id = 'thread-123'): StableThreadIdentity {
  return { threadHostKind: 't3code', threadId: id }
}

function title(observedAt = firstTime): ThreadTitleObservation {
  return {
    sourceKey: 't3code',
    authority: 'thread-host',
    title: 'Improve inbox management',
    observedAt
  }
}

test('strict private JSON replacement uses user-only files without temp residue', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-private-json-test-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'nested', 'state.json')
  await writePrivateEnrichmentJson(filePath, { value: 1 })
  assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')), { value: 1 })
  assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['state.json'])
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600)
    assert.equal((await fs.stat(path.dirname(filePath))).mode & 0o777, 0o700)
  }
})

test('accepts a source/repository-coherent snapshot and restores it', async (t) => {
  const value = await fixture()
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const review = await createReview(value)
  const accepted = await value.store.acceptReviewSnapshot(
    review.review.id,
    snapshot(value)
  )
  assert.deepEqual(await value.store.loadReview(review.review.id), accepted)

  const restarted = new PrivateEnrichmentStore(
    value.applicationData,
    value.reviewStore
  )
  assert.deepEqual(await restarted.loadReview(review.review.id), accepted)
  assert.equal((await restarted.projection(review)).project?.name, 'markover')
})

test('rejects mismatched source and repository evidence without a sidecar', async (t) => {
  const value = await fixture()
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const review = await createReview(value)

  const changed = snapshot(value)
  changed.source.verifiedChecksum = `sha256:${'b'.repeat(64)}`
  await assert.rejects(
    value.store.acceptReviewSnapshot(review.review.id, changed),
    (error: unknown) => (
      error instanceof PrivateEnrichmentStoreError &&
      error.code === 'SOURCE_MISMATCH'
    )
  )

  const wrongRepository = snapshot(value)
  wrongRepository.repository = {
    ...wrongRepository.repository as NonNullable<typeof wrongRepository.repository>,
    repositoryRelativePath: 'doc/other.md'
  }
  await assert.rejects(
    value.store.acceptReviewSnapshot(review.review.id, wrongRepository)
  )
  await assert.rejects(fs.access(value.store.reviewPath(review.review.id)))
})

test('persists current failures and ignores a late failure for an older generation', async (t) => {
  const value = await fixture()
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const review = await createReview(value)
  await value.store.acceptReviewSnapshot(review.review.id, snapshot(value))
  await value.store.acceptReviewSnapshot(review.review.id, snapshot(value, secondTime))

  const ignored = await value.store.recordReviewValidationFailure(
    review.review.id,
    firstTime,
    'source-missing',
    thirdTime
  )
  assert.equal(ignored?.error, null)
  const failed = await value.store.recordReviewValidationFailure(
    review.review.id,
    secondTime,
    'source-missing',
    thirdTime
  )
  assert.equal(failed?.error?.code, 'source-missing')
  assert.equal(
    (await value.store.projection(review)).error?.code,
    'source-missing'
  )
})

test('invalid private bytes remain untouched and produce a runtime projection error', async (t) => {
  const value = await fixture()
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const review = await createReview(value)
  const portablePath = path.join(
    value.reviewStore.directory,
    review.review.id,
    'review.json'
  )
  const portableBytes = await fs.readFile(portablePath, 'utf8')
  await fs.writeFile(value.store.reviewPath(review.review.id), '{invalid', 'utf8')
  const projection = await value.store.projection(review)
  assert.equal(projection.error?.code, 'invalid-private-state')
  assert.equal(
    await fs.readFile(value.store.reviewPath(review.review.id), 'utf8'),
    '{invalid'
  )
  assert.equal((await value.reviewStore.load(review.review.id)).review.id, review.review.id)
  assert.equal(await fs.readFile(portablePath, 'utf8'), portableBytes)
  await assert.rejects(
    value.store.acceptReviewSnapshot(review.review.id, snapshot(value)),
    (error: unknown) => (
      error instanceof PrivateEnrichmentStoreError &&
      error.code === 'INVALID_PRIVATE_STATE'
    )
  )
})

test('mismatched review IDs are invalid private state and remain untouched', async (t) => {
  const value = await fixture()
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const review = await createReview(value)
  const mismatched = {
    format: 'markover-review-enrichment',
    version: 1,
    reviewId: 'mko_other12',
    snapshot: snapshot(value),
    error: null
  }
  const bytes = `${JSON.stringify(mismatched)}\n`
  await fs.writeFile(value.store.reviewPath(review.review.id), bytes, 'utf8')
  assert.equal((await value.store.projection(review)).error?.code, 'invalid-private-state')
  assert.equal(await fs.readFile(value.store.reviewPath(review.review.id), 'utf8'), bytes)
})

test('initial validation failures arbitrate monotonically without a file', async (t) => {
  const value = await fixture()
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const review = await createReview(value)
  await assert.rejects(
    value.store.recordReviewValidationFailure(
      review.review.id,
      null,
      'source-missing',
      'not-a-time'
    )
  )
  assert.equal((await value.store.projection(review)).error, null)
  await value.store.recordReviewValidationFailure(
    review.review.id,
    null,
    'source-missing',
    secondTime
  )
  await value.store.recordReviewValidationFailure(
    review.review.id,
    null,
    'source-changed',
    firstTime
  )
  assert.equal((await value.store.projection(review)).error?.code, 'source-missing')
  await assert.rejects(
    value.store.recordReviewValidationFailure(
      review.review.id,
      null,
      'source-changed',
      secondTime
    ),
    (error: unknown) => (
      error instanceof PrivateEnrichmentStoreError &&
      error.code === 'ENRICHMENT_CONFLICT'
    )
  )
  await assert.rejects(fs.access(value.store.reviewPath(review.review.id)))
})

test('initial validation failures order expanded years by instant', async (t) => {
  const value = await fixture()
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const review = await createReview(value)
  await value.store.recordReviewValidationFailure(
    review.review.id,
    null,
    'source-missing',
    secondTime
  )
  await value.store.recordReviewValidationFailure(
    review.review.id,
    null,
    'source-changed',
    '+010000-01-01T00:00:00.000Z'
  )
  assert.equal((await value.store.projection(review)).error?.code, 'source-changed')
})

test('initial failures survive older success and clear on newer success', async (t) => {
  const value = await fixture()
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const review = await createReview(value)
  await value.store.recordReviewValidationFailure(
    review.review.id,
    null,
    'source-missing',
    secondTime
  )
  const older = await value.store.acceptReviewSnapshot(
    review.review.id,
    snapshot(value, firstTime)
  )
  assert.equal(older.error?.code, 'source-missing')
  assert.equal(
    (await new PrivateEnrichmentStore(
      value.applicationData,
      value.reviewStore
    ).projection(review)).error?.code,
    'source-missing'
  )

  const newer = await value.store.acceptReviewSnapshot(
    review.review.id,
    snapshot(value, thirdTime)
  )
  assert.equal(newer.error, null)
  assert.equal((await value.store.projection(review)).error, null)
})

test('thread observations persist independently and conflict without rewriting', async (t) => {
  const value = await fixture()
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const observed = await value.store.observeThreadTitle(identity(), title())
  assert.deepEqual(await value.store.loadThread(identity()), observed)
  const bytes = await fs.readFile(value.store.threadPath(identity()), 'utf8')

  await assert.rejects(
    value.store.observeThreadTitle(identity(), {
      ...title(),
      title: 'Conflicting title'
    }),
    (error: unknown) => (
      error instanceof PrivateEnrichmentStoreError &&
      error.code === 'ENRICHMENT_CONFLICT'
    )
  )
  assert.equal(
    (value.store.threadError(identity()) as PrivateEnrichmentStoreError).code,
    'ENRICHMENT_CONFLICT'
  )
  assert.equal(await fs.readFile(value.store.threadPath(identity()), 'utf8'), bytes)
  await value.store.loadThread(identity())
  assert.equal(
    (value.store.threadError(identity()) as PrivateEnrichmentStoreError).code,
    'ENRICHMENT_CONFLICT'
  )
  await value.store.observeThreadTitle(identity(), title(secondTime))
  assert.equal(value.store.threadError(identity()), null)
})

test('pause drains admitted work and rejects later mutations', async (t) => {
  let releaseWrite!: () => void
  let writeStarted!: () => void
  const started = new Promise<void>((resolve) => {
    writeStarted = resolve
  })
  const release = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  const value = await fixture({
    writeJson: async (filePath, state) => {
      writeStarted()
      await release
      await writePrivateEnrichmentJson(filePath, state)
    }
  })
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const review = await createReview(value)
  const mutation = value.store.acceptReviewSnapshot(review.review.id, snapshot(value))
  await started
  const pausing = value.store.pauseAndDrain()
  await assert.rejects(
    value.store.observeThreadTitle(identity(), title()),
    (error: unknown) => (
      error instanceof PrivateEnrichmentStoreError &&
      error.code === 'ENRICHMENT_PAUSED'
    )
  )
  releaseWrite()
  await mutation
  await pausing
  value.store.resume()
  await value.store.observeThreadTitle(identity(), title())
})

test('post-trash cleanup retains references and fails closed on uncertain reviews', async (t) => {
  const ids = ['mko_review1', 'mko_review2']
  const value = await fixture()
  const reviewStore = new ReviewStore(value.reviewStore.directory, {
    idFactory: () => ids.shift() as string,
    now: () => firstTime
  })
  const store = new PrivateEnrichmentStore(value.applicationData, reviewStore)
  value.reviewStore = reviewStore
  value.store = store
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const first = await createReview(value)
  const second = await createReview(value)
  await store.observeThreadTitle(identity(), title())
  await store.pauseAndDrain()

  await reviewStore.trashReview(first.review.id, (target) => (
    fs.rm(target, { recursive: true, force: true })
  ))
  assert.equal(
    await store.cleanupThreadAfterTrash(identity()),
    'retained-reference'
  )

  const malformedDirectory = path.join(reviewStore.directory, 'mko_broken1')
  await fs.mkdir(malformedDirectory)
  await fs.writeFile(path.join(malformedDirectory, 'review.json'), '{bad', 'utf8')
  await reviewStore.trashReview(second.review.id, (target) => (
    fs.rm(target, { recursive: true, force: true })
  ))
  assert.equal(
    await store.cleanupThreadAfterTrash(identity()),
    'retained-uncertain'
  )
  await fs.rm(malformedDirectory, { recursive: true, force: true })
  assert.equal(await store.cleanupThreadAfterTrash(identity()), 'removed')
  await assert.rejects(fs.access(store.threadPath(identity())))
})

test('post-trash cleanup is fenced behind the paused admission gate', async (t) => {
  const value = await fixture()
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  await assert.rejects(
    value.store.cleanupThreadAfterTrash(identity()),
    (error: unknown) => (
      error instanceof PrivateEnrichmentStoreError &&
      error.code === 'ENRICHMENT_NOT_PAUSED'
    )
  )
})

test('private writes can be parsed after direct file inspection', async (t) => {
  const value = await fixture()
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const review = await createReview(value)
  await value.store.acceptReviewSnapshot(review.review.id, snapshot(value))
  assert.ok(parseReviewEnrichment(JSON.parse(
    await fs.readFile(value.store.reviewPath(review.review.id), 'utf8')
  )))
})

test('idempotent replay proves storage recovery before clearing write failure', async (t) => {
  let writes = 0
  const value = await fixture({
    writeJson: async (filePath, state) => {
      writes += 1
      if (writes === 2) throw new Error('Simulated validation write failure.')
      await writePrivateEnrichmentJson(filePath, state)
    }
  })
  t.after(() => fs.rm(value.applicationData, { recursive: true, force: true }))
  const review = await createReview(value)
  await value.store.acceptReviewSnapshot(review.review.id, snapshot(value))
  await assert.rejects(value.store.recordReviewValidationFailure(
    review.review.id,
    firstTime,
    'source-missing',
    secondTime
  ))
  assert.equal(
    (await value.store.projection(review)).error?.code,
    'private-write-failed'
  )

  await value.store.acceptReviewSnapshot(review.review.id, snapshot(value))
  assert.equal(writes, 3)
  assert.equal((await value.store.projection(review)).error, null)
})

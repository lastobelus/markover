import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import { LocalServiceError, requestJson } from '../src/local-client'
import {
  startLocalService,
  type LocalServiceOptions
} from '../src/local-service'
import { importLegacyReviews } from '../src/review-migration'
import {
  assertReviewArtifact,
  ReviewStore,
  type ReviewArtifact
} from '../src/review-store'

const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi

type FixtureOptions = Omit<LocalServiceOptions, 'store'>

function expectRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

function expectArtifact(value: unknown, reviewId: string): ReviewArtifact {
  assertReviewArtifact(value, reviewId)
  return value
}

function child(node: ReviewNode, index = 0): ReviewNode {
  const result = node.children[index]
  assert.ok(result)
  return result
}

function hasServiceError(
  error: unknown,
  code: string,
  statusCode: number
): boolean {
  return error instanceof LocalServiceError &&
    error.code === code &&
    error.statusCode === statusCode
}

async function serviceFixture(
  t: TestContext,
  options: FixtureOptions = {}
) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-service-test-')
  )
  const endpointPath = path.join(directory, 'service.json')
  const changes: Array<{
    artifact: ReviewArtifact
    action: 'created' | 'imported' | 'handoff' | 'edit'
  }> = []
  const store = new ReviewStore(path.join(directory, 'reviews'), {
    idFactory: () => 'mko_aaa11111'
  })
  const service = await startLocalService({
    store,
    beforeAction: options.beforeAction,
    importReviews: options.importReviews,
    async onChange(artifact, action) {
      changes.push({ artifact, action })
      await options.onChange?.(artifact, action)
    }
  })
  await fs.writeFile(endpointPath, JSON.stringify({
    version: 1,
    port: service.port
  }))
  t.after(async () => {
    await service.close()
    await fs.rm(directory, { recursive: true, force: true })
  })
  return { changes, endpointPath, store }
}

function tree(): ReviewTree {
  return parseMarkdown('# Review\n', 'sha256:test', {
    name: 'review.md',
    path: '/tmp/review.md'
  })
}

test('serves health and a complete open/get/edit workflow', async (t) => {
  const { changes, endpointPath } = await serviceFixture(t)

  assert.deepEqual(
    await requestJson(endpointPath, 'GET', '/health'),
    { status: 'ok', version: 1 }
  )

  const opened = await requestJson(endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Review the service flow.' }
  })
  assert.deepEqual(opened, {
    reviewId: 'mko_aaa11111',
    status: 'editing'
  })

  const handedOff = expectArtifact(await requestJson(
    endpointPath,
    'POST',
    '/reviews/mko_aaa11111/handoff'
  ), 'mko_aaa11111')
  const retry = await requestJson(
    endpointPath,
    'POST',
    '/reviews/mko_aaa11111/handoff'
  )
  assert.equal(handedOff.review.status, 'pending-agent')
  assert.equal(handedOff.sourceDocument.content, '# Review\n')
  assert.deepEqual(retry, handedOff)

  assert.deepEqual(
    await requestJson(
      endpointPath,
      'POST',
      '/reviews/mko_aaa11111/edit'
    ),
    { reviewId: 'mko_aaa11111', status: 'editing' }
  )
  assert.deepEqual(
    changes.map((change) => change.action),
    ['created', 'handoff', 'handoff', 'edit']
  )
})

test('lists and loads reviews through one-shot requests', async (t) => {
  const { endpointPath } = await serviceFixture(t)
  await requestJson(endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Review listing.' }
  })

  const listed = expectRecord(await requestJson(endpointPath, 'GET', '/reviews'))
  const loaded = await requestJson(
    endpointPath,
    'GET',
    '/reviews/mko_aaa11111'
  )
  assert.ok(Array.isArray(listed.reviews))
  assert.equal(listed.reviews.length, 1)
  assert.deepEqual(listed.reviews[0], loaded)
})

test('imports checkout reviews and publishes them before handoff', async (t) => {
  const sourceDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-service-import-')
  )
  t.after(() => fs.rm(sourceDirectory, { recursive: true, force: true }))
  const sourceStore = new ReviewStore(sourceDirectory, {
    idFactory: () => 'mko_import01'
  })
  await sourceStore.create({
    tree: tree(),
    contextSummary: 'Import this review.'
  })

  let targetDirectory = ''
  const fixture = await serviceFixture(t, {
    importReviews(source) {
      return importLegacyReviews(source, targetDirectory)
    }
  })
  targetDirectory = fixture.store.directory

  assert.deepEqual(
    await requestJson(fixture.endpointPath, 'POST', '/reviews/import', {
      sourceDirectory
    }),
    { imported: ['mko_import01'] }
  )
  assert.deepEqual(
    fixture.changes.map(({ action, artifact }) => [action, artifact.review.id]),
    [['imported', 'mko_import01']]
  )
  const imported = expectArtifact(
    await requestJson(
      fixture.endpointPath,
      'GET',
      '/reviews/mko_import01'
    ),
    'mko_import01'
  )
  assert.equal(imported.review.status, 'editing')
})

test('returns structured errors to the client', async (t) => {
  const { endpointPath } = await serviceFixture(t)

  await assert.rejects(
    requestJson(endpointPath, 'GET', '/missing'),
    (error: unknown) => hasServiceError(error, 'NOT_FOUND', 404)
  )
  await assert.rejects(
    requestJson(
      endpointPath,
      'POST',
      '/reviews/not-an-id/handoff'
    ),
    (error: unknown) => hasServiceError(error, 'INVALID_ID', 400)
  )
})

test('handoff waits for the latest renderer snapshot barrier', async (t) => {
  const storeReference: { current?: ReviewStore } = {}
  const fixture = await serviceFixture(t, {
    async beforeAction(reviewId) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.ok(storeReference.current)
      const latest = await storeReference.current.load(reviewId)
      child(latest.root).feedback = 'The final unsaved sentence.'
      await storeReference.current.updateTree(reviewId, latest)
    }
  })
  storeReference.current = fixture.store

  await requestJson(fixture.endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Review the snapshot barrier.' }
  })
  const handedOff = expectArtifact(await requestJson(
    fixture.endpointPath,
    'POST',
    '/reviews/mko_aaa11111/handoff'
  ), 'mko_aaa11111')

  assert.equal(
    child(handedOff.root).feedback,
    'The final unsaved sentence.'
  )
  assert.equal(handedOff.review.status, 'pending-agent')
})

test('handoff waits for the renderer to apply its status', async (t) => {
  let statusApplied
  const fixture = await serviceFixture(t, {
    async onChange() {
      await new Promise((resolve) => setTimeout(resolve, 20))
      statusApplied = true
    }
  })
  await requestJson(fixture.endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Review status acknowledgement.' }
  })
  statusApplied = false

  await requestJson(
    fixture.endpointPath,
    'POST',
    '/reviews/mko_aaa11111/handoff'
  )

  assert.equal(statusApplied, true)
})

test('a failed handoff rolls the renderer back to editing', async (t) => {
  let rolledBack = false
  const fixture = await serviceFixture(t, {
    beforeAction() {
      return Promise.resolve(() => {
        rolledBack = true
      }
      )
    }
  })
  await requestJson(fixture.endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Review handoff rollback.' }
  })
  fixture.store.handoff = () => Promise.reject(
    new Error('simulated write failure')
  )

  await assert.rejects(
    requestJson(
      fixture.endpointPath,
      'POST',
      '/reviews/mko_aaa11111/handoff'
    ),
    (error: unknown) => (
      error instanceof LocalServiceError && error.statusCode === 500
    )
  )
  assert.equal(rolledBack, true)
})

test('handoff and edit serialize across the renderer snapshot', async (t) => {
  let releaseSnapshot!: () => void
  let snapshotStarted!: () => void
  const snapshotReady = new Promise<void>((resolve) => {
    snapshotStarted = resolve
  })
  const snapshotBarrier = new Promise<void>((resolve) => {
    releaseSnapshot = resolve
  })
  const fixture = await serviceFixture(t, {
    async beforeAction() {
      snapshotStarted()
      await snapshotBarrier
    }
  })
  await requestJson(fixture.endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Review concurrent actions.' }
  })

  const handoff = requestJson(
    fixture.endpointPath,
    'POST',
    '/reviews/mko_aaa11111/handoff'
  )
  await snapshotReady
  const edit = requestJson(
    fixture.endpointPath,
    'POST',
    '/reviews/mko_aaa11111/edit'
  )
  releaseSnapshot()

  const handedOff = expectArtifact(await handoff, 'mko_aaa11111')
  const reopened = expectRecord(await edit)
  assert.equal(handedOff.review.status, 'pending-agent')
  assert.equal(reopened.status, 'editing')
  assert.deepEqual(
    fixture.changes.slice(-2).map((change) => change.action),
    ['handoff', 'edit']
  )
  assert.equal(
    (await fixture.store.load('mko_aaa11111')).review.status,
    'editing'
  )
})

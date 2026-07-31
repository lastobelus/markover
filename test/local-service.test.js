const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { requestJson } = require('../src/local-client')
const { startLocalService } = require('../src/local-service')
const { ReviewStore } = require('../src/review-store')
const { parseMarkdown } = require('../src/tree')

async function serviceFixture(t, options = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-service-test-')
  )
  const endpointPath = path.join(directory, 'service.json')
  const changes = []
  const store = new ReviewStore(path.join(directory, 'reviews'), {
    idFactory: () => 'mko_aaa11111'
  })
  const service = await startLocalService({
    store,
    beforeAction: options.beforeAction,
    onChange(artifact, action) {
      changes.push({ artifact, action })
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

function tree() {
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

  const handedOff = await requestJson(
    endpointPath,
    'POST',
    '/reviews/mko_aaa11111/handoff'
  )
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

  const listed = await requestJson(endpointPath, 'GET', '/reviews')
  const loaded = await requestJson(
    endpointPath,
    'GET',
    '/reviews/mko_aaa11111'
  )
  assert.equal(listed.reviews.length, 1)
  assert.deepEqual(listed.reviews[0], loaded)
})

test('returns structured errors to the client', async (t) => {
  const { endpointPath } = await serviceFixture(t)

  await assert.rejects(
    requestJson(endpointPath, 'GET', '/missing'),
    (error) => error.code === 'NOT_FOUND' && error.statusCode === 404
  )
  await assert.rejects(
    requestJson(
      endpointPath,
      'POST',
      '/reviews/not-an-id/handoff'
    ),
    (error) => error.code === 'INVALID_ID' && error.statusCode === 400
  )
})

test('handoff waits for the latest renderer snapshot barrier', async (t) => {
  let store
  const fixture = await serviceFixture(t, {
    async beforeAction(reviewId) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      const latest = await store.load(reviewId)
      latest.root.children[0].feedback = 'The final unsaved sentence.'
      await store.updateTree(reviewId, latest)
    }
  })
  store = fixture.store

  await requestJson(fixture.endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Review the snapshot barrier.' }
  })
  const handedOff = await requestJson(
    fixture.endpointPath,
    'POST',
    '/reviews/mko_aaa11111/handoff'
  )

  assert.equal(
    handedOff.root.children[0].feedback,
    'The final unsaved sentence.'
  )
  assert.equal(handedOff.review.status, 'pending-agent')
})

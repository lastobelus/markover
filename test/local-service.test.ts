import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test, { type TestContext } from 'node:test'

import { reviewChecksum } from '../src/review-format'

import {
  LocalServiceError,
  probeService,
  readServiceConnection,
  requestServiceQuit,
  requestJson
} from '../src/local-client'
import {
  MAXIMUM_BODY_BYTES,
  readJson,
  startLocalService,
  type LocalServiceOptions
} from '../src/local-service'
import {
  assertReviewArtifact,
  ReviewStore,
  type ReviewArtifact
} from '../src/review-store'
import {
  createServiceIdentity,
  publishServiceConnection,
  tokenPathForEndpoint
} from '../src/service-endpoint'

const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi

type FixtureOptions = Omit<
  LocalServiceOptions,
  'identity' | 'store'
> & { reviewIds?: string[] }

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

function requestBody(contents: string): http.IncomingMessage {
  return Readable.from([Buffer.from(contents)]) as unknown as http.IncomingMessage
}

test('request body limit accepts the exact boundary and rejects one byte more', async () => {
  const exact = JSON.stringify('a'.repeat(MAXIMUM_BODY_BYTES - 2))
  assert.equal(Buffer.byteLength(exact), MAXIMUM_BODY_BYTES)
  assert.equal((await readJson(requestBody(exact)) as string).length, MAXIMUM_BODY_BYTES - 2)

  const oversized = JSON.stringify('a'.repeat(MAXIMUM_BODY_BYTES - 1))
  assert.equal(Buffer.byteLength(oversized), MAXIMUM_BODY_BYTES + 1)
  await assert.rejects(
    readJson(requestBody(oversized)),
    (error: unknown) => (
      error instanceof Error && Reflect.get(error, 'code') === 'BODY_TOO_LARGE'
    )
  )
})

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
    action:
      | 'created'
      | 'handoff'
      | 'get-for-review'
      | 'submit'
      | 'edit'
      | 'revise'
      | 'done'
      | 'observed'
  }> = []
  const store = new ReviewStore(path.join(directory, 'reviews'), {
    idFactory: () => options.reviewIds?.shift() || 'mko_aaa11111'
  })
  const identity = createServiceIdentity()
  const service = await startLocalService({
    identity,
    store,
    beforeAction: options.beforeAction,
    async onChange(artifact, action) {
      changes.push({ artifact, action })
      await options.onChange?.(artifact, action)
    },
    onActivate: options.onActivate,
    onQuit: options.onQuit,
    onUnauthorized: options.onUnauthorized,
    interpretationPolicy: options.interpretationPolicy,
    agentReviewMode: options.agentReviewMode,
    windowVisible: options.windowVisible
  })
  await publishServiceConnection({
    endpointPath,
    identity,
    port: service.port,
    pid: 1234
  })
  t.after(async () => {
    await service.close()
    await fs.rm(directory, { recursive: true, force: true })
  })
  return { changes, endpointPath, identity, port: service.port, service, store }
}

async function rawRequest(
  port: number,
  method: string,
  requestPath: string,
  headers: Record<string, string | string[]> = {},
  body: string | null = null
): Promise<{
  body: unknown
  headers: http.IncomingHttpHeaders
  statusCode: number | undefined
}> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: headers as http.OutgoingHttpHeaders
    }, (response) => {
      response.setEncoding('utf8')
      let contents = ''
      response.on('data', (chunk: string) => { contents += chunk })
      response.on('end', () => {
        resolve({
          body: contents ? JSON.parse(contents) : null,
          headers: response.headers,
          statusCode: response.statusCode
        })
      })
    })
    request.on('error', reject)
    if (body !== null) request.write(body)
    request.end()
  })
}

function assertUnauthorized(
  response: Awaited<ReturnType<typeof rawRequest>>,
  label: string
): void {
  assert.equal(response.statusCode, 401, label)
  assert.equal(
    response.headers['www-authenticate'],
    'Bearer realm="Markover"',
    label
  )
  assert.deepEqual(response.body, {
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authentication required.'
    }
  }, label)
}

function tree(): ReviewTree {
  const source = '# Review\n'
  return parseMarkdown(source, reviewChecksum(source), {
    name: 'review.md',
    path: '/tmp/review.md'
  })
}

test('serves health and a complete open/get/edit workflow', async (t) => {
  const activations: string[] = []
  const { changes, endpointPath, identity } = await serviceFixture(t, {
    interpretationPolicy: () => 'Use the policy captured at open.',
    windowVisible: () => true,
    onActivate(reviewId) {
      activations.push(reviewId)
      return Promise.resolve({ reviewId, outcome: 'activated' })
    }
  })

  assert.deepEqual(
    await requestJson(endpointPath, 'GET', '/health'),
    {
      status: 'ok',
      version: 2,
      instanceId: identity.instanceId,
      windowVisible: true
    }
  )
  assert.equal((await probeService(endpointPath)).windowVisible, true)

  const opened = await requestJson(endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Review the service flow.' }
  })
  assert.deepEqual(opened, {
    reviewId: 'mko_aaa11111',
    status: 'editing'
  })
  assert.deepEqual(
    await requestJson(
      endpointPath,
      'POST',
      '/reviews/mko_aaa11111/activate'
    ),
    { reviewId: 'mko_aaa11111', outcome: 'activated' }
  )
  assert.deepEqual(activations, ['mko_aaa11111'])

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
  assert.equal(
    handedOff.review.agentGuidance.interpretationPolicy,
    'Use the policy captured at open.'
  )
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

test('claims and atomically submits a complete agent review', async (t) => {
  let reviewMode: AgentReviewMode = 'annotations-and-source-proposals'
  const { changes, endpointPath, store } = await serviceFixture(t, {
    agentReviewMode: () => reviewMode
  })
  await requestJson(endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Agent review workflow.' }
  })
  const claimed = expectArtifact(await requestJson(
    endpointPath,
    'POST',
    '/reviews/mko_aaa11111/get-for-review',
    {
      agentThread: {
        id: 'reviewer-thread',
        threadHost: { kind: 't3code', provider: 'codex' }
      }
    }
  ), 'mko_aaa11111')
  assert.equal(claimed.review.status, 'agent-reviewing')
  assert.equal(
    claimed.review.agentReviewer?.mode,
    'annotations-and-source-proposals'
  )
  reviewMode = 'annotation-only'
  assert.deepEqual(
    await requestJson(
      endpointPath,
      'POST',
      '/reviews/mko_aaa11111/get-for-review'
    ),
    claimed
  )

  const submission = structuredClone(claimed)
  child(submission.root).feedback = 'Agent finding.'
  assert.deepEqual(
    await requestJson(
      endpointPath,
      'POST',
      '/reviews/mko_aaa11111/submit',
      { artifact: submission }
    ),
    { reviewId: 'mko_aaa11111', status: 'reviewed' }
  )
  assert.equal((await store.load('mko_aaa11111')).review.status, 'reviewed')
  assert.deepEqual(
    changes.map((change) => change.action),
    ['created', 'get-for-review', 'get-for-review', 'submit']
  )
})

test('a post-commit submit publication failure is uncertain and exact retry repairs it', async (t) => {
  let failPublication = true
  const fixture = await serviceFixture(t, {
    onChange(_artifact, action) {
      if (action === 'submit' && failPublication) {
        failPublication = false
        throw new Error('renderer unavailable')
      }
    }
  })
  await requestJson(fixture.endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Recover an uncertain submit.' }
  })
  const claimed = expectArtifact(await requestJson(
    fixture.endpointPath,
    'POST',
    '/reviews/mko_aaa11111/get-for-review'
  ), 'mko_aaa11111')
  child(claimed.root).feedback = 'Returned despite publication failure.'

  await assert.rejects(
    requestJson(
      fixture.endpointPath,
      'POST',
      '/reviews/mko_aaa11111/submit',
      { artifact: claimed }
    ),
    (error: unknown) => hasServiceError(error, 'REQUEST_UNCERTAIN', 503)
  )
  assert.equal(
    (await fixture.store.load('mko_aaa11111')).review.status,
    'reviewed'
  )
  assert.deepEqual(
    await requestJson(
      fixture.endpointPath,
      'POST',
      '/reviews/mko_aaa11111/submit',
      { artifact: claimed }
    ),
    { reviewId: 'mko_aaa11111', status: 'reviewed' }
  )
})

test('an exact submit retry keeps its reviewed receipt after PR archival', async (t) => {
  let failPublication = true
  const fixture = await serviceFixture(t, {
    onChange(_artifact, action) {
      if (action === 'submit' && failPublication) {
        failPublication = false
        throw new Error('renderer unavailable')
      }
    }
  })
  await requestJson(fixture.endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: {
      contextSummary: 'Recover an archived uncertain submit.',
      git: { repositoryUrl: 'git@github.com:lastobelus/markover.git' },
      pullRequest: { number: 150, fixtureExtension: 'preserve me' }
    }
  })
  const claimed = expectArtifact(await requestJson(
    fixture.endpointPath,
    'POST',
    '/reviews/mko_aaa11111/get-for-review'
  ), 'mko_aaa11111')
  child(claimed.root).feedback = 'Accepted before archival.'

  await assert.rejects(
    requestJson(
      fixture.endpointPath,
      'POST',
      '/reviews/mko_aaa11111/submit',
      { artifact: claimed }
    ),
    (error: unknown) => hasServiceError(error, 'REQUEST_UNCERTAIN', 503)
  )
  await requestJson(fixture.endpointPath, 'POST', '/reviews/done', {
    pullRequestUrl: 'https://github.com/lastobelus/markover/pull/150',
    pullRequestStatus: 'merged'
  })
  assert.equal(
    (await fixture.store.load('mko_aaa11111')).review.status,
    'done'
  )
  assert.deepEqual(
    await requestJson(
      fixture.endpointPath,
      'POST',
      '/reviews/mko_aaa11111/submit',
      { artifact: claimed }
    ),
    { reviewId: 'mko_aaa11111', status: 'reviewed' }
  )
  const stored = await fixture.store.load('mko_aaa11111')
  assert.equal(stored.review.status, 'done')
  assert.equal(
    (stored.review.pullRequest as Record<string, unknown>).fixtureExtension,
    'preserve me'
  )
})

test('get-for-review checks the persisted renderer snapshot before claiming', async (t) => {
  const storeReference: { current?: ReviewStore } = {}
  let rolledBack = false
  const fixture = await serviceFixture(t, {
    async beforeAction(reviewId, action) {
      assert.equal(action, 'get-for-review')
      const latest = await storeReference.current?.load(reviewId)
      assert.ok(latest)
      child(latest.root).feedback = 'Pending human feedback.'
      await storeReference.current?.updateTree(reviewId, latest)
      return () => { rolledBack = true }
    }
  })
  storeReference.current = fixture.store
  await requestJson(fixture.endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Flush before claim.' }
  })

  await assert.rejects(
    requestJson(
      fixture.endpointPath,
      'POST',
      '/reviews/mko_aaa11111/get-for-review'
    ),
    (error: unknown) => hasServiceError(error, 'REVIEW_NOT_PRISTINE', 409)
  )
  const stored = await fixture.store.load('mko_aaa11111')
  assert.equal(stored.review.status, 'editing')
  assert.equal(child(stored.root).feedback, 'Pending human feedback.')
  assert.equal(rolledBack, true)
})

test('persists PR observations through revise and PR-scoped done', async (t) => {
  const { changes, endpointPath, store } = await serviceFixture(t)
  assert.deepEqual(
    await requestJson(endpointPath, 'POST', '/reviews', {
      tree: tree(),
      pullRequestStatus: 'draft',
      metadata: {
        contextSummary: 'Review the PR lifecycle.',
        git: {
          repositoryUrl: 'git@github.com:lastobelus/markover.git'
        },
        pullRequest: { number: 123, fixtureExtension: 'preserve me' }
      }
    }),
    { reviewId: 'mko_aaa11111', status: 'editing' }
  )

  const handedOff = expectArtifact(await requestJson(
    endpointPath,
    'POST',
    '/reviews/mko_aaa11111/handoff',
    { pullRequestStatus: 'open' }
  ), 'mko_aaa11111')
  assert.equal(handedOff.review.status, 'pending-agent')
  assert.equal(
    (handedOff.review.pullRequest as Record<string, unknown>).status,
    'open'
  )

  assert.deepEqual(
    await requestJson(
      endpointPath,
      'POST',
      '/reviews/mko_aaa11111/revise',
      { pullRequestStatus: 'open' }
    ),
    { reviewId: 'mko_aaa11111', status: 'revised' }
  )
  assert.deepEqual(
    await requestJson(endpointPath, 'POST', '/reviews/done', {
      pullRequestUrl: 'https://github.com/lastobelus/markover/pull/123',
      pullRequestStatus: 'merged'
    }),
    {
      pullRequestUrl: 'https://github.com/lastobelus/markover/pull/123',
      reviewIds: ['mko_aaa11111'],
      status: 'done'
    }
  )
  const completed = await store.load('mko_aaa11111')
  assert.equal(completed.review.status, 'done')
  assert.deepEqual(completed.review.pullRequest, {
    number: 123,
    fixtureExtension: 'preserve me',
    url: 'https://github.com/lastobelus/markover/pull/123',
    status: 'merged',
    statusObservedAt: completed.review.updatedAt,
    statusSource: 'agent'
  })
  assert.deepEqual(
    changes.map((change) => change.action),
    ['created', 'handoff', 'revise', 'done']
  )
  assert.deepEqual(
    await requestJson(endpointPath, 'POST', '/reviews/done', {
      pullRequestUrl: 'https://github.com/lastobelus/markover/pull/999',
      pullRequestStatus: 'merged'
    }),
    {
      pullRequestUrl: 'https://github.com/lastobelus/markover/pull/999',
      reviewIds: [],
      status: 'done'
    }
  )
})

test('a received PR observation refreshes every matching stored review', async (t) => {
  const { changes, endpointPath, store } = await serviceFixture(t, {
    reviewIds: ['mko_aaa11111', 'mko_bbb22222']
  })
  const metadata = {
    contextSummary: 'Review the shared PR.',
    git: { repositoryUrl: 'git@github.com:lastobelus/markover.git' },
    pullRequest: { number: 123 }
  }
  await requestJson(endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata
  })
  await requestJson(endpointPath, 'POST', '/reviews', {
    tree: tree(),
    pullRequestStatus: 'open',
    metadata
  })

  const earlier = await store.load('mko_aaa11111')
  assert.equal(
    (earlier.review.pullRequest as Record<string, unknown>).status,
    'open'
  )
  assert.deepEqual(
    changes.map((change) => change.action),
    ['created', 'created', 'observed']
  )
})

test('done captures an editing review before completing it', async (t) => {
  const barriers: Array<{ reviewId: string; action: string }> = []
  const { endpointPath } = await serviceFixture(t, {
    beforeAction(reviewId, action) {
      barriers.push({ reviewId, action })
      return Promise.resolve(undefined)
    }
  })
  await requestJson(endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: {
      contextSummary: 'Review before merge.',
      git: { repositoryUrl: 'https://github.com/lastobelus/markover' },
      pullRequest: { number: 123 }
    }
  })
  await requestJson(endpointPath, 'POST', '/reviews/done', {
    pullRequestUrl: 'https://github.com/lastobelus/markover/pull/123',
    pullRequestStatus: 'merged'
  })
  assert.deepEqual(barriers, [{
    reviewId: 'mko_aaa11111',
    action: 'done'
  }])
})

test('done rechecks and serializes a review that becomes editable', async (t) => {
  let releaseCandidates!: () => void
  let candidatesFound!: () => void
  const candidatesReady = new Promise<void>((resolve) => {
    candidatesFound = resolve
  })
  const candidatesBarrier = new Promise<void>((resolve) => {
    releaseCandidates = resolve
  })
  const storeReference: { current?: ReviewStore } = {}
  const barriers: string[] = []
  const fixture = await serviceFixture(t, {
    async beforeAction(reviewId, action) {
      if (action !== 'done') return
      barriers.push(reviewId)
      assert.ok(storeReference.current)
      const latest = await storeReference.current.load(reviewId)
      child(latest.root).feedback = 'Captured after the review became editable.'
      await storeReference.current.updateTree(reviewId, latest)
    }
  })
  storeReference.current = fixture.store
  await requestJson(fixture.endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: {
      contextSummary: 'Complete after an edit race.',
      git: { repositoryUrl: 'https://github.com/lastobelus/markover' },
      pullRequest: { number: 123 }
    }
  })
  await requestJson(
    fixture.endpointPath,
    'POST',
    '/reviews/mko_aaa11111/handoff'
  )

  const matching = fixture.store.matchingPullRequestReviews.bind(fixture.store)
  fixture.store.matchingPullRequestReviews = async (pullRequestUrl) => {
    const candidates = await matching(pullRequestUrl)
    candidatesFound()
    await candidatesBarrier
    return candidates
  }
  const done = requestJson(fixture.endpointPath, 'POST', '/reviews/done', {
    pullRequestUrl: 'https://github.com/lastobelus/markover/pull/123',
    pullRequestStatus: 'merged'
  })
  await candidatesReady
  assert.deepEqual(
    await requestJson(
      fixture.endpointPath,
      'POST',
      '/reviews/mko_aaa11111/edit'
    ),
    { reviewId: 'mko_aaa11111', status: 'editing' }
  )
  releaseCandidates()
  await done

  const completed = await fixture.store.load('mko_aaa11111')
  assert.deepEqual(barriers, ['mko_aaa11111'])
  assert.equal(completed.review.status, 'done')
  assert.equal(
    child(completed.root).feedback,
    'Captured after the review became editable.'
  )
})

test('authenticated quit acknowledges and invokes the app callback', async (t) => {
  let quits = 0
  const { endpointPath } = await serviceFixture(t, {
    onQuit() {
      quits += 1
    }
  })

  await requestServiceQuit(endpointPath)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(quits, 1)
})

test('rejects hostile credential forms before routing or bodies', async (t) => {
  const unauthorized: Array<{
    method: string
    pathname: string
    reason: string
  }> = []
  const fixture = await serviceFixture(t, {
    onUnauthorized(event) {
      unauthorized.push(event)
    }
  })
  const wrongToken = fixture.identity.token === 'B'.repeat(43)
    ? 'C'.repeat(43)
    : 'B'.repeat(43)
  const credentials: Array<{
    authorization?: string | string[]
    reason: 'missing' | 'malformed' | 'mismatch'
  }> = [
    { reason: 'missing' },
    { authorization: 'Basic credential', reason: 'malformed' },
    { authorization: 'Bearer', reason: 'malformed' },
    { authorization: 'Bearer short', reason: 'malformed' },
    { authorization: `Bearer ${'A'.repeat(42)}`, reason: 'malformed' },
    { authorization: `Bearer ${'A'.repeat(44)}`, reason: 'malformed' },
    { authorization: `Bearer ${'A'.repeat(42)}*`, reason: 'malformed' },
    { authorization: `Bearer\t${fixture.identity.token}`, reason: 'malformed' },
    {
      authorization: `Bearer ${fixture.identity.token} extra`,
      reason: 'malformed'
    },
    { authorization: `Bearer ${wrongToken}`, reason: 'mismatch' },
    {
      authorization: [
        `Bearer ${fixture.identity.token}`,
        `Bearer ${fixture.identity.token}`
      ],
      reason: 'malformed'
    }
  ]

  for (const [index, credential] of credentials.entries()) {
    const response = await rawRequest(
      fixture.port,
      'POST',
      '/reviews?private=secret',
      credential.authorization
        ? { authorization: credential.authorization }
        : {},
      '{'
    )
    assertUnauthorized(response, `credential ${String(index)}`)
  }

  assert.deepEqual(
    unauthorized.map(({ method, pathname, reason }) => ({
      method,
      pathname,
      reason
    })),
    credentials.map(({ reason }) => ({
      method: 'POST',
      pathname: '/reviews',
      reason
    }))
  )
  assert.deepEqual(await fixture.store.list(), [])
  assert.deepEqual(fixture.changes, [])
})

test('gates every current non-health route with real HTTP', async (t) => {
  let beforeActions = 0
  const fixture = await serviceFixture(t, {
    beforeAction() {
      beforeActions += 1
      return Promise.resolve(undefined)
    }
  })
  const wrongToken = fixture.identity.token === 'B'.repeat(43)
    ? 'C'.repeat(43)
    : 'B'.repeat(43)
  const routes = [
    { method: 'GET', path: '/reviews', body: null },
    { method: 'POST', path: '/reviews', body: '{' },
    { method: 'GET', path: '/reviews/mko_missing1', body: null },
    { method: 'POST', path: '/reviews/mko_missing1/activate', body: null },
    { method: 'POST', path: '/reviews/mko_missing1/handoff', body: null },
    { method: 'POST', path: '/reviews/mko_missing1/get-for-review', body: null },
    { method: 'POST', path: '/reviews/mko_missing1/submit', body: '{' },
    { method: 'POST', path: '/reviews/mko_missing1/edit', body: null },
    { method: 'POST', path: '/reviews/mko_missing1/revise', body: null },
    { method: 'POST', path: '/reviews/done', body: '{' },
    { method: 'POST', path: '/quit', body: null },
    { method: 'GET', path: '/missing?private=secret', body: null },
    { method: 'GET', path: '/health?details=1', body: null },
    { method: 'POST', path: '/health', body: '{' }
  ]

  for (const route of routes) {
    assertUnauthorized(
      await rawRequest(
        fixture.port,
        route.method,
        route.path,
        {},
        route.body
      ),
      `${route.method} ${route.path} without a credential`
    )
    assertUnauthorized(
      await rawRequest(
        fixture.port,
        route.method,
        route.path,
        { authorization: `Bearer ${wrongToken}` },
        route.body
      ),
      `${route.method} ${route.path} with an incorrect credential`
    )
  }

  const health = await rawRequest(fixture.port, 'GET', '/health')
  assert.equal(health.statusCode, 200)
  assert.deepEqual(health.body, {
    status: 'ok',
    version: 2,
    instanceId: fixture.identity.instanceId,
    windowVisible: false
  })
  assert.deepEqual(await fixture.store.list(), [])
  assert.deepEqual(fixture.changes, [])
  assert.equal(beforeActions, 0)
})

test('accepts standards-valid Bearer scheme and spacing variants', async (t) => {
  const fixture = await serviceFixture(t)
  for (const authorization of [
    `Bearer ${fixture.identity.token}`,
    `bearer ${fixture.identity.token}`,
    `BEARER    ${fixture.identity.token}`
  ]) {
    const response = await rawRequest(fixture.port, 'GET', '/reviews', {
      authorization
    })
    assert.equal(response.statusCode, 200, authorization)
    assert.deepEqual(response.body, { reviews: [] }, authorization)
  }
})

test('categorizes invalid, stale, and rejected service credentials', async (t) => {
  const fixture = await serviceFixture(t)
  const tokenPath = tokenPathForEndpoint(fixture.endpointPath)

  await fs.writeFile(tokenPath, '{}')
  assert.deepEqual(
    await requestJson(fixture.endpointPath, 'GET', '/health'),
    {
      status: 'ok',
      version: 2,
      instanceId: fixture.identity.instanceId,
      windowVisible: false
    }
  )
  await assert.rejects(
    requestJson(fixture.endpointPath, 'GET', '/reviews'),
    (error: unknown) => (
      error instanceof LocalServiceError &&
      error.code === 'INVALID_CREDENTIAL'
    )
  )

  await fs.writeFile(tokenPath, JSON.stringify({
    version: 1,
    instanceId: '22222222-2222-4222-8222-222222222222',
    token: fixture.identity.token
  }))
  await assert.rejects(
    requestJson(fixture.endpointPath, 'GET', '/reviews'),
    (error: unknown) => (
      error instanceof LocalServiceError && error.code === 'STALE_SERVICE'
    )
  )

  await fs.writeFile(tokenPath, JSON.stringify({
    version: 1,
    instanceId: fixture.identity.instanceId,
    token: fixture.identity.token === 'B'.repeat(43)
      ? 'C'.repeat(43)
      : 'B'.repeat(43)
  }))
  await assert.rejects(
    requestJson(fixture.endpointPath, 'GET', '/reviews'),
    (error: unknown) => hasServiceError(error, 'UNAUTHORIZED', 401)
  )

  await fs.writeFile(fixture.endpointPath, JSON.stringify({
    version: 1,
    port: fixture.port
  }))
  await assert.rejects(
    requestJson(fixture.endpointPath, 'GET', '/health'),
    (error: unknown) => (
      error instanceof LocalServiceError && error.code === 'INVALID_ENDPOINT'
    )
  )
})

test('record reads converge within their bounded retry window', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-record-convergence-test-')
  )
  const endpointPath = path.join(directory, 'service.json')
  const identity = createServiceIdentity()
  await publishServiceConnection({
    endpointPath,
    identity,
    port: 43210,
    pid: 1234
  })
  const mismatchedIdentity = createServiceIdentity()
  await fs.writeFile(tokenPathForEndpoint(endpointPath), JSON.stringify({
    version: 1,
    instanceId: mismatchedIdentity.instanceId,
    token: identity.token
  }))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  let waits = 0
  const connection = await readServiceConnection(endpointPath, {
    retryDelaysMilliseconds: [0, 1],
    async wait() {
      waits += 1
      await fs.writeFile(tokenPathForEndpoint(endpointPath), JSON.stringify({
        version: 1,
        instanceId: identity.instanceId,
        token: identity.token
      }))
    }
  })

  assert.equal(waits, 1)
  assert.deepEqual(connection, {
    endpoint: {
      version: 2,
      instanceId: identity.instanceId,
      port: 43210,
      pid: 1234
    },
    credential: {
      version: 1,
      instanceId: identity.instanceId,
      token: identity.token
    }
  })
})

test('health identity mismatch prevents secret request transmission', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-health-mismatch-test-')
  )
  const endpointPath = path.join(directory, 'service.json')
  const identity = createServiceIdentity()
  const received: Array<{
    authorization: string | undefined
    body: string
    method: string | undefined
    url: string | undefined
  }> = []
  const fakeService = http.createServer((request, response) => {
    request.setEncoding('utf8')
    let body = ''
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      received.push({
        authorization: request.headers.authorization,
        body,
        method: request.method,
        url: request.url
      })
      const contents = `${JSON.stringify({
        status: 'ok',
        version: 2,
        instanceId: createServiceIdentity().instanceId
      })}\n`
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(contents)
      })
      response.end(contents)
    })
  })
  await new Promise<void>((resolve) => fakeService.listen(0, '127.0.0.1', resolve))
  const address = fakeService.address()
  assert.ok(address && typeof address === 'object')
  await publishServiceConnection({
    endpointPath,
    identity,
    port: address.port,
    pid: 1234
  })
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      fakeService.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    await fs.rm(directory, { recursive: true, force: true })
  })

  await assert.rejects(
    requestJson(endpointPath, 'POST', '/reviews', {
      private: 'review contents'
    }),
    (error: unknown) => (
      error instanceof LocalServiceError && error.code === 'STALE_SERVICE'
    )
  )
  assert.deepEqual(received, [{
    authorization: undefined,
    body: '',
    method: 'GET',
    url: '/health'
  }])
})

test('authenticated requests never cache a successful health preflight', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-health-freshness-test-')
  )
  const endpointPath = path.join(directory, 'service.json')
  const identity = createServiceIdentity()
  const received: Array<{ authorized: boolean; url: string | undefined }> = []
  const fakeService = http.createServer((request, response) => {
    received.push({
      authorized: typeof request.headers.authorization === 'string',
      url: request.url
    })
    const body = request.url === '/health'
      ? { status: 'ok', version: 2, instanceId: identity.instanceId }
      : { reviews: [] }
    const contents = `${JSON.stringify(body)}\n`
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(contents)
    })
    response.end(contents)
  })
  await new Promise<void>((resolve) => fakeService.listen(0, '127.0.0.1', resolve))
  const address = fakeService.address()
  assert.ok(address && typeof address === 'object')
  await publishServiceConnection({
    endpointPath,
    identity,
    port: address.port,
    pid: 1234
  })
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      fakeService.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    await fs.rm(directory, { recursive: true, force: true })
  })

  assert.deepEqual(
    await requestJson(endpointPath, 'GET', '/reviews'),
    { reviews: [] }
  )
  assert.deepEqual(
    await requestJson(endpointPath, 'GET', '/reviews'),
    { reviews: [] }
  )
  assert.deepEqual(received, [
    { authorized: false, url: '/health' },
    { authorized: true, url: '/reviews' },
    { authorized: false, url: '/health' },
    { authorized: true, url: '/reviews' }
  ])
})

test('aborted authenticated responses are uncertain requests', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-aborted-response-test-')
  )
  const endpointPath = path.join(directory, 'service.json')
  const identity = createServiceIdentity()
  let mutationReceived = false
  const fakeService = http.createServer((request, response) => {
    if (request.url === '/health') {
      const contents = `${JSON.stringify({
        status: 'ok',
        version: 2,
        instanceId: identity.instanceId
      })}\n`
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(contents)
      })
      response.end(contents)
      return
    }

    mutationReceived = true
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': 100
    })
    response.flushHeaders()
    setImmediate(() => {
      response.destroy()
    })
  })
  await new Promise<void>((resolve) => fakeService.listen(0, '127.0.0.1', resolve))
  const address = fakeService.address()
  assert.ok(address && typeof address === 'object')
  await publishServiceConnection({
    endpointPath,
    identity,
    port: address.port,
    pid: 1234
  })
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      fakeService.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    await fs.rm(directory, { recursive: true, force: true })
  })

  const outcome = await Promise.race([
    requestJson(endpointPath, 'POST', '/reviews', {
      tree: tree(),
      metadata: { contextSummary: 'Simulate a persisted mutation.' }
    }).catch((error: unknown) => error),
    new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null)
      }, 250)
    })
  ])

  assert.equal(mutationReceived, true)
  assert.ok(outcome instanceof LocalServiceError)
  assert.equal(outcome.code, 'REQUEST_UNCERTAIN')
  assert.match(outcome.message, /Inspect Markover before retrying/)
})

test('rejects an invalid authorization token before listening', async () => {
  await assert.rejects(
    startLocalService({
      identity: {
        instanceId: '11111111-1111-4111-8111-111111111111',
        token: 'short'
      },
      store: new ReviewStore('/unused/reviews')
    }),
    /service identity is invalid/
  )
})

test('diagnostic callback failures cannot change a rejection', async (t) => {
  const fixture = await serviceFixture(t, {
    onUnauthorized() {
      throw new Error('simulated diagnostic failure')
    }
  })
  const response = await rawRequest(fixture.port, 'GET', '/reviews')
  assert.equal(response.statusCode, 401)
  assert.deepEqual(response.body, {
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authentication required.'
    }
  })
})

test('lists and loads reviews through one-shot requests', async (t) => {
  const { endpointPath, store } = await serviceFixture(t)
  await requestJson(endpointPath, 'POST', '/reviews', {
    tree: tree(),
    metadata: { contextSummary: 'Review listing.' }
  })
  await fs.writeFile(
    path.join(store.directory, 'mko_aaa11111', 'enrichment.json'),
    JSON.stringify({ canonicalPath: '/private/do-not-export.md' }),
    'utf8'
  )

  const listed = expectRecord(await requestJson(endpointPath, 'GET', '/reviews'))
  const loaded = await requestJson(
    endpointPath,
    'GET',
    '/reviews/mko_aaa11111'
  )
  assert.ok(Array.isArray(listed.reviews))
  assert.equal(listed.reviews.length, 1)
  assert.deepEqual(listed.reviews[0], loaded)
  assert.doesNotMatch(JSON.stringify({ listed, loaded }), /enrichment|canonicalPath|do-not-export/)
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

  const invalidTree = tree()
  Reflect.set(invalidTree.root, 'children', 'not-an-array')
  await assert.rejects(
    requestJson(endpointPath, 'POST', '/reviews', {
      tree: invalidTree,
      metadata: { contextSummary: 'Reject malformed collections.' }
    }),
    (error: unknown) => hasServiceError(error, 'INVALID_REVIEW', 400)
  )
})

test('unknown review versions cross the service as conflict errors without rewriting', async (t) => {
  const { endpointPath, store } = await serviceFixture(t)
  const created = await store.create({
    tree: tree(),
    contextSummary: 'Preserve future service data.'
  })
  const future = structuredClone(created) as unknown as Record<string, unknown>
  future.version = 2
  const bytes = `${JSON.stringify(future, null, 2)}\n`
  await fs.writeFile(store.reviewPath(created.review.id), bytes, 'utf8')

  await assert.rejects(
    requestJson(
      endpointPath,
      'POST',
      `/reviews/${created.review.id}/handoff`
    ),
    (error: unknown) => hasServiceError(
      error,
      'UNSUPPORTED_REVIEW_VERSION',
      409
    )
  )
  assert.equal(await fs.readFile(store.reviewPath(created.review.id), 'utf8'), bytes)
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

test('pausing mutations drains active work and rejects new mutations', async (t) => {
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
    metadata: { contextSummary: 'Review shutdown mutation gating.' }
  })

  const handoff = requestJson(
    fixture.endpointPath,
    'POST',
    '/reviews/mko_aaa11111/handoff'
  )
  await snapshotReady
  let paused = false
  const pause = fixture.service.pauseMutations().then(() => { paused = true })
  await Promise.resolve()
  assert.equal(paused, false)
  await assert.rejects(
    requestJson(
      fixture.endpointPath,
      'POST',
      '/reviews/mko_aaa11111/edit'
    ),
    (error: unknown) => hasServiceError(error, 'SHUTTING_DOWN', 503)
  )

  releaseSnapshot()
  await handoff
  await pause
  assert.equal(paused, true)
  fixture.service.resumeMutations()
  const edited = expectRecord(await requestJson(
    fixture.endpointPath,
    'POST',
    '/reviews/mko_aaa11111/edit'
  ))
  assert.equal(edited.status, 'editing')
})

test('pausing mutations drains activation and rejects a new activation', async (t) => {
  let releaseActivation!: () => void
  let activationStarted!: () => void
  const activationReady = new Promise<void>((resolve) => {
    activationStarted = resolve
  })
  const activationBarrier = new Promise<void>((resolve) => {
    releaseActivation = resolve
  })
  const fixture = await serviceFixture(t, {
    async onActivate(reviewId) {
      activationStarted()
      await activationBarrier
      return { reviewId, outcome: 'activated' }
    }
  })

  const activation = requestJson(
    fixture.endpointPath,
    'POST',
    '/reviews/mko_aaa11111/activate'
  )
  await activationReady
  let paused = false
  const pause = fixture.service.pauseMutations().then(() => { paused = true })
  await Promise.resolve()
  assert.equal(paused, false)
  await assert.rejects(
    requestJson(
      fixture.endpointPath,
      'POST',
      '/reviews/mko_aaa11111/activate'
    ),
    (error: unknown) => hasServiceError(error, 'SHUTTING_DOWN', 503)
  )

  releaseActivation()
  await activation
  await pause
  assert.equal(paused, true)
})

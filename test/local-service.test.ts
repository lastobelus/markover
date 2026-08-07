import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  LocalServiceError,
  readServiceConnection,
  requestJson
} from '../src/local-client'
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
import {
  createServiceIdentity,
  publishServiceConnection,
  tokenPathForEndpoint
} from '../src/service-endpoint'

const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi

type FixtureOptions = Omit<
  LocalServiceOptions,
  'identity' | 'store'
>

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
  const identity = createServiceIdentity()
  const service = await startLocalService({
    identity,
    store,
    beforeAction: options.beforeAction,
    importReviews: options.importReviews,
    async onChange(artifact, action) {
      changes.push({ artifact, action })
      await options.onChange?.(artifact, action)
    },
    onActivate: options.onActivate,
    onUnauthorized: options.onUnauthorized,
    interpretationPolicy: options.interpretationPolicy
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
  return parseMarkdown('# Review\n', 'sha256:test', {
    name: 'review.md',
    path: '/tmp/review.md'
  })
}

test('serves health and a complete open/get/edit workflow', async (t) => {
  const activations: string[] = []
  const { changes, endpointPath, identity } = await serviceFixture(t, {
    interpretationPolicy: () => 'Use the policy captured at open.',
    onActivate(reviewId) {
      activations.push(reviewId)
      return Promise.resolve({ reviewId, outcome: 'activated' })
    }
  })

  assert.deepEqual(
    await requestJson(endpointPath, 'GET', '/health'),
    { status: 'ok', version: 2, instanceId: identity.instanceId }
  )

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
  let imports = 0
  const fixture = await serviceFixture(t, {
    beforeAction() {
      beforeActions += 1
      return Promise.resolve(undefined)
    },
    importReviews() {
      imports += 1
      return Promise.resolve([])
    }
  })
  const wrongToken = fixture.identity.token === 'B'.repeat(43)
    ? 'C'.repeat(43)
    : 'B'.repeat(43)
  const routes = [
    { method: 'GET', path: '/reviews', body: null },
    { method: 'POST', path: '/reviews/import', body: '{' },
    { method: 'POST', path: '/reviews', body: '{' },
    { method: 'GET', path: '/reviews/mko_missing1', body: null },
    { method: 'POST', path: '/reviews/mko_missing1/activate', body: null },
    { method: 'POST', path: '/reviews/mko_missing1/handoff', body: null },
    { method: 'POST', path: '/reviews/mko_missing1/edit', body: null },
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
    instanceId: fixture.identity.instanceId
  })
  assert.deepEqual(await fixture.store.list(), [])
  assert.deepEqual(fixture.changes, [])
  assert.equal(beforeActions, 0)
  assert.equal(imports, 0)
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
      instanceId: fixture.identity.instanceId
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

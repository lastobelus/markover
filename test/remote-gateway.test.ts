import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import type { ResolvedInstance } from '../src/instance'
import { startLocalService } from '../src/local-service'
import {
  hasRemoteGatewayCapability,
  remoteGatewayActivationEligible,
  remoteGatewayHostEligible,
  REMOTE_GATEWAY_CAPABILITY,
  REMOTE_GATEWAY_CAPABILITY_HEADER,
  REMOTE_GATEWAY_IDEMPOTENCY_HEADER,
  REMOTE_GATEWAY_REQUEST_DIGEST_HEADER,
  RemoteGatewayError,
  startRemoteGateway,
  type RemoteGateway
} from '../src/remote-gateway'
import { reviewChecksum } from '../src/review-format'
import { ReviewStore, type ReviewArtifact } from '../src/review-store'
import { createServiceIdentity } from '../src/service-endpoint'

const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi

interface GatewayFixture {
  changes: string[]
  directory: string
  gateway: RemoteGateway
  routingChecks: () => number
  socketPath: string
  store: ReviewStore
}

function tree(): ReviewTree {
  const source = '# Remote review\n\nReview this from htulo.\n'
  return parseMarkdown(source, reviewChecksum(source), {
    name: 'remote.md',
    path: '/Users/lasto/remote.md'
  })
}

function digest(bytes: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function capabilityHeader(
  value: unknown = { [REMOTE_GATEWAY_CAPABILITY]: [{ access: 'author' }] }
): Record<string, string> {
  return { [REMOTE_GATEWAY_CAPABILITY_HEADER]: JSON.stringify(value) }
}

function responseErrorCode(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const error = (body as Record<string, unknown>).error
  return error && typeof error === 'object' && !Array.isArray(error)
    ? (error as Record<string, unknown>).code
    : null
}

function createHeaders(bytes: Uint8Array): Record<string, string> {
  return {
    ...capabilityHeader(),
    [REMOTE_GATEWAY_IDEMPOTENCY_HEADER]: 'A'.repeat(43),
    [REMOTE_GATEWAY_REQUEST_DIGEST_HEADER]: digest(bytes)
  }
}

async function requestGateway(
  socketPath: string,
  method: string,
  requestPath: string,
  headers: Record<string, string | string[]> = {},
  body: Uint8Array = Buffer.alloc(0)
): Promise<{ body: unknown; statusCode: number | undefined }> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      socketPath,
      method,
      path: requestPath,
      headers: {
        'content-length': body.byteLength,
        ...headers
      }
    }, (response) => {
      const chunks: Uint8Array[] = []
      response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      response.on('end', () => {
        const bytes = Buffer.concat(chunks)
        resolve({
          body: bytes.byteLength ? JSON.parse(bytes.toString('utf8')) : null,
          statusCode: response.statusCode
        })
      })
    })
    request.on('error', reject)
    request.end(body)
  })
}

async function gatewayFixture(
  t: TestContext,
  options: {
    beforeAction?: () => Promise<undefined>
    discoveryPolicy?: boolean
  } = {}
): Promise<GatewayFixture> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-remote-gateway-test-')
  )
  const store = new ReviewStore(path.join(directory, 'reviews'), {
    idFactory: () => 'mko_aaa11111'
  })
  const identity = createServiceIdentity()
  const changes: string[] = []
  const service = await startLocalService({
    identity,
    store,
    beforeAction: options.beforeAction,
    onChange(_artifact, action) {
      changes.push(action)
    }
  })
  let routingChecks = 0
  const socketPath = path.join(directory, 'state', 'remote.sock')
  const gateway = await startRemoteGateway({
    socketPath,
    localPort: service.port,
    localToken: identity.token,
    discoveryPolicy: () => options.discoveryPolicy ?? false,
    routingReady() {
      routingChecks += 1
      return Promise.resolve()
    }
  })
  t.after(async () => {
    await gateway.close()
    await service.close()
    await fs.rm(directory, { recursive: true, force: true })
  })
  return {
    changes,
    directory,
    gateway,
    routingChecks: () => routingChecks,
    socketPath,
    store
  }
}

function canonicalInstance(checkout: string | null): ResolvedInstance {
  return {
    version: 1,
    identity: { kind: 'canonical', key: 'canonical' },
    stateRoot: '/state',
    checkout,
    service: {
      root: '/state',
      endpointPath: '/state/service.json',
      tokenPath: '/state/service.token',
      singleInstanceLockRoot: '/state'
    },
    scheme: 'markover',
    process: { status: 'running' },
    coldStart: { eligible: false, blockedBy: 'already-running' },
    branding: {
      appName: 'Markover',
      headerBadge: null,
      iconLabel: null,
      iconSvgPath: 'mark.svg',
      iconPngPath: 'mark.png',
      iconIcnsPath: 'mark.icns'
    },
    pullRequest: null
  }
}

test('activation requires a configured non-smoke canonical macOS instance', () => {
  const configured = canonicalInstance('/checkouts/main')
  assert.equal(remoteGatewayActivationEligible(configured, false, 'darwin'), true)
  assert.equal(remoteGatewayActivationEligible(configured, true, 'darwin'), false)
  assert.equal(remoteGatewayActivationEligible(configured, false, 'linux'), false)
  assert.equal(
    remoteGatewayActivationEligible(canonicalInstance(null), false, 'darwin'),
    false
  )
  assert.equal(
    remoteGatewayHostEligible(canonicalInstance(null), false, 'darwin'),
    true
  )
  const development = structuredClone(configured)
  development.identity = {
    kind: 'development',
    key: 'pr-187',
    pullRequestNumber: 187
  }
  development.scheme = 'markover-187'
  development.pullRequest = { number: 187, state: 'open' }
  assert.equal(remoteGatewayActivationEligible(development, false, 'darwin'), false)
  assert.equal(remoteGatewayHostEligible(development, false, 'darwin'), false)
})

test('capability parser accepts one exact forwarded app capability', () => {
  assert.equal(hasRemoteGatewayCapability(capabilityHeader()), true)
  for (const value of [
    {},
    { [REMOTE_GATEWAY_CAPABILITY]: [] },
    { [REMOTE_GATEWAY_CAPABILITY]: [{}], 'example.com/extra': [{}] },
    { 'example.com/wrong': [{}] }
  ]) {
    assert.equal(hasRemoteGatewayCapability(capabilityHeader(value)), false)
  }
  assert.equal(hasRemoteGatewayCapability({
    [REMOTE_GATEWAY_CAPABILITY_HEADER]: '{'
  }), false)
})

test('gateway authenticates before routes and bodies and exposes bounded health', async (t) => {
  const fixture = await gatewayFixture(t, { discoveryPolicy: true })
  const checksAfterStartup = fixture.routingChecks()

  const denied = await requestGateway(
    fixture.socketPath,
    'POST',
    '/reviews',
    {},
    Buffer.from('{')
  )
  assert.equal(denied.statusCode, 403)
  assert.deepEqual(denied.body, {
    error: {
      code: 'REMOTE_CAPABILITY_REQUIRED',
      message: 'Remote Markover capability required.'
    }
  })
  assert.equal(fixture.routingChecks(), checksAfterStartup)

  const health = await requestGateway(
    fixture.socketPath,
    'GET',
    '/health',
    capabilityHeader()
  )
  assert.equal(health.statusCode, 200)
  assert.deepEqual(health.body, {
    status: 'ok',
    protocol: { name: 'markover-remote', version: 1 },
    role: 'canonical',
    scheme: 'markover',
    discoverAgentThreadFromLocalSessions: true
  })
  assert.doesNotMatch(JSON.stringify(health.body), /path|process|instanceId|port/)

  for (const route of [
    ['GET', '/reviews'],
    ['GET', '/reviews/mko_aaa11111'],
    ['POST', '/reviews/mko_aaa11111/get-for-review'],
    ['POST', '/reviews/mko_aaa11111/submit'],
    ['POST', '/reviews/mko_aaa11111/resolve'],
    ['POST', '/quit'],
    ['GET', '/health?details=1']
  ] as const) {
    const response = await requestGateway(
      fixture.socketPath,
      route[0],
      route[1],
      capabilityHeader(),
      Buffer.from('{')
    )
    assert.equal(response.statusCode, 404, `${route[0]} ${route[1]}`)
  }
  assert.deepEqual(await fixture.store.list(), [])
})

test('remote create pins origin, recovers by key, and returns canonical URLs', async (t) => {
  const fixture = await gatewayFixture(t)
  const body = Buffer.from(JSON.stringify({
    tree: tree(),
    metadata: {
      contextSummary: 'Review the remote gateway path.',
      agentThread: {
        id: 'thread-187',
        threadHost: { kind: 't3', provider: 'openai' }
      }
    }
  }))

  const created = await requestGateway(
    fixture.socketPath,
    'POST',
    '/reviews',
    createHeaders(body),
    body
  )
  assert.equal(created.statusCode, 201)
  assert.deepEqual(created.body, {
    created: true,
    reviewId: 'mko_aaa11111',
    status: 'editing',
    reviewUrl: 'markover://review/mko_aaa11111'
  })
  const stored = await fixture.store.load('mko_aaa11111')
  assert.equal(stored.review.origin, 'remote-agent')
  assert.deepEqual(stored.review.creationReceipt, {
    version: 1,
    keyDigest: digest('A'.repeat(43)),
    requestDigest: digest(body)
  })
  assert.deepEqual(fixture.changes, ['created'])

  const recovered = await requestGateway(
    fixture.socketPath,
    'POST',
    '/reviews',
    createHeaders(body)
  )
  assert.equal(recovered.statusCode, 200)
  assert.deepEqual(recovered.body, {
    created: false,
    reviewId: 'mko_aaa11111',
    status: 'editing',
    reviewUrl: 'markover://review/mko_aaa11111'
  })
  assert.deepEqual(fixture.changes, ['created'])

  const conflictingBody = Buffer.from(JSON.stringify({
    tree: tree(),
    metadata: { contextSummary: 'A conflicting retry.' }
  }))
  const conflict = await requestGateway(
    fixture.socketPath,
    'POST',
    '/reviews',
    createHeaders(conflictingBody),
    conflictingBody
  )
  assert.equal(conflict.statusCode, 409)
  assert.equal(responseErrorCode(conflict.body), 'IDEMPOTENCY_CONFLICT')
  const conflictError = (conflict.body as {
    error: { creationReceipt: { requestDigest: string }; reviewId: string }
  }).error
  assert.equal(conflictError.reviewId, 'mko_aaa11111')
  assert.equal(conflictError.creationReceipt.requestDigest, digest(body))

  const handedOff = await requestGateway(
    fixture.socketPath,
    'POST',
    '/reviews/mko_aaa11111/handoff',
    capabilityHeader()
  )
  assert.equal(handedOff.statusCode, 200)
  assert.equal((handedOff.body as ReviewArtifact).review.status, 'pending-agent')

  const pending = await requestGateway(
    fixture.socketPath,
    'POST',
    '/reviews/pending',
    capabilityHeader(),
    Buffer.from(JSON.stringify({
      agentThread: {
        id: 'thread-187',
        threadHost: { kind: 't3', provider: 'openai' }
      }
    }))
  )
  assert.equal(pending.statusCode, 200)
  const pendingBody = pending.body as {
    reviews: Array<{ reviewUrl: string }>
  }
  assert.equal(
    pendingBody.reviews[0]?.reviewUrl,
    'markover://review/mko_aaa11111'
  )
})

test('remote create rejects origin claims, attachment metadata, and digest drift', async (t) => {
  const fixture = await gatewayFixture(t)
  for (const [body, code] of [
    [{ tree: tree(), metadata: { contextSummary: 'Origin.', origin: 'agent' } }, 'REMOTE_ORIGIN_FORBIDDEN'],
    [{ tree: { ...tree(), attachments: [] }, metadata: { contextSummary: 'Attachments.' } }, 'REMOTE_ATTACHMENTS_FORBIDDEN']
  ] as const) {
    const bytes = Buffer.from(JSON.stringify(body))
    const response = await requestGateway(
      fixture.socketPath,
      'POST',
      '/reviews',
      createHeaders(bytes),
      bytes
    )
    assert.equal(response.statusCode, 400)
    assert.equal(responseErrorCode(response.body), code)
  }

  const valid = Buffer.from(JSON.stringify({
    tree: tree(),
    metadata: { contextSummary: 'Digest mismatch.' }
  }))
  const mismatched = await requestGateway(
    fixture.socketPath,
    'POST',
    '/reviews',
    {
      ...createHeaders(valid),
      [REMOTE_GATEWAY_REQUEST_DIGEST_HEADER]: digest(Buffer.from('different'))
    },
    valid
  )
  assert.equal(mismatched.statusCode, 400)
  assert.equal(
    responseErrorCode(mismatched.body),
    'REQUEST_DIGEST_MISMATCH'
  )
  assert.deepEqual(await fixture.store.list(), [])
})

test('socket lifecycle hardens modes, rejects live ownership, recovers stale sockets, and removes its own socket', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-remote-socket-test-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const stateRoot = path.join(directory, 'state')
  const socketPath = path.join(stateRoot, 'remote.sock')
  await fs.mkdir(stateRoot)

  const owner = await fs.stat(stateRoot)
  await assert.rejects(
    startRemoteGateway({
      socketPath,
      localPort: 1234,
      localToken: 'B'.repeat(43),
      discoveryPolicy: () => false,
      routingReady: () => Promise.resolve(),
      uid: owner.uid + 1
    }),
    (error: unknown) => (
      error instanceof RemoteGatewayError &&
      error.code === 'REMOTE_GATEWAY_PARENT_UNOWNED'
    )
  )

  const active = http.createServer()
  await new Promise<void>((resolve) => active.listen(socketPath, resolve))
  await assert.rejects(
    startRemoteGateway({
      socketPath,
      localPort: 1234,
      localToken: 'B'.repeat(43),
      discoveryPolicy: () => false,
      routingReady: () => Promise.resolve()
    }),
    (error: unknown) => (
      error instanceof RemoteGatewayError &&
      error.code === 'REMOTE_GATEWAY_IN_USE'
    )
  )
  assert.equal((await fs.lstat(socketPath)).isSocket(), true)
  await new Promise<void>((resolve, reject) => {
    active.close((error) => { if (error) reject(error); else resolve() })
  })
  await fs.unlink(socketPath).catch(() => undefined)

  const stale = spawnSync('python3', [
    '-c',
    'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])',
    socketPath
  ], { encoding: 'utf8' })
  assert.equal(stale.status, 0, stale.stderr)
  assert.equal((await fs.lstat(socketPath)).isSocket(), true)

  const identity = createServiceIdentity()
  const store = new ReviewStore(path.join(directory, 'reviews'))
  const local = await startLocalService({ identity, store })
  t.after(() => local.close())
  const gateway = await startRemoteGateway({
    socketPath,
    localPort: local.port,
    localToken: identity.token,
    discoveryPolicy: () => false,
    routingReady: () => Promise.resolve()
  })
  const parentMode = (await fs.stat(stateRoot)).mode & 0o777
  const socketMode = (await fs.stat(socketPath)).mode & 0o777
  assert.equal(parentMode, 0o700)
  assert.equal(socketMode, 0o600)
  await gateway.close()
  await assert.rejects(fs.access(socketPath))
})

test('gateway caps responses from the canonical mutation service', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-remote-response-test-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const local = http.createServer((_request, response) => {
    const body = JSON.stringify({ reviews: [], padding: 'x'.repeat(256) })
    response.writeHead(200, {
      'content-length': Buffer.byteLength(body),
      'content-type': 'application/json'
    })
    response.end(body)
  })
  await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => {
    local.close((error) => { if (error) reject(error); else resolve() })
  }))
  const address = local.address()
  assert.ok(address && typeof address === 'object')
  const gateway = await startRemoteGateway({
    socketPath: path.join(directory, 'remote.sock'),
    localPort: address.port,
    localToken: 'B'.repeat(43),
    discoveryPolicy: () => false,
    routingReady: () => Promise.resolve(),
    maximumResponseBytes: 64
  })
  t.after(() => gateway.close())

  const response = await requestGateway(
    gateway.socketPath,
    'POST',
    '/reviews/pending',
    capabilityHeader(),
    Buffer.from('{}')
  )
  assert.equal(response.statusCode, 502)
  assert.equal(responseErrorCode(response.body), 'RESPONSE_TOO_LARGE')
})

test('disable drains the one active request before removing the socket', async (t) => {
  let releaseAction: () => void = () => {}
  let markActionStarted: () => void = () => {}
  const actionStarted = new Promise<void>((resolve) => { markActionStarted = resolve })
  const actionBarrier = new Promise<void>((resolve) => { releaseAction = resolve })
  const fixture = await gatewayFixture(t, {
    async beforeAction() {
      markActionStarted()
      await actionBarrier
      return undefined
    }
  })
  const body = Buffer.from(JSON.stringify({
    tree: tree(),
    metadata: { contextSummary: 'Drain active request.' }
  }))
  await requestGateway(
    fixture.socketPath,
    'POST',
    '/reviews',
    createHeaders(body),
    body
  )

  const handoff = requestGateway(
    fixture.socketPath,
    'POST',
    '/reviews/mko_aaa11111/handoff',
    capabilityHeader()
  )
  await actionStarted
  let closed = false
  const closing = fixture.gateway.close().then(() => { closed = true })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(closed, false)
  releaseAction()
  assert.equal((await handoff).statusCode, 200)
  await closing
  await assert.rejects(fs.access(fixture.socketPath))
})

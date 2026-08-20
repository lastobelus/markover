import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import type { ResolvedInstance } from '../src/instance'
import { InternalAttachmentAllowlist } from '../src/internal-protocol'
import {
  MAXIMUM_BODY_BYTES,
  startLocalService
} from '../src/local-service'
import {
  hasRemoteGatewayCapability,
  MAXIMUM_REMOTE_RESPONSE_BYTES,
  remoteGatewayActivationEligible,
  remoteGatewayHostEligible,
  REMOTE_GATEWAY_CAPABILITY,
  REMOTE_GATEWAY_CAPABILITY_HEADER,
  REMOTE_GATEWAY_HOST,
  REMOTE_GATEWAY_IDEMPOTENCY_HEADER,
  REMOTE_GATEWAY_REQUEST_DIGEST_HEADER,
  RemoteGatewayError,
  startRemoteGateway,
  type RemoteGateway
} from '../src/remote-gateway'
import {
  createRemoteAttachmentAccess,
  remoteContentDigest,
  remoteRequestAuthorization,
  RemoteAttachmentAccessStore,
  type RemoteGatewayChallenge,
  RemoteGatewayChallengeStore,
  REMOTE_GATEWAY_CONTENT_DIGEST_HEADER,
  verifyRemoteAttachmentResponseAuthorization,
  verifyRemoteGatewayChallenge
} from '../src/remote-gateway-auth'
import {
  loadOrCreateRemoteGatewayCredential,
  RemoteGatewayCredentialError,
  remoteGatewayCredentialPath
} from '../src/remote-gateway-credential'
import {
  projectRemoteAttachments,
  readVerifiedRemoteAttachment
} from '../src/remote-attachments'
import { reviewChecksum } from '../src/review-format'
import { ReviewStore, type ReviewArtifact } from '../src/review-store'
import { createServiceIdentity } from '../src/service-endpoint'

const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi

interface GatewayFixture {
  changes: string[]
  directory: string
  gateway: RemoteGateway
  routingChecks: () => number
  port: number
  store: ReviewStore
}

const GATEWAY_TOKEN = 'G'.repeat(43)

function tree(): ReviewTree {
  const source = '# Remote review\n\nReview this from the remote client host.\n'
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

const missingAttachment = () => Promise.resolve(null)

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

async function requestGatewayRaw(
  port: number,
  method: string,
  requestPath: string,
  headers: Record<string, string | string[]> = {},
  body: Uint8Array = Buffer.alloc(0)
): Promise<{ body: unknown; statusCode: number | undefined }> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: REMOTE_GATEWAY_HOST,
      port,
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

async function requestGateway(
  port: number,
  method: string,
  requestPath: string,
  headers: Record<string, string | string[]> = {},
  body: Uint8Array = Buffer.alloc(0)
): Promise<{ body: unknown; headers: http.IncomingHttpHeaders; statusCode: number | undefined }> {
  if (
    method === 'GET' && requestPath === '/health' ||
    !Object.hasOwn(headers, REMOTE_GATEWAY_CAPABILITY_HEADER)
  ) {
    const response = await requestGatewayRaw(port, method, requestPath, headers, body)
    return { ...response, headers: {} }
  }
  const health = await requestGatewayRaw(
    port,
    'GET',
    '/health',
    capabilityHeader()
  )
  assert.equal(health.statusCode, 200)
  assert.ok(health.body && typeof health.body === 'object')
  const challenge = (health.body as Record<string, unknown>).authorization
  assert.equal(verifyRemoteGatewayChallenge(GATEWAY_TOKEN, challenge), true)
  const contentDigest = remoteContentDigest(body)
  return requestGatewayWithResponseHeaders(port, method, requestPath, {
    ...headers,
    authorization: remoteRequestAuthorization(
      GATEWAY_TOKEN,
      challenge as RemoteGatewayChallenge,
      method,
      requestPath,
      contentDigest
    ),
    [REMOTE_GATEWAY_CONTENT_DIGEST_HEADER]: contentDigest
  }, body)
}

async function requestGatewayWithResponseHeaders(
  port: number,
  method: string,
  requestPath: string,
  headers: Record<string, string | string[]> = {},
  body: Uint8Array = Buffer.alloc(0)
): Promise<{ body: unknown; headers: http.IncomingHttpHeaders; statusCode: number | undefined }> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: REMOTE_GATEWAY_HOST,
      port,
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
          headers: response.headers,
          statusCode: response.statusCode
        })
      })
    })
    request.on('error', reject)
    request.end(body)
  })
}

async function requestGatewayBytes(
  port: number,
  requestPath: string,
  headers: Record<string, string> = {}
): Promise<{ body: Buffer; headers: http.IncomingHttpHeaders; statusCode: number | undefined }> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: REMOTE_GATEWAY_HOST,
      port,
      method: 'GET',
      path: requestPath,
      headers
    }, (response) => {
      const chunks: Uint8Array[] = []
      response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      response.on('end', () => {
        resolve({
          body: Buffer.concat(chunks),
          headers: response.headers,
          statusCode: response.statusCode
        })
      })
    })
    request.on('error', reject)
    request.end()
  })
}

async function interruptGatewayResponse(
  port: number,
  requestPath: string,
  headers: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: REMOTE_GATEWAY_HOST,
      port,
      method: 'GET',
      path: requestPath,
      headers
    }, (response) => {
      response.once('data', () => {
        response.destroy()
        resolve()
      })
      response.once('error', reject)
    })
    request.on('error', reject)
    request.end()
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
  const attachments = new InternalAttachmentAllowlist(store.directory)
  const gateway = await startRemoteGateway({
    gatewayToken: GATEWAY_TOKEN,
    localPort: service.port,
    localToken: identity.token,
    discoveryPolicy: () => options.discoveryPolicy ?? false,
    routingReady() {
      routingChecks += 1
      return Promise.resolve()
    },
    async loadAttachment(reviewId, attachmentId) {
      const artifact = await store.load(reviewId)
      attachments.replaceReview(reviewId, artifact)
      const matches: ReviewAttachment[] = []
      const visit = (node: ReviewNode): void => {
        for (const attachment of node.attachments || []) {
          if (attachment.id === attachmentId) matches.push(attachment)
        }
        node.children.forEach(visit)
      }
      visit(artifact.root)
      if (matches.length !== 1) return null
      const filePath = await attachments.resolve(reviewId, attachmentId)
      return filePath
        ? {
            attachment: matches[0] as ReviewAttachment,
            attachmentRoot: path.join(store.directory, reviewId, 'attachments'),
            filePath
          }
          : null
    },
    port: 0
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
    port: gateway.port,
    routingChecks: () => routingChecks,
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
  const invalidCheckout = canonicalInstance('/checkouts/main')
  invalidCheckout.coldStart = {
    eligible: false,
    blockedBy: 'canonical-checkout-invalid'
  }
  assert.equal(
    remoteGatewayActivationEligible(invalidCheckout, false, 'darwin'),
    false
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

test('gateway challenges prove credential ownership and reject replay and expiry', () => {
  let now = 1_000_000
  const store = new RemoteGatewayChallengeStore(GATEWAY_TOKEN, () => now)
  const challenge = store.create()
  assert.equal(verifyRemoteGatewayChallenge(GATEWAY_TOKEN, challenge, now), true)
  assert.equal(verifyRemoteGatewayChallenge('X'.repeat(43), challenge, now), false)

  const bytes = Buffer.from('{"review":true}')
  const contentDigest = remoteContentDigest(bytes)
  const authorization = remoteRequestAuthorization(
    GATEWAY_TOKEN,
    challenge,
    'POST',
    '/reviews',
    contentDigest
  )
  const headers = {
    authorization,
    [REMOTE_GATEWAY_CONTENT_DIGEST_HEADER]: contentDigest
  }
  assert.deepEqual(store.authorize(headers, 'POST', '/reviews'), {
    contentDigest,
    nonce: challenge.nonce
  })
  assert.equal(store.authorize(headers, 'POST', '/reviews'), null)

  const wrongPathChallenge = store.create()
  const wrongPathHeaders = {
    authorization: remoteRequestAuthorization(
      GATEWAY_TOKEN,
      wrongPathChallenge,
      'POST',
      '/reviews',
      contentDigest
    ),
    [REMOTE_GATEWAY_CONTENT_DIGEST_HEADER]: contentDigest
  }
  assert.equal(store.authorize(wrongPathHeaders, 'POST', '/reviews/pending'), null)
  assert.deepEqual(store.authorize(wrongPathHeaders, 'POST', '/reviews'), {
    contentDigest,
    nonce: wrongPathChallenge.nonce
  })

  const expired = store.create()
  now = expired.expiresAt
  assert.equal(verifyRemoteGatewayChallenge(GATEWAY_TOKEN, expired, now), false)
  assert.equal(store.authorize({
    authorization: remoteRequestAuthorization(
      GATEWAY_TOKEN,
      expired,
      'POST',
      '/reviews',
      contentDigest
    ),
    [REMOTE_GATEWAY_CONTENT_DIGEST_HEADER]: contentDigest
  }, 'POST', '/reviews'), null)
})

test('attachment access is scoped to the issuing gateway instance', () => {
  const now = Date.now()
  const issuingGateway = new RemoteAttachmentAccessStore(GATEWAY_TOKEN, () => now)
  const restartedGateway = new RemoteAttachmentAccessStore(GATEWAY_TOKEN, () => now)
  const access = issuingGateway.create('mko_aaa11111', 'img-1')
  assert.equal(issuingGateway.verify('mko_aaa11111', 'img-1', access), true)
  assert.equal(issuingGateway.verify('mko_aaa11111', 'img-2', access), false)
  assert.equal(restartedGateway.verify('mko_aaa11111', 'img-1', access), false)
})

test('gateway checks capability and proof before routes and bodies and exposes bounded health', async (t) => {
  const fixture = await gatewayFixture(t, { discoveryPolicy: true })
  const checksAfterStartup = fixture.routingChecks()

  const denied = await requestGateway(
    fixture.port,
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
  const capabilityOnly = {
    [REMOTE_GATEWAY_CAPABILITY_HEADER]: capabilityHeader()[
      REMOTE_GATEWAY_CAPABILITY_HEADER
    ] as string
  }
  const missingCredential = await requestGatewayRaw(
    fixture.port,
    'POST',
    '/reviews',
    capabilityOnly,
    Buffer.from('{')
  )
  assert.equal(missingCredential.statusCode, 403)
  assert.equal(responseErrorCode(missingCredential.body), 'REMOTE_CREDENTIAL_REQUIRED')
  assert.equal(fixture.routingChecks(), checksAfterStartup)

  const health = await requestGateway(
    fixture.port,
    'GET',
    '/health',
    capabilityHeader()
  )
  assert.equal(health.statusCode, 200)
  assert.ok(health.body && typeof health.body === 'object')
  const healthBody = health.body as Record<string, unknown>
  assert.equal(healthBody.status, 'ok')
  assert.deepEqual(healthBody.protocol, { name: 'markover-remote', version: 1 })
  assert.equal(healthBody.role, 'canonical')
  assert.equal(healthBody.scheme, 'markover')
  assert.equal(healthBody.discoverAgentThreadFromLocalSessions, true)
  assert.equal(
    verifyRemoteGatewayChallenge(GATEWAY_TOKEN, healthBody.authorization),
    true
  )
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
      fixture.port,
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
    fixture.port,
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
    fixture.port,
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
    fixture.port,
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
    fixture.port,
    'POST',
    '/reviews/mko_aaa11111/handoff',
    capabilityHeader()
  )
  assert.equal(handedOff.statusCode, 200)
  assert.equal((handedOff.body as ReviewArtifact).review.status, 'pending-agent')

  const pending = await requestGateway(
    fixture.port,
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

test('remote response headroom carries every maximum-size create through handoff', async (t) => {
  const fixture = await gatewayFixture(t)
  const input = {
    tree: tree(),
    metadata: { contextSummary: '' }
  }
  const emptyBodyBytes = Buffer.byteLength(JSON.stringify(input))
  input.metadata.contextSummary = 'x'.repeat(
    MAXIMUM_BODY_BYTES - emptyBodyBytes
  )
  const body = Buffer.from(JSON.stringify(input))
  assert.equal(body.byteLength, MAXIMUM_BODY_BYTES)
  assert.equal(MAXIMUM_REMOTE_RESPONSE_BYTES, MAXIMUM_BODY_BYTES * 2)

  const created = await requestGateway(
    fixture.port,
    'POST',
    '/reviews',
    createHeaders(body),
    body
  )
  assert.equal(created.statusCode, 201)

  const handedOff = await requestGateway(
    fixture.port,
    'POST',
    '/reviews/mko_aaa11111/handoff',
    capabilityHeader()
  )
  assert.equal(handedOff.statusCode, 200)
  assert.equal((handedOff.body as ReviewArtifact).review.status, 'pending-agent')
  assert.ok(Buffer.byteLength(JSON.stringify(handedOff.body)) > MAXIMUM_BODY_BYTES)
})

test('remote create rejects origin claims, attachment metadata, and digest drift', async (t) => {
  const fixture = await gatewayFixture(t)
  for (const [body, code] of [
    [{ tree: tree(), metadata: { contextSummary: 'Origin.', origin: 'agent' } }, 'REMOTE_ORIGIN_FORBIDDEN'],
    [{ tree: { ...tree(), attachments: [] }, metadata: { contextSummary: 'Attachments.' } }, 'REMOTE_ATTACHMENTS_FORBIDDEN']
  ] as const) {
    const bytes = Buffer.from(JSON.stringify(body))
    const response = await requestGateway(
      fixture.port,
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
    fixture.port,
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

test('remote handoff projects checked private attachments and streams retryable bytes', async (t) => {
  const fixture = await gatewayFixture(t)
  const createBody = Buffer.from(JSON.stringify({
    tree: tree(),
    metadata: { contextSummary: 'Check the private screenshot.' }
  }))
  const created = await requestGateway(
    fixture.port,
    'POST',
    '/reviews',
    createHeaders(createBody),
    createBody
  )
  assert.equal(created.statusCode, 201)

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('private-image')
  ])
  const saved = await fixture.store.saveAttachmentFile('mko_aaa11111', 'png', png)
  const artifact = await fixture.store.load('mko_aaa11111')
  const annotated = structuredClone(artifact)
  const target = annotated.root.children[0] as ReviewNode
  target.attachments = [{
    id: saved.id,
    type: 'image',
    mimeType: 'image/png',
    path: saved.path,
    checksum: digest(png)
  }]
  await fixture.store.updateTree('mko_aaa11111', annotated)

  const handoff = await requestGateway(
    fixture.port,
    'POST',
    '/reviews/mko_aaa11111/handoff',
    capabilityHeader()
  )
  assert.equal(handoff.statusCode, 200)
  const projected = handoff.body as ReviewArtifact
  const projectedAttachment = projected.root.children[0]?.attachments?.[0]
  assert.ok(projectedAttachment)
  assert.equal(projectedAttachment.id, 'img-1')
  assert.equal(projectedAttachment.type, 'image')
  assert.equal(projectedAttachment.mimeType, 'image/png')
  assert.equal(projectedAttachment.checksum, digest(png))
  assert.equal(Object.hasOwn(projectedAttachment, 'path'), false)
  assert.equal(typeof projectedAttachment.url, 'string')
  const projectedUrl = new URL(
    projectedAttachment.url as string,
    'http://markover.invalid'
  )
  assert.equal(
    projectedUrl.pathname,
    '/reviews/mko_aaa11111/attachments/img-1'
  )
  assert.equal(projectedUrl.searchParams.size, 1)
  assert.match(projectedUrl.searchParams.get('access') || '', /^\d{13}\.[a-f0-9]{64}$/)
  assert.equal(
    (await fixture.store.load('mko_aaa11111')).root.children[0]?.attachments?.[0]?.path,
    saved.path
  )

  const route = `${projectedUrl.pathname}${projectedUrl.search}`
  const first = await requestGatewayBytes(fixture.port, route, capabilityHeader())
  const retry = await requestGatewayBytes(fixture.port, route, capabilityHeader())
  assert.equal(first.statusCode, 200)
  assert.equal(first.headers['content-type'], 'image/png')
  assert.equal(first.headers['content-length'], String(png.byteLength))
  assert.equal(
    verifyRemoteAttachmentResponseAuthorization(
      GATEWAY_TOKEN,
      projectedUrl.searchParams.get('access') as string,
      200,
      first.body,
      first.headers['markover-response-auth']
    ),
    true
  )
  assert.deepEqual(first.body, png)
  assert.deepEqual(retry.body, png)

  await interruptGatewayResponse(fixture.port, route, capabilityHeader())
  const afterInterruption = await requestGatewayBytes(
    fixture.port,
    route,
    capabilityHeader()
  )
  assert.equal(afterInterruption.statusCode, 200)
  assert.deepEqual(afterInterruption.body, png)

  const denied = await requestGatewayBytes(fixture.port, route)
  assert.equal(denied.statusCode, 403)
  assert.equal(responseErrorCode(JSON.parse(denied.body.toString('utf8'))), 'REMOTE_CAPABILITY_REQUIRED')

  const missingAccess = await requestGatewayBytes(
    fixture.port,
    projectedUrl.pathname,
    capabilityHeader()
  )
  assert.equal(missingAccess.statusCode, 403)
  assert.equal(
    responseErrorCode(JSON.parse(missingAccess.body.toString('utf8'))),
    'REMOTE_ATTACHMENT_AUTHORIZATION_REQUIRED'
  )
  projectedUrl.searchParams.set('access', `${projectedUrl.searchParams.get('access')}x`)
  const tampered = await requestGatewayBytes(
    fixture.port,
    `${projectedUrl.pathname}${projectedUrl.search}`,
    capabilityHeader()
  )
  assert.equal(tampered.statusCode, 403)

  const expiredAccess = createRemoteAttachmentAccess(
    GATEWAY_TOKEN,
    'mko_aaa11111',
    'img-1',
    Date.now() - 1
  )
  const expired = await requestGatewayBytes(
    fixture.port,
    `${projectedUrl.pathname}?access=${expiredAccess}`,
    capabilityHeader()
  )
  assert.equal(expired.statusCode, 403)
})

test('private attachment checks reject corrupt metadata, paths, bytes, and links', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-remote-attachment-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('checked')
  ])
  const filePath = path.join(directory, 'img-1.png')
  await fs.writeFile(filePath, png)
  const attachment: ReviewAttachment = {
    id: 'img-1',
    type: 'image',
    mimeType: 'image/png',
    path: filePath,
    checksum: digest(png)
  }
  const load = () => Promise.resolve({
    attachment,
    attachmentRoot: directory,
    filePath
  })
  assert.deepEqual(
    (await readVerifiedRemoteAttachment('mko_aaa11111', 'img-1', load)).bytes,
    png
  )

  attachment.checksum = digest('wrong')
  await assert.rejects(
    readVerifiedRemoteAttachment('mko_aaa11111', 'img-1', load),
    (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === 'REMOTE_ATTACHMENT_CHECKSUM_MISMATCH'
  )
  attachment.checksum = digest(png)
  attachment.mimeType = 'image/jpeg'
  await assert.rejects(
    readVerifiedRemoteAttachment('mko_aaa11111', 'img-1', load),
    (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === 'REMOTE_ATTACHMENT_TYPE_MISMATCH'
  )
  attachment.mimeType = 'image/png'

  const emptyPath = path.join(directory, 'img-2.png')
  await fs.writeFile(emptyPath, Buffer.alloc(0))
  await assert.rejects(
    readVerifiedRemoteAttachment('mko_aaa11111', 'img-2', () => Promise.resolve({
      attachment: { ...attachment, id: 'img-2' },
      attachmentRoot: directory,
      filePath: emptyPath
    })),
    (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === 'REMOTE_ATTACHMENT_LENGTH_MISMATCH'
  )

  const artifact = {
    review: { id: 'mko_aaa11111' },
    root: {
      attachments: [attachment, { ...attachment }],
      children: []
    }
  }
  await assert.rejects(
    projectRemoteAttachments(artifact, load),
    (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === 'REMOTE_ATTACHMENT_METADATA_INVALID'
  )
  const linkPath = path.join(directory, 'img-3.png')
  await fs.symlink(filePath, linkPath)
  await assert.rejects(
    readVerifiedRemoteAttachment('mko_aaa11111', 'img-3', () => Promise.resolve({
      attachment: { ...attachment, id: 'img-3' },
      attachmentRoot: directory,
      filePath: linkPath
    })),
    (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === 'REMOTE_ATTACHMENT_NOT_FOUND'
  )
  const swapPath = path.join(directory, 'img-swap.png')
  await fs.writeFile(swapPath, png)
  await assert.rejects(
    readVerifiedRemoteAttachment('mko_aaa11111', 'img-swap', async () => {
      await fs.unlink(swapPath)
      await fs.symlink(filePath, swapPath)
      return {
        attachment: { ...attachment, id: 'img-swap' },
        attachmentRoot: directory,
        filePath: swapPath
      }
    }),
    (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === 'REMOTE_ATTACHMENT_NOT_FOUND'
  )

  const reviewsRoot = path.join(directory, 'reviews')
  const firstRoot = path.join(reviewsRoot, 'mko_aaa11111', 'attachments')
  const otherRoot = path.join(reviewsRoot, 'mko_bbb22222', 'attachments')
  await fs.mkdir(firstRoot, { recursive: true })
  await fs.mkdir(otherRoot, { recursive: true })
  const orphan = path.join(firstRoot, 'img-4.png')
  const crossReview = path.join(otherRoot, 'img-4.png')
  await fs.writeFile(crossReview, png)
  const allowlist = new InternalAttachmentAllowlist(reviewsRoot)
  assert.equal(allowlist.register('mko_aaa11111', 'img-4', crossReview), false)
  assert.equal(
    allowlist.register('mko_aaa11111', 'img-4', path.join(firstRoot, '..', 'img-4.png')),
    false
  )
  assert.equal(allowlist.register('mko_aaa11111', 'img-4', orphan), true)
  assert.equal(await allowlist.resolve('mko_aaa11111', 'img-4'), null)
  const duplicateTree = tree()
  const [firstNode] = duplicateTree.root.children
  assert.ok(firstNode)
  firstNode.attachments = [
    { id: 'img-4', path: orphan },
    { id: 'img-4', path: orphan }
  ]
  allowlist.replaceReview('mko_aaa11111', duplicateTree)
  assert.equal(await allowlist.resolve('mko_aaa11111', 'img-4'), null)
})

test('loopback lifecycle validates ports, rejects an occupied port, and closes its exact listener', async () => {
  await assert.rejects(
    startRemoteGateway({
      gatewayToken: GATEWAY_TOKEN,
      localPort: 1234,
      localToken: 'B'.repeat(43),
      discoveryPolicy: () => false,
      loadAttachment: missingAttachment,
      routingReady: () => Promise.resolve(),
      port: -1
    }),
    (error: unknown) => (
      error instanceof RemoteGatewayError &&
      error.code === 'REMOTE_GATEWAY_PORT_INVALID'
    )
  )

  const gateway = await startRemoteGateway({
    gatewayToken: GATEWAY_TOKEN,
    localPort: 1234,
    localToken: 'B'.repeat(43),
    discoveryPolicy: () => false,
    loadAttachment: missingAttachment,
    routingReady: () => Promise.resolve(),
    port: 0
  })
  assert.equal(gateway.host, REMOTE_GATEWAY_HOST)
  assert.ok(gateway.port > 0)

  await assert.rejects(
    startRemoteGateway({
      gatewayToken: GATEWAY_TOKEN,
      localPort: 1234,
      localToken: 'B'.repeat(43),
      discoveryPolicy: () => false,
      loadAttachment: missingAttachment,
      routingReady: () => Promise.resolve(),
      port: gateway.port
    }),
    (error: unknown) => (
      error instanceof RemoteGatewayError &&
      error.code === 'REMOTE_GATEWAY_IN_USE'
    )
  )
  await gateway.close()
  await gateway.close()
  await assert.rejects(requestGateway(
    gateway.port,
    'GET',
    '/health',
    capabilityHeader()
  ))
})

test('gateway credential is stable, owner-only, and fails closed when exposed', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-remote-credential-test-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const credentialPath = remoteGatewayCredentialPath(
    path.join(directory, 'state')
  )
  const first = await loadOrCreateRemoteGatewayCredential({
    credentialPath,
    token: () => GATEWAY_TOKEN
  })
  const second = await loadOrCreateRemoteGatewayCredential({
    credentialPath,
    token: () => 'X'.repeat(43)
  })
  assert.equal(first, GATEWAY_TOKEN)
  assert.equal(second, GATEWAY_TOKEN)
  assert.equal((await fs.stat(path.dirname(credentialPath))).mode & 0o777, 0o700)
  assert.equal((await fs.stat(credentialPath)).mode & 0o777, 0o600)

  await fs.chmod(credentialPath, 0o644)
  await assert.rejects(
    loadOrCreateRemoteGatewayCredential({ credentialPath }),
    (error: unknown) => (
      error instanceof RemoteGatewayCredentialError &&
      error.code === 'REMOTE_GATEWAY_CREDENTIAL_UNSAFE'
    )
  )
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
    gatewayToken: GATEWAY_TOKEN,
    localPort: address.port,
    localToken: 'B'.repeat(43),
    discoveryPolicy: () => false,
    loadAttachment: missingAttachment,
    routingReady: () => Promise.resolve(),
    maximumResponseBytes: 64,
    port: 0
  })
  t.after(() => gateway.close())

  const response = await requestGateway(
    gateway.port,
    'POST',
    '/reviews/pending',
    capabilityHeader(),
    Buffer.from('{}')
  )
  assert.equal(response.statusCode, 502)
  assert.equal(responseErrorCode(response.body), 'RESPONSE_TOO_LARGE')
})

test('disable drains the one active request before closing the loopback listener', async (t) => {
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
    fixture.port,
    'POST',
    '/reviews',
    createHeaders(body),
    body
  )

  const handoff = requestGateway(
    fixture.port,
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
  await assert.rejects(requestGateway(
    fixture.port,
    'GET',
    '/health',
    capabilityHeader()
  ))
})

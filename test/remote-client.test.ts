import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type https from 'node:https'
import type { RequestOptions as HttpsRequestOptions } from 'node:https'
import test from 'node:test'

import {
  readRemoteAttachment,
  readRemoteHealth,
  RemoteClientError,
  type RemoteClientTiming,
  requestRemoteJson,
  validateRemoteAttachmentUrls
} from '../src/remote-client'
import {
  createRemoteAttachmentAccess,
  createRemoteGatewayChallenge,
  remoteAttachmentResponseAuthorization,
  remoteContentDigest,
  remoteRequestAuthorization,
  remoteResponseAuthorization,
  type RemoteGatewayChallenge
} from '../src/remote-gateway-auth'
import {
  loadRemoteProfile,
  parseRemoteProfile,
  RemoteProfileError,
  type RemoteProfile
} from '../src/remote-profile'

const token = 'A'.repeat(43)
const profile: RemoteProfile = {
  baseUrl: 'https://canonical.example.ts.net/',
  token
}
const fixedNow = Date.now()
const fixedNonce = 'N'.repeat(43)
const validHealth = {
  status: 'ok',
  protocol: { name: 'markover-remote', version: 1 },
  role: 'canonical',
  scheme: 'markover',
  discoverAgentThreadFromLocalSessions: true,
  authorization: createRemoteGatewayChallenge(token, fixedNow, fixedNonce)
}

function validAuthorization(): RemoteGatewayChallenge {
  return createRemoteGatewayChallenge(token, fixedNow, fixedNonce)
}

interface ResponsePlan {
  attachmentAccess?: string
  body: unknown
  contentType?: string
  omitResponseAuthorization?: boolean
  rawBody?: string
  rawBytes?: Uint8Array
  responseToken?: string
  statusCode: number
}

interface ErrorPlan {
  afterSend: boolean
  error: true
}

interface StallPlan {
  afterSend: boolean
  stall: true
}

type Plan = ResponsePlan | ErrorPlan | StallPlan

interface CapturedRequest {
  body: string
  destroyed: boolean
  options: HttpsRequestOptions
}

function fakeTransport(plans: readonly Plan[]): {
  captured: CapturedRequest[]
  request: typeof https.request
} {
  const remaining = [...plans]
  const captured: CapturedRequest[] = []
  const transport = ((
    options: HttpsRequestOptions,
    callback: (response: IncomingMessage) => void
  ): ClientRequest => {
    const plan = remaining.shift()
    assert.ok(plan, 'unexpected HTTPS request')
    const events = new EventEmitter()
    const record: CapturedRequest = { body: '', destroyed: false, options }
    captured.push(record)

    const request = Object.assign(events, {
      destroy: () => {
        record.destroyed = true
        return request
      },
      end: () => {
        queueMicrotask(() => {
          if ('error' in plan && !plan.afterSend) {
            events.emit('error', new Error('connect failed'))
            return
          }
          if ('stall' in plan && !plan.afterSend) return
          const socket = Object.assign(new EventEmitter(), { connecting: false })
          events.emit('socket', socket)
          events.emit('finish')
          if ('error' in plan) {
            events.emit('error', new Error('response lost'))
            return
          }
          if ('stall' in plan) return

          const responseEvents = new EventEmitter()
          const responseBody = Buffer.from(
            plan.rawBytes ?? plan.rawBody ?? JSON.stringify(plan.body)
          )
          const requestHeaders = options.headers as Record<string, unknown> | undefined
          const requestAuthorization = requestHeaders?.authorization
          const nonce = typeof requestAuthorization === 'string'
            ? /^Markover-HMAC-v1 ([A-Za-z0-9_-]{43})\./.exec(requestAuthorization)?.[1]
            : undefined
          const responseAuthorization = plan.omitResponseAuthorization
            ? undefined
            : nonce !== undefined
              ? remoteResponseAuthorization(
                plan.responseToken ?? token,
                nonce,
                plan.statusCode,
                responseBody
              )
              : plan.attachmentAccess !== undefined
                ? remoteAttachmentResponseAuthorization(
                  plan.responseToken ?? token,
                  plan.attachmentAccess,
                  plan.statusCode,
                  responseBody
                )
                : undefined
          const response = Object.assign(responseEvents, {
            complete: true,
            headers: {
              'content-type': plan.contentType ?? 'application/json; charset=utf-8',
              ...(responseAuthorization === undefined
                ? {}
                : { 'markover-response-auth': responseAuthorization })
            },
            resume: () => response,
            statusCode: plan.statusCode
          })
          callback(response as unknown as IncomingMessage)
          responseEvents.emit('data', responseBody)
          responseEvents.emit('end')
        })
        return request
      },
      write: (chunk: string | Uint8Array) => {
        record.body += typeof chunk === 'string'
          ? chunk
          : Buffer.from(chunk).toString('utf8')
        return true
      }
    })
    return request as unknown as ClientRequest
  }) as unknown as typeof https.request
  return { captured, request: transport }
}

interface ScheduledTimer {
  active: boolean
  callback: () => void
  milliseconds: number
  timer: ReturnType<typeof setTimeout>
}

function manualTiming(): {
  fire: (milliseconds: number) => void
  timing: RemoteClientTiming
} {
  const scheduled: ScheduledTimer[] = []
  const timing: RemoteClientTiming = {
    setTimeout: (callback, milliseconds) => {
      const timer = setTimeout(() => {}, 60_000)
      clearTimeout(timer)
      scheduled.push({ active: true, callback, milliseconds, timer })
      return timer
    },
    clearTimeout: (timer) => {
      const scheduledTimer = scheduled.find((entry) => entry.timer === timer)
      if (scheduledTimer) scheduledTimer.active = false
    }
  }
  return {
    fire: (milliseconds) => {
      const scheduledTimer = scheduled.find((entry) => (
        entry.active && entry.milliseconds === milliseconds
      ))
      assert.ok(scheduledTimer, `no active ${milliseconds} ms timer`)
      scheduledTimer.active = false
      scheduledTimer.callback()
    },
    timing
  }
}

function hasRemoteError(
  error: unknown,
  code: string,
  statusCode: number | null = null
): boolean {
  return error instanceof RemoteClientError &&
    error.code === code &&
    error.statusCode === statusCode
}

function creationReceiptDigest(value: unknown): unknown {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).requestDigest
    : null
}

test('remote profile is opt-in and accepts only an exact root HTTPS ts.net endpoint', async () => {
  assert.equal(await loadRemoteProfile({ environment: {} }), null)

  let readPath = ''
  assert.deepEqual(await loadRemoteProfile({
    environment: { MARKOVER_REMOTE_PROFILE: '/profiles/canonical.json' },
    inspectFile: () => Promise.resolve({
      isFile: () => true,
      isSymbolicLink: () => false,
      mode: 0o600,
      uid: 42
    }),
    readFile: (profilePath) => {
      readPath = profilePath
      return Promise.resolve(JSON.stringify({
        baseUrl: 'https://Canonical.Example.ts.net',
        token
      }))
    },
    uid: 42
  }), { baseUrl: 'https://canonical.example.ts.net/', token })
  assert.equal(readPath, '/profiles/canonical.json')
  assert.deepEqual(parseRemoteProfile({
    baseUrl: 'https://canonical.example.ts.net:8443/',
    token
  }), { baseUrl: 'https://canonical.example.ts.net:8443/', token })

  for (const baseUrl of [
    'http://canonical.example.ts.net/',
    'https://user@canonical.example.ts.net/',
    'https://canonical.example.ts.net/reviews',
    'https://canonical.example.ts.net/?details=1',
    'https://canonical.example.ts.net/#health',
    'https://canonical.example.ts.net:0/',
    'https://canonical.example.ts.net:65536/',
    'https://127.0.0.1/',
    'https://example.com/'
  ]) {
    assert.throws(
      () => parseRemoteProfile({ baseUrl, token }),
      (error: unknown) => error instanceof RemoteProfileError,
      baseUrl
    )
  }
  assert.throws(() => parseRemoteProfile({
    baseUrl: profile.baseUrl,
    token,
    redirectUrl: 'https://other.example.ts.net/'
  }), RemoteProfileError)
})

test('remote profile requires a regular owner-only file', async () => {
  const cases = [
    {
      name: 'unsafe mode',
      mode: 0o640,
      isSymbolicLink: false,
      uid: 42
    },
    {
      name: 'symlink',
      mode: 0o600,
      isSymbolicLink: true,
      uid: 42
    },
    {
      name: 'unowned file',
      mode: 0o600,
      isSymbolicLink: false,
      uid: 7
    }
  ]
  for (const file of cases) {
    await assert.rejects(
      loadRemoteProfile({
        environment: { MARKOVER_REMOTE_PROFILE: '/profiles/canonical.json' },
        inspectFile: () => Promise.resolve({
          isFile: () => true,
          isSymbolicLink: () => file.isSymbolicLink,
          mode: file.mode,
          uid: file.uid
        }),
        platform: 'darwin',
        readFile: () => Promise.resolve(JSON.stringify({
          baseUrl: profile.baseUrl,
          token
        })),
        uid: 42
      }),
      (error: unknown) => error instanceof RemoteProfileError,
      file.name
    )
  }
})

test('health pins protocol identity and exposes the boolean discovery snapshot', async () => {
  const transport = fakeTransport([{ statusCode: 200, body: validHealth }])
  const health = await readRemoteHealth(profile, { request: transport.request })
  assert.deepEqual(health, validHealth)
  const request = transport.captured[0]
  assert.ok(request)
  assert.equal(request.options.protocol, 'https:')
  assert.equal(request.options.hostname, 'canonical.example.ts.net')
  assert.equal(request.options.port, 443)
  assert.equal(request.options.path, '/health')
  assert.equal(request.options.agent, false)
  assert.equal(
    (request.options.headers as Record<string, string> | undefined)?.authorization,
    undefined
  )
  assert.doesNotMatch(JSON.stringify(request.options.headers), new RegExp(token))

  const portTransport = fakeTransport([{ statusCode: 200, body: validHealth }])
  await readRemoteHealth({
    baseUrl: 'https://canonical.example.ts.net:8443/',
    token
  }, { request: portTransport.request })
  assert.equal(portTransport.captured[0]?.options.port, 8443)

  for (const incompatible of [
    { ...validHealth, protocol: { name: 'other', version: 1 } },
    { ...validHealth, protocol: { name: 'markover-remote', version: 2 } },
    { ...validHealth, role: 'development' },
    { ...validHealth, scheme: 'markover-dev' },
    { ...validHealth, discoverAgentThreadFromLocalSessions: 'yes' },
    {
      ...validHealth,
      authorization: {
        ...validHealth.authorization,
        proof: '0'.repeat(64)
      }
    },
    {
      ...validHealth,
      authorization: createRemoteGatewayChallenge(
        token,
        fixedNow - 60_000,
        fixedNonce
      )
    }
  ]) {
    const rejected = fakeTransport([{ statusCode: 200, body: incompatible }])
    await assert.rejects(
      readRemoteHealth(profile, { request: rejected.request }),
      (error: unknown) => hasRemoteError(error, 'INCOMPATIBLE_REMOTE_CANONICAL', 200)
    )
    assert.equal(rejected.captured.length, 1)
  }
})

test('remote requests preflight without leaking private headers and bound responses', async () => {
  const transport = fakeTransport([
    { statusCode: 200, body: validHealth },
    { statusCode: 201, body: { reviewId: 'mko_12345678' } }
  ])
  assert.deepEqual(await requestRemoteJson(
    profile,
    'POST',
    '/reviews',
    { source: '# Review' },
    {
      headers: {
        authorization: 'Bearer attacker-controlled',
        'idempotency-key': 'private-key',
        'markover-content-digest': 'sha256:attacker-controlled',
        'x-private-header': 'private-value'
      },
      request: transport.request
    }
  ), { reviewId: 'mko_12345678' })
  assert.equal(transport.captured.length, 2)
  assert.doesNotMatch(
    JSON.stringify(transport.captured[0]?.options.headers),
    new RegExp(token)
  )
  assert.doesNotMatch(
    JSON.stringify(transport.captured[1]?.options.headers),
    new RegExp(token)
  )
  assert.equal(
    (transport.captured[0]?.options.headers as Record<string, string> | undefined)?.authorization,
    undefined
  )
  assert.equal(transport.captured[0]?.options.headers &&
    Object.hasOwn(transport.captured[0].options.headers, 'idempotency-key'), false)
  assert.equal(transport.captured[0]?.options.headers &&
    Object.hasOwn(transport.captured[0].options.headers, 'x-private-header'), false)
  assert.equal(
    (transport.captured[1]?.options.headers as Record<string, string> | undefined)?.authorization,
    remoteRequestAuthorization(
      token,
      validHealth.authorization,
      'POST',
      '/reviews',
      remoteContentDigest(Buffer.from(JSON.stringify({ source: '# Review' })))
    )
  )
  assert.equal(
    (transport.captured[1]?.options.headers as Record<string, string> | undefined)?.[
      'markover-content-digest'
    ] ?? '',
    remoteContentDigest(Buffer.from(JSON.stringify({ source: '# Review' })))
  )
  assert.equal(
    (transport.captured[1]?.options.headers as Record<string, unknown> | undefined)?.[
      'idempotency-key'
    ],
    'private-key'
  )
  assert.equal(transport.captured[1]?.body, JSON.stringify({ source: '# Review' }))

  const oversized = fakeTransport([{
    statusCode: 200,
    body: { value: '12345678' }
  }])
  await assert.rejects(
    requestRemoteJson(profile, 'GET', '/reviews', null, {
      authorization: validAuthorization(),
      maximumResponseBytes: 8,
      preflight: false,
      request: oversized.request
    }),
    (error: unknown) => hasRemoteError(error, 'RESPONSE_TOO_LARGE', 200)
  )
  assert.equal(oversized.captured[0]?.destroyed, true)

  for (const responsePlan of [
    {
      statusCode: 200,
      body: { reviews: [] },
      omitResponseAuthorization: true
    },
    {
      statusCode: 200,
      body: { reviews: [] },
      responseToken: 'X'.repeat(43)
    }
  ]) {
    const forged = fakeTransport([responsePlan])
    await assert.rejects(
      requestRemoteJson(profile, 'GET', '/reviews', null, {
        authorization: validAuthorization(),
        mutation: false,
        preflight: false,
        request: forged.request
      }),
      (error: unknown) => hasRemoteError(error, 'INVALID_RESPONSE', 200)
    )
  }
})

test('remote client does not follow redirects and preserves structured service errors', async () => {
  const details = {
    code: 'IDEMPOTENCY_CONFLICT',
    message: 'The key belongs to another request.',
    creationReceipt: { requestDigest: 'sha256:abc' },
    reviewId: 'mko_12345678'
  }
  const conflict = fakeTransport([{ statusCode: 409, body: { error: details } }])
  await assert.rejects(
    requestRemoteJson(profile, 'POST', '/reviews', {}, {
      authorization: validAuthorization(),
      preflight: false,
      request: conflict.request
    }),
    (error: unknown) => error instanceof RemoteClientError &&
      error.code === 'IDEMPOTENCY_CONFLICT' &&
      error.statusCode === 409 &&
      error.details !== null &&
      creationReceiptDigest(error.details.creationReceipt) === 'sha256:abc' &&
      error.details.reviewId === details.reviewId
  )

  const redirect = fakeTransport([{
    statusCode: 307,
    body: { error: { code: 'REDIRECT', message: 'Moved.' } }
  }])
  await assert.rejects(
    requestRemoteJson(profile, 'GET', '/health', null, {
      authorization: validAuthorization(),
      preflight: false,
      request: redirect.request
    }),
    (error: unknown) => hasRemoteError(error, 'REDIRECT', 307)
  )
  assert.equal(redirect.captured.length, 1)

  const uncertain = fakeTransport([{
    statusCode: 502,
    body: {
      error: {
        code: 'REMOTE_GATEWAY_FAILURE',
        message: 'The gateway lost the canonical response.'
      }
    }
  }])
  await assert.rejects(
    requestRemoteJson(profile, 'POST', '/reviews/pending', {}, {
      authorization: validAuthorization(),
      preflight: false,
      request: uncertain.request
    }),
    (error: unknown) => hasRemoteError(error, 'REQUEST_UNCERTAIN')
  )

  const notFound = fakeTransport([{
    statusCode: 404,
    body: { error: { code: 'NOT_FOUND', message: 'Review not found.' } }
  }])
  await assert.rejects(
    requestRemoteJson(profile, 'POST', '/reviews/mko_missing/edit', {}, {
      authorization: validAuthorization(),
      preflight: false,
      request: notFound.request
    }),
    (error: unknown) => hasRemoteError(error, 'NOT_FOUND', 404)
  )
})

test('remote client rejects malformed JSON, content types, errors, and request bodies', async () => {
  const malformedJson = fakeTransport([{
    statusCode: 200,
    body: null,
    rawBody: '{'
  }])
  await assert.rejects(
    requestRemoteJson(profile, 'GET', '/reviews', null, {
      authorization: validAuthorization(),
      preflight: false,
      request: malformedJson.request
    }),
    (error: unknown) => hasRemoteError(error, 'INVALID_RESPONSE', 200)
  )

  const malformedMutation = fakeTransport([{
    statusCode: 200,
    body: null,
    rawBody: '{'
  }])
  await assert.rejects(
    requestRemoteJson(profile, 'POST', '/reviews', {}, {
      authorization: validAuthorization(),
      preflight: false,
      request: malformedMutation.request
    }),
    (error: unknown) => hasRemoteError(error, 'REQUEST_UNCERTAIN')
  )

  const wrongContentType = fakeTransport([{
    statusCode: 200,
    body: {},
    contentType: 'text/plain'
  }])
  await assert.rejects(
    requestRemoteJson(profile, 'GET', '/reviews', null, {
      authorization: validAuthorization(),
      preflight: false,
      request: wrongContentType.request
    }),
    (error: unknown) => hasRemoteError(error, 'INVALID_RESPONSE', 200)
  )

  const malformedError = fakeTransport([{
    statusCode: 503,
    body: { error: { code: 7, message: 'Unavailable.' } }
  }])
  await assert.rejects(
    requestRemoteJson(profile, 'GET', '/reviews', null, {
      authorization: validAuthorization(),
      preflight: false,
      request: malformedError.request
    }),
    (error: unknown) => hasRemoteError(error, 'INVALID_RESPONSE', 503)
  )

  await assert.rejects(
    requestRemoteJson(profile, 'POST', '/reviews', 1n, {
      authorization: validAuthorization(),
      preflight: false
    }),
    (error: unknown) => hasRemoteError(error, 'INVALID_REMOTE_REQUEST')
  )
})

test('remote transport failures distinguish pre-send failure from uncertain mutation loss', async () => {
  const preSend = fakeTransport([{ error: true, afterSend: false }])
  await assert.rejects(
    requestRemoteJson(profile, 'POST', '/reviews', {}, {
      authorization: validAuthorization(),
      preflight: false,
      request: preSend.request
    }),
    (error: unknown) => hasRemoteError(error, 'REMOTE_CANONICAL_UNAVAILABLE')
  )

  const afterSend = fakeTransport([{ error: true, afterSend: true }])
  await assert.rejects(
    requestRemoteJson(profile, 'POST', '/reviews', {}, {
      authorization: validAuthorization(),
      preflight: false,
      request: afterSend.request
    }),
    (error: unknown) => hasRemoteError(error, 'REQUEST_UNCERTAIN')
  )
})

test('connect and response timeouts use independently injectable bounds', async () => {
  const connectTransport = fakeTransport([{ stall: true, afterSend: false }])
  const connectTiming = manualTiming()
  const connectPromise = requestRemoteJson(profile, 'POST', '/reviews', {}, {
    authorization: validAuthorization(),
    connectTimeoutMilliseconds: 11,
    preflight: false,
    request: connectTransport.request,
    responseTimeoutMilliseconds: 22,
    timing: connectTiming.timing
  })
  await new Promise<void>((resolve) => { queueMicrotask(resolve) })
  connectTiming.fire(11)
  await assert.rejects(
    connectPromise,
    (error: unknown) => hasRemoteError(error, 'REMOTE_CANONICAL_UNAVAILABLE')
  )

  const responseTransport = fakeTransport([{ stall: true, afterSend: true }])
  const responseTiming = manualTiming()
  const responsePromise = requestRemoteJson(profile, 'POST', '/reviews', {}, {
    authorization: validAuthorization(),
    connectTimeoutMilliseconds: 33,
    preflight: false,
    request: responseTransport.request,
    responseTimeoutMilliseconds: 44,
    timing: responseTiming.timing
  })
  await new Promise<void>((resolve) => { queueMicrotask(resolve) })
  responseTiming.fire(44)
  await assert.rejects(
    responsePromise,
    (error: unknown) => hasRemoteError(error, 'REQUEST_UNCERTAIN')
  )
})

test('remote attachment URLs stay on the pinned canonical HTTPS origin', () => {
  const expiresAt = Date.now() + 60_000
  const access = createRemoteAttachmentAccess(
    token,
    'mko_aaa11111',
    'img-1',
    expiresAt
  )
  const artifact = {
    review: { id: 'mko_aaa11111' },
    root: {
      attachments: [{
        id: 'img-1',
        url: `/reviews/mko_aaa11111/attachments/img-1?access=${access}`
      }],
      children: []
    }
  }
  assert.equal(validateRemoteAttachmentUrls(profile, artifact), artifact)
  assert.equal(
    artifact.root.attachments[0]?.url,
    `https://canonical.example.ts.net/reviews/mko_aaa11111/attachments/img-1?access=${access}`
  )
  for (const attachment of [
    {
      id: 'img-1',
      path: '/private/img-1.png',
      url: `/reviews/mko_aaa11111/attachments/img-1?access=${access}`
    },
    {
      id: 'img-1',
      url: `https://other.example.ts.net/reviews/mko_aaa11111/attachments/img-1?access=${access}`
    },
    {
      id: 'img-1',
      url: `https://canonical.example.ts.net/reviews/mko_other111/attachments/img-1?access=${access}`
    },
    {
      id: 'img-1',
      url: `/reviews/mko_aaa11111/attachments/img-2?access=${access}`
    },
    {
      id: 'img-1',
      url: `/reviews/mko_aaa11111/attachments/img-1?access=${access}&extra=1`
    },
    {
      id: 'img-1',
      url: `/reviews/mko_aaa11111/attachments/img-1?access=${createRemoteAttachmentAccess(
        token,
        'mko_aaa11111',
        'img-1',
        Date.now() - 1
      )}`
    },
    {
      id: 'img-1',
      url: '/reviews/mko_aaa11111/attachments/img-1'
    }
  ]) {
    assert.throws(
      () => validateRemoteAttachmentUrls(profile, {
        review: { id: 'mko_aaa11111' },
        root: { attachments: [attachment], children: [] }
      }),
      (error: unknown) => hasRemoteError(error, 'INVALID_RESPONSE')
    )
  }
})

test('remote attachment retrieval verifies the scoped response and checksum', async () => {
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('checked')
  ])
  const access = createRemoteAttachmentAccess(
    token,
    'mko_aaa11111',
    'img-1',
    Date.now() + 60_000
  )
  const attachment = {
    checksum: remoteContentDigest(bytes),
    id: 'img-1',
    mimeType: 'image/png',
    url: `/reviews/mko_aaa11111/attachments/img-1?access=${access}`
  }
  const valid = fakeTransport([{
    attachmentAccess: access,
    body: null,
    contentType: 'image/png',
    rawBytes: bytes,
    statusCode: 200
  }])
  assert.deepEqual(await readRemoteAttachment(
    profile,
    'mko_aaa11111',
    attachment,
    { request: valid.request }
  ), bytes)
  const captured = valid.captured[0]
  assert.ok(captured)
  assert.equal(
    captured.options.path,
    `/reviews/mko_aaa11111/attachments/img-1?access=${access}`
  )
  assert.doesNotMatch(JSON.stringify(captured.options.headers), new RegExp(token))

  for (const plan of [
    {
      attachmentAccess: access,
      body: null,
      contentType: 'image/png',
      rawBytes: Buffer.from('tampered'),
      statusCode: 200
    },
    {
      attachmentAccess: access,
      body: null,
      contentType: 'image/png',
      rawBytes: bytes,
      responseToken: 'X'.repeat(43),
      statusCode: 200
    },
    {
      attachmentAccess: access,
      body: null,
      contentType: 'image/png',
      omitResponseAuthorization: true,
      rawBytes: bytes,
      statusCode: 200
    }
  ]) {
    const rejected = fakeTransport([plan])
    await assert.rejects(
      readRemoteAttachment(profile, 'mko_aaa11111', attachment, {
        request: rejected.request
      }),
      (error: unknown) => hasRemoteError(error, 'INVALID_RESPONSE', 200)
    )
  }
})

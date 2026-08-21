import https, {
  type RequestOptions as HttpsRequestOptions
} from 'node:https'

import {
  MAXIMUM_REMOTE_RESPONSE_BYTES,
  REMOTE_GATEWAY_PROTOCOL_VERSION
} from './remote-gateway'
import {
  remoteContentDigest,
  remoteRequestAuthorization,
  type RemoteGatewayChallenge,
  REMOTE_GATEWAY_CLOCK_SKEW_TOLERANCE_MILLISECONDS,
  REMOTE_GATEWAY_CONTENT_DIGEST_HEADER,
  REMOTE_GATEWAY_RESPONSE_AUTH_HEADER,
  verifyRemoteAttachmentAccess,
  verifyRemoteAttachmentResponseAuthorization,
  verifyRemoteGatewayChallenge,
  verifyRemoteResponseAuthorization
} from './remote-gateway-auth'
import type { RemoteProfile } from './remote-profile'

const DEFAULT_CONNECT_TIMEOUT_MILLISECONDS = 5_000
const DEFAULT_RESPONSE_TIMEOUT_MILLISECONDS = 30_000

export interface RemoteHealth {
  status: 'ok'
  protocol: {
    name: 'markover-remote'
    version: typeof REMOTE_GATEWAY_PROTOCOL_VERSION
  }
  role: 'canonical'
  scheme: 'markover'
  discoverAgentThreadFromLocalSessions: boolean
  authorization: RemoteGatewayChallenge
}

export class RemoteClientError extends Error {
  readonly code: string
  readonly details: Readonly<Record<string, unknown>> | null
  readonly statusCode: number | null

  constructor(
    code: string,
    message: string,
    statusCode: number | null = null,
    details: Readonly<Record<string, unknown>> | null = null
  ) {
    super(message)
    this.name = 'RemoteClientError'
    this.code = code
    this.details = details
    this.statusCode = statusCode
  }
}

type RequestTransport = typeof https.request
type Timer = ReturnType<typeof setTimeout>

export interface RemoteClientTiming {
  setTimeout: (callback: () => void, milliseconds: number) => Timer
  clearTimeout: (timer: Timer) => void
}

export interface RemoteClientOptions {
  connectTimeoutMilliseconds?: number
  maximumResponseBytes?: number
  request?: RequestTransport
  responseTimeoutMilliseconds?: number
  timing?: RemoteClientTiming
}

export interface RemoteJsonRequestOptions extends RemoteClientOptions {
  authorization?: RemoteGatewayChallenge | undefined
  headers?: Readonly<Record<string, string>> | undefined
  mutation?: boolean | undefined
  preflight?: boolean | undefined
}

export interface RemoteAttachmentReference {
  checksum: string
  id: string
  mimeType: string
  url: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unavailable(): RemoteClientError {
  return new RemoteClientError(
    'REMOTE_CANONICAL_UNAVAILABLE',
    'Canonical Markover is unavailable.'
  )
}

function uncertain(): RemoteClientError {
  return new RemoteClientError(
    'REQUEST_UNCERTAIN',
    'The remote Markover request may have completed. Recover the exact request before retrying.'
  )
}

function invalidResponse(statusCode: number | null = null): RemoteClientError {
  return new RemoteClientError(
    'INVALID_RESPONSE',
    'Canonical Markover returned an invalid response.',
    statusCode
  )
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function requestUrl(profile: RemoteProfile, requestPath: string): URL {
  if (!requestPath.startsWith('/') || requestPath.startsWith('//')) {
    throw new RemoteClientError(
      'INVALID_REMOTE_REQUEST',
      'The remote Markover request path is invalid.'
    )
  }
  const url = new URL(requestPath, profile.baseUrl)
  const base = new URL(profile.baseUrl)
  if (
    url.origin !== base.origin ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    throw new RemoteClientError(
      'INVALID_REMOTE_REQUEST',
      'The remote Markover request path is invalid.'
    )
  }
  return url
}

export function validateRemoteAttachmentUrls(
  profile: RemoteProfile,
  value: unknown
): unknown {
  if (!isRecord(value) || !isRecord(value.review) || typeof value.review.id !== 'string') {
    return value
  }
  const reviewId = value.review.id
  const visit = (entry: unknown): void => {
    if (!isRecord(entry)) return
    if (Array.isArray(entry.attachments)) {
      for (const attachment of entry.attachments) {
        if (
          !isRecord(attachment) ||
          typeof attachment.id !== 'string' ||
          Object.hasOwn(attachment, 'path') ||
          typeof attachment.url !== 'string'
        ) throw invalidResponse()
        const { url: attachmentUrl } = validatedRemoteAttachmentUrl(
          profile,
          reviewId,
          attachment.id,
          attachment.url
        )
        attachment.url = attachmentUrl.href
      }
    }
    if (Array.isArray(entry.children)) entry.children.forEach(visit)
  }
  visit(value.root)
  return value
}

function validatedRemoteAttachmentUrl(
  profile: RemoteProfile,
  reviewId: string,
  attachmentId: string,
  value: string
): { access: string; url: URL } {
  const expectedPath = `/reviews/${encodeURIComponent(reviewId)}/attachments/${encodeURIComponent(attachmentId)}`
  let url: URL
  try {
    url = new URL(value, profile.baseUrl)
  } catch {
    throw invalidResponse()
  }
  const access = url.searchParams.get('access')
  if (
    url.origin !== new URL(profile.baseUrl).origin ||
    url.pathname !== expectedPath ||
    url.searchParams.size !== 1 ||
    url.hash !== '' ||
    access === null ||
    !verifyRemoteAttachmentAccess(
      profile.token,
      reviewId,
      attachmentId,
      access,
      Date.now(),
      REMOTE_GATEWAY_CLOCK_SKEW_TOLERANCE_MILLISECONDS
    )
  ) throw invalidResponse()
  return { access, url }
}

export async function readRemoteAttachment(
  profile: RemoteProfile,
  reviewId: string,
  attachment: RemoteAttachmentReference,
  {
    connectTimeoutMilliseconds = DEFAULT_CONNECT_TIMEOUT_MILLISECONDS,
    maximumResponseBytes = MAXIMUM_REMOTE_RESPONSE_BYTES,
    request: requestTransport = https.request,
    responseTimeoutMilliseconds = DEFAULT_RESPONSE_TIMEOUT_MILLISECONDS,
    timing = { setTimeout, clearTimeout }
  }: RemoteClientOptions = {}
): Promise<Buffer> {
  if (
    !positiveFinite(connectTimeoutMilliseconds) ||
    !positiveFinite(responseTimeoutMilliseconds) ||
    !positiveFinite(maximumResponseBytes) ||
    !/^sha256:[a-f0-9]{64}$/.test(attachment.checksum) ||
    !/^(?:image\/png|image\/jpeg)$/.test(attachment.mimeType)
  ) throw invalidResponse()
  const { access, url } = validatedRemoteAttachmentUrl(
    profile,
    reviewId,
    attachment.id,
    attachment.url
  )

  return new Promise<Buffer>((resolve, reject) => {
    let complete = false
    let connectTimer: Timer | null = null
    let responseTimer: Timer | null = null
    const clearTimers = () => {
      if (connectTimer !== null) timing.clearTimeout(connectTimer)
      if (responseTimer !== null) timing.clearTimeout(responseTimer)
      connectTimer = null
      responseTimer = null
    }
    const settle = (action: () => void) => {
      if (complete) return
      complete = true
      clearTimers()
      action()
    }
    const rejectUnavailable = () => {
      settle(() => { reject(unavailable()) })
    }

    let request: ReturnType<RequestTransport>
    try {
      request = requestTransport({
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port ? Number(url.port) : 443,
        method: 'GET',
        path: `${url.pathname}${url.search}`,
        headers: { connection: 'close' },
        agent: false
      }, (response) => {
        if (connectTimer !== null) timing.clearTimeout(connectTimer)
        connectTimer = null
        const statusCode = response.statusCode ?? null
        const contentType = response.headers['content-type']
        let size = 0
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | string) => {
          if (complete) return
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += bytes.byteLength
          if (size > maximumResponseBytes) {
            request.destroy()
            settle(() => { reject(new RemoteClientError(
              'RESPONSE_TOO_LARGE',
              'Canonical Markover returned a response that is too large.',
              statusCode
            )) })
            return
          }
          chunks.push(bytes)
        })
        response.once('aborted', rejectUnavailable)
        response.once('error', rejectUnavailable)
        response.once('end', () => {
          if (complete) return
          const bytes = Buffer.concat(chunks)
          if (
            !response.complete ||
            statusCode !== 200 ||
            contentType !== attachment.mimeType ||
            remoteContentDigest(bytes) !== attachment.checksum ||
            !verifyRemoteAttachmentResponseAuthorization(
              profile.token,
              access,
              statusCode,
              bytes,
              response.headers[REMOTE_GATEWAY_RESPONSE_AUTH_HEADER]
            )
          ) {
            settle(() => { reject(invalidResponse(statusCode)) })
            return
          }
          settle(() => { resolve(bytes) })
        })
      })
    } catch {
      rejectUnavailable()
      return
    }
    connectTimer = timing.setTimeout(() => {
      request.destroy()
      rejectUnavailable()
    }, connectTimeoutMilliseconds)
    request.once('socket', (socket) => {
      const connected = () => {
        if (connectTimer !== null) timing.clearTimeout(connectTimer)
        connectTimer = null
      }
      if (socket.connecting) socket.once('secureConnect', connected)
      else connected()
    })
    request.once('finish', () => {
      responseTimer = timing.setTimeout(() => {
        request.destroy()
        rejectUnavailable()
      }, responseTimeoutMilliseconds)
    })
    request.once('error', rejectUnavailable)
    request.end()
  })
}

async function sendRemoteJson(
  profile: RemoteProfile,
  method: string,
  path: string,
  body: unknown,
  {
    connectTimeoutMilliseconds = DEFAULT_CONNECT_TIMEOUT_MILLISECONDS,
    maximumResponseBytes = MAXIMUM_REMOTE_RESPONSE_BYTES,
    request: requestTransport = https.request,
    responseTimeoutMilliseconds = DEFAULT_RESPONSE_TIMEOUT_MILLISECONDS,
    timing = { setTimeout, clearTimeout },
    headers: suppliedHeaders = {},
    mutation = method !== 'GET'
  }: RemoteJsonRequestOptions,
  authorization: RemoteGatewayChallenge | null = null
): Promise<unknown> {
  if (
    !positiveFinite(connectTimeoutMilliseconds) ||
    !positiveFinite(responseTimeoutMilliseconds) ||
    !positiveFinite(maximumResponseBytes)
  ) {
    throw new RemoteClientError(
      'INVALID_REMOTE_REQUEST',
      'Remote Markover request limits must be positive.'
    )
  }

  const url = requestUrl(profile, path)
  let contents: string | null = null
  if (body !== null) {
    try {
      const serialized = JSON.stringify(body)
      if (typeof serialized !== 'string') throw new Error('Not JSON serializable.')
      contents = serialized
    } catch {
      throw new RemoteClientError(
        'INVALID_REMOTE_REQUEST',
        'The remote Markover request body is not valid JSON.'
      )
    }
  }
  const headers: Record<string, string | number> = { ...suppliedHeaders }
  headers.accept = 'application/json'
  headers.connection = 'close'
  if (contents !== null) {
    headers['content-type'] = 'application/json'
    headers['content-length'] = Buffer.byteLength(contents)
  }
  const requestBytes = Buffer.from(contents ?? '')
  if (authorization) {
    const contentDigest = remoteContentDigest(requestBytes)
    headers[REMOTE_GATEWAY_CONTENT_DIGEST_HEADER] = contentDigest
    headers.authorization = remoteRequestAuthorization(
      profile.token,
      authorization,
      method,
      path,
      contentDigest
    )
  }

  return new Promise<unknown>((resolve, reject) => {
    let complete = false
    let mutationSent = false
    let connectTimer: Timer | null = null
    let responseTimer: Timer | null = null

    const clearTimers = () => {
      if (connectTimer !== null) timing.clearTimeout(connectTimer)
      if (responseTimer !== null) timing.clearTimeout(responseTimer)
      connectTimer = null
      responseTimer = null
    }
    const settle = (action: () => void) => {
      if (complete) return
      complete = true
      clearTimers()
      action()
    }
    const rejectOnce = (error: Error) => {
      settle(() => { reject(error) })
    }
    const rejectTransport = () => {
      rejectOnce(mutation && mutationSent ? uncertain() : unavailable())
    }
    const rejectInvalidResponse = (error: RemoteClientError) => {
      rejectOnce(mutation && mutationSent ? uncertain() : error)
    }

    let request: ReturnType<RequestTransport>
    const requestOptions: HttpsRequestOptions = {
      protocol: 'https:',
      hostname: url.hostname,
      port: url.port ? Number(url.port) : 443,
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      agent: false
    }
    try {
      request = requestTransport(requestOptions, (response) => {
        if (connectTimer !== null) {
          timing.clearTimeout(connectTimer)
          connectTimer = null
        }
        const statusCode = response.statusCode ?? null
        const contentType = response.headers['content-type']
        if (
          typeof contentType !== 'string' ||
          !/^application\/json(?:\s*;|$)/i.test(contentType)
        ) {
          response.resume()
          rejectInvalidResponse(invalidResponse(statusCode))
          return
        }

        let size = 0
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | string) => {
          if (complete) return
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += bytes.byteLength
          if (size > maximumResponseBytes) {
            request.destroy()
            rejectInvalidResponse(new RemoteClientError(
              'RESPONSE_TOO_LARGE',
              'Canonical Markover returned a response that is too large.',
              statusCode
            ))
            return
          }
          chunks.push(bytes)
        })
        response.once('aborted', rejectTransport)
        response.once('error', rejectTransport)
        response.once('end', () => {
          if (complete) return
          if (!response.complete) {
            rejectTransport()
            return
          }
          const responseBytes = Buffer.concat(chunks)
          if (
            authorization &&
            !verifyRemoteResponseAuthorization(
              profile.token,
              authorization.nonce,
              statusCode ?? 0,
              responseBytes,
              response.headers[REMOTE_GATEWAY_RESPONSE_AUTH_HEADER]
            )
          ) {
            rejectInvalidResponse(invalidResponse(statusCode))
            return
          }
          let parsed: unknown
          try {
            parsed = JSON.parse(responseBytes.toString('utf8'))
          } catch {
            rejectInvalidResponse(invalidResponse(statusCode))
            return
          }

          if (statusCode === null || statusCode < 200 || statusCode >= 300) {
            const serviceError = isRecord(parsed) ? parsed.error : null
            if (
              !isRecord(serviceError) ||
              typeof serviceError.code !== 'string' ||
              typeof serviceError.message !== 'string'
            ) {
              rejectInvalidResponse(invalidResponse(statusCode))
              return
            }
            if (mutation && mutationSent && statusCode === 502) {
              rejectOnce(uncertain())
              return
            }
            rejectOnce(new RemoteClientError(
              serviceError.code,
              serviceError.message,
              statusCode,
              serviceError
            ))
            return
          }
          settle(() => { resolve(parsed) })
        })
      })
    } catch {
      rejectTransport()
      return
    }

    connectTimer = timing.setTimeout(() => {
      request.destroy()
      rejectTransport()
    }, connectTimeoutMilliseconds)
    request.once('socket', (socket) => {
      const connected = () => {
        if (connectTimer !== null) {
          timing.clearTimeout(connectTimer)
          connectTimer = null
        }
      }
      if (socket.connecting) socket.once('secureConnect', connected)
      else connected()
    })
    request.once('finish', () => {
      if (complete) return
      mutationSent = true
      responseTimer = timing.setTimeout(() => {
        request.destroy()
        rejectTransport()
      }, responseTimeoutMilliseconds)
    })
    request.once('error', rejectTransport)
    if (contents !== null) request.write(contents)
    request.end()
  })
}

export async function readRemoteHealth(
  profile: RemoteProfile,
  options: RemoteClientOptions = {}
): Promise<RemoteHealth> {
  const health = await sendRemoteJson(profile, 'GET', '/health', null, {
    ...options,
    mutation: false,
    preflight: false
  })
  if (
    !isRecord(health) ||
    health.status !== 'ok' ||
    !isRecord(health.protocol) ||
    health.protocol.name !== 'markover-remote' ||
    health.protocol.version !== REMOTE_GATEWAY_PROTOCOL_VERSION ||
    health.role !== 'canonical' ||
    health.scheme !== 'markover' ||
    typeof health.discoverAgentThreadFromLocalSessions !== 'boolean' ||
    !verifyRemoteGatewayChallenge(profile.token, health.authorization)
  ) {
    throw new RemoteClientError(
      'INCOMPATIBLE_REMOTE_CANONICAL',
      'The remote endpoint is not a compatible canonical Markover service.',
      200
    )
  }
  return health as unknown as RemoteHealth
}

export async function requestRemoteJson(
  profile: RemoteProfile,
  method: string,
  path: string,
  body: unknown = null,
  options: RemoteJsonRequestOptions = {}
): Promise<unknown> {
  let authorization = options.authorization ?? null
  if (options.preflight !== false) {
    const {
      connectTimeoutMilliseconds,
      maximumResponseBytes,
      request,
      responseTimeoutMilliseconds,
      timing
    } = options
    const health = await readRemoteHealth(profile, {
      ...(connectTimeoutMilliseconds === undefined
        ? {}
        : { connectTimeoutMilliseconds }),
      ...(maximumResponseBytes === undefined ? {} : { maximumResponseBytes }),
      ...(request === undefined ? {} : { request }),
      ...(responseTimeoutMilliseconds === undefined
        ? {}
        : { responseTimeoutMilliseconds }),
      ...(timing === undefined ? {} : { timing })
    })
    authorization = health.authorization
  }
  if (!authorization) {
    throw new RemoteClientError(
      'INVALID_REMOTE_REQUEST',
      'A fresh remote Markover authorization challenge is required.'
    )
  }
  return sendRemoteJson(profile, method, path, body, options, authorization)
}

import fs from 'node:fs/promises'
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import net from 'node:net'
import path from 'node:path'

import type { ResolvedInstance } from './instance'
import {
  INTERNAL_IDEMPOTENCY_KEY_HEADER,
  INTERNAL_REMOTE_CREATE_PATH,
  INTERNAL_REMOTE_RECOVERY_PATH,
  INTERNAL_REQUEST_DIGEST_HEADER,
  MAXIMUM_BODY_BYTES
} from './local-service'
import { reviewUrl } from './review-url'

export const REMOTE_GATEWAY_CAPABILITY =
  'lastobelus.com/cap/markover-remote-client'
export const REMOTE_GATEWAY_CAPABILITY_HEADER =
  'tailscale-app-capabilities'
export const REMOTE_GATEWAY_IDEMPOTENCY_HEADER = 'idempotency-key'
export const REMOTE_GATEWAY_REQUEST_DIGEST_HEADER =
  'markover-request-digest'
export const REMOTE_GATEWAY_PROTOCOL_VERSION = 1
export const MAXIMUM_REMOTE_RESPONSE_BYTES = 16 * 1024 * 1024
export const REMOTE_GATEWAY_SOCKET_NAME = 'remote-gateway.sock'

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/
const REQUEST_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const MAXIMUM_CAPABILITY_HEADER_BYTES = 16 * 1024
const REQUEST_TIMEOUT_MILLISECONDS = 30_000

interface ProxyResponse {
  body: unknown
  statusCode: number
}

interface SocketIdentity {
  dev: number
  ino: number
}

export interface RemoteGateway {
  socketPath: string
  close: () => Promise<void>
}

export interface RemoteGatewayOptions {
  socketPath: string
  localPort: number
  localToken: string
  discoveryPolicy: () => boolean
  routingReady: () => Promise<void>
  maximumResponseBytes?: number
  scheme?: string
  platform?: NodeJS.Platform
  uid?: number
}

export class RemoteGatewayError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RemoteGatewayError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorCode(error: unknown): unknown {
  return isRecord(error) ? error.code : null
}

function gatewayError(code: string, message: string): RemoteGatewayError {
  return new RemoteGatewayError(code, message)
}

export function remoteGatewaySocketPath(stateRoot: string): string {
  return path.join(stateRoot, REMOTE_GATEWAY_SOCKET_NAME)
}

export function remoteGatewayActivationEligible(
  instance: ResolvedInstance,
  smoke: boolean,
  platform: NodeJS.Platform = process.platform
): boolean {
  return remoteGatewayHostEligible(instance, smoke, platform) &&
    instance.checkout !== null
}

export function remoteGatewayHostEligible(
  instance: ResolvedInstance,
  smoke: boolean,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'darwin' &&
    !smoke &&
    instance.identity.kind === 'canonical' &&
    instance.scheme === 'markover'
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown
): void {
  const contents = `${JSON.stringify(body)}\n`
  response.writeHead(statusCode, {
    connection: 'close',
    'content-length': Buffer.byteLength(contents),
    'content-type': 'application/json; charset=utf-8'
  })
  response.end(contents)
}

function assertResponseBound(body: unknown, maximumBytes: number): void {
  if (Buffer.byteLength(`${JSON.stringify(body)}\n`) > maximumBytes) {
    throw gatewayError(
      'RESPONSE_TOO_LARGE',
      'Canonical Markover returned a response that is too large.'
    )
  }
}

async function readRequestBytes(request: IncomingMessage): Promise<Buffer> {
  let size = 0
  const chunks: Uint8Array[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAXIMUM_BODY_BYTES) {
      throw gatewayError('BODY_TOO_LARGE', 'Request body is too large.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function parseJson(bytes: Uint8Array): unknown {
  if (!bytes.byteLength) return null
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw gatewayError('INVALID_JSON', 'Request body must be valid JSON.')
  }
}

function singleHeader(request: IncomingMessage, name: string): string | null {
  const values = request.headersDistinct[name] || []
  return values.length === 1 && values[0] !== undefined ? values[0] : null
}

export function hasRemoteGatewayCapability(
  headers: IncomingHttpHeaders
): boolean {
  const raw = headers[REMOTE_GATEWAY_CAPABILITY_HEADER]
  if (
    typeof raw !== 'string' ||
    Buffer.byteLength(raw) > MAXIMUM_CAPABILITY_HEADER_BYTES
  ) return false
  try {
    const capabilities: unknown = JSON.parse(raw)
    if (!isRecord(capabilities)) return false
    const names = Object.keys(capabilities)
    return names.length === 1 &&
      names[0] === REMOTE_GATEWAY_CAPABILITY &&
      Array.isArray(capabilities[REMOTE_GATEWAY_CAPABILITY]) &&
      capabilities[REMOTE_GATEWAY_CAPABILITY].length > 0
  } catch {
    return false
  }
}

function containsProperty(value: unknown, property: string): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsProperty(entry, property))
  }
  if (!isRecord(value)) return false
  return Object.hasOwn(value, property) ||
    Object.values(value).some((entry) => containsProperty(entry, property))
}

function validateRemoteCreateBody(body: unknown): void {
  if (containsProperty(body, 'origin')) {
    throw gatewayError(
      'REMOTE_ORIGIN_FORBIDDEN',
      'Remote review origin is derived by canonical Markover.'
    )
  }
  if (containsProperty(body, 'attachments')) {
    throw gatewayError(
      'REMOTE_ATTACHMENTS_FORBIDDEN',
      'Remote review creation does not accept attachment metadata.'
    )
  }
}

function validatedAttemptHeaders(request: IncomingMessage): {
  idempotencyKey: string
  requestDigest: string
} {
  const idempotencyKey = singleHeader(
    request,
    REMOTE_GATEWAY_IDEMPOTENCY_HEADER
  )
  const requestDigest = singleHeader(
    request,
    REMOTE_GATEWAY_REQUEST_DIGEST_HEADER
  )
  if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw gatewayError(
      'INVALID_CREATION_RECEIPT',
      'A 256-bit base64url idempotency key is required.'
    )
  }
  if (!requestDigest || !REQUEST_DIGEST_PATTERN.test(requestDigest)) {
    throw gatewayError(
      'INVALID_CREATION_RECEIPT',
      'A SHA-256 request digest is required.'
    )
  }
  return { idempotencyKey, requestDigest }
}

function allowedRemotePath(method: string | undefined, pathname: string): boolean {
  if (method === 'GET' && pathname === '/health') return true
  if (method !== 'POST') return false
  if (
    pathname === '/reviews' ||
    pathname === '/reviews/pending' ||
    pathname === '/reviews/done'
  ) return true
  return /^\/reviews\/mko_[a-zA-Z0-9]{6,32}\/(?:handoff|edit|revise)$/.test(
    pathname
  )
}

function proxyRequest(
  port: number,
  token: string,
  method: string,
  pathname: string,
  body: Uint8Array,
  headers: Record<string, string> = {},
  maximumResponseBytes = MAXIMUM_REMOTE_RESPONSE_BYTES
): Promise<ProxyResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: pathname,
      headers: {
        authorization: `Bearer ${token}`,
        connection: 'close',
        'content-length': body.byteLength,
        ...(body.byteLength ? { 'content-type': 'application/json' } : {}),
        ...headers
      }
    }, (response) => {
      let size = 0
      const chunks: Uint8Array[] = []
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maximumResponseBytes) {
          response.destroy(gatewayError(
            'RESPONSE_TOO_LARGE',
            'Canonical Markover returned a response that is too large.'
          ))
          return
        }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => {
        try {
          resolve({
            body: parseJson(Buffer.concat(chunks)),
            statusCode: response.statusCode || 502
          })
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })
    request.setTimeout(REQUEST_TIMEOUT_MILLISECONDS, () => {
      request.destroy(gatewayError(
        'CANONICAL_SERVICE_TIMEOUT',
        'Canonical Markover did not complete the request in time.'
      ))
    })
    request.on('error', reject)
    request.end(body)
  })
}

function responseWithReviewUrl(
  body: unknown,
  scheme: string
): unknown {
  if (!isRecord(body) || typeof body.reviewId !== 'string') return body
  return { ...body, reviewUrl: reviewUrl(scheme, body.reviewId) }
}

function pendingResponseWithUrls(body: unknown, scheme: string): unknown {
  if (!isRecord(body) || !Array.isArray(body.reviews)) return body
  return {
    ...body,
    reviews: body.reviews.map((entry: unknown) => (
      isRecord(entry) && typeof entry.reviewId === 'string'
        ? { ...entry, reviewUrl: reviewUrl(scheme, entry.reviewId) }
        : entry
    ))
  }
}

async function socketIsListening(socketPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy()
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') {
        resolve(false)
      } else {
        reject(error)
      }
    })
  })
}

async function prepareSocketPath(
  socketPath: string,
  uid: number
): Promise<void> {
  const parent = path.dirname(socketPath)
  await fs.mkdir(parent, { recursive: true, mode: 0o700 })
  const parentStats = await fs.lstat(parent)
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw gatewayError(
      'REMOTE_GATEWAY_PARENT_INVALID',
      'The remote gateway parent must be an owned directory.'
    )
  }
  if (parentStats.uid !== uid) {
    throw gatewayError(
      'REMOTE_GATEWAY_PARENT_UNOWNED',
      'The remote gateway parent belongs to another account.'
    )
  }
  await fs.chmod(parent, 0o700)

  let socketStats
  try {
    socketStats = await fs.lstat(socketPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    throw error
  }
  if (!socketStats.isSocket() || socketStats.uid !== uid) {
    throw gatewayError(
      'REMOTE_GATEWAY_SOCKET_UNOWNED',
      'The remote gateway path is not an owned stale socket.'
    )
  }
  if (await socketIsListening(socketPath)) {
    throw gatewayError(
      'REMOTE_GATEWAY_IN_USE',
      'Another process is already listening on the remote gateway socket.'
    )
  }
  await fs.unlink(socketPath)
}

async function removeOwnedSocket(
  socketPath: string,
  identity: SocketIdentity,
  uid: number
): Promise<void> {
  try {
    const stats = await fs.lstat(socketPath)
    if (
      stats.isSocket() &&
      stats.uid === uid &&
      stats.dev === identity.dev &&
      stats.ino === identity.ino
    ) {
      await fs.unlink(socketPath)
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
}

export async function startRemoteGateway({
  socketPath,
  localPort,
  localToken,
  discoveryPolicy,
  routingReady,
  maximumResponseBytes = MAXIMUM_REMOTE_RESPONSE_BYTES,
  scheme = 'markover',
  platform = process.platform,
  uid = typeof process.getuid === 'function' ? process.getuid() : -1
}: RemoteGatewayOptions): Promise<RemoteGateway> {
  if (platform === 'win32' || uid < 0) {
    throw gatewayError(
      'REMOTE_GATEWAY_PLATFORM_UNSUPPORTED',
      'The remote gateway requires an owner-mode Unix socket.'
    )
  }
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65_535) {
    throw gatewayError(
      'REMOTE_GATEWAY_LOCAL_SERVICE_INVALID',
      'The canonical local service port is invalid.'
    )
  }
  if (!Number.isInteger(maximumResponseBytes) || maximumResponseBytes < 1) {
    throw gatewayError(
      'REMOTE_GATEWAY_RESPONSE_BOUND_INVALID',
      'The remote gateway response bound is invalid.'
    )
  }

  await routingReady()
  await prepareSocketPath(socketPath, uid)

  let accepting = true
  let activeRequest: Promise<void> | null = null

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    if (!hasRemoteGatewayCapability(request.headers)) {
      sendJson(response, 403, {
        error: {
          code: 'REMOTE_CAPABILITY_REQUIRED',
          message: 'Remote Markover capability required.'
        }
      })
      return
    }
    if (!accepting) {
      sendJson(response, 503, {
        error: {
          code: 'REMOTE_GATEWAY_DISABLED',
          message: 'The remote Markover gateway is disabled.'
        }
      })
      return
    }
    if (activeRequest) {
      sendJson(response, 503, {
        error: {
          code: 'REMOTE_GATEWAY_BUSY',
          message: 'The remote Markover gateway is handling another request.'
        }
      })
      return
    }

    let resolveActive: () => void = () => {}
    activeRequest = new Promise<void>((resolve) => { resolveActive = resolve })
    try {
      let url: URL
      try {
        url = new URL(request.url || '', 'http://markover.invalid')
      } catch {
        sendJson(response, 404, {
          error: { code: 'NOT_FOUND', message: 'Route not found.' }
        })
        return
      }
      if (url.search || !allowedRemotePath(request.method, url.pathname)) {
        sendJson(response, 404, {
          error: { code: 'NOT_FOUND', message: 'Route not found.' }
        })
        return
      }

      await routingReady()
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          status: 'ok',
          protocol: {
            name: 'markover-remote',
            version: REMOTE_GATEWAY_PROTOCOL_VERSION
          },
          role: 'canonical',
          scheme,
          discoverAgentThreadFromLocalSessions: discoveryPolicy()
        })
        return
      }

      const attempt = url.pathname === '/reviews'
        ? validatedAttemptHeaders(request)
        : null
      const requestBytes = await readRequestBytes(request)
      let internalPath = url.pathname
      let internalBody = requestBytes
      let internalHeaders: Record<string, string> = {}
      if (url.pathname === '/reviews') {
        const { idempotencyKey, requestDigest } = attempt as {
          idempotencyKey: string
          requestDigest: string
        }
        internalHeaders = {
          [INTERNAL_IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
          [INTERNAL_REQUEST_DIGEST_HEADER]: requestDigest
        }
        if (requestBytes.byteLength) {
          validateRemoteCreateBody(parseJson(requestBytes))
          internalPath = INTERNAL_REMOTE_CREATE_PATH
        } else {
          internalPath = INTERNAL_REMOTE_RECOVERY_PATH
          internalBody = Buffer.alloc(0)
        }
      }

      const proxied = await proxyRequest(
        localPort,
        localToken,
        request.method || 'POST',
        internalPath,
        internalBody,
        internalHeaders,
        maximumResponseBytes
      )
      const body = proxied.statusCode >= 200 && proxied.statusCode < 300
        ? url.pathname === '/reviews'
          ? responseWithReviewUrl(proxied.body, scheme)
          : url.pathname === '/reviews/pending'
            ? pendingResponseWithUrls(proxied.body, scheme)
            : proxied.body
        : proxied.body
      assertResponseBound(body, maximumResponseBytes)
      sendJson(response, proxied.statusCode, body)
    } catch (error) {
      const code = errorCode(error)
      const statusCode = code === 'BODY_TOO_LARGE'
        ? 413
        : code === 'REMOTE_ORIGIN_FORBIDDEN' ||
            code === 'REMOTE_ATTACHMENTS_FORBIDDEN' ||
            code === 'INVALID_CREATION_RECEIPT' ||
            code === 'INVALID_JSON'
          ? 400
          : code === 'CANONICAL_ROUTING_UNHEALTHY'
            ? 503
            : 502
      sendJson(response, statusCode, {
        error: {
          code: typeof code === 'string' ? code : 'REMOTE_GATEWAY_FAILURE',
          message: error instanceof Error ? error.message : String(error)
        }
      })
    } finally {
      resolveActive()
      activeRequest = null
    }
  }

  const server = http.createServer((request, response) => {
    void handleRequest(request, response)
  })
  server.requestTimeout = REQUEST_TIMEOUT_MILLISECONDS
  server.headersTimeout = REQUEST_TIMEOUT_MILLISECONDS

  let startedSocketIdentity: SocketIdentity | null = null
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })
    await fs.chmod(socketPath, 0o600)
    const stats = await fs.lstat(socketPath)
    if (!stats.isSocket() || stats.uid !== uid) {
      throw gatewayError(
        'REMOTE_GATEWAY_SOCKET_INVALID',
        'The remote gateway did not create an owned Unix socket.'
      )
    }
    const socketIdentity = { dev: stats.dev, ino: stats.ino }
    startedSocketIdentity = socketIdentity
    let closePromise: Promise<void> | null = null
    return {
      socketPath,
      close: () => {
        accepting = false
        closePromise ||= new Promise<void>((resolve, reject) => {
          server.close((error) => { if (error) reject(error); else resolve() })
          server.closeIdleConnections()
        }).then(async () => {
          await activeRequest
          await removeOwnedSocket(socketPath, socketIdentity, uid)
        })
        return closePromise
      }
    }
  } catch (error) {
    accepting = false
    await new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve()
        return
      }
      server.close(() => { resolve() })
    })
    if (startedSocketIdentity) {
      await removeOwnedSocket(socketPath, startedSocketIdentity, uid)
    }
    throw error
  }
}

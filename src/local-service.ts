import { timingSafeEqual } from 'node:crypto'
import http, {
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import type { AddressInfo } from 'node:net'

import { AsyncMutationTracker } from './async-mutation-tracker'
import type {
  ReviewArtifact,
  ReviewCreateInput,
  ReviewStore
} from './review-store'
import {
  CAPABILITY_TOKEN_PATTERN,
  SERVICE_INSTANCE_PATTERN,
  type ServiceIdentity
} from './service-endpoint'

export const MAXIMUM_BODY_BYTES = 16 * 1024 * 1024

interface ReviewRoute {
  reviewId: string
  action: 'activate' | 'handoff' | 'edit' | null
}

export interface LocalService {
  port: number
  close: () => Promise<void>
  pauseMutations: () => Promise<void>
  resumeMutations: () => void
}

export interface UnauthorizedRequest {
  method: string
  pathname: string
  reason: 'missing' | 'malformed' | 'mismatch'
}

export interface LocalServiceOptions {
  identity: ServiceIdentity
  store: Pick<
    ReviewStore,
    'create' | 'edit' | 'handoff' | 'list' | 'load'
  >
  beforeAction?: ((
    reviewId: string,
    action: 'handoff' | 'edit'
  ) => Promise<undefined | (() => void | Promise<void>)>) | undefined
  onActivate?: ((reviewId: string) => Promise<ReviewActivationResult>) | undefined
  onChange?: ((
    artifact: ReviewArtifact,
    action: 'created' | 'handoff' | 'edit'
  ) => void | Promise<void>) | undefined
  onUnauthorized?: ((event: UnauthorizedRequest) => void) | undefined
  interpretationPolicy?: (() => string) | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorProperty(error: unknown, key: 'code' | 'message'): unknown {
  return error !== null && typeof error === 'object' ? Reflect.get(error, key) : null
}

function serviceError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  const contents = `${JSON.stringify(body)}\n`
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(contents),
    ...headers
  })
  response.end(contents)
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Uint8Array[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAXIMUM_BODY_BYTES) {
      throw serviceError('BODY_TOO_LARGE', 'Request body is too large.')
    }
    chunks.push(buffer)
  }

  if (!chunks.length) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw serviceError('INVALID_JSON', 'Request body must be valid JSON.')
  }
}

function errorStatus(error: unknown): number {
  const code = errorProperty(error, 'code')
  if (code === 'ACTIVATION_NOT_READY') return 503
  if (code === 'ACTIVATION_TIMEOUT') return 504
  if (code === 'NOT_FOUND') return 404
  if (
    code === 'INVALID_ID' ||
    code === 'INVALID_JSON' ||
    code === 'INVALID_REVIEW' ||
    code === 'REVIEW_MISMATCH'
  ) {
    return 400
  }
  if (code === 'NOT_EDITABLE') return 409
  if (code === 'SHUTTING_DOWN') return 503
  if (code === 'BODY_TOO_LARGE') return 413
  return 500
}

export function reviewRoute(pathname: string): ReviewRoute | null {
  const match = /^\/reviews\/([^/]+)(?:\/(activate|handoff|edit))?$/.exec(pathname)
  if (!match) return null
  return {
    reviewId: decodeURIComponent(match[1] as string),
    action: (match[2] as 'activate' | 'handoff' | 'edit' | undefined) || null
  }
}

export async function startLocalService({
  identity,
  store,
  beforeAction = () => Promise.resolve(undefined),
  onActivate = () => Promise.reject(serviceError(
    'ACTIVATION_UNAVAILABLE',
    'Review activation is unavailable.'
  )),
  onChange = () => {},
  onUnauthorized = () => {},
  interpretationPolicy
}: LocalServiceOptions): Promise<LocalService> {
  if (
    !SERVICE_INSTANCE_PATTERN.test(identity.instanceId) ||
    !CAPABILITY_TOKEN_PATTERN.test(identity.token)
  ) {
    throw new Error('Markover service identity is invalid.')
  }
  const expectedToken = Buffer.from(identity.token, 'ascii')
  const actionQueues = new Map<string, Promise<void>>()
  const mutations = new AsyncMutationTracker()
  let acceptingMutations = true

  function runMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (!acceptingMutations) {
      return Promise.reject(serviceError(
        'SHUTTING_DOWN',
        'Markover is preparing to quit; retry after it restarts.'
      ))
    }
    return mutations.track(operation)
  }

  function serializeReviewAction<T>(
    reviewId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = actionQueues.get(reviewId) || Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    const queued = current.then(() => undefined, () => undefined)
    actionQueues.set(reviewId, queued)
    return current.finally(() => {
      if (actionQueues.get(reviewId) === queued) {
        actionQueues.delete(reviewId)
      }
    })
  }

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, {
          status: 'ok',
          version: 2,
          instanceId: identity.instanceId
        })
        return
      }

      const authorizationValues = request.headersDistinct.authorization || []
      let unauthorizedReason: UnauthorizedRequest['reason'] | null = null
      let presentedToken = ''
      if (authorizationValues.length === 0) {
        unauthorizedReason = 'missing'
      } else if (authorizationValues.length !== 1) {
        unauthorizedReason = 'malformed'
      } else {
        const match = /^Bearer +([A-Za-z0-9_-]{43})$/i.exec(
          authorizationValues[0] as string
        )
        if (!match) {
          unauthorizedReason = 'malformed'
        } else {
          presentedToken = match[1] as string
          if (!timingSafeEqual(Buffer.from(presentedToken, 'ascii'), expectedToken)) {
            unauthorizedReason = 'mismatch'
          }
        }
      }
      if (unauthorizedReason) {
        let pathname = '(invalid)'
        try {
          pathname = new URL(
            request.url || '',
            'http://127.0.0.1'
          ).pathname
        } catch {
          // Keep malformed request targets out of diagnostics.
        }
        try {
          onUnauthorized({
            method: request.method || 'UNKNOWN',
            pathname,
            reason: unauthorizedReason
          })
        } catch {
          // Diagnostics cannot change authorization behavior.
        }
        sendJson(
          response,
          401,
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required.'
            }
          },
          { 'www-authenticate': 'Bearer realm="Markover"' }
        )
        return
      }

      const url = new URL(request.url || '', 'http://127.0.0.1')

      if (request.method === 'GET' && url.pathname === '/reviews') {
        sendJson(response, 200, { reviews: await store.list() })
        return
      }

      if (request.method === 'POST' && url.pathname === '/reviews') {
        const artifact = await runMutation(async () => {
          const body = await readJson(request)
          const record = isRecord(body) ? body : {}
          const metadata = isRecord(record.metadata) ? record.metadata : {}
          const createInput: ReviewCreateInput = {
            tree: record.tree,
            contextSummary: metadata.contextSummary,
            agentThread: metadata.agentThread,
            git: metadata.git,
            pullRequest: metadata.pullRequest,
            interpretationPolicy: interpretationPolicy?.()
          }
          const created = await store.create(createInput)
          await onChange(created, 'created')
          return created
        })
        sendJson(response, 201, {
          reviewId: artifact.review.id,
          status: artifact.review.status
        })
        return
      }

      const route = reviewRoute(url.pathname)
      if (route && request.method === 'GET' && !route.action) {
        sendJson(response, 200, await store.load(route.reviewId))
        return
      }

      if (
        route &&
        request.method === 'POST' &&
        route.action === 'activate'
      ) {
        sendJson(response, 200, await runMutation(() => (
          onActivate(route.reviewId)
        )))
        return
      }

      if (
        route &&
        request.method === 'POST' &&
        (route.action === 'handoff' || route.action === 'edit')
      ) {
        const action = route.action
        const artifact = await runMutation(() => (
          serializeReviewAction(route.reviewId, async () => {
            let rollbackHandoff: undefined | (() => void | Promise<void>)
            if (action === 'handoff') {
              const current = await store.load(route.reviewId)
              if (current.review.status === 'editing') {
                rollbackHandoff = await beforeAction(route.reviewId, action)
              }
            }
            let changed
            try {
              changed = action === 'handoff'
                ? await store.handoff(route.reviewId)
                : await store.edit(route.reviewId)
            } catch (error) {
              if (rollbackHandoff) await rollbackHandoff()
              throw error
            }
            await onChange(changed, action)
            return changed
          })
        ))
        sendJson(
          response,
          200,
          action === 'handoff'
            ? artifact
            : {
                reviewId: artifact.review.id,
                status: artifact.review.status
              }
        )
        return
      }

      sendJson(response, 404, {
        error: { code: 'NOT_FOUND', message: 'Route not found.' }
      })
    } catch (error) {
      const code = errorProperty(error, 'code')
      const message = errorProperty(error, 'message')
      sendJson(response, errorStatus(error), {
        error: {
          code: typeof code === 'string' ? code : 'INTERNAL_ERROR',
          message: typeof message === 'string' ? message : String(error)
        }
      })
    }
  }

  const server = http.createServer((request, response) => {
    void handleRequest(request, response)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address() as AddressInfo
  let closePromise: Promise<void> | null = null
  return {
    port: address.port,
    pauseMutations: async () => {
      acceptingMutations = false
      await mutations.wait()
    },
    resumeMutations: () => {
      if (!closePromise) acceptingMutations = true
    },
    close: () => {
      acceptingMutations = false
      closePromise ||= mutations.wait().then(() => new Promise<void>(
        (resolve, reject) => {
          server.close((error) => { if (error) reject(error); else resolve() })
        }
      ))
      return closePromise
    }
  }
}

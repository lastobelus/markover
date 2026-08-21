import { timingSafeEqual } from 'node:crypto'
import http, {
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import type { AddressInfo } from 'node:net'

import { AsyncMutationTracker } from './async-mutation-tracker'
import type {
  ManualReviewResolutionOutcome,
  ReviewArtifact,
  ReviewCreationAttempt,
  ReviewCreationResult,
  ReviewStore
} from './review-store'
import {
  pendingReviewResponsibility,
  reviewHasFeedbackArtifacts
} from './review-store'
import {
  CAPABILITY_TOKEN_PATTERN,
  SERVICE_INSTANCE_PATTERN,
  type ServiceIdentity
} from './service-endpoint'
import {
  isPullRequestStatus,
  parseGitHubPullRequestUrl
} from './pull-request'
import {
  isDevelopmentElementCalloutRequest,
  type DevelopmentElementCalloutRequest,
  type DevelopmentElementCalloutResult
} from './development-element'

export const MAXIMUM_BODY_BYTES = 16 * 1024 * 1024
export const INTERNAL_REMOTE_CREATE_PATH = '/internal/remote/reviews'
export const INTERNAL_REMOTE_RECOVERY_PATH =
  '/internal/remote/reviews/recover'
export const INTERNAL_IDEMPOTENCY_KEY_HEADER =
  'x-markover-idempotency-key'
export const INTERNAL_REQUEST_DIGEST_HEADER =
  'x-markover-request-digest'

interface ReviewRoute {
  reviewId: string
  action:
    | 'activate'
    | 'handoff'
    | 'get-for-review'
    | 'submit'
    | 'edit'
    | 'resolve'
    | 'unresolve'
    | 'revise'
    | null
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

export type ReviewCreateProducer = 'agent' | 'remote-agent'

export type LocalServiceChangeAction =
  | 'created'
  | 'handoff'
  | 'get-for-review'
  | 'submit'
  | 'edit'
  | 'resolve'
  | 'unresolve'
  | 'revise'
  | 'done'
  | 'observed'

type ReviewCreateMutationStore = Pick<
  ReviewStore,
  'create' | 'createWithReceipt' | 'propagatePullRequestObservation'
>

export interface ReviewCreateMutationOptions {
  body: unknown
  producer: unknown
  store: ReviewCreateMutationStore
  attempt?: ReviewCreationAttempt | undefined
  interpretationPolicy?: string | undefined
  onChange?: (
    artifact: ReviewArtifact,
    action: LocalServiceChangeAction
  ) => void | Promise<void>
}

export interface LocalServiceOptions {
  identity: ServiceIdentity
  store: Pick<
    ReviewStore,
    | 'create'
    | 'createWithReceipt'
    | 'doneReview'
    | 'edit'
    | 'getForReview'
    | 'handoff'
    | 'list'
    | 'load'
    | 'matchingPullRequestReviews'
    | 'pendingForThread'
    | 'propagatePullRequestObservation'
    | 'recoverCreation'
    | 'resolve'
    | 'revise'
    | 'submitAgentReview'
    | 'unresolve'
  >
  beforeAction?: ((
    reviewId: string,
    action: 'handoff' | 'get-for-review' | 'edit' | 'done' | 'resolve'
  ) => Promise<undefined | (() => void | Promise<void>)>) | undefined
  confirmFeedbackAbandonment?: ((
    artifacts: readonly ReviewArtifact[],
    outcome: Exclude<ManualReviewResolutionOutcome, 'feedback-abandoned'>
  ) => Promise<boolean>) | undefined
  onActivate?: ((reviewId: string) => Promise<ReviewActivationResult>) | undefined
  onChange?: ((
    artifact: ReviewArtifact,
    action: LocalServiceChangeAction
  ) => void | Promise<void>) | undefined
  onDevelopmentReload?: (() => Promise<void>) | undefined
  onDevelopmentElementCallout?: ((
    request: DevelopmentElementCalloutRequest
  ) => Promise<DevelopmentElementCalloutResult>) | undefined
  onQuit?: (() => void) | undefined
  onUnauthorized?: ((event: UnauthorizedRequest) => void) | undefined
  interpretationPolicy?: (() => string) | undefined
  agentReviewMode?: (() => AgentReviewMode) | undefined
  windowVisible?: (() => boolean) | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorProperty(
  error: unknown,
  key: 'code' | 'creationReceipt' | 'message' | 'reviewId' | 'reviewIds'
): unknown {
  return isRecord(error) ? error[key] : null
}

function serviceError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

export function reviewCreateInputForProducer(
  body: unknown,
  producer: unknown,
  interpretationPolicy?: string
): Parameters<ReviewStore['create']>[0] {
  if (producer !== 'agent' && producer !== 'remote-agent') {
    throw serviceError(
      'INVALID_REVIEW_PRODUCER',
      'Review creation requires a supported trusted producer.'
    )
  }
  const record = isRecord(body) ? body : {}
  const metadata = isRecord(record.metadata) ? record.metadata : {}
  return {
    tree: record.tree,
    contextSummary: metadata.contextSummary,
    origin: producer,
    agentThread: metadata.agentThread,
    git: metadata.git,
    pullRequest: metadata.pullRequest,
    pullRequestStatus: record.pullRequestStatus,
    interpretationPolicy
  }
}

export async function createReviewForProducer({
  body,
  producer,
  store,
  attempt,
  interpretationPolicy,
  onChange = () => {}
}: ReviewCreateMutationOptions): Promise<ReviewCreationResult> {
  const input = reviewCreateInputForProducer(
    body,
    producer,
    interpretationPolicy
  )
  const result = attempt
    ? await store.createWithReceipt(input, attempt)
    : { artifact: await store.create(input), created: true }
  if (!result.created) return result

  await onChange(result.artifact, 'created')
  const related = await store.propagatePullRequestObservation(result.artifact)
  for (const updated of related) await onChange(updated, 'observed')
  return result
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

async function readRequestBytes(request: IncomingMessage): Promise<Buffer> {
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

  return Buffer.concat(chunks)
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  if (!bytes.byteLength) return null
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw serviceError('INVALID_JSON', 'Request body must be valid JSON.')
  }
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  return parseJsonBytes(await readRequestBytes(request))
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const values = request.headersDistinct[name] || []
  return values.length === 1 ? values[0] : undefined
}

function errorStatus(error: unknown): number {
  const code = errorProperty(error, 'code')
  if (code === 'ACTIVATION_NOT_READY') return 503
  if (code === 'ACTIVATION_TIMEOUT') return 504
  if (
    code === 'DEVELOPMENT_ELEMENT_REFERENCE_STALE' ||
    code === 'NOT_FOUND' ||
    code === 'RECEIPT_NOT_FOUND'
  ) return 404
  if (
    code === 'UNSUPPORTED_REVIEW_FORMAT' ||
    code === 'UNSUPPORTED_REVIEW_VERSION'
  ) return 409
  if (
    code === 'INVALID_ID' ||
    code === 'INVALID_DEVELOPMENT_ELEMENT_CALLOUT' ||
    code === 'INVALID_CREATION_RECEIPT' ||
    code === 'INVALID_JSON' ||
    code === 'INVALID_PULL_REQUEST' ||
    code === 'INVALID_PULL_REQUEST_STATUS' ||
    code === 'INVALID_REVIEW_PRODUCER' ||
    code === 'INVALID_RESOLUTION' ||
    code === 'INVALID_REVIEW' ||
    code === 'INVALID_THREAD' ||
    code === 'PULL_REQUEST_REQUIRED' ||
    code === 'REQUEST_DIGEST_MISMATCH' ||
    code === 'REVIEW_MISMATCH'
  ) {
    return 400
  }
  if (
    code === 'CLAIM_CONFLICT' ||
    code === 'DEVELOPMENT_ELEMENT_REFERENCE_AMBIGUOUS' ||
    code === 'CREATION_RECEIPT_SCAN_INCOMPLETE' ||
    code === 'DUPLICATE_CREATION_RECEIPT' ||
    code === 'FEEDBACK_REQUIRED' ||
    code === 'FEEDBACK_REQUIRES_ABANDONMENT' ||
    code === 'IDEMPOTENCY_CONFLICT' ||
    code === 'INVALID_TRANSITION' ||
    code === 'NOT_EDITABLE' ||
    code === 'REVIEW_NOT_PRISTINE' ||
    code === 'SOURCE_PROPOSALS_FORBIDDEN' ||
    code === 'SUBMISSION_CONFLICT'
  ) return 409
  if (code === 'SHUTTING_DOWN') return 503
  if (code === 'DEVELOPMENT_ELEMENT_CALLOUT_NOT_READY') return 503
  if (code === 'DEVELOPMENT_ELEMENT_CALLOUT_TIMEOUT') return 504
  if (code === 'REQUEST_UNCERTAIN') return 503
  if (code === 'BODY_TOO_LARGE') return 413
  return 500
}

export function reviewRoute(pathname: string): ReviewRoute | null {
  const match = /^\/reviews\/([^/]+)(?:\/(activate|handoff|get-for-review|submit|edit|resolve|unresolve|revise))?$/.exec(pathname)
  if (!match) return null
  return {
    reviewId: decodeURIComponent(match[1] as string),
    action: (
      match[2] as Exclude<ReviewRoute['action'], null> | undefined
    ) || null
  }
}

export async function startLocalService({
  identity,
  store,
  beforeAction = () => Promise.resolve(undefined),
  confirmFeedbackAbandonment = () => Promise.resolve(false),
  onActivate = () => Promise.reject(serviceError(
    'ACTIVATION_UNAVAILABLE',
    'Review activation is unavailable.'
  )),
  onChange = () => {},
  onDevelopmentElementCallout,
  onDevelopmentReload,
  onQuit = () => {},
  onUnauthorized = () => {},
  interpretationPolicy,
  agentReviewMode = () => 'annotation-only',
  windowVisible = () => false
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

  async function propagateObservation(artifact: ReviewArtifact): Promise<void> {
    const related = await store.propagatePullRequestObservation(artifact)
    for (const updated of related) await onChange(updated, 'observed')
  }

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    let exposeRemoteErrorDetails = false
    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, {
          status: 'ok',
          version: 2,
          instanceId: identity.instanceId,
          executablePath: process.execPath,
          windowVisible: windowVisible()
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

      if (
        request.method === 'POST' &&
        url.pathname === '/development/element-callout' &&
        onDevelopmentElementCallout
      ) {
        const body = await readJson(request)
        if (!isDevelopmentElementCalloutRequest(body)) {
          throw serviceError(
            'INVALID_DEVELOPMENT_ELEMENT_CALLOUT',
            'Development element callout input is invalid.'
          )
        }
        const result = await onDevelopmentElementCallout(body)
        if (result.status === 'stale') {
          throw serviceError(
            'DEVELOPMENT_ELEMENT_REFERENCE_STALE',
            'The development element reference is stale.'
          )
        }
        if (result.status === 'ambiguous') {
          throw serviceError(
            'DEVELOPMENT_ELEMENT_REFERENCE_AMBIGUOUS',
            'The development element reference is ambiguous.'
          )
        }
        sendJson(response, 200, result)
        return
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/development/reload' &&
        onDevelopmentReload
      ) {
        await onDevelopmentReload()
        sendJson(response, 200, { status: 'reloaded' })
        return
      }

      if (
        request.method === 'POST' &&
        url.pathname === INTERNAL_REMOTE_CREATE_PATH
      ) {
        exposeRemoteErrorDetails = true
        const requestBytes = await readRequestBytes(request)
        const body = parseJsonBytes(requestBytes)
        const result = await runMutation(() => createReviewForProducer({
          body,
          producer: 'remote-agent',
          store,
          attempt: {
            idempotencyKey: singleHeader(
              request,
              INTERNAL_IDEMPOTENCY_KEY_HEADER
            ),
            requestBytes,
            requestDigest: singleHeader(
              request,
              INTERNAL_REQUEST_DIGEST_HEADER
            )
          },
          interpretationPolicy: interpretationPolicy?.(),
          onChange
        }))
        sendJson(response, result.created ? 201 : 200, {
          created: result.created,
          reviewId: result.artifact.review.id,
          status: result.artifact.review.status
        })
        return
      }

      if (
        request.method === 'POST' &&
        url.pathname === INTERNAL_REMOTE_RECOVERY_PATH
      ) {
        exposeRemoteErrorDetails = true
        const artifact = await runMutation(() => store.recoverCreation({
          idempotencyKey: singleHeader(
            request,
            INTERNAL_IDEMPOTENCY_KEY_HEADER
          ),
          requestDigest: singleHeader(
            request,
            INTERNAL_REQUEST_DIGEST_HEADER
          )
        }))
        sendJson(response, 200, {
          created: false,
          reviewId: artifact.review.id,
          status: artifact.review.status
        })
        return
      }

      if (request.method === 'POST' && url.pathname === '/quit') {
        sendJson(response, 202, { status: 'quitting' })
        setImmediate(onQuit)
        return
      }

      if (request.method === 'GET' && url.pathname === '/reviews') {
        sendJson(response, 200, { reviews: await store.list() })
        return
      }

      if (request.method === 'POST' && url.pathname === '/reviews/pending') {
        const body = await readJson(request)
        const record = isRecord(body) ? body : {}
        const reviews = await store.pendingForThread(record.agentThread)
        sendJson(response, 200, {
          format: 'markover-pending-reviews',
          version: 1,
          reviews: reviews.map((artifact) => ({
            reviewId: artifact.review.id,
            responsibility: pendingReviewResponsibility(artifact.review.status),
            status: artifact.review.status,
            documentName: artifact.sourceDocument.name,
            contextSummary: artifact.review.contextSummary,
            createdAt: artifact.review.createdAt,
            attentionRequestedAt: artifact.review.attentionRequestedAt,
            pullRequest: artifact.review.pullRequest
              ? {
                  number: artifact.review.pullRequest.number,
                  url: artifact.review.pullRequest.url,
                  ...(artifact.review.pullRequest.status
                    ? { status: artifact.review.pullRequest.status }
                    : {})
                }
              : null
          }))
        })
        return
      }

      if (request.method === 'POST' && url.pathname === '/reviews') {
        const result = await runMutation(async () => {
          const body = await readJson(request)
          return createReviewForProducer({
            body,
            producer: 'agent',
            store,
            interpretationPolicy: interpretationPolicy?.(),
            onChange
          })
        })
        sendJson(response, 201, {
          reviewId: result.artifact.review.id,
          status: result.artifact.review.status
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
        route.action === 'get-for-review'
      ) {
        const body = await readJson(request)
        const record = isRecord(body) ? body : {}
        const suppliedPullRequestStatus = record.pullRequestStatus
        if (
          suppliedPullRequestStatus !== undefined &&
          suppliedPullRequestStatus !== null &&
          !isPullRequestStatus(suppliedPullRequestStatus)
        ) {
          throw serviceError(
            'INVALID_PULL_REQUEST_STATUS',
            'Invalid pull request status.'
          )
        }
        const pullRequestStatus = isPullRequestStatus(
          suppliedPullRequestStatus
        ) ? suppliedPullRequestStatus : undefined
        const artifact = await runMutation(() => (
          serializeReviewAction(route.reviewId, async () => {
            const current = await store.load(route.reviewId)
            let rollback: undefined | (() => void | Promise<void>)
            if (current.review.status === 'editing') {
              rollback = await beforeAction(route.reviewId, 'get-for-review')
            }
            let accepted = false
            try {
              const claimed = await store.getForReview(route.reviewId, {
                mode: agentReviewMode(),
                maximumSubmissionBytes: MAXIMUM_BODY_BYTES,
                ...(Object.prototype.hasOwnProperty.call(record, 'agentThread')
                  ? { agentThread: record.agentThread }
                  : {}),
                ...(pullRequestStatus ? { pullRequestStatus } : {})
              })
              accepted = true
              await onChange(claimed, 'get-for-review')
              if (current.review.status === 'editing') {
                await propagateObservation(claimed)
              }
              return claimed
            } catch (error) {
              if (!accepted && rollback) await rollback()
              if (accepted) {
                throw serviceError(
                  'REQUEST_UNCERTAIN',
                  `Agent review ${route.reviewId} was claimed, but publication did not complete. Retry get-for-review with only the review ID.`
                )
              }
              throw error
            }
          })
        ))
        sendJson(response, 200, artifact)
        return
      }

      if (
        route &&
        request.method === 'POST' &&
        route.action === 'submit'
      ) {
        const body = await readJson(request)
        const record = isRecord(body) ? body : {}
        const artifact = await runMutation(() => (
          serializeReviewAction(route.reviewId, async () => {
            let committed = false
            try {
              const submitted = await store.submitAgentReview(
                route.reviewId,
                record.artifact
              )
              committed = true
              await onChange(submitted, 'submit')
              return submitted
            } catch (error) {
              if (committed) {
                throw serviceError(
                  'REQUEST_UNCERTAIN',
                  `Agent review ${route.reviewId} was accepted, but publication did not complete. Retry the exact submit command.`
                )
              }
              throw error
            }
          })
        ))
        sendJson(response, 200, {
          reviewId: artifact.review.id,
          status: artifact.review.status === 'done' &&
            artifact.review.agentReviewer
            ? 'reviewed'
            : artifact.review.status
        })
        return
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/reviews/done'
      ) {
        const result = await runMutation(async () => {
          const body = await readJson(request)
          const record = isRecord(body) ? body : {}
          const pullRequestUrl = record.pullRequestUrl
          const pullRequestStatus = record.pullRequestStatus
          if (typeof pullRequestUrl !== 'string') {
            throw serviceError(
              'INVALID_PULL_REQUEST',
              'Done requires a GitHub pull request URL.'
            )
          }
          if (!isPullRequestStatus(pullRequestStatus)) {
            throw serviceError(
              'INVALID_PULL_REQUEST_STATUS',
              'Done requires a pull request status.'
            )
          }
          const pullRequest = parseGitHubPullRequestUrl(pullRequestUrl)
          if (!pullRequest) {
            throw serviceError(
              'INVALID_PULL_REQUEST',
              'Done requires a canonical GitHub pull request URL.'
            )
          }
          if (pullRequestStatus !== 'merged') {
            throw serviceError(
              'INVALID_PULL_REQUEST_STATUS',
              'Done requires a verified merged pull request status.'
            )
          }
          const candidates = await store.matchingPullRequestReviews(
            pullRequest.url
          )
          const reviews: ReviewArtifact[] = []
          for (const candidate of candidates) {
            const completed = await serializeReviewAction(
              candidate.review.id,
              async () => {
                const current = await store.load(candidate.review.id)
                let rollback: undefined | (() => void | Promise<void>)
                if (current.review.status === 'editing') {
                  rollback = await beforeAction(candidate.review.id, 'done')
                }
                let committed = false
                try {
                  const artifact = await store.doneReview(
                    candidate.review.id,
                    pullRequest.url,
                    pullRequestStatus
                  )
                  if (!artifact) {
                    if (rollback) await rollback()
                    return null
                  }
                  committed = true
                  await onChange(artifact, 'done')
                  return artifact
                } catch (error) {
                  if (!committed && rollback) await rollback()
                  throw error
                }
              }
            )
            if (completed) reviews.push(completed)
          }
          return {
            pullRequestUrl: pullRequest.url,
            reviews,
            status: 'done' as const
          }
        })
        sendJson(response, 200, {
          pullRequestUrl: result.pullRequestUrl,
          reviewIds: result.reviews.map((artifact) => artifact.review.id),
          status: result.status
        })
        return
      }

      if (
        route &&
        request.method === 'POST' &&
        (route.action === 'resolve' || route.action === 'unresolve')
      ) {
        const action = route.action
        const body = await readJson(request)
        const record = isRecord(body) ? body : {}
        const outcome = record.outcome
        if (
          action === 'resolve' &&
          outcome !== 'reviewed-no-notes' &&
          outcome !== 'accepted-unreviewed'
        ) {
          throw serviceError(
            'INVALID_RESOLUTION',
            'Resolve requires reviewed-no-notes or accepted-unreviewed.'
          )
        }
        const result = await runMutation(() => (
          serializeReviewAction(route.reviewId, async () => {
            let rollback: undefined | (() => void | Promise<void>)
            let current = await store.load(route.reviewId)
            if (action === 'resolve' && current.review.status === 'editing') {
              rollback = await beforeAction(route.reviewId, 'resolve')
              current = await store.load(route.reviewId)
            }
            if (action === 'unresolve') {
              const changed = await store.unresolve(route.reviewId)
              await onChange(changed, 'unresolve')
              return { artifact: changed, outcome: 'unresolved' as const }
            }
            let resolution = outcome as ManualReviewResolutionOutcome
            if (reviewHasFeedbackArtifacts(current.root)) {
              if (!await confirmFeedbackAbandonment(
                [current],
                resolution as Exclude<
                  ManualReviewResolutionOutcome,
                  'feedback-abandoned'
                >
              )) {
                if (rollback) await rollback()
                return { artifact: current, outcome: 'cancelled' as const }
              }
              resolution = 'feedback-abandoned'
            }
            try {
              const changed = await store.resolve(route.reviewId, resolution)
              await onChange(changed, 'resolve')
              return { artifact: changed, outcome: 'resolved' as const }
            } catch (error) {
              if (rollback) await rollback()
              throw error
            }
          })
        ))
        sendJson(response, 200, {
          reviewId: result.artifact.review.id,
          status: result.artifact.review.status,
          outcome: result.outcome,
          ...(result.artifact.review.resolution
            ? { resolution: result.artifact.review.resolution }
            : {})
        })
        return
      }

      if (
        route &&
        request.method === 'POST' &&
        (
          route.action === 'handoff' ||
          route.action === 'edit' ||
          route.action === 'revise'
        )
      ) {
        const action = route.action
        const body = await readJson(request)
        const record = isRecord(body) ? body : {}
        const suppliedPullRequestStatus = record.pullRequestStatus
        if (
          suppliedPullRequestStatus !== undefined &&
          suppliedPullRequestStatus !== null &&
          !isPullRequestStatus(suppliedPullRequestStatus)
        ) {
          throw serviceError(
            'INVALID_PULL_REQUEST_STATUS',
            'Invalid pull request status.'
          )
        }
        const pullRequestStatus = isPullRequestStatus(
          suppliedPullRequestStatus
        ) ? suppliedPullRequestStatus : undefined
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
                ? await store.handoff(route.reviewId, pullRequestStatus)
                : action === 'revise'
                  ? await store.revise(route.reviewId, pullRequestStatus)
                  : await store.edit(route.reviewId)
            } catch (error) {
              if (rollbackHandoff) await rollbackHandoff()
              throw error
            }
            await onChange(changed, action)
            if (action !== 'edit') await propagateObservation(changed)
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
      const creationReceipt = exposeRemoteErrorDetails &&
          isRecord(error)
        ? errorProperty(error, 'creationReceipt')
        : undefined
      const reviewId = exposeRemoteErrorDetails &&
          isRecord(error)
        ? errorProperty(error, 'reviewId')
        : undefined
      const reviewIds = exposeRemoteErrorDetails &&
          isRecord(error)
        ? errorProperty(error, 'reviewIds')
        : undefined
      sendJson(response, errorStatus(error), {
        error: {
          code: typeof code === 'string' ? code : 'INTERNAL_ERROR',
          message: typeof message === 'string' ? message : String(error),
          ...(creationReceipt === undefined ? {} : { creationReceipt }),
          ...(typeof reviewId === 'string' ? { reviewId } : {}),
          ...(Array.isArray(reviewIds) ? { reviewIds } : {})
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

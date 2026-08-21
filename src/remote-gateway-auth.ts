import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

import { CAPABILITY_TOKEN_PATTERN } from './service-endpoint'

export const REMOTE_GATEWAY_AUTHORIZATION_HEADER = 'authorization'
export const REMOTE_GATEWAY_CONTENT_DIGEST_HEADER = 'markover-content-digest'
export const REMOTE_GATEWAY_RESPONSE_AUTH_HEADER = 'markover-response-auth'
export const REMOTE_GATEWAY_AUTHORIZATION_SCHEME = 'Markover-HMAC-v1'
export const REMOTE_GATEWAY_CHALLENGE_LIFETIME_MILLISECONDS = 30_000
export const REMOTE_GATEWAY_CLOCK_SKEW_TOLERANCE_MILLISECONDS = 60_000

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const AUTHORIZATION_PATTERN = /^Markover-HMAC-v1 ([A-Za-z0-9_-]{43})\.([a-f0-9]{64})$/
const ATTACHMENT_ACCESS_PATTERN = /^(\d{13})\.([a-f0-9]{64})$/
const REMOTE_ATTACHMENT_ACCESS_LIFETIME_MILLISECONDS = 5 * 60_000

export interface RemoteGatewayChallenge {
  expiresAt: number
  nonce: string
  proof: string
  scheme: typeof REMOTE_GATEWAY_AUTHORIZATION_SCHEME
}

function hmac(token: string, value: string): string {
  return createHmac('sha256', token).update(value).digest('hex')
}

function equalHex(left: string, right: string): boolean {
  return left.length === right.length &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

export function remoteContentDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function challengeProofInput(nonce: string, expiresAt: number): string {
  return `markover-remote-server-v1\n${nonce}\n${String(expiresAt)}`
}

function requestProofInput(
  nonce: string,
  method: string,
  requestPath: string,
  contentDigest: string
): string {
  return [
    'markover-remote-request-v1',
    nonce,
    method,
    requestPath,
    contentDigest
  ].join('\n')
}

function responseProofInput(
  nonce: string,
  statusCode: number,
  contentDigest: string
): string {
  return [
    'markover-remote-response-v1',
    nonce,
    String(statusCode),
    contentDigest
  ].join('\n')
}

export function createRemoteGatewayChallenge(
  token: string,
  now = Date.now(),
  nonce = randomBytes(32).toString('base64url')
): RemoteGatewayChallenge {
  if (!CAPABILITY_TOKEN_PATTERN.test(token) || !CAPABILITY_TOKEN_PATTERN.test(nonce)) {
    throw new Error('Remote gateway challenge input is invalid.')
  }
  const expiresAt = now + REMOTE_GATEWAY_CHALLENGE_LIFETIME_MILLISECONDS
  return {
    expiresAt,
    nonce,
    proof: hmac(token, challengeProofInput(nonce, expiresAt)),
    scheme: REMOTE_GATEWAY_AUTHORIZATION_SCHEME
  }
}

export function verifyRemoteGatewayChallenge(
  token: string,
  value: unknown,
  now = Date.now()
): value is RemoteGatewayChallenge {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) return false
  const challenge = value as Record<string, unknown>
  if (
    Object.keys(challenge).length !== 4 ||
    challenge.scheme !== REMOTE_GATEWAY_AUTHORIZATION_SCHEME ||
    typeof challenge.nonce !== 'string' ||
    !CAPABILITY_TOKEN_PATTERN.test(challenge.nonce) ||
    typeof challenge.expiresAt !== 'number' ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.expiresAt <= now - REMOTE_GATEWAY_CLOCK_SKEW_TOLERANCE_MILLISECONDS ||
    challenge.expiresAt > now +
      REMOTE_GATEWAY_CHALLENGE_LIFETIME_MILLISECONDS +
      REMOTE_GATEWAY_CLOCK_SKEW_TOLERANCE_MILLISECONDS ||
    typeof challenge.proof !== 'string' ||
    !/^[a-f0-9]{64}$/.test(challenge.proof) ||
    !CAPABILITY_TOKEN_PATTERN.test(token)
  ) return false
  return equalHex(
    challenge.proof,
    hmac(token, challengeProofInput(challenge.nonce, challenge.expiresAt))
  )
}

export function remoteRequestAuthorization(
  token: string,
  challenge: RemoteGatewayChallenge,
  method: string,
  requestPath: string,
  contentDigest: string
): string {
  if (!DIGEST_PATTERN.test(contentDigest)) {
    throw new Error('Remote request digest is invalid.')
  }
  return `${REMOTE_GATEWAY_AUTHORIZATION_SCHEME} ${challenge.nonce}.${hmac(
    token,
    requestProofInput(challenge.nonce, method, requestPath, contentDigest)
  )}`
}

export class RemoteGatewayChallengeStore {
  private readonly challenges = new Map<string, number>()

  constructor(
    private readonly token: string,
    private readonly now: () => number = Date.now
  ) {}

  create(): RemoteGatewayChallenge {
    const now = this.now()
    for (const [nonce, expiresAt] of this.challenges) {
      if (expiresAt <= now) this.challenges.delete(nonce)
    }
    while (this.challenges.size >= 32) {
      const oldest = this.challenges.keys().next().value
      if (oldest === undefined) break
      this.challenges.delete(oldest)
    }
    const challenge = createRemoteGatewayChallenge(this.token, now)
    this.challenges.set(challenge.nonce, challenge.expiresAt)
    return challenge
  }

  authorize(
    headers: IncomingHttpHeaders,
    method: string,
    requestPath: string
  ): { contentDigest: string; nonce: string } | null {
    const authorization = headers[REMOTE_GATEWAY_AUTHORIZATION_HEADER]
    const contentDigest = headers[REMOTE_GATEWAY_CONTENT_DIGEST_HEADER]
    if (
      typeof authorization !== 'string' ||
      typeof contentDigest !== 'string' ||
      !DIGEST_PATTERN.test(contentDigest)
    ) return null
    const matched = AUTHORIZATION_PATTERN.exec(authorization)
    if (!matched) return null
    const nonce = matched[1] as string
    const suppliedProof = matched[2] as string
    const expiresAt = this.challenges.get(nonce)
    if (expiresAt === undefined || expiresAt <= this.now()) {
      this.challenges.delete(nonce)
      return null
    }
    const expectedProof = hmac(
      this.token,
      requestProofInput(nonce, method, requestPath, contentDigest)
    )
    if (!equalHex(suppliedProof, expectedProof)) return null
    this.challenges.delete(nonce)
    return { contentDigest, nonce }
  }
}

export function remoteResponseAuthorization(
  token: string,
  nonce: string,
  statusCode: number,
  bytes: Uint8Array
): string {
  return hmac(
    token,
    responseProofInput(nonce, statusCode, remoteContentDigest(bytes))
  )
}

export function verifyRemoteResponseAuthorization(
  token: string,
  nonce: string,
  statusCode: number,
  bytes: Uint8Array,
  value: unknown
): boolean {
  return typeof value === 'string' &&
    /^[a-f0-9]{64}$/.test(value) &&
    equalHex(value, remoteResponseAuthorization(token, nonce, statusCode, bytes))
}

function attachmentProofInput(
  reviewId: string,
  attachmentId: string,
  expiresAt: number
): string {
  return [
    'markover-remote-attachment-v1',
    reviewId,
    attachmentId,
    String(expiresAt)
  ].join('\n')
}

export function createRemoteAttachmentAccess(
  token: string,
  reviewId: string,
  attachmentId: string,
  expiresAt: number
): string {
  return `${String(expiresAt)}.${hmac(
    token,
    attachmentProofInput(reviewId, attachmentId, expiresAt)
  )}`
}

export function verifyRemoteAttachmentAccess(
  token: string,
  reviewId: string,
  attachmentId: string,
  value: string | null,
  now = Date.now(),
  clockSkewToleranceMilliseconds = 0
): boolean {
  if (value === null) return false
  const matched = ATTACHMENT_ACCESS_PATTERN.exec(value)
  if (!matched) return false
  const expiresAt = Number(matched[1])
  const suppliedProof = matched[2] as string
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now - clockSkewToleranceMilliseconds ||
    expiresAt > now +
      REMOTE_ATTACHMENT_ACCESS_LIFETIME_MILLISECONDS +
      clockSkewToleranceMilliseconds
  ) return false
  return equalHex(
    suppliedProof,
    hmac(token, attachmentProofInput(reviewId, attachmentId, expiresAt))
  )
}

export class RemoteAttachmentAccessStore {
  private readonly access = new Set<string>()

  constructor(
    private readonly token: string,
    private readonly now: () => number = Date.now
  ) {}

  create(reviewId: string, attachmentId: string): string {
    this.prune()
    const value = createRemoteAttachmentAccess(
      this.token,
      reviewId,
      attachmentId,
      this.now() + REMOTE_ATTACHMENT_ACCESS_LIFETIME_MILLISECONDS
    )
    this.access.add(value)
    return value
  }

  verify(reviewId: string, attachmentId: string, value: string | null): boolean {
    this.prune()
    return value !== null &&
      this.access.has(value) &&
      verifyRemoteAttachmentAccess(
        this.token,
        reviewId,
        attachmentId,
        value,
        this.now()
      )
  }

  private prune(): void {
    const now = this.now()
    for (const value of this.access) {
      const expiresAt = Number(ATTACHMENT_ACCESS_PATTERN.exec(value)?.[1] ?? 0)
      if (expiresAt <= now) this.access.delete(value)
    }
  }
}

function attachmentResponseProofInput(
  access: string,
  statusCode: number,
  contentDigest: string
): string {
  return [
    'markover-remote-attachment-response-v1',
    access,
    String(statusCode),
    contentDigest
  ].join('\n')
}

export function remoteAttachmentResponseAuthorization(
  token: string,
  access: string,
  statusCode: number,
  bytes: Uint8Array
): string {
  return hmac(
    token,
    attachmentResponseProofInput(
      access,
      statusCode,
      remoteContentDigest(bytes)
    )
  )
}

export function verifyRemoteAttachmentResponseAuthorization(
  token: string,
  access: string,
  statusCode: number,
  bytes: Uint8Array,
  value: unknown
): boolean {
  return typeof value === 'string' &&
    /^[a-f0-9]{64}$/.test(value) &&
    equalHex(
      value,
      remoteAttachmentResponseAuthorization(token, access, statusCode, bytes)
    )
}

import {
  hasPullRequestObservationFields,
  parseGitHubPullRequestUrl,
  pullRequestObservation
} from './pull-request'

export const REVIEW_FORMAT = 'markover-review' as const
export const REVIEW_FORMAT_VERSION = 1 as const
export const REVIEW_FORMAT_COMPATIBILITY_URL =
  'https://lastobelus.github.io/markover/compatibility/' as const

const REVIEW_ID_PATTERN = /^mko_[a-zA-Z0-9]{6,32}$/
const ATTACHMENT_ID_PATTERN = /^img-[1-9]\d*$/
const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/
const REVIEW_NODE_TYPES = new Set<ReviewNodeType>([
  'document',
  'heading',
  'paragraph',
  'blockquote',
  'table',
  'thematic-break',
  'ordered-item',
  'unordered-item',
  'code',
  'frontmatter',
  'frontmatter-entry'
])
const REVIEW_STATUSES = new Set<ReviewStatus>([
  'editing',
  'pending-agent',
  'revised',
  'done'
])
const PRIVATE_EXTENSION_NAMESPACES = new Set([
  'appPrivate',
  'cache',
  'caches',
  'credential',
  'credentials',
  'enrichment',
  'privateEnrichment',
  'settings',
  'workspace'
])
const PRIVATE_TOP_LEVEL_FIELDS = new Set([
  'commonGitDirectory',
  'cwd',
  'discovery',
  'forkedFromId',
  'logPath',
  'parentThreadId',
  'projectRoot',
  'repositoryRoot',
  'requestingThreadTitle',
  'sources'
])
const SCP_REPOSITORY_URL_PATTERN = /^(?:[^@/\\:\s]+@)?[^/\\:\s]+:[^\\\s]+$/
const SHA256_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
])
const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

export type ReviewFormatErrorCode =
  | 'INVALID_REVIEW'
  | 'UNSUPPORTED_REVIEW_FORMAT'
  | 'UNSUPPORTED_REVIEW_VERSION'

export class ReviewFormatError extends Error {
  readonly code: ReviewFormatErrorCode
  readonly receivedFormat: unknown
  readonly receivedVersion: unknown

  constructor(
    code: ReviewFormatErrorCode,
    message: string,
    receivedFormat?: unknown,
    receivedVersion?: unknown
  ) {
    super(message)
    this.name = 'ReviewFormatError'
    this.code = code
    this.receivedFormat = receivedFormat
    this.receivedVersion = receivedVersion
  }
}

function invalid(message: string): never {
  throw new ReviewFormatError('INVALID_REVIEW', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function owns(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function requireKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (!keys.every((key) => owns(value, key))) {
    invalid(`Review data is missing required fields: ${keys.filter((key) => !owns(value, key)).join(', ')}.`)
  }
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function assertNoPrivateEvidence(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoPrivateEvidence(entry)
    return
  }
  if (!isRecord(value)) return
  for (const [field, nested] of Object.entries(value)) {
    if (PRIVATE_EXTENSION_NAMESPACES.has(field)) {
      invalid(`Portable review data must not contain private ${field} evidence.`)
    }
    if (PRIVATE_TOP_LEVEL_FIELDS.has(field)) {
      invalid(`Portable review data must not contain local ${field} evidence.`)
    }
    assertNoPrivateEvidence(nested)
  }
}

function compatibilityUrl(format: string, version: unknown): string {
  const query = new URLSearchParams({ format })
  if (positiveInteger(version)) query.set('version', String(version))
  return `${REVIEW_FORMAT_COMPATIBILITY_URL}?${query.toString()}`
}

export function isCanonicalReviewTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

export function reviewChecksum(content: string): string {
  const source = new TextEncoder().encode(content)
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(source)
  padded[source.length] = 0x80
  const view = new DataView(padded.buffer)
  const bitLength = source.length * 8
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000))
  view.setUint32(paddedLength - 4, bitLength >>> 0)

  const hash = new Uint32Array(SHA256_INITIAL)
  const words = new Uint32Array(64)
  const rotateRight = (value: number, bits: number): number => (
    (value >>> bits) | (value << (32 - bits))
  ) >>> 0

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4)
    }
    for (let index = 16; index < 64; index += 1) {
      const prior15 = words[index - 15] as number
      const prior2 = words[index - 2] as number
      const sigma0 = rotateRight(prior15, 7) ^ rotateRight(prior15, 18) ^ (prior15 >>> 3)
      const sigma1 = rotateRight(prior2, 17) ^ rotateRight(prior2, 19) ^ (prior2 >>> 10)
      words[index] = (
        (words[index - 16] as number) + sigma0 +
        (words[index - 7] as number) + sigma1
      ) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const capitalSigma1 = rotateRight(e as number, 6) ^
        rotateRight(e as number, 11) ^ rotateRight(e as number, 25)
      const choice = ((e as number) & (f as number)) ^ (~(e as number) & (g as number))
      const temporary1 = (
        (h as number) + capitalSigma1 + choice +
        (SHA256_CONSTANTS[index] as number) + (words[index] as number)
      ) >>> 0
      const capitalSigma0 = rotateRight(a as number, 2) ^
        rotateRight(a as number, 13) ^ rotateRight(a as number, 22)
      const majority = ((a as number) & (b as number)) ^
        ((a as number) & (c as number)) ^ ((b as number) & (c as number))
      const temporary2 = (capitalSigma0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = ((d as number) + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }
    const chunk = [a, b, c, d, e, f, g, h]
    for (let index = 0; index < hash.length; index += 1) {
      hash[index] = ((hash[index] as number) + (chunk[index] as number)) >>> 0
    }
  }

  return `sha256:${[...hash].map((word) => word.toString(16).padStart(8, '0')).join('')}`
}

function assertHeader(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value) || !owns(value, 'format') || !owns(value, 'version')) {
    invalid('Review data requires format and version headers.')
  }
  if (typeof value.format !== 'string') invalid('Review format must be a string.')
  if (value.format !== REVIEW_FORMAT) {
    throw new ReviewFormatError(
      'UNSUPPORTED_REVIEW_FORMAT',
      `Unsupported review format ${JSON.stringify(value.format)}; this Markover supports ${REVIEW_FORMAT}. Consult the official compatibility catalog: ${compatibilityUrl(value.format, value.version)}`,
      value.format,
      value.version
    )
  }
  if (!positiveInteger(value.version)) invalid('Review version must be a positive integer.')
  if (value.version !== REVIEW_FORMAT_VERSION) {
    throw new ReviewFormatError(
      'UNSUPPORTED_REVIEW_VERSION',
      `Unsupported ${REVIEW_FORMAT} version ${String(value.version)}; this Markover supports version ${String(REVIEW_FORMAT_VERSION)}. Consult the official compatibility catalog for the Markover release that supports it: ${compatibilityUrl(value.format, value.version)}`,
      value.format,
      value.version
    )
  }
}

function assertSourceDocument(value: unknown): asserts value is SourceDocument {
  if (!isRecord(value)) invalid('sourceDocument must be an object.')
  requireKeys(value, ['name', 'path', 'content', 'checksum'])
  if (value.name !== null && typeof value.name !== 'string') {
    invalid('sourceDocument.name must be a string or null.')
  }
  if (value.path !== null && typeof value.path !== 'string') {
    invalid('sourceDocument.path must be a string or null.')
  }
  if (typeof value.content !== 'string') invalid('sourceDocument.content must be a string.')
  if (
    typeof value.checksum !== 'string' ||
    !CHECKSUM_PATTERN.test(value.checksum) ||
    value.checksum !== reviewChecksum(value.content)
  ) {
    invalid('sourceDocument.checksum must be the SHA-256 checksum of sourceDocument.content.')
  }
}

function assertUnsupported(value: unknown): asserts value is UnsupportedSourceLine[] {
  if (!Array.isArray(value)) invalid('unsupported must be an array.')
  for (const entry of value) {
    if (!isRecord(entry)) invalid('Every unsupported source record must be an object.')
    requireKeys(entry, ['line', 'text'])
    if (!positiveInteger(entry.line) || typeof entry.text !== 'string') {
      invalid('Unsupported source records require a positive line and string text.')
    }
  }
}

function assertAttachment(
  value: unknown,
  attachmentIds: Set<string>
): asserts value is ReviewAttachment {
  if (!isRecord(value)) invalid('Every attachment must be an object.')
  requireKeys(value, ['id'])
  if (typeof value.id !== 'string' || !ATTACHMENT_ID_PATTERN.test(value.id)) {
    invalid('Every attachment requires an img-N ID.')
  }
  if (attachmentIds.has(value.id)) invalid(`Duplicate attachment ID: ${value.id}.`)
  attachmentIds.add(value.id)
  if (value.type !== undefined && value.type !== 'image') {
    invalid('Unsupported attachment type; v1 permits only image attachments.')
  }
  for (const field of ['label', 'path', 'mimeType', 'url'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      invalid(`Attachment ${field} must be a string when present.`)
    }
  }
  if (
    value.checksum !== undefined &&
    (typeof value.checksum !== 'string' || !CHECKSUM_PATTERN.test(value.checksum))
  ) {
    invalid('Attachment checksum must be a SHA-256 checksum when present.')
  }
  for (const field of ['width', 'height'] as const) {
    if (
      value[field] !== undefined &&
      value[field] !== null &&
      !positiveInteger(value[field])
    ) {
      invalid(`Attachment ${field} must be a positive integer or null when present.`)
    }
  }
}

function assertNode(
  value: unknown,
  nodeIds: Set<string>,
  attachmentIds: Set<string>,
  root: boolean
): asserts value is ReviewNode {
  if (!isRecord(value)) invalid('Every review block must be an object.')
  requireKeys(value, [
    'id',
    'type',
    'raw',
    'text',
    'lineStart',
    'lineEnd',
    'feedback',
    'children'
  ])
  if (owns(value, 'collapsed')) {
    invalid('Portable v1 blocks must not contain collapsed presentation state.')
  }
  if (!nonblank(value.id)) invalid('Every review block requires a nonblank ID.')
  if (nodeIds.has(value.id)) invalid(`Duplicate review block ID: ${value.id}.`)
  nodeIds.add(value.id)
  if (!REVIEW_NODE_TYPES.has(value.type as ReviewNodeType)) {
    invalid(`Unsupported review block type: ${String(value.type)}.`)
  }
  if ((root && value.type !== 'document') || (!root && value.type === 'document')) {
    invalid('Exactly the root review block must have type document.')
  }
  if (
    typeof value.raw !== 'string' ||
    typeof value.text !== 'string' ||
    !positiveInteger(value.lineStart) ||
    !positiveInteger(value.lineEnd) ||
    value.lineEnd < value.lineStart ||
    typeof value.feedback !== 'string' ||
    !Array.isArray(value.children)
  ) {
    invalid(`Review block ${value.id} has invalid common fields.`)
  }
  if (value.sourceEditable !== undefined && typeof value.sourceEditable !== 'boolean') {
    invalid(`Review block ${value.id} has invalid sourceEditable data.`)
  }
  if (value.sourceEdit !== undefined) {
    if (!isRecord(value.sourceEdit)) invalid(`Review block ${value.id} has an invalid source edit.`)
    requireKeys(value.sourceEdit, ['original', 'current'])
    if (
      value.sourceEditable === false ||
      typeof value.sourceEdit.original !== 'string' ||
      value.sourceEdit.original !== value.raw ||
      typeof value.sourceEdit.current !== 'string' ||
      !value.sourceEdit.current.trim() ||
      value.sourceEdit.current === value.sourceEdit.original
    ) {
      invalid(`Review block ${value.id} has an invalid source edit.`)
    }
  }
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments)) invalid(`Review block ${value.id} attachments must be an array.`)
    for (const attachment of value.attachments) {
      assertAttachment(attachment, attachmentIds)
    }
  }

  switch (value.type) {
    case 'heading':
      if (!positiveInteger(value.level) || value.level > 6) invalid(`Heading ${value.id} has an invalid level.`)
      break
    case 'code':
      if (typeof value.language !== 'string') invalid(`Code block ${value.id} requires a language string.`)
      break
    case 'frontmatter':
      if (value.sourceEditable !== false) invalid('Frontmatter must set sourceEditable to false.')
      break
    case 'frontmatter-entry':
      if (typeof value.key !== 'string') invalid(`Frontmatter entry ${value.id} requires a key string.`)
      break
    case 'ordered-item':
    case 'unordered-item':
      if (
        typeof value.marker !== 'string' ||
        typeof value.listId !== 'string' ||
        !positiveInteger(value.listPosition) ||
        (value.listLength !== null && !positiveInteger(value.listLength)) ||
        (typeof value.listLength === 'number' && value.listPosition > value.listLength) ||
        (value.task !== undefined && value.task !== true) ||
        (value.checked !== undefined && typeof value.checked !== 'boolean')
      ) {
        invalid(`List item ${value.id} has invalid list metadata.`)
      }
      break
  }

  for (const child of value.children) {
    assertNode(child, nodeIds, attachmentIds, false)
  }
}

const PRIVATE_THREAD_AND_ENVELOPE_FIELDS = new Set([
  ...PRIVATE_TOP_LEVEL_FIELDS,
  'title',
  'name'
])

function assertAgentThread(value: unknown): asserts value is ReviewAgentThread | null {
  if (value === null) return
  if (!isRecord(value)) invalid('review.agentThread must be an object or null.')
  requireKeys(value, ['id', 'threadHost'])
  if (!nonblank(value.id) || !isRecord(value.threadHost)) {
    invalid('review.agentThread requires a provider thread ID and threadHost object.')
  }
  for (const privateField of PRIVATE_THREAD_AND_ENVELOPE_FIELDS) {
    if (owns(value, privateField)) invalid(`review.agentThread must not contain private ${privateField} evidence.`)
  }
  requireKeys(value.threadHost, ['kind', 'provider'])
  if (!nonblank(value.threadHost.kind) || !nonblank(value.threadHost.provider)) {
    invalid('review.agentThread.threadHost requires nonblank kind and provider strings.')
  }
  for (const field of ['threadId', 'machine'] as const) {
    if (value.threadHost[field] !== undefined && !nonblank(value.threadHost[field])) {
      invalid(`review.agentThread.threadHost.${field} must be nonblank when present.`)
    }
  }
  for (const privateField of PRIVATE_THREAD_AND_ENVELOPE_FIELDS) {
    if (owns(value.threadHost, privateField)) {
      invalid(`review.agentThread.threadHost must not contain private ${privateField} evidence.`)
    }
  }
  if (value.threadHost.threadId === value.id) {
    invalid('threadHost.threadId must be omitted when it duplicates agentThread.id.')
  }
}

export function isPortableRepositoryUrl(value: unknown): value is string {
  if (!nonblank(value)) return false
  if (/^file:/i.test(value)) return false
  if (/^[a-zA-Z]:/.test(value)) return false
  if (!value.includes('://')) {
    return SCP_REPOSITORY_URL_PATTERN.test(value)
  }
  try {
    const parsed = new URL(value)
    return Boolean(parsed.hostname) && parsed.protocol !== 'file:' &&
      !parsed.username && !parsed.password && !parsed.search && !parsed.hash
  } catch {
    return false
  }
}

function assertGit(value: unknown): asserts value is ReviewGitSnapshot | null {
  if (value === null) return
  if (!isRecord(value)) invalid('review.git must be an object or null.')
  for (const privateField of [
    'repositoryRoot',
    'projectRoot',
    'sources',
    'commonGitDirectory'
  ]) {
    if (owns(value, privateField)) invalid(`review.git must not contain private ${privateField} evidence.`)
  }
  if (value.repositoryUrl !== undefined && !isPortableRepositoryUrl(value.repositoryUrl)) {
    invalid('review.git.repositoryUrl must be a sanitized nonblank URL.')
  }
  for (const field of ['branch', 'commit'] as const) {
    if (value[field] !== undefined && !nonblank(value[field])) {
      invalid(`review.git.${field} must be nonblank when present.`)
    }
  }
}

function assertPullRequest(
  value: unknown,
  status: ReviewStatus
): asserts value is ReviewPullRequest | null {
  if (value === null) {
    if (status === 'done') invalid('A Done review requires an associated merged pull request.')
    return
  }
  if (!isRecord(value)) invalid('review.pullRequest must be an object or null.')
  requireKeys(value, ['number', 'url'])
  const identity = parseGitHubPullRequestUrl(value.url)
  if (
    !identity ||
    value.url !== identity.url ||
    !positiveInteger(value.number) ||
    identity.number !== value.number
  ) {
    invalid('An associated pull request requires a canonical GitHub URL and matching positive number.')
  }
  const observation = pullRequestObservation(value)
  if (hasPullRequestObservationFields(value) && !observation) {
    invalid('Pull request observations require status, statusObservedAt, and statusSource together.')
  }
  if (status === 'done' && observation?.status !== 'merged') {
    invalid('A Done review requires a merged pull request observation.')
  }
}

function assertEnvelope(
  value: unknown,
  expectedReviewId?: string
): asserts value is ReviewEnvelope {
  if (!isRecord(value)) invalid('review must be an object.')
  for (const privateField of PRIVATE_THREAD_AND_ENVELOPE_FIELDS) {
    if (owns(value, privateField)) {
      invalid(`review must not contain private ${privateField} evidence.`)
    }
  }
  requireKeys(value, [
    'id',
    'status',
    'origin',
    'createdAt',
    'updatedAt',
    'attentionRequestedAt',
    'contextSummary',
    'agentThread',
    'git',
    'pullRequest',
    'agentGuidance'
  ])
  if (
    typeof value.id !== 'string' ||
    !REVIEW_ID_PATTERN.test(value.id) ||
    (expectedReviewId !== undefined && value.id !== expectedReviewId)
  ) {
    invalid('review.id is invalid or does not match its managed directory.')
  }
  if (!REVIEW_STATUSES.has(value.status as ReviewStatus)) {
    invalid(`Unsupported review lifecycle status: ${String(value.status)}.`)
  }
  if (!nonblank(value.origin)) invalid('review.origin must be a nonblank string.')
  if (
    !isCanonicalReviewTimestamp(value.createdAt) ||
    !isCanonicalReviewTimestamp(value.updatedAt) ||
    !isCanonicalReviewTimestamp(value.attentionRequestedAt) ||
    value.createdAt > value.attentionRequestedAt ||
    value.attentionRequestedAt > value.updatedAt
  ) {
    invalid('Review lifecycle timestamps must be ordered canonical UTC instants.')
  }
  if (!nonblank(value.contextSummary)) invalid('review.contextSummary must be nonblank.')
  assertAgentThread(value.agentThread)
  if (value.origin === 'local' && value.agentThread !== null) {
    invalid('A local review requires review.agentThread to be null.')
  }
  assertGit(value.git)
  assertPullRequest(value.pullRequest, value.status as ReviewStatus)
  const observation = pullRequestObservation(value.pullRequest)
  if (observation && observation.statusObservedAt > value.updatedAt) {
    invalid('Pull request observations must not be newer than review.updatedAt.')
  }
  if (!isRecord(value.agentGuidance)) invalid('review.agentGuidance must be an object.')
  requireKeys(value.agentGuidance, ['fixedContract', 'interpretationPolicy'])
  if (
    typeof value.agentGuidance.fixedContract !== 'string' ||
    typeof value.agentGuidance.interpretationPolicy !== 'string'
  ) {
    invalid('review.agentGuidance requires string fixedContract and interpretationPolicy fields.')
  }
}

function assertV1Body(value: Record<string, unknown>): void {
  assertNoPrivateEvidence(value)
  for (const field of PRIVATE_TOP_LEVEL_FIELDS) {
    if (owns(value, field)) {
      invalid(`Portable review data must not contain top-level private ${field} evidence.`)
    }
  }
  requireKeys(value, ['sourceDocument', 'unsupported', 'root'])
  assertSourceDocument(value.sourceDocument)
  assertUnsupported(value.unsupported)
  assertNode(value.root, new Set<string>(), new Set<string>(), true)
}

export function decodeReviewTree(value: unknown): ReviewTree {
  assertHeader(value)
  assertV1Body(value)
  return value as unknown as ReviewTree
}

export function decodeReviewArtifact(
  value: unknown,
  expectedReviewId?: string
): ReviewArtifact {
  assertHeader(value)
  assertV1Body(value)
  if (!owns(value, 'review') || value.review === undefined) {
    invalid('Managed review artifacts require a review envelope.')
  }
  assertEnvelope(value.review, expectedReviewId)
  return value as unknown as ReviewArtifact
}

export function isReviewTree(value: unknown): value is ReviewTree {
  try {
    decodeReviewTree(value)
    return true
  } catch {
    return false
  }
}

export function isReviewArtifact(value: unknown): value is ReviewArtifact {
  try {
    decodeReviewArtifact(value)
    return true
  } catch {
    return false
  }
}

import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { guidance } from './agent-guidance'
import { reviewerGuidance } from './agent-reviewer-guidance'
import {
  canonicalPullRequestMetadata,
  hasPullRequestObservationFields,
  isPullRequestStatus,
  parseGitHubPullRequestUrl,
  pullRequestObservation,
  reviewPullRequestIdentity,
  type GitHubPullRequestIdentity,
  type PullRequestStatus
} from './pull-request'
import {
  decodeReviewArtifact,
  decodeReviewTree,
  reviewCompatibilityUrl,
  ReviewFormatError
} from './review-format'

const REVIEW_ID_PATTERN = /^mko_[a-zA-Z0-9]{6,32}$/
const REVIEW_STATUSES = new Set<ReviewStatus>([
  'editing',
  'pending-agent',
  'agent-reviewing',
  'reviewed',
  'revised',
  'done'
])
const MANUAL_REVIEW_RESOLUTION_OUTCOMES = new Set<ManualReviewResolutionOutcome>([
  'reviewed-no-notes',
  'accepted-unreviewed',
  'feedback-abandoned'
])

export type ReviewStatus =
  | 'editing'
  | 'pending-agent'
  | 'agent-reviewing'
  | 'reviewed'
  | 'revised'
  | 'done'
export type ReviewArtifact = Omit<ReviewTree, 'review'> & {
  review: ReviewEnvelope
}

export interface ReviewCreateInput {
  tree: unknown
  contextSummary: unknown
  origin?: unknown
  agentThread?: unknown
  git?: unknown
  pullRequest?: unknown
  pullRequestStatus?: unknown
  interpretationPolicy?: unknown
}

export interface DoneReviewsResult {
  pullRequestUrl: string
  reviews: ReviewArtifact[]
  status: 'done'
}

export type ManualReviewResolutionOutcome =
  | 'reviewed-no-notes'
  | 'accepted-unreviewed'
  | 'feedback-abandoned'

export type PendingReviewResponsibility = 'needs-me' | 'with-agent'

export interface ReviewStoreOptions {
  claimIdFactory?: () => string
  idFactory?: () => string
  now?: () => string | number | Date
}

export interface AgentReviewClaimInput {
  agentThread?: unknown
  maximumSubmissionBytes?: number
  mode: AgentReviewMode
  pullRequestStatus?: PullRequestStatus
}

export interface ReviewListWarning {
  reviewId: string
  reason: 'incomplete' | 'incompatible' | 'invalid' | 'legacy' | 'unreadable'
  detail?: string
}

export interface ReviewListResult {
  reviews: ReviewArtifact[]
  incompatible: ReviewIncompatibleListing[]
  warnings: ReviewListWarning[]
}

export interface ReviewIncompatibleListing {
  reviewId: string
  format: string
  version: string
  compatibilityUrl: string
}

export type ReviewDeletionPolicy = 'standard' | 'pending-agent'

export interface UnusedAttachmentCandidate {
  reviewId: string
  attachmentId: string
  filePath: string
  bytes: number
}

export interface UnusedAttachmentScan {
  candidates: UnusedAttachmentCandidate[]
  totalBytes: number
  warnings: ReviewListWarning[]
}

export interface UnusedAttachmentCleanupResult {
  count: number
  totalBytes: number
}

export type TrashItem = (filePath: string) => Promise<void>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonblankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function assertThreadQuery(value: unknown): asserts value is ReviewAgentThread {
  if (
    !isRecord(value) ||
    !nonblankString(value.id) ||
    !isRecord(value.threadHost) ||
    !nonblankString(value.threadHost.kind) ||
    !nonblankString(value.threadHost.provider) ||
    (value.threadHost.threadId !== undefined &&
      !nonblankString(value.threadHost.threadId))
  ) {
    throw new ReviewStoreError(
      'INVALID_THREAD',
      'A pending-review query requires a complete requesting-thread identity.'
    )
  }
}

function sameRequestingThread(
  stored: ReviewAgentThread | null,
  query: ReviewAgentThread
): boolean {
  if (!stored) return false
  const queryHostId = query.threadHost.threadId
  if (queryHostId) {
    return stored.threadHost.kind === query.threadHost.kind &&
      stored.threadHost.threadId === queryHostId
  }
  return stored.id === query.id &&
    stored.threadHost.kind === query.threadHost.kind &&
    stored.threadHost.provider === query.threadHost.provider
}

export function pendingReviewResponsibility(
  status: ReviewStatus
): PendingReviewResponsibility | null {
  if (status === 'editing') return 'needs-me'
  if (status === 'pending-agent' || status === 'agent-reviewing') {
    return 'with-agent'
  }
  return null
}

function errorCode(error: unknown): unknown {
  return isRecord(error) ? error.code : null
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && REVIEW_STATUSES.has(value as ReviewStatus)
}

export class ReviewStoreError extends Error {
  readonly code: string
  readonly receivedFormat: unknown
  readonly receivedVersion: unknown

  constructor(
    code: string,
    message: string,
    receivedFormat?: unknown,
    receivedVersion?: unknown
  ) {
    super(message)
    this.name = 'ReviewStoreError'
    this.code = code
    this.receivedFormat = receivedFormat
    this.receivedVersion = receivedVersion
  }
}

export function createReviewId(): string {
  return `mko_${randomBytes(4).toString('hex')}`
}

export function createReviewClaimId(): string {
  return `mko_claim_${randomBytes(12).toString('hex')}`
}

function cloneJson<T>(value: T): T {
  const clone: unknown = JSON.parse(JSON.stringify(value))
  return clone as T
}

function assertReviewId(reviewId: string): void {
  if (!REVIEW_ID_PATTERN.test(reviewId)) {
    throw new ReviewStoreError('INVALID_ID', `Invalid review ID: ${reviewId}`)
  }
}

export function assertReviewTree(tree: unknown): asserts tree is ReviewTree {
  try {
    decodeReviewTree(tree)
  } catch (error) {
    if (error instanceof ReviewFormatError) {
      throw new ReviewStoreError(
        error.code,
        error.message,
        error.receivedFormat,
        error.receivedVersion
      )
    }
    throw error
  }
}

export function assertReviewArtifact(
  artifact: unknown,
  reviewId: string
): asserts artifact is ReviewArtifact {
  assertReviewTree(artifact)
  if (!isRecord(artifact.review)) {
    throw new ReviewStoreError(
      'UNMANAGED_REVIEW',
      `Review ${reviewId} predates the managed review envelope.`
    )
  }
  try {
    decodeReviewArtifact(artifact, reviewId)
  } catch (error) {
    if (error instanceof ReviewFormatError) {
      throw new ReviewStoreError(
        error.code,
        error.message,
        error.receivedFormat,
        error.receivedVersion
      )
    }
    throw error
  }
}

function treeFields(tree: unknown): Omit<ReviewTree, 'review'> {
  assertReviewTree(tree)
  const fields = cloneJson(tree)
  delete fields.review
  return fields
}

function immutableNode(node: ReviewNode): Record<string, unknown> {
  const children = node.children
  const properties: Record<string, unknown> = { ...node }
  delete properties.children
  delete properties.feedback
  delete properties.attachments
  delete properties.sourceEdit
  return {
    ...properties,
    children: children.map(immutableNode)
  }
}

function reviewTarget(tree: unknown): Record<string, unknown> {
  const fields = treeFields(tree)
  return {
    format: fields.format,
    version: fields.version,
    sourceDocument: fields.sourceDocument,
    unsupported: fields.unsupported,
    root: immutableNode(fields.root)
  }
}

function assertSameReviewTarget(current: unknown, updated: unknown): void {
  if (
    JSON.stringify(reviewTarget(current)) !==
    JSON.stringify(reviewTarget(updated))
  ) {
    throw new ReviewStoreError(
      'REVIEW_MISMATCH',
      'A review update cannot change its source snapshot or block structure.'
    )
  }
}

function visitReviewNodes(
  node: ReviewNode,
  visitor: (node: ReviewNode) => void
): void {
  visitor(node)
  for (const child of node.children) visitReviewNodes(child, visitor)
}

export function reviewHasFeedbackArtifacts(root: ReviewNode): boolean {
  let found = false
  visitReviewNodes(root, (node) => {
    if (
      node.feedback.trim() ||
      (node.attachments?.length ?? 0) > 0 ||
      node.sourceEdit !== undefined
    ) found = true
  })
  return found
}

function assertPristineAgentReview(artifact: ReviewArtifact): void {
  const containsReviewContent = (node: ReviewNode): boolean => (
    Boolean(node.feedback.trim()) ||
    (node.attachments?.length ?? 0) > 0 ||
    node.sourceEdit !== undefined ||
    node.children.some(containsReviewContent)
  )
  if (containsReviewContent(artifact.root)) {
    throw new ReviewStoreError(
      'REVIEW_NOT_PRISTINE',
      `Review ${artifact.review.id} already contains human review content; open a new review for agent review.`
    )
  }
}

function withoutAgentReviewContent(artifact: ReviewArtifact): unknown {
  const stripped = cloneJson(artifact)
  visitReviewNodes(stripped.root, (node) => {
    const record = node as unknown as Record<string, unknown>
    delete record.feedback
    delete record.sourceEdit
  })
  return stripped
}

function expectedAgentReviewSubmission(
  current: ReviewArtifact,
  submission: ReviewArtifact
): ReviewArtifact | null {
  const reviewer = current.review.agentReviewer
  if (!reviewer) return null

  const expected = cloneJson(current)
  expected.review.status = 'agent-reviewing'
  expected.review.updatedAt = reviewer.startedAt
  expected.review.agentReviewer = {
    ...reviewer,
    completedAt: null
  }

  if (current.review.status === 'done') {
    const currentIdentity = reviewPullRequestIdentity(
      current.review.pullRequest,
      current.review.git
    )
    const submittedIdentity = reviewPullRequestIdentity(
      submission.review.pullRequest,
      submission.review.git
    )
    if (
      !currentIdentity ||
      !submittedIdentity ||
      !isDeepStrictEqual(currentIdentity, submittedIdentity)
    ) return null

    const pullRequest = cloneJson(current.review.pullRequest)
    if (!isRecord(pullRequest)) return null
    delete pullRequest.status
    delete pullRequest.statusObservedAt
    delete pullRequest.statusSource
    const submittedObservation = pullRequestObservation(
      submission.review.pullRequest
    )
    if (submittedObservation) Object.assign(pullRequest, submittedObservation)
    expected.review.pullRequest = pullRequest
  }

  return expected
}

function assertAllowedAgentReviewContent(
  artifact: ReviewArtifact,
  mode: AgentReviewMode
): void {
  visitReviewNodes(artifact.root, (node) => {
    if (node.sourceEdit === undefined) return
    if (mode === 'annotation-only') {
      throw new ReviewStoreError(
        'SOURCE_PROPOSALS_FORBIDDEN',
        'This agent review permits annotations only; remove every sourceEdit and retry.'
      )
    }
    if (!isDeepStrictEqual(Object.keys(node.sourceEdit).sort(), ['current', 'original'])) {
      throw new ReviewStoreError(
        'INVALID_REVIEW',
        `Source proposal ${node.id} may contain only original and current.`
      )
    }
  })
}

function agentReviewSubmissionBytes(artifact: ReviewArtifact): number {
  return Buffer.byteLength(JSON.stringify({ artifact }), 'utf8')
}

function assertNever(value: never): never {
  throw new ReviewStoreError('INVALID_STATUS', `Invalid review status: ${String(value)}`)
}

export function reviewDeletionPolicy(
  status: ReviewStatus
): ReviewDeletionPolicy {
  switch (status) {
    case 'editing': return 'standard'
    case 'pending-agent': return 'pending-agent'
    case 'agent-reviewing': return 'pending-agent'
    case 'reviewed': return 'standard'
    case 'revised': return 'standard'
    case 'done': return 'standard'
    default: return assertNever(status)
  }
}

function observedPullRequest(
  pullRequest: unknown,
  status: unknown,
  observedAt: string,
  pullRequestUrl?: string
): unknown {
  if (status === undefined || status === null) return cloneJson(pullRequest)
  if (!isPullRequestStatus(status)) {
    const description = typeof status === 'string'
      ? status
      : JSON.stringify(status)
    throw new ReviewStoreError(
      'INVALID_PULL_REQUEST_STATUS',
      `Invalid pull request status: ${description}`
    )
  }
  if (
    !isRecord(pullRequest) ||
    !canonicalPullRequestMetadata(pullRequest, null)
  ) {
    throw new ReviewStoreError(
      'PULL_REQUEST_REQUIRED',
      'A pull request status requires an associated pull request.'
    )
  }
  return {
    ...cloneJson(pullRequest),
    ...(pullRequestUrl ? { url: pullRequestUrl } : {}),
    status,
    statusObservedAt: observedAt,
    statusSource: 'agent'
  }
}

function transitionAllowed(
  current: ReviewStatus,
  next: ReviewStatus
): boolean {
  if (current === next) return true
  if (current === 'editing') return next === 'pending-agent'
  if (current === 'pending-agent') {
    return next === 'editing' || next === 'revised'
  }
  if (current === 'agent-reviewing') return next === 'editing'
  return false
}

function attachmentIds(root: ReviewNode): Set<string> {
  const ids = new Set<string>()
  const visit = (node: ReviewNode): void => {
    for (const attachment of node.attachments || []) ids.add(attachment.id)
    for (const child of node.children) visit(child)
  }
  visit(root)
  return ids
}

function attachmentCount(root: ReviewNode, attachmentId: string): number {
  let count = 0
  const visit = (node: ReviewNode): void => {
    count += (node.attachments || []).filter(
      (attachment) => attachment.id === attachmentId
    ).length
    for (const child of node.children) visit(child)
  }
  visit(root)
  return count
}

function sameCandidates(
  left: UnusedAttachmentCandidate[],
  right: UnusedAttachmentCandidate[]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export class ReviewStore {
  readonly directory: string
  private readonly claimIdFactory: () => string
  private readonly idFactory: () => string
  private readonly now: () => string | number | Date
  private readonly queues = new Map<string, Promise<void>>()

  constructor(directory: string, options: ReviewStoreOptions = {}) {
    this.directory = path.resolve(directory)
    this.claimIdFactory = options.claimIdFactory || createReviewClaimId
    this.idFactory = options.idFactory || createReviewId
    this.now = options.now || (() => new Date())
  }

  reviewDirectory(reviewId: string): string {
    assertReviewId(reviewId)
    return path.join(this.directory, reviewId)
  }

  reviewPath(reviewId: string): string {
    return path.join(this.reviewDirectory(reviewId), 'review.json')
  }

  async create({
    tree,
    contextSummary,
    origin = 'agent',
    agentThread = null,
    git = null,
    pullRequest = null,
    pullRequestStatus,
    interpretationPolicy
  }: ReviewCreateInput): Promise<ReviewArtifact> {
    assertReviewTree(tree)
    if (typeof contextSummary !== 'string' || !contextSummary.trim()) {
      throw new ReviewStoreError(
        'INVALID_REVIEW',
        'A non-empty context summary is required.'
      )
    }
    if (typeof origin !== 'string' || !origin.trim()) {
      throw new ReviewStoreError(
        'INVALID_REVIEW',
        'A non-empty review origin is required.'
      )
    }
    const canonicalPullRequest = pullRequest === null || pullRequest === undefined
      ? null
      : canonicalPullRequestMetadata(pullRequest, git)
    if (pullRequest !== null && pullRequest !== undefined && !canonicalPullRequest) {
      throw new ReviewStoreError(
        'INVALID_PULL_REQUEST',
        'An associated pull request requires a GitHub repository remote and positive pull request number.'
      )
    }
    if (
      canonicalPullRequest &&
      hasPullRequestObservationFields(canonicalPullRequest) &&
      !pullRequestObservation(canonicalPullRequest)
    ) {
      throw new ReviewStoreError(
        'INVALID_PULL_REQUEST_STATUS',
        'Pull request observations require status, statusObservedAt, and statusSource together.'
      )
    }

    return this.serialize('create', async () => {
      await fs.mkdir(this.directory, { recursive: true })

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const reviewId = this.idFactory()
        assertReviewId(reviewId)
        const reviewDirectory = this.reviewDirectory(reviewId)
        const stagingDirectory = path.join(
          this.directory,
          `.create-${reviewId}-${randomBytes(6).toString('hex')}`
        )

        try {
          await fs.access(reviewDirectory)
          continue
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') throw error
        }

        const timestamp = this.timestamp()
        const artifact: unknown = {
          ...treeFields(tree),
          review: {
            id: reviewId,
            status: 'editing',
            origin,
            createdAt: timestamp,
            updatedAt: timestamp,
            attentionRequestedAt: timestamp,
            contextSummary,
            agentThread: cloneJson(agentThread),
            git: cloneJson(git),
            pullRequest: observedPullRequest(
              canonicalPullRequest,
              pullRequestStatus,
              timestamp
            ),
            agentGuidance: guidance(interpretationPolicy)
          }
        }
        assertReviewArtifact(artifact, reviewId)

        await fs.mkdir(stagingDirectory)
        try {
          await this.writeFile(
            path.join(stagingDirectory, 'review.json'),
            artifact
          )
          await fs.rename(stagingDirectory, reviewDirectory)
          return cloneJson(artifact)
        } catch (error) {
          if (
            (errorCode(error) === 'EEXIST' || errorCode(error) === 'ENOTEMPTY') &&
            attempt < 9
          ) {
            continue
          }
          throw error
        } finally {
          await fs.rm(stagingDirectory, { recursive: true, force: true })
        }
      }

      throw new ReviewStoreError(
        'ID_COLLISION',
        'Could not allocate a unique review ID.'
      )
    })
  }

  async load(reviewId: string): Promise<ReviewArtifact> {
    assertReviewId(reviewId)
    return this.serialize(reviewId, async () => cloneJson(
      await this.read(reviewId)
    ))
  }

  async list(): Promise<ReviewArtifact[]> {
    return (await this.listWithWarnings()).reviews
  }

  async listWithWarnings(): Promise<ReviewListResult> {
    await fs.mkdir(this.directory, { recursive: true })
    const entries = await fs.readdir(this.directory, { withFileTypes: true })
    const reviewIds = entries
      .filter((entry) => entry.isDirectory() && REVIEW_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)

    const warnings: ReviewListWarning[] = []
    const incompatible: ReviewIncompatibleListing[] = []
    const reviews = await Promise.all(reviewIds.map(async (reviewId) => {
      try {
        return await this.load(reviewId)
      } catch (error) {
        const code = errorCode(error)
        if (code === 'NOT_FOUND') {
          warnings.push({ reviewId, reason: 'incomplete' })
          return null
        }
        if (code === 'UNMANAGED_REVIEW') {
          warnings.push({ reviewId, reason: 'legacy' })
          return null
        }
        if (
          code === 'UNSUPPORTED_REVIEW_FORMAT' ||
          code === 'UNSUPPORTED_REVIEW_VERSION'
        ) {
          if (error instanceof ReviewStoreError) {
            const format = typeof error.receivedFormat === 'string'
              ? error.receivedFormat
              : 'unknown'
            incompatible.push({
              reviewId,
              format,
              version: String(error.receivedVersion),
              compatibilityUrl: reviewCompatibilityUrl(
                format,
                error.receivedVersion
              )
            })
          }
          warnings.push({
            reviewId,
            reason: 'incompatible',
            ...(error instanceof Error ? { detail: error.message } : {})
          })
          return null
        }
        if (code === 'INVALID_REVIEW' || error instanceof SyntaxError) {
          warnings.push({ reviewId, reason: 'invalid' })
          return null
        }
        if (code === 'EACCES' || code === 'EPERM' || code === 'EISDIR') {
          warnings.push({ reviewId, reason: 'unreadable' })
          return null
        }
        throw error
      }
    }))
    const sorted = reviews.filter(
      (review): review is ReviewArtifact => review !== null
    ).sort((left, right) => (
      left.review.createdAt.localeCompare(right.review.createdAt) ||
      left.review.id.localeCompare(right.review.id)
    ))
    incompatible.sort((left, right) => left.reviewId.localeCompare(right.reviewId))
    warnings.sort((left, right) => left.reviewId.localeCompare(right.reviewId))
    return { reviews: sorted, incompatible, warnings }
  }

  async pendingForThread(agentThread: unknown): Promise<ReviewArtifact[]> {
    assertThreadQuery(agentThread)
    return (await this.list())
      .filter((artifact) => (
        pendingReviewResponsibility(artifact.review.status) !== null &&
        sameRequestingThread(artifact.review.agentThread, agentThread)
      ))
      .sort((left, right) => (
        right.review.attentionRequestedAt.localeCompare(
          left.review.attentionRequestedAt
        ) || right.review.id.localeCompare(left.review.id)
      ))
  }

  async updateTree(reviewId: string, tree: unknown): Promise<ReviewArtifact> {
    assertReviewId(reviewId)
    assertReviewTree(tree)
    return this.serialize(reviewId, async () => {
      const current = await this.read(reviewId)
      assertSameReviewTarget(current, tree)
      if (current.review.status !== 'editing') {
        throw new ReviewStoreError(
          'NOT_EDITABLE',
          `Review ${reviewId} is with the agent and read only.`
        )
      }

      const updated = {
        ...treeFields(tree),
        review: {
          ...current.review,
          updatedAt: this.mutationTimestamp(current.review)
        }
      }
      await this.write(reviewId, updated)
      return cloneJson(updated)
    })
  }

  async saveAttachmentFile(
    reviewId: string,
    extension: string,
    bytes: Uint8Array
  ): Promise<{ id: string; path: string }> {
    assertReviewId(reviewId)
    if (!/^[a-z0-9]+$/.test(extension)) {
      throw new ReviewStoreError(
        'INVALID_ATTACHMENT',
        `Invalid attachment extension: ${extension}`
      )
    }

    return this.serialize(reviewId, async () => {
      const current = await this.read(reviewId)
      if (current.review.status !== 'editing') {
        throw new ReviewStoreError(
          'NOT_EDITABLE',
          `Review ${reviewId} is with the agent and read only.`
        )
      }

      const directory = path.join(this.reviewDirectory(reviewId), 'attachments')
      await fs.mkdir(directory, { recursive: true })
      const entries = await fs.readdir(directory)
      const sequence = entries.reduce((maximum: number, entry: string) => {
        const match = /^img-(\d+)\./.exec(entry)
        return match ? Math.max(maximum, Number(match[1])) : maximum
      }, 0) + 1
      const id = `img-${String(sequence)}`
      const filePath = path.join(directory, `${id}.${extension}`)
      await fs.writeFile(filePath, bytes, { flag: 'wx', flush: true })
      return { id, path: filePath }
    })
  }

  async trashReview(
    reviewId: string,
    trashItem: TrashItem
  ): Promise<ReviewDeletionPolicy> {
    assertReviewId(reviewId)
    return this.serialize(reviewId, async () => {
      const current = await this.read(reviewId)
      const policy = reviewDeletionPolicy(current.review.status)
      await trashItem(this.reviewDirectory(reviewId))
      return policy
    })
  }

  async removeAttachment(
    reviewId: string,
    attachmentId: string,
    tree: unknown,
    trashItem: TrashItem
  ): Promise<ReviewArtifact> {
    assertReviewId(reviewId)
    if (!/^img-[1-9]\d*$/.test(attachmentId)) {
      throw new ReviewStoreError(
        'INVALID_ATTACHMENT',
        `Invalid attachment ID: ${attachmentId}`
      )
    }
    assertReviewTree(tree)

    return this.serialize(reviewId, async () => {
      const current = await this.read(reviewId)
      if (current.review.status !== 'editing') {
        throw new ReviewStoreError(
          'NOT_EDITABLE',
          `Review ${reviewId} is with the agent and read only.`
        )
      }
      assertSameReviewTarget(current, tree)
      if (
        attachmentCount(current.root, attachmentId) !== 1 ||
        attachmentCount(tree.root, attachmentId) !== 0
      ) {
        throw new ReviewStoreError(
          'ATTACHMENT_MISMATCH',
          `Review ${reviewId} does not contain one removable ${attachmentId}.`
        )
      }

      const updated: ReviewArtifact = {
        ...treeFields(tree),
        review: {
          ...current.review,
          updatedAt: this.mutationTimestamp(current.review)
        }
      }
      const attachmentsDirectory = path.join(
        this.reviewDirectory(reviewId),
        'attachments'
      )
      let attachmentPath: string | null = null
      try {
        const attachmentPattern = new RegExp(
          `^${attachmentId.replace('-', '\\-')}\\.[a-z0-9]+$`
        )
        const matches = (await fs.readdir(attachmentsDirectory))
          .filter((entry) => attachmentPattern.test(entry))
        if (matches.length > 1) {
          throw new ReviewStoreError(
            'ATTACHMENT_MISMATCH',
            `Review ${reviewId} contains multiple files for ${attachmentId}.`
          )
        }
        if (matches[0]) attachmentPath = path.join(attachmentsDirectory, matches[0])
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
      }

      await this.write(reviewId, updated)
      try {
        if (attachmentPath) await trashItem(attachmentPath)
      } catch (error) {
        await this.write(reviewId, current)
        throw error
      }
      return cloneJson(updated)
    })
  }

  async scanUnusedAttachments(): Promise<UnusedAttachmentScan> {
    const { reviews, warnings } = await this.listWithWarnings()
    const candidates: UnusedAttachmentCandidate[] = []
    for (const review of reviews) {
      const reviewId = review.review.id
      const referenced = attachmentIds(review.root)
      const directory = path.join(this.reviewDirectory(reviewId), 'attachments')
      try {
        const entries = await fs.readdir(directory, { withFileTypes: true })
        for (const entry of entries) {
          const match = /^(img-[1-9]\d*)\.[a-z0-9]+$/.exec(entry.name)
          const attachmentId = match?.[1]
          if (!entry.isFile() || !attachmentId || referenced.has(attachmentId)) {
            continue
          }
          const filePath = path.join(directory, entry.name)
          const stats = await fs.stat(filePath)
          candidates.push({
            reviewId,
            attachmentId,
            filePath,
            bytes: stats.size
          })
        }
      } catch (error) {
        if (errorCode(error) === 'ENOENT') continue
        if (errorCode(error) === 'EACCES' || errorCode(error) === 'EPERM') {
          warnings.push({ reviewId, reason: 'unreadable' })
          continue
        }
        throw error
      }
    }
    candidates.sort((left, right) => left.filePath.localeCompare(right.filePath))
    warnings.sort((left, right) => left.reviewId.localeCompare(right.reviewId))
    return {
      candidates,
      totalBytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0),
      warnings
    }
  }

  async trashUnusedAttachments(
    expected: UnusedAttachmentScan,
    trashItem: TrashItem
  ): Promise<UnusedAttachmentCleanupResult> {
    const current = await this.scanUnusedAttachments()
    if (!sameCandidates(expected.candidates, current.candidates)) {
      throw new ReviewStoreError(
        'CLEANUP_CHANGED',
        'Unused attachments changed before cleanup. Review the updated count and try again.'
      )
    }
    for (const candidate of current.candidates) {
      await trashItem(candidate.filePath)
    }
    return {
      count: current.candidates.length,
      totalBytes: current.totalBytes
    }
  }

  async getForReview(
    reviewId: string,
    {
      agentThread,
      maximumSubmissionBytes,
      mode,
      pullRequestStatus
    }: AgentReviewClaimInput
  ): Promise<ReviewArtifact> {
    assertReviewId(reviewId)
    return this.serialize(reviewId, async () => {
      const current = await this.read(reviewId)
      if (current.review.status === 'agent-reviewing') {
        const reviewer = current.review.agentReviewer as ReviewAgentReviewer
        if (
          agentThread !== undefined &&
          !isDeepStrictEqual(agentThread, reviewer.agentThread)
        ) {
          throw new ReviewStoreError(
            'CLAIM_CONFLICT',
            'This review is already claimed with different reviewer identity metadata.'
          )
        }
        if (
          pullRequestStatus !== undefined &&
          current.review.pullRequest?.status !== pullRequestStatus
        ) {
          throw new ReviewStoreError(
            'CLAIM_CONFLICT',
            'This review is already claimed with a different pull request observation.'
          )
        }
        return cloneJson(current)
      }
      if (current.review.status !== 'editing') {
        throw new ReviewStoreError(
          'INVALID_TRANSITION',
          `Review ${reviewId} cannot be claimed from ${current.review.status}.`
        )
      }
      assertPristineAgentReview(current)
      const timestamp = this.mutationTimestamp(current.review)
      const updated = cloneJson(current)
      updated.review.status = 'agent-reviewing'
      updated.review.updatedAt = timestamp
      updated.review.pullRequest = observedPullRequest(
        current.review.pullRequest,
        pullRequestStatus,
        timestamp
      ) as ReviewPullRequest | null
      updated.review.agentReviewer = {
        mode,
        claimId: this.claimIdFactory(),
        agentThread: cloneJson(
          agentThread === undefined ? null : agentThread
        ) as ReviewAgentThread | null,
        startedAt: timestamp,
        completedAt: null,
        agentGuidance: reviewerGuidance()
      }
      assertReviewArtifact(updated, reviewId)
      if (
        maximumSubmissionBytes !== undefined &&
        agentReviewSubmissionBytes(updated) > maximumSubmissionBytes
      ) {
        throw new ReviewStoreError(
          'BODY_TOO_LARGE',
          `Review ${reviewId} is too large for the agent-review submission route.`
        )
      }
      await this.write(reviewId, updated)
      return cloneJson(updated)
    })
  }

  async submitAgentReview(
    reviewId: string,
    submission: unknown
  ): Promise<ReviewArtifact> {
    assertReviewId(reviewId)
    assertReviewArtifact(submission, reviewId)
    return this.serialize(reviewId, async () => {
      const current = await this.read(reviewId)
      if (
        current.review.status === 'reviewed' ||
        (current.review.status === 'done' && current.review.agentReviewer)
      ) {
        const expected = expectedAgentReviewSubmission(current, submission)
        if (expected && isDeepStrictEqual(expected, submission)) {
          return cloneJson(current)
        }
        throw new ReviewStoreError(
          'SUBMISSION_CONFLICT',
          'This agent review is already complete with different submitted content.'
        )
      }
      if (current.review.status !== 'agent-reviewing') {
        throw new ReviewStoreError(
          'INVALID_TRANSITION',
          `Review ${reviewId} cannot accept an agent submission from ${current.review.status}.`
        )
      }
      if (!isDeepStrictEqual(
        withoutAgentReviewContent(current),
        withoutAgentReviewContent(submission)
      )) {
        throw new ReviewStoreError(
          'REVIEW_MISMATCH',
          'Agent review submission changed fields outside feedback and permitted source proposals.'
        )
      }
      const reviewer = current.review.agentReviewer as ReviewAgentReviewer
      assertAllowedAgentReviewContent(submission, reviewer.mode)
      const completedAt = this.mutationTimestamp(current.review)
      const updated = cloneJson(submission)
      updated.review.status = 'reviewed'
      updated.review.updatedAt = completedAt
      updated.review.agentReviewer = {
        ...reviewer,
        completedAt
      }
      assertReviewArtifact(updated, reviewId)
      await this.write(reviewId, updated)
      return cloneJson(updated)
    })
  }

  async handoff(
    reviewId: string,
    pullRequestStatus?: PullRequestStatus
  ): Promise<ReviewArtifact> {
    return this.transition(reviewId, 'pending-agent', pullRequestStatus)
  }

  async edit(reviewId: string): Promise<ReviewArtifact> {
    return this.transition(reviewId, 'editing')
  }

  async revise(
    reviewId: string,
    pullRequestStatus?: PullRequestStatus
  ): Promise<ReviewArtifact> {
    return this.transition(reviewId, 'revised', pullRequestStatus)
  }

  async resolve(
    reviewId: string,
    outcome: ManualReviewResolutionOutcome
  ): Promise<ReviewArtifact> {
    assertReviewId(reviewId)
    if (!MANUAL_REVIEW_RESOLUTION_OUTCOMES.has(outcome)) {
      throw new ReviewStoreError(
        'INVALID_RESOLUTION',
        `Invalid manual review resolution: ${outcome}`
      )
    }
    return this.serialize(reviewId, async () => {
      const current = await this.read(reviewId)
      if (
        current.review.status !== 'editing' &&
        current.review.status !== 'pending-agent'
      ) {
        throw new ReviewStoreError(
          'INVALID_TRANSITION',
          `Review ${reviewId} cannot be resolved from ${current.review.status}.`
        )
      }
      const hasFeedback = reviewHasFeedbackArtifacts(current.root)
      if (outcome === 'feedback-abandoned' && !hasFeedback) {
        throw new ReviewStoreError(
          'FEEDBACK_REQUIRED',
          `Review ${reviewId} has no feedback to abandon.`
        )
      }
      if (outcome !== 'feedback-abandoned' && hasFeedback) {
        throw new ReviewStoreError(
          'FEEDBACK_REQUIRES_ABANDONMENT',
          `Review ${reviewId} contains feedback; abandon it explicitly or leave the review unresolved.`
        )
      }

      const timestamp = this.mutationTimestamp(current.review)
      const updated = cloneJson(current)
      updated.review.status = 'revised'
      updated.review.updatedAt = timestamp
      updated.review.resolution = { outcome, resolvedAt: timestamp }
      await this.write(reviewId, updated)
      return cloneJson(updated)
    })
  }

  async unresolve(reviewId: string): Promise<ReviewArtifact> {
    assertReviewId(reviewId)
    return this.serialize(reviewId, async () => {
      const current = await this.read(reviewId)
      const outcome = current.review.resolution?.outcome
      if (
        current.review.status !== 'revised' ||
        outcome === undefined ||
        outcome === 'feedback-addressed' ||
        outcome === 'merged-unresolved'
      ) {
        throw new ReviewStoreError(
          'INVALID_TRANSITION',
          `Review ${reviewId} cannot return to Needs me from its current resolution.`
        )
      }
      const timestamp = this.mutationTimestamp(current.review)
      const updated = cloneJson(current)
      updated.review.status = 'editing'
      updated.review.updatedAt = timestamp
      updated.review.attentionRequestedAt = timestamp
      delete updated.review.resolution
      await this.write(reviewId, updated)
      return cloneJson(updated)
    })
  }

  async done(
    pullRequestUrl: string,
    pullRequestStatus: PullRequestStatus
  ): Promise<DoneReviewsResult> {
    const identity = parseGitHubPullRequestUrl(pullRequestUrl)
    if (!identity) {
      throw new ReviewStoreError(
        'INVALID_PULL_REQUEST',
        `Invalid GitHub pull request URL: ${pullRequestUrl}`
      )
    }
    if (pullRequestStatus !== 'merged') {
      throw new ReviewStoreError(
        'INVALID_PULL_REQUEST_STATUS',
        'Done requires a verified merged pull request status.'
      )
    }

    const candidates = await this.matchingPullRequestReviews(identity.url)
    const reviews: ReviewArtifact[] = []
    for (const candidate of candidates) {
      const updated = await this.markDone(candidate.review.id, identity)
      if (updated) reviews.push(updated)
    }
    return {
      pullRequestUrl: identity.url,
      reviews,
      status: 'done'
    }
  }

  async doneReview(
    reviewId: string,
    pullRequestUrl: string,
    pullRequestStatus: PullRequestStatus
  ): Promise<ReviewArtifact | null> {
    assertReviewId(reviewId)
    const identity = parseGitHubPullRequestUrl(pullRequestUrl)
    if (!identity) {
      throw new ReviewStoreError(
        'INVALID_PULL_REQUEST',
        `Invalid GitHub pull request URL: ${pullRequestUrl}`
      )
    }
    if (pullRequestStatus !== 'merged') {
      throw new ReviewStoreError(
        'INVALID_PULL_REQUEST_STATUS',
        'Done requires a verified merged pull request status.'
      )
    }
    return this.markDone(reviewId, identity)
  }

  async matchingPullRequestReviews(
    pullRequestUrl: string
  ): Promise<ReviewArtifact[]> {
    const identity = parseGitHubPullRequestUrl(pullRequestUrl)
    if (!identity) {
      throw new ReviewStoreError(
        'INVALID_PULL_REQUEST',
        `Invalid GitHub pull request URL: ${pullRequestUrl}`
      )
    }
    return (await this.list()).filter((artifact) => {
      const candidate = reviewPullRequestIdentity(
        artifact.review.pullRequest,
        artifact.review.git
      )
      return candidate?.repository === identity.repository &&
        candidate.number === identity.number
    })
  }

  async propagatePullRequestObservation(
    source: ReviewArtifact
  ): Promise<ReviewArtifact[]> {
    const identity = reviewPullRequestIdentity(
      source.review.pullRequest,
      source.review.git
    )
    const observation = pullRequestObservation(source.review.pullRequest)
    if (!identity || !observation) return []

    const candidates = await this.matchingPullRequestReviews(identity.url)
    const updated: ReviewArtifact[] = []
    for (const candidate of candidates) {
      if (candidate.review.id === source.review.id) continue
      const propagated = await this.serialize(candidate.review.id, async () => {
        const current = await this.read(candidate.review.id)
        const currentIdentity = reviewPullRequestIdentity(
          current.review.pullRequest,
          current.review.git
        )
        const currentObservation = pullRequestObservation(
          current.review.pullRequest
        )
        if (
          currentIdentity?.repository !== identity.repository ||
          currentIdentity.number !== identity.number ||
          current.review.status === 'agent-reviewing' ||
          current.review.status === 'reviewed' ||
          currentObservation && (
            currentObservation.statusObservedAt > observation.statusObservedAt ||
            currentObservation.statusObservedAt === observation.statusObservedAt &&
              currentObservation.status === observation.status &&
              currentObservation.statusSource === observation.statusSource
          ) ||
          current.review.status === 'done' && observation.status !== 'merged'
        ) return null

        const next = cloneJson(current)
        next.review.updatedAt = this.mutationTimestamp(
          current.review,
          observation.statusObservedAt
        )
        next.review.pullRequest = {
          ...(isRecord(next.review.pullRequest) ? next.review.pullRequest : {}),
          number: identity.number,
          url: identity.url,
          status: observation.status,
          statusObservedAt: observation.statusObservedAt,
          statusSource: observation.statusSource
        }
        await this.write(candidate.review.id, next)
        return cloneJson(next)
      })
      if (propagated) updated.push(propagated)
    }
    return updated
  }

  async transition(
    reviewId: string,
    status: string,
    pullRequestStatus?: PullRequestStatus
  ): Promise<ReviewArtifact> {
    assertReviewId(reviewId)
    if (!isReviewStatus(status)) {
      throw new ReviewStoreError('INVALID_STATUS', `Invalid review status: ${status}`)
    }

    return this.serialize(reviewId, async () => {
      const current = await this.read(reviewId)
      if (!transitionAllowed(current.review.status, status)) {
        throw new ReviewStoreError(
          'INVALID_TRANSITION',
          `Review ${reviewId} cannot move from ${current.review.status} to ${status}.`
        )
      }
      if (
        current.review.status === status &&
        pullRequestStatus === undefined
      ) return cloneJson(current)
      if (current.review.status === 'agent-reviewing' && status === 'editing') {
        assertPristineAgentReview(current)
      }

      const updated = cloneJson(current)
      updated.review.status = status
      if (status === 'editing') {
        delete updated.review.agentReviewer
        delete updated.review.resolution
      }
      const timestamp = this.mutationTimestamp(current.review)
      updated.review.updatedAt = timestamp
      if (status === 'revised' && current.review.status !== 'revised') {
        updated.review.resolution = {
          outcome: 'feedback-addressed',
          resolvedAt: timestamp
        }
      }
      if (current.review.status !== 'editing' && status === 'editing') {
        updated.review.attentionRequestedAt = timestamp
      }
      updated.review.pullRequest = observedPullRequest(
        current.review.pullRequest,
        pullRequestStatus,
        timestamp
      ) as ReviewPullRequest | null
      await this.write(reviewId, updated)
      return cloneJson(updated)
    })
  }

  private async markDone(
    reviewId: string,
    identity: GitHubPullRequestIdentity
  ): Promise<ReviewArtifact | null> {
    return this.serialize(reviewId, async () => {
      const current = await this.read(reviewId)
      const candidate = reviewPullRequestIdentity(
        current.review.pullRequest,
        current.review.git
      )
      if (
        candidate?.repository !== identity.repository ||
        candidate.number !== identity.number
      ) return null
      if (current.review.status === 'agent-reviewing') return null
      if (
        current.review.status === 'done' &&
        isRecord(current.review.pullRequest) &&
        current.review.pullRequest.status === 'merged'
      ) return cloneJson(current)

      const timestamp = this.mutationTimestamp(current.review)
      const updated = cloneJson(current)
      updated.review.status = 'done'
      updated.review.updatedAt = timestamp
      if (
        updated.review.resolution === undefined &&
        (current.review.status === 'editing' || current.review.status === 'pending-agent')
      ) {
        updated.review.resolution = {
          outcome: 'merged-unresolved',
          resolvedAt: timestamp
        }
      }
      updated.review.pullRequest = observedPullRequest(
        current.review.pullRequest,
        'merged',
        timestamp,
        identity.url
      ) as ReviewPullRequest | null
      await this.write(reviewId, updated)
      return cloneJson(updated)
    })
  }

  timestamp(): string {
    return new Date(this.now()).toISOString()
  }

  private mutationTimestamp(
    review: ReviewEnvelope,
    ...portableActivity: string[]
  ): string {
    return [
      this.timestamp(),
      review.createdAt,
      review.attentionRequestedAt,
      review.updatedAt,
      ...portableActivity
    ].sort().at(-1) as string
  }

  async read(reviewId: string): Promise<ReviewArtifact> {
    try {
      const artifact: unknown = JSON.parse(
        await fs.readFile(this.reviewPath(reviewId), 'utf8')
      )
      assertReviewArtifact(artifact, reviewId)
      return artifact
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        throw new ReviewStoreError(
          'NOT_FOUND',
          `Review ${reviewId} was not found.`
        )
      }
      throw error
    }
  }

  async write(reviewId: string, artifact: ReviewArtifact): Promise<void> {
    await this.writeFile(this.reviewPath(reviewId), artifact)
  }

  async writeFile(filePath: string, artifact: unknown): Promise<void> {
    const temporaryPath = path.join(
      path.dirname(filePath),
      `.review-${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`
    )

    try {
      await fs.writeFile(
        temporaryPath,
        `${JSON.stringify(artifact, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', flush: true }
      )
      await fs.rename(temporaryPath, filePath)
    } finally {
      await fs.unlink(temporaryPath).catch((error: unknown) => {
        if (errorCode(error) !== 'ENOENT') throw error
      })
    }
  }

  serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) || Promise.resolve()
    const result = previous.catch(() => {}).then(operation)
    const queued = result.then(() => undefined, () => undefined)
    this.queues.set(key, queued)

    return result.finally(() => {
      if (this.queues.get(key) === queued) this.queues.delete(key)
    })
  }
}

export { REVIEW_ID_PATTERN }

import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { guidance } from './agent-guidance'
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

const REVIEW_ID_PATTERN = /^mko_[a-zA-Z0-9]{6,32}$/
export type ReviewStatus = 'editing' | 'pending-agent' | 'revised' | 'done'
const REVIEW_STATUSES = new Set<ReviewStatus>([
  'editing',
  'pending-agent',
  'revised',
  'done'
])

export interface ReviewEnvelope {
  id: string
  status: ReviewStatus
  createdAt: string
  updatedAt: string
  contextSummary: string
  agentThread: unknown
  git: unknown
  pullRequest: unknown
  agentGuidance: AgentGuidance
}

export type ReviewArtifact = Omit<ReviewTree, 'review'> & {
  review: ReviewEnvelope
}

export interface ReviewCreateInput {
  tree: unknown
  contextSummary: unknown
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

export interface ReviewStoreOptions {
  idFactory?: () => string
  now?: () => string | number | Date
}

export interface ReviewListWarning {
  reviewId: string
  reason: 'incomplete' | 'invalid' | 'legacy' | 'unreadable'
}

export interface ReviewListResult {
  reviews: ReviewArtifact[]
  warnings: ReviewListWarning[]
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

function errorCode(error: unknown): unknown {
  return isRecord(error) ? error.code : null
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && REVIEW_STATUSES.has(value as ReviewStatus)
}

export class ReviewStoreError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ReviewStoreError'
    this.code = code
  }
}

export function createReviewId(): string {
  return `mko_${randomBytes(4).toString('hex')}`
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
  if (
    !isRecord(tree) ||
    tree.format !== 'markover-review' ||
    tree.version !== 1 ||
    !tree.sourceDocument ||
    !Array.isArray(tree.unsupported) ||
    !tree.root
  ) {
    throw new ReviewStoreError(
      'INVALID_REVIEW',
      'Expected a markover-review version 1 tree.'
    )
  }

  assertSourceEdits(tree.root)
}

function assertSourceEdits(node: unknown): void {
  if (!isRecord(node)) {
    throw new ReviewStoreError(
      'INVALID_REVIEW',
      'Expected every review block to be an object.'
    )
  }
  if (!Array.isArray(node.children)) {
    throw new ReviewStoreError(
      'INVALID_REVIEW',
      'Expected every review block to have a children array.'
    )
  }
  if (Object.prototype.hasOwnProperty.call(node, 'sourceEdit')) {
    const sourceEdit = node.sourceEdit
    const fields = sourceEdit && typeof sourceEdit === 'object'
      ? Object.keys(sourceEdit).sort()
      : []
    if (
      !sourceEdit ||
      node.sourceEditable === false ||
      !isRecord(sourceEdit) ||
      fields.length !== 2 ||
      fields[0] !== 'current' ||
      fields[1] !== 'original' ||
      typeof sourceEdit.original !== 'string' ||
      sourceEdit.original !== node.raw ||
      typeof sourceEdit.current !== 'string' ||
      !sourceEdit.current.trim() ||
      sourceEdit.current === sourceEdit.original
    ) {
      const nodeId = typeof node.id === 'string' && node.id
        ? node.id
        : '<unknown>'
      throw new ReviewStoreError(
        'INVALID_REVIEW',
        `Block ${nodeId} has an invalid source edit.`
      )
    }
  }

  for (const child of node.children) assertSourceEdits(child)
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
  if (
    artifact.review.id !== reviewId ||
    !isReviewStatus(artifact.review.status) ||
    !isRecord(artifact.review.agentGuidance) ||
    typeof artifact.review.agentGuidance.fixedContract !== 'string' ||
    typeof artifact.review.agentGuidance.interpretationPolicy !== 'string'
  ) {
    throw new ReviewStoreError(
      'INVALID_REVIEW',
      `Review ${reviewId} has an invalid envelope.`
    )
  }
  assertPullRequestEnvelope(
    artifact.review.pullRequest,
    artifact.review.status
  )
}

function assertPullRequestEnvelope(
  pullRequest: unknown,
  reviewStatus: ReviewStatus
): void {
  if (pullRequest === null) {
    if (reviewStatus === 'done') {
      throw new ReviewStoreError(
        'INVALID_REVIEW',
        'A Done review requires an associated merged pull request.'
      )
    }
    return
  }
  if (
    !isRecord(pullRequest) ||
    !canonicalPullRequestMetadata(pullRequest, null)
  ) {
    throw new ReviewStoreError(
      'INVALID_REVIEW',
      'An associated pull request requires a canonical GitHub URL and matching positive number.'
    )
  }
  const observation = pullRequestObservation(pullRequest)
  if (hasPullRequestObservationFields(pullRequest) && !observation) {
    throw new ReviewStoreError(
      'INVALID_REVIEW',
      'Pull request observations require status, statusObservedAt, and statusSource together.'
    )
  }
  if (reviewStatus === 'done' && observation?.status !== 'merged') {
    throw new ReviewStoreError(
      'INVALID_REVIEW',
      'A Done review requires a merged pull request observation.'
    )
  }
}

function treeFields(tree: unknown): Omit<ReviewTree, 'review'> {
  assertReviewTree(tree)
  return {
    format: tree.format,
    version: tree.version,
    sourceDocument: cloneJson(tree.sourceDocument),
    unsupported: cloneJson(tree.unsupported),
    root: cloneJson(tree.root)
  }
}

function immutableNode(node: ReviewNode): Record<string, unknown> {
  const children = node.children
  const properties: Record<string, unknown> = { ...node }
  delete properties.children
  delete properties.feedback
  delete properties.collapsed
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

function assertNever(value: never): never {
  throw new ReviewStoreError('INVALID_STATUS', `Invalid review status: ${String(value)}`)
}

export function reviewDeletionPolicy(
  status: ReviewStatus
): ReviewDeletionPolicy {
  switch (status) {
    case 'editing': return 'standard'
    case 'pending-agent': return 'pending-agent'
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
  private readonly idFactory: () => string
  private readonly now: () => string | number | Date
  private readonly queues = new Map<string, Promise<void>>()

  constructor(directory: string, options: ReviewStoreOptions = {}) {
    this.directory = path.resolve(directory)
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
        const artifact: ReviewArtifact = {
          ...treeFields(tree),
          review: {
            id: reviewId,
            status: 'editing',
            createdAt: timestamp,
            updatedAt: timestamp,
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
    warnings.sort((left, right) => left.reviewId.localeCompare(right.reviewId))
    return { reviews: sorted, warnings }
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
          updatedAt: this.timestamp()
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
          updatedAt: this.timestamp()
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

      const updated = cloneJson(current)
      updated.review.status = status
      const timestamp = this.timestamp()
      updated.review.updatedAt = timestamp
      updated.review.pullRequest = observedPullRequest(
        current.review.pullRequest,
        pullRequestStatus,
        timestamp
      )
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
      if (
        current.review.status === 'done' &&
        isRecord(current.review.pullRequest) &&
        current.review.pullRequest.status === 'merged'
      ) return cloneJson(current)

      const timestamp = this.timestamp()
      const updated = cloneJson(current)
      updated.review.status = 'done'
      updated.review.updatedAt = timestamp
      updated.review.pullRequest = observedPullRequest(
        current.review.pullRequest,
        'merged',
        timestamp,
        identity.url
      )
      await this.write(reviewId, updated)
      return cloneJson(updated)
    })
  }

  timestamp(): string {
    return new Date(this.now()).toISOString()
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

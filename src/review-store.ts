import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { guidance } from './agent-guidance'

const REVIEW_ID_PATTERN = /^mko_[a-zA-Z0-9]{6,32}$/
export type ReviewStatus = 'editing' | 'pending-agent'
const REVIEW_STATUSES = new Set<ReviewStatus>(['editing', 'pending-agent'])

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
  interpretationPolicy?: unknown
}

export interface ReviewStoreOptions {
  idFactory?: () => string
  now?: () => string | number | Date
}

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
    interpretationPolicy
  }: ReviewCreateInput): Promise<ReviewArtifact> {
    assertReviewTree(tree)
    if (typeof contextSummary !== 'string' || !contextSummary.trim()) {
      throw new ReviewStoreError(
        'INVALID_REVIEW',
        'A non-empty context summary is required.'
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
            pullRequest: cloneJson(pullRequest),
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
    await fs.mkdir(this.directory, { recursive: true })
    const entries = await fs.readdir(this.directory, { withFileTypes: true })
    const reviewIds = entries
      .filter((entry) => entry.isDirectory() && REVIEW_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)

    const reviews = await Promise.all(reviewIds.map(async (reviewId) => {
      try {
        return await this.load(reviewId)
      } catch (error) {
        if (
          errorCode(error) === 'NOT_FOUND' ||
          errorCode(error) === 'UNMANAGED_REVIEW'
        ) {
          return null
        }
        throw error
      }
    }))
    return reviews.filter((review): review is ReviewArtifact => review !== null).sort((left, right) => (
      left.review.createdAt.localeCompare(right.review.createdAt) ||
      left.review.id.localeCompare(right.review.id)
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

  async handoff(reviewId: string): Promise<ReviewArtifact> {
    return this.transition(reviewId, 'pending-agent')
  }

  async edit(reviewId: string): Promise<ReviewArtifact> {
    return this.transition(reviewId, 'editing')
  }

  async transition(reviewId: string, status: string): Promise<ReviewArtifact> {
    assertReviewId(reviewId)
    if (!isReviewStatus(status)) {
      throw new ReviewStoreError('INVALID_STATUS', `Invalid review status: ${status}`)
    }

    return this.serialize(reviewId, async () => {
      const current = await this.read(reviewId)
      if (current.review.status === status) return cloneJson(current)

      const updated = cloneJson(current)
      updated.review.status = status
      updated.review.updatedAt = this.timestamp()
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

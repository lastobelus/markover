const { randomBytes } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const REVIEW_ID_PATTERN = /^mko_[a-zA-Z0-9]{6,32}$/
const REVIEW_STATUSES = new Set(['editing', 'pending-agent'])

class ReviewStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ReviewStoreError'
    this.code = code
  }
}

function createReviewId() {
  return `mko_${randomBytes(4).toString('hex')}`
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertReviewId(reviewId) {
  if (!REVIEW_ID_PATTERN.test(reviewId)) {
    throw new ReviewStoreError('INVALID_ID', `Invalid review ID: ${reviewId}`)
  }
}

function assertTree(tree) {
  if (
    !tree ||
    tree.format !== 'markover-review' ||
    tree.version !== 1 ||
    !tree.sourceDocument ||
    !tree.root
  ) {
    throw new ReviewStoreError(
      'INVALID_REVIEW',
      'Expected a markover-review version 1 tree.'
    )
  }

  assertSourceEdits(tree.root)
}

function assertSourceEdits(node) {
  if (Object.prototype.hasOwnProperty.call(node, 'sourceEdit')) {
    const sourceEdit = node.sourceEdit
    const fields = sourceEdit && typeof sourceEdit === 'object'
      ? Object.keys(sourceEdit).sort()
      : []
    if (
      !sourceEdit ||
      node.sourceEditable === false ||
      typeof sourceEdit !== 'object' ||
      Array.isArray(sourceEdit) ||
      fields.length !== 2 ||
      fields[0] !== 'current' ||
      fields[1] !== 'original' ||
      typeof sourceEdit.original !== 'string' ||
      sourceEdit.original !== node.raw ||
      typeof sourceEdit.current !== 'string' ||
      !sourceEdit.current.trim() ||
      sourceEdit.current === sourceEdit.original
    ) {
      throw new ReviewStoreError(
        'INVALID_REVIEW',
        `Block ${node.id || '<unknown>'} has an invalid source edit.`
      )
    }
  }

  for (const child of node.children || []) assertSourceEdits(child)
}

function treeFields(tree) {
  assertTree(tree)
  return {
    format: tree.format,
    version: tree.version,
    sourceDocument: cloneJson(tree.sourceDocument),
    unsupported: cloneJson(tree.unsupported || []),
    root: cloneJson(tree.root)
  }
}

function immutableNode(node) {
  const {
    feedback: _feedback,
    collapsed: _collapsed,
    attachments: _attachments,
    sourceEdit: _sourceEdit,
    children = [],
    ...properties
  } = node
  return {
    ...properties,
    children: children.map(immutableNode)
  }
}

function reviewTarget(tree) {
  const fields = treeFields(tree)
  return {
    format: fields.format,
    version: fields.version,
    sourceDocument: fields.sourceDocument,
    unsupported: fields.unsupported,
    root: immutableNode(fields.root)
  }
}

function assertSameReviewTarget(current, updated) {
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

class ReviewStore {
  constructor(directory, options = {}) {
    this.directory = path.resolve(directory)
    this.idFactory = options.idFactory || createReviewId
    this.now = options.now || (() => new Date())
    this.queues = new Map()
  }

  reviewDirectory(reviewId) {
    assertReviewId(reviewId)
    return path.join(this.directory, reviewId)
  }

  reviewPath(reviewId) {
    return path.join(this.reviewDirectory(reviewId), 'review.json')
  }

  async create({ tree, contextSummary, agentThread = null, git = null, pullRequest = null }) {
    assertTree(tree)
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
          if (error.code !== 'ENOENT') throw error
        }

        const timestamp = this.timestamp()
        const artifact = {
          ...treeFields(tree),
          review: {
            id: reviewId,
            status: 'editing',
            createdAt: timestamp,
            updatedAt: timestamp,
            contextSummary,
            agentThread: cloneJson(agentThread),
            git: cloneJson(git),
            pullRequest: cloneJson(pullRequest)
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
            (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') &&
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

  async load(reviewId) {
    assertReviewId(reviewId)
    return this.serialize(reviewId, async () => cloneJson(
      await this.read(reviewId)
    ))
  }

  async list() {
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
          error.code === 'NOT_FOUND' ||
          error.code === 'UNMANAGED_REVIEW'
        ) {
          return null
        }
        throw error
      }
    }))
    return reviews.filter(Boolean).sort((left, right) => (
      left.review.createdAt.localeCompare(right.review.createdAt) ||
      left.review.id.localeCompare(right.review.id)
    ))
  }

  async updateTree(reviewId, tree) {
    assertReviewId(reviewId)
    assertTree(tree)
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

  async saveAttachmentFile(reviewId, extension, bytes) {
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
      const sequence = entries.reduce((maximum, entry) => {
        const match = /^img-(\d+)\./.exec(entry)
        return match ? Math.max(maximum, Number(match[1])) : maximum
      }, 0) + 1
      const id = `img-${sequence}`
      const filePath = path.join(directory, `${id}.${extension}`)
      await fs.writeFile(filePath, bytes, { flag: 'wx', flush: true })
      return { id, path: filePath }
    })
  }

  async handoff(reviewId) {
    return this.transition(reviewId, 'pending-agent')
  }

  async edit(reviewId) {
    return this.transition(reviewId, 'editing')
  }

  async transition(reviewId, status) {
    assertReviewId(reviewId)
    if (!REVIEW_STATUSES.has(status)) {
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

  timestamp() {
    return new Date(this.now()).toISOString()
  }

  async read(reviewId) {
    try {
      const artifact = JSON.parse(
        await fs.readFile(this.reviewPath(reviewId), 'utf8')
      )
      assertTree(artifact)
      if (!artifact.review) {
        throw new ReviewStoreError(
          'UNMANAGED_REVIEW',
          `Review ${reviewId} predates the managed review envelope.`
        )
      }
      if (
        artifact.review.id !== reviewId ||
        !REVIEW_STATUSES.has(artifact.review.status)
      ) {
        throw new ReviewStoreError(
          'INVALID_REVIEW',
          `Review ${reviewId} has an invalid envelope.`
        )
      }
      return artifact
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new ReviewStoreError(
          'NOT_FOUND',
          `Review ${reviewId} was not found.`
        )
      }
      throw error
    }
  }

  async write(reviewId, artifact) {
    await this.writeFile(this.reviewPath(reviewId), artifact)
  }

  async writeFile(filePath, artifact) {
    const temporaryPath = path.join(
      path.dirname(filePath),
      `.review-${process.pid}-${randomBytes(6).toString('hex')}.tmp`
    )

    try {
      await fs.writeFile(
        temporaryPath,
        `${JSON.stringify(artifact, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', flush: true }
      )
      await fs.rename(temporaryPath, filePath)
    } finally {
      await fs.unlink(temporaryPath).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }

  serialize(key, operation) {
    const previous = this.queues.get(key) || Promise.resolve()
    const result = previous.catch(() => {}).then(operation)
    const queued = result.then(() => {}, () => {})
    this.queues.set(key, queued)

    return result.finally(() => {
      if (this.queues.get(key) === queued) this.queues.delete(key)
    })
  }
}

module.exports = {
  REVIEW_ID_PATTERN,
  ReviewStore,
  ReviewStoreError,
  createReviewId
}

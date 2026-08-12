  function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  function isTreeEditable(tree: unknown): boolean {
    if (!isRecord(tree) || !tree.review) return true
    return isRecord(tree.review) && tree.review.status === 'editing'
  }

  function basename(value?: string | null): string {
    const normalized = (value || '').replace(/[\\/]+$/, '')
    return normalized.split(/[\\/]/).pop() || ''
  }

  function dirname(value?: unknown): string {
    const normalized = typeof value === 'string'
      ? value.replace(/\\/g, '/')
      : ''
    const index = normalized.lastIndexOf('/')
    return index > 0 ? normalized.slice(0, index) : ''
  }

  function repositoryName(value: unknown): string {
    if (typeof value !== 'string') return ''
    const normalized = value.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '')
    return basename(normalized)
  }

  function projectIdentity(
    document: {
      path?: unknown
      projectRoot?: unknown
      reviewId?: unknown
      tree?: unknown
    }
  ): ProjectIdentity {
    const review = isRecord(document.tree) && isRecord(document.tree.review)
      ? document.tree.review
      : null
    const git = review && isRecord(review.git) ? review.git : null
    const configuredRoot = typeof document.projectRoot === 'string'
      ? document.projectRoot
      : null
    const managed = typeof document.reviewId === 'string' && Boolean(document.reviewId)
    const fallbackRoot = managed ? null : dirname(document.path)
    const root = (configuredRoot || fallbackRoot || '')
      .replace(/[\\/]+$/, '') || null
    return {
      key: root || 'unassigned',
      name: repositoryName(git?.repositoryUrl) || basename(root) || 'Other',
      root
    }
  }

  function clampDocumentsListWidth(
    width: unknown,
    viewportWidth: unknown
  ): number {
    const minimum = 150
    const maximum = Math.max(
      minimum,
      Math.min(440, Number(viewportWidth) - 560)
    )
    return Math.min(maximum, Math.max(minimum, Number(width) || minimum))
  }

  function clampAnnotationPaneWidth(
    width: unknown,
    workspaceWidth: unknown,
    documentsListWidth: unknown
  ): number {
    const minimum = 360
    const maximum = Math.max(
      minimum,
      Number(workspaceWidth) - Number(documentsListWidth) - 200
    )
    return Math.min(maximum, Math.max(minimum, Number(width) || minimum))
  }

  function formatRelativeTime(
    timestamp: unknown,
    now: unknown = Date.now()
  ): string {
    const elapsed = Math.max(0, Number(now) - Number(timestamp))
    const minutes = Math.floor(elapsed / 60000)
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${String(minutes)}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${String(hours)}h ago`
    const days = Math.floor(hours / 24)
    if (days < 365) return `${String(days)}d ago`
    return `${String(Math.floor(days / 365))}y ago`
  }

  function relativeTimeRefreshDelay(
    timestamps: unknown[],
    now: unknown = Date.now()
  ): number | null {
    const refreshes = timestamps
      .map(Number)
      .filter(Number.isFinite)
      .map((timestamp) => {
        const elapsed = Math.max(0, Number(now) - timestamp)
        const minute = 60000
        const hour = 60 * minute
        const day = 24 * hour
        const year = 365 * day
        const unit = elapsed < hour
          ? minute
          : elapsed < day
            ? hour
            : elapsed < year
              ? day
              : year
        const nextElapsed = (Math.floor(elapsed / unit) + 1) * unit
        return Math.max(1000, timestamp + nextElapsed - Number(now))
      })
    return refreshes.length ? Math.min(...refreshes) : null
  }

  class ReviewMutationTracker implements ReviewMutationTrackerContract {
    private readonly byReview = new Map<string, Set<Promise<unknown>>>()

    track<T>(reviewId: string, operation: T | PromiseLike<T>): Promise<T> {
      const operations = this.byReview.get(reviewId) || new Set()
      this.byReview.set(reviewId, operations)
      const tracked: Promise<T> = Promise.resolve(operation).finally(() => {
        operations.delete(tracked)
        if (!operations.size) this.byReview.delete(reviewId)
      })
      operations.add(tracked)
      return tracked
    }

    has(reviewId: string): boolean {
      return Boolean(this.byReview.get(reviewId)?.size)
    }

    async waitCurrent(reviewId: string): Promise<void> {
      const operations = this.byReview.get(reviewId)
      if (operations) await Promise.allSettled([...operations])
    }

    async wait(reviewId: string): Promise<void> {
      while (this.has(reviewId)) {
        const operations = this.byReview.get(reviewId)
        if (!operations) continue
        await Promise.allSettled([...operations])
      }
    }
  }

  class ReviewSessions implements ReviewSessionsContract {
    private readonly byId = new Map<string, ReviewSession>()
    private activeId: string | null = null
    private viewSequence = 0
    private readonly now: () => number

    constructor(options: { now?: () => number } = {}) {
      this.now = options.now || Date.now
    }

    add(document: ReviewSessionDocument): ReviewSession {
      const reviewId = document.reviewId || document.tree.review.id
      if (!reviewId) throw new Error('A managed review requires a review ID.')

      const existing = this.byId.get(reviewId)
      if (existing) return existing

      const project = projectIdentity(document)
      const reviewedAt = Date.parse(
        document.tree.review.updatedAt ||
        document.tree.review.createdAt ||
        ''
      )
      const lifecycleActivityAt = Number.isFinite(reviewedAt)
        ? reviewedAt
        : this.now()
      const requestedAt = Date.parse(
        document.tree.review.attentionRequestedAt || ''
      )
      const collapsedBlockIds = new Set<string>()
      const collectInitialCollapse = (node: ReviewNode): void => {
        for (const child of node.children) {
          if (child.type === 'frontmatter' && child.children.length) {
            collapsedBlockIds.add(child.id)
          }
          collectInitialCollapse(child)
        }
      }
      collectInitialCollapse(document.tree.root)
      const session: ReviewSession = {
        reviewId,
        documentName: document.name || basename(document.path) || 'Untitled',
        documentPath: document.path || null,
        checksum: document.checksum,
        tree: document.tree,
        projectKey: project.key,
        projectName: project.name,
        projectRoot: project.root,
        attentionRequestedAt: Number.isFinite(requestedAt) ? requestedAt : 0,
        lifecycleActivityAt,
        lastViewedOrder: ++this.viewSequence,
        lastViewedAt: lifecycleActivityAt,
        selectedId: document.tree.root.children[0]?.id || null,
        annotatedOnly: false,
        annotationView: 'selected',
        sourceCollapsed: false,
        collapsedBlockIds,
        sourceDrafts: new Map(),
        sourceEditingId: null,
        attachmentPreviewUrls: new Map()
      }
      this.byId.set(reviewId, session)
      return session
    }

    activate(reviewId: string): ReviewSession {
      const session = this.byId.get(reviewId)
      if (!session) throw new Error(`Unknown review: ${reviewId}`)
      this.activeId = reviewId
      session.lastViewedOrder = ++this.viewSequence
      session.lastViewedAt = this.now()
      return session
    }

    active(): ReviewSession | null {
      return this.activeId ? this.byId.get(this.activeId) || null : null
    }

    get(reviewId: string): ReviewSession | null {
      return this.byId.get(reviewId) || null
    }

    remove(reviewId: string): ReviewSession | null {
      const session = this.byId.get(reviewId) || null
      if (!session) return null
      this.byId.delete(reviewId)
      if (this.activeId === reviewId) this.activeId = null
      return session
    }

    snapshot(reviewId: string): ReviewSessionTree | null {
      const session = this.get(reviewId)
      if (!session) return null
      const snapshot: unknown = JSON.parse(JSON.stringify(session.tree))
      return snapshot as ReviewSessionTree
    }

    updateStatus(
      reviewId: string,
      status: ReviewSessionEnvelope['status']
    ): ReviewSession | null {
      const session = this.get(reviewId)
      if (!session) return null
      const previous = session.tree.review.status
      session.tree.review.status = status
      if (status !== previous) {
        session.lifecycleActivityAt = this.now()
        if (status === 'editing') {
          session.attentionRequestedAt = session.lifecycleActivityAt
        }
      }
      return session
    }

    updateDocument(document: ReviewSessionDocument): ReviewSession | null {
      const reviewId = document.reviewId || document.tree.review.id
      if (!reviewId) return null
      const session = this.get(reviewId)
      if (!session) return null
      session.tree.review.updatedAt = document.tree.review.updatedAt
      session.tree.review.attentionRequestedAt =
        document.tree.review.attentionRequestedAt
      const requestedAt = Date.parse(document.tree.review.attentionRequestedAt)
      if (Number.isFinite(requestedAt)) session.attentionRequestedAt = requestedAt
      session.tree.review.pullRequest = document.tree.review.pullRequest
      return session
    }

    adjacent(reviewId: string, offset: number): ReviewSession | null {
      const sessions = this.list()
      if (!sessions.length) return null
      const index = sessions.findIndex((session) => session.reviewId === reviewId)
      if (index === -1) return null
      return sessions[(index + offset + sessions.length) % sessions.length] ?? null
    }

    list(): ReviewSession[] {
      return [...this.byId.values()]
    }

    recent(limit = Infinity): ReviewSession[] {
      return this.list()
        .sort((left, right) => right.lastViewedOrder - left.lastViewedOrder)
        .slice(0, limit)
    }

    projectGroups(): ReviewProjectGroup[] {
      const byProject = new Map<string, ReviewProjectGroup>()
      for (const session of this.recent()) {
        let group = byProject.get(session.projectKey)
        if (!group) {
          group = {
            key: session.projectKey,
            name: session.projectName,
            root: session.projectRoot,
            lastViewedOrder: session.lastViewedOrder,
            sessions: []
          }
          byProject.set(session.projectKey, group)
        }
        group.lastViewedOrder = Math.max(
          group.lastViewedOrder,
          session.lastViewedOrder
        )
        group.sessions.push(session)
      }
      return [...byProject.values()].sort(
        (left, right) => right.lastViewedOrder - left.lastViewedOrder
      )
    }
  }

  const api = {
    clampAnnotationPaneWidth,
    clampDocumentsListWidth,
    formatRelativeTime,
    isTreeEditable,
    projectIdentity,
    relativeTimeRefreshDelay,
    ReviewMutationTracker,
    ReviewSessions
  } satisfies MarkoverReviewSessionsApi

export {
  clampAnnotationPaneWidth,
  clampDocumentsListWidth,
  formatRelativeTime,
  isTreeEditable,
  projectIdentity,
  relativeTimeRefreshDelay,
  ReviewMutationTracker,
  ReviewSessions
}
export default api

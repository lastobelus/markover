(function exposeReviewSessions(globalScope) {
  function isTreeEditable(tree) {
    return !tree?.review || tree.review.status === 'editing'
  }

  function basename(value) {
    const normalized = String(value || '').replace(/[\\/]+$/, '')
    return normalized.split(/[\\/]/).pop() || ''
  }

  function dirname(value) {
    const normalized = String(value || '').replace(/\\/g, '/')
    const index = normalized.lastIndexOf('/')
    return index > 0 ? normalized.slice(0, index) : ''
  }

  function projectIdentity(document) {
    const repositoryRoot = document.projectRoot ||
      document.tree?.review?.git?.repositoryRoot ||
      null
    const fallbackRoot = dirname(document.path)
    const root = String(repositoryRoot || fallbackRoot || '')
      .replace(/[\\/]+$/, '') || null
    return {
      key: root || 'unassigned',
      name: basename(root) || 'Other',
      root
    }
  }

  function clampDocumentsListWidth(width, viewportWidth) {
    const minimum = 150
    const maximum = Math.max(
      minimum,
      Math.min(440, Number(viewportWidth) - 560)
    )
    return Math.min(maximum, Math.max(minimum, Number(width) || minimum))
  }

  function formatRelativeTime(timestamp, now = Date.now()) {
    const elapsed = Math.max(0, Number(now) - Number(timestamp))
    const minutes = Math.floor(elapsed / 60000)
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 365) return `${days}d ago`
    return `${Math.floor(days / 365)}y ago`
  }

  function relativeTimeRefreshDelay(timestamps, now = Date.now()) {
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

  class ReviewMutationTracker {
    constructor() {
      this.byReview = new Map()
    }

    track(reviewId, operation) {
      const operations = this.byReview.get(reviewId) || new Set()
      this.byReview.set(reviewId, operations)
      const tracked = Promise.resolve(operation).finally(() => {
        operations.delete(tracked)
        if (!operations.size) this.byReview.delete(reviewId)
      })
      operations.add(tracked)
      return tracked
    }

    has(reviewId) {
      return Boolean(this.byReview.get(reviewId)?.size)
    }

    async wait(reviewId) {
      while (this.has(reviewId)) {
        await Promise.allSettled([...this.byReview.get(reviewId)])
      }
    }
  }

  class ReviewSessions {
    constructor(options = {}) {
      this.byId = new Map()
      this.activeId = null
      this.viewSequence = 0
      this.now = options.now || Date.now
    }

    add(document) {
      const reviewId = document.reviewId || document.tree?.review?.id
      if (!reviewId) throw new Error('A managed review requires a review ID.')

      const existing = this.byId.get(reviewId)
      if (existing) return existing

      const project = projectIdentity(document)
      const reviewedAt = Date.parse(
        document.tree?.review?.updatedAt ||
        document.tree?.review?.createdAt ||
        ''
      )
      const session = {
        reviewId,
        documentName: document.name,
        documentPath: document.path || null,
        checksum: document.checksum,
        tree: document.tree,
        projectKey: project.key,
        projectName: project.name,
        projectRoot: project.root,
        lastViewedOrder: ++this.viewSequence,
        lastViewedAt: Number.isFinite(reviewedAt) ? reviewedAt : this.now(),
        selectedId: document.tree.root.children[0]?.id || null,
        sourceCollapsed: false,
        attachmentPreviewUrls: new Map()
      }
      this.byId.set(reviewId, session)
      return session
    }

    activate(reviewId) {
      const session = this.byId.get(reviewId)
      if (!session) throw new Error(`Unknown review: ${reviewId}`)
      this.activeId = reviewId
      session.lastViewedOrder = ++this.viewSequence
      session.lastViewedAt = this.now()
      return session
    }

    active() {
      return this.activeId ? this.byId.get(this.activeId) || null : null
    }

    get(reviewId) {
      return this.byId.get(reviewId) || null
    }

    snapshot(reviewId) {
      const session = this.get(reviewId)
      return session ? JSON.parse(JSON.stringify(session.tree)) : null
    }

    updateStatus(reviewId, status) {
      const session = this.get(reviewId)
      if (!session) return null
      session.tree.review.status = status
      return session
    }

    adjacent(reviewId, offset) {
      const sessions = this.list()
      if (!sessions.length) return null
      const index = sessions.findIndex((session) => session.reviewId === reviewId)
      if (index === -1) return null
      return sessions[(index + offset + sessions.length) % sessions.length]
    }

    list() {
      return [...this.byId.values()]
    }

    recent(limit = Infinity) {
      return this.list()
        .sort((left, right) => right.lastViewedOrder - left.lastViewedOrder)
        .slice(0, limit)
    }

    projectGroups() {
      const byProject = new Map()
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
    clampDocumentsListWidth,
    formatRelativeTime,
    isTreeEditable,
    projectIdentity,
    relativeTimeRefreshDelay,
    ReviewMutationTracker,
    ReviewSessions
  }
  globalScope.MarkoverReviewSessions = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

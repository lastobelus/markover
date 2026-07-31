(function exposeReviewSessions(globalScope) {
  function isTreeEditable(tree) {
    return !tree?.review || tree.review.status === 'editing'
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
    constructor() {
      this.byId = new Map()
      this.activeId = null
    }

    add(document) {
      const reviewId = document.reviewId || document.tree?.review?.id
      if (!reviewId) throw new Error('A managed review requires a review ID.')

      const existing = this.byId.get(reviewId)
      if (existing) return existing

      const session = {
        reviewId,
        documentName: document.name,
        documentPath: document.path || null,
        checksum: document.checksum,
        tree: document.tree,
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
  }

  const api = { isTreeEditable, ReviewMutationTracker, ReviewSessions }
  globalScope.MarkoverReviewSessions = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

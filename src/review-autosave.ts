import type { ReviewArtifact, ReviewStore } from './review-store'

export const DEFAULT_AUTOSAVE_MAXIMUM_DELAY_MS = 2000
export const MINIMUM_AUTOSAVE_MAXIMUM_DELAY_MS = 100
export const MAXIMUM_AUTOSAVE_MAXIMUM_DELAY_MS = 60_000
export const MAXIMUM_AUTOSAVE_RETRY_DELAY_MS = 30_000
export const MAXIMUM_AUTOSAVE_PERSISTENCE_BUDGET_MS = 500

interface PendingSnapshot {
  sequence: number
  tree: ReviewTree
  urgent: boolean
}

interface SaveWaiter {
  reject: (error: unknown) => void
  resolve: (artifact: ReviewArtifact) => void
  sequence: number
}

interface FlushWaiter {
  reject: (error: unknown) => void
  resolve: () => void
}

interface ReviewAutosaveState {
  cancelPersistenceDeadline: (() => void) | null
  cancelTimer: (() => void) | null
  failed: boolean
  failureCount: number
  inFlight: boolean
  nextSequence: number
  nextWriteAt: number
  pending: PendingSnapshot | null
  flushWaiters: FlushWaiter[]
  waiters: SaveWaiter[]
}

export interface ReviewAutosaveOptions {
  maximumDelayMs?: number | undefined
  now?: (() => number) | undefined
  onFailure?: ((reviewId: string, error: unknown) => void) | undefined
  onRecovered?: ((reviewId: string) => void) | undefined
  onSaved?: ((artifact: ReviewArtifact) => void) | undefined
  schedule?: ((operation: () => void, delayMs: number) => () => void) | undefined
}

type ReviewTreeWriter = Pick<ReviewStore, 'updateTree'>

function defaultSchedule(operation: () => void, delayMs: number): () => void {
  const timer = setTimeout(operation, delayMs)
  return () => { clearTimeout(timer) }
}

export class ReviewAutosave {
  readonly maximumDelayMs: number
  readonly persistenceBudgetMs: number
  readonly writeIntervalMs: number
  private readonly now: () => number
  private readonly onFailure: (reviewId: string, error: unknown) => void
  private readonly onRecovered: (reviewId: string) => void
  private readonly onSaved: (artifact: ReviewArtifact) => void
  private readonly schedule: (operation: () => void, delayMs: number) => () => void
  private readonly states = new Map<string, ReviewAutosaveState>()
  private readonly writer: ReviewTreeWriter

  constructor(writer: ReviewTreeWriter, options: ReviewAutosaveOptions = {}) {
    this.writer = writer
    this.maximumDelayMs = options.maximumDelayMs ??
      DEFAULT_AUTOSAVE_MAXIMUM_DELAY_MS
    this.persistenceBudgetMs = Math.min(
      MAXIMUM_AUTOSAVE_PERSISTENCE_BUDGET_MS,
      Math.floor(this.maximumDelayMs / 2)
    )
    this.writeIntervalMs = this.maximumDelayMs - this.persistenceBudgetMs
    this.now = options.now ?? (() => performance.now())
    this.schedule = options.schedule ?? defaultSchedule
    this.onFailure = options.onFailure ?? (() => {})
    this.onRecovered = options.onRecovered ?? (() => {})
    this.onSaved = options.onSaved ?? (() => {})
  }

  queue(reviewId: string, tree: ReviewTree): void {
    this.enqueue(reviewId, tree, false)
  }

  saveNow(reviewId: string, tree: ReviewTree): Promise<ReviewArtifact> {
    const { sequence, state } = this.enqueue(reviewId, tree, true)
    return new Promise((resolve, reject) => {
      state.waiters.push({ reject, resolve, sequence })
    })
  }

  flush(reviewId: string): Promise<void> {
    const state = this.states.get(reviewId)
    if (!state || (!state.inFlight && !state.pending)) return Promise.resolve()

    return new Promise((resolve, reject) => {
      state.flushWaiters.push({ reject, resolve })
      if (state.pending) state.pending.urgent = true
      if (!state.inFlight && state.pending) {
        state.cancelTimer?.()
        state.cancelTimer = null
        this.startWrite(reviewId, state)
      }
    })
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.states.keys()].map((reviewId) => (
      this.flush(reviewId)
    )))
  }

  failedReviewIds(): string[] {
    return [...this.states.entries()]
      .filter(([, state]) => state.failed)
      .map(([reviewId]) => reviewId)
      .sort()
  }

  private state(reviewId: string): ReviewAutosaveState {
    let state = this.states.get(reviewId)
    if (!state) {
      state = {
        cancelPersistenceDeadline: null,
        cancelTimer: null,
        failed: false,
        failureCount: 0,
        inFlight: false,
        nextSequence: 0,
        nextWriteAt: Number.NEGATIVE_INFINITY,
        pending: null,
        flushWaiters: [],
        waiters: []
      }
      this.states.set(reviewId, state)
    }
    return state
  }

  private enqueue(
    reviewId: string,
    tree: ReviewTree,
    immediate: boolean
  ): { sequence: number; state: ReviewAutosaveState } {
    const state = this.state(reviewId)
    const sequence = ++state.nextSequence
    const urgent = immediate || state.pending?.urgent === true
    if (state.pending) {
      this.rejectWaiters(
        state,
        state.pending.sequence,
        new Error('The exact autosave snapshot was superseded before persistence.')
      )
    }
    state.pending = {
      sequence,
      tree: structuredClone(tree),
      urgent
    }

    if (!state.inFlight && immediate) {
      state.cancelTimer?.()
      state.cancelTimer = null
      this.startWrite(reviewId, state)
    } else if (!state.inFlight && !state.cancelTimer && !state.failed) {
      const delay = state.nextWriteAt - this.now()
      if (delay <= 0) this.startWrite(reviewId, state)
      else this.setTimer(reviewId, state, delay)
    }
    return { sequence, state }
  }

  private startWrite(reviewId: string, state: ReviewAutosaveState): void {
    if (state.inFlight || !state.pending) return
    state.cancelTimer?.()
    state.cancelTimer = null
    const attempted = state.pending
    state.pending = null
    state.inFlight = true
    state.nextWriteAt = this.now() + this.writeIntervalMs
    state.cancelPersistenceDeadline?.()
    state.cancelPersistenceDeadline = this.schedule(() => {
      state.cancelPersistenceDeadline = null
      if (!state.inFlight || state.failed) return
      state.failed = true
      this.safely(() => {
        this.onFailure(
          reviewId,
          new Error(
            `Autosave persistence exceeded its ${String(this.persistenceBudgetMs)}ms healthy-storage budget.`
          )
        )
      })
    }, this.persistenceBudgetMs)

    void this.writer.updateTree(reviewId, attempted.tree).then(
      (artifact) => {
        state.cancelPersistenceDeadline?.()
        state.cancelPersistenceDeadline = null
        state.inFlight = false
        state.failureCount = 0
        if (state.failed && !state.pending) {
          state.failed = false
          this.safely(() => { this.onRecovered(reviewId) })
        }
        this.safely(() => { this.onSaved(artifact) })
        const completed = state.waiters.filter(
          (waiter) => waiter.sequence === attempted.sequence
        )
        state.waiters = state.waiters.filter(
          (waiter) => waiter.sequence !== attempted.sequence
        )
        for (const waiter of completed) waiter.resolve(artifact)
        this.schedulePending(reviewId, state)
        if (!state.pending) this.resolveFlushWaiters(state)
      },
      (error: unknown) => {
        state.cancelPersistenceDeadline?.()
        state.cancelPersistenceDeadline = null
        state.inFlight = false
        state.failed = true
        state.failureCount += 1
        if (!state.pending || state.pending.sequence < attempted.sequence) {
          state.pending = attempted
        }
        this.safely(() => { this.onFailure(reviewId, error) })
        const failed = state.waiters.filter(
          (waiter) => waiter.sequence === attempted.sequence
        )
        state.waiters = state.waiters.filter(
          (waiter) => waiter.sequence !== attempted.sequence
        )
        for (const waiter of failed) waiter.reject(error)
        this.rejectFlushWaiters(state, error)
        const retryDelay = Math.min(
          100 * 2 ** Math.min(state.failureCount - 1, 20),
          MAXIMUM_AUTOSAVE_RETRY_DELAY_MS
        )
        this.setTimer(reviewId, state, retryDelay)
      }
    )
  }

  private schedulePending(
    reviewId: string,
    state: ReviewAutosaveState
  ): void {
    if (!state.pending) return
    this.setTimer(
      reviewId,
      state,
      state.pending.urgent
        ? 0
        : Math.max(0, state.nextWriteAt - this.now())
    )
  }

  private setTimer(
    reviewId: string,
    state: ReviewAutosaveState,
    delayMs: number
  ): void {
    state.cancelTimer?.()
    state.cancelTimer = this.schedule(() => {
      state.cancelTimer = null
      this.startWrite(reviewId, state)
    }, delayMs)
  }

  private safely(operation: () => void): void {
    try {
      operation()
    } catch {
      // Observer failures cannot alter persistence behavior.
    }
  }

  private rejectWaiters(
    state: ReviewAutosaveState,
    sequence: number,
    error: unknown
  ): void {
    const superseded = state.waiters.filter(
      (waiter) => waiter.sequence === sequence
    )
    state.waiters = state.waiters.filter(
      (waiter) => waiter.sequence !== sequence
    )
    for (const waiter of superseded) waiter.reject(error)
  }

  private resolveFlushWaiters(state: ReviewAutosaveState): void {
    const waiters = state.flushWaiters.splice(0)
    for (const waiter of waiters) waiter.resolve()
  }

  private rejectFlushWaiters(
    state: ReviewAutosaveState,
    error: unknown
  ): void {
    const waiters = state.flushWaiters.splice(0)
    for (const waiter of waiters) waiter.reject(error)
  }
}

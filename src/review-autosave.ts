import type { ReviewArtifact, ReviewStore } from './review-store'

export const DEFAULT_AUTOSAVE_MAXIMUM_DELAY_MS = 2000
export const MINIMUM_AUTOSAVE_MAXIMUM_DELAY_MS = 100
export const MAXIMUM_AUTOSAVE_MAXIMUM_DELAY_MS = 60_000
export const MAXIMUM_AUTOSAVE_RETRY_DELAY_MS = 30_000

interface PendingSnapshot {
  queuedAt: number
  sequence: number
  tree: ReviewTree
  urgent: boolean
}

interface SaveWaiter {
  reject: (error: unknown) => void
  resolve: (artifact: ReviewArtifact) => void
  sequence: number
}

interface ReviewAutosaveState {
  cancelTimer: (() => void) | null
  failed: boolean
  failureCount: number
  inFlight: boolean
  nextSequence: number
  pending: PendingSnapshot | null
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

  private state(reviewId: string): ReviewAutosaveState {
    let state = this.states.get(reviewId)
    if (!state) {
      state = {
        cancelTimer: null,
        failed: false,
        failureCount: 0,
        inFlight: false,
        nextSequence: 0,
        pending: null,
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
    const queuedAt = state.pending?.queuedAt ?? this.now()
    const urgent = immediate || state.pending?.urgent === true
    state.pending = {
      queuedAt,
      sequence,
      tree: structuredClone(tree),
      urgent
    }

    if (!state.inFlight && (!state.cancelTimer || immediate || state.failed)) {
      state.cancelTimer?.()
      state.cancelTimer = null
      this.startWrite(reviewId, state)
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

    void this.writer.updateTree(reviewId, attempted.tree).then(
      (artifact) => {
        state.inFlight = false
        state.failureCount = 0
        if (state.failed) {
          state.failed = false
          this.safely(() => { this.onRecovered(reviewId) })
        }
        this.safely(() => { this.onSaved(artifact) })
        const completed = state.waiters.filter(
          (waiter) => waiter.sequence <= attempted.sequence
        )
        state.waiters = state.waiters.filter(
          (waiter) => waiter.sequence > attempted.sequence
        )
        for (const waiter of completed) waiter.resolve(artifact)
        this.schedulePending(reviewId, state)
      },
      (error: unknown) => {
        state.inFlight = false
        state.failed = true
        state.failureCount += 1
        if (!state.pending || state.pending.sequence < attempted.sequence) {
          state.pending = attempted
        } else {
          state.pending.queuedAt = Math.min(
            state.pending.queuedAt,
            attempted.queuedAt
          )
        }
        this.safely(() => { this.onFailure(reviewId, error) })
        const failed = state.waiters.filter(
          (waiter) => waiter.sequence <= attempted.sequence
        )
        state.waiters = state.waiters.filter(
          (waiter) => waiter.sequence > attempted.sequence
        )
        for (const waiter of failed) waiter.reject(error)
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
        : Math.max(
            0,
            state.pending.queuedAt + this.maximumDelayMs - this.now()
          )
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
}

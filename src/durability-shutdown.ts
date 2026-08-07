export interface DurabilityShutdownSteps {
  pauseMutations: () => Promise<void>
  captureSnapshots: () => Promise<void>
  waitForAttachments: () => Promise<void>
  flushAutosaves: () => Promise<void>
  closeService: () => Promise<void>
  resumeMutations: () => void
}

export const DURABILITY_SHUTDOWN_DEADLINE_MS = 5000

export class DurabilityShutdownDeadlineError extends Error {
  readonly code = 'DURABILITY_SHUTDOWN_DEADLINE'

  constructor() {
    super('Markover could not finish saving review work within five seconds.')
    this.name = 'DurabilityShutdownDeadlineError'
  }
}

export interface DurabilityShutdownOptions {
  deadlineMs?: number | undefined
  schedule?: ((operation: () => void, delayMs: number) => () => void) | undefined
}

function defaultSchedule(operation: () => void, delayMs: number): () => void {
  const timer = setTimeout(operation, delayMs)
  return () => { clearTimeout(timer) }
}

export async function persistReviewSnapshots(
  reviewIds: readonly string[],
  capture: (reviewId: string) => Promise<ReviewTree | null>,
  persist: (reviewId: string, tree: ReviewTree) => Promise<unknown>
): Promise<void> {
  await Promise.all(reviewIds.map(async (reviewId) => {
    const tree = await capture(reviewId)
    if (tree) await persist(reviewId, tree)
  }))
}

export async function runDurabilityShutdown(
  steps: DurabilityShutdownSteps,
  options: DurabilityShutdownOptions = {}
): Promise<void> {
  const deadlineMs = options.deadlineMs ?? DURABILITY_SHUTDOWN_DEADLINE_MS
  const schedule = options.schedule ?? defaultSchedule
  let rejectDeadline!: (error: unknown) => void
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject
  })
  const cancelDeadline = schedule(() => {
    rejectDeadline(new DurabilityShutdownDeadlineError())
  }, deadlineMs)
  const beforeDeadline = async (operation: () => Promise<void>): Promise<void> => {
    await Promise.race([
      Promise.resolve().then(operation),
      deadline
    ])
  }

  try {
    await beforeDeadline(steps.pauseMutations)
    await beforeDeadline(steps.waitForAttachments)
    await beforeDeadline(steps.captureSnapshots)
    await beforeDeadline(steps.flushAutosaves)
    cancelDeadline()
    await steps.closeService()
  } catch (error) {
    cancelDeadline()
    steps.resumeMutations()
    throw error
  }
}

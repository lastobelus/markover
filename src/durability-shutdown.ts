export interface DurabilityShutdownSteps {
  pauseMutations: () => Promise<void>
  captureSnapshots: () => Promise<void>
  waitForAttachments: () => Promise<void>
  flushAutosaves: () => Promise<void>
  closeService: () => Promise<void>
  resumeMutations: () => void
}

export async function runDurabilityShutdown(
  steps: DurabilityShutdownSteps
): Promise<void> {
  try {
    await steps.pauseMutations()
    await steps.waitForAttachments()
    await steps.captureSnapshots()
    await steps.flushAutosaves()
    await steps.closeService()
  } catch (error) {
    steps.resumeMutations()
    throw error
  }
}

export function autosaveFailureMessage(
  failedReviewIds: readonly string[]
): string | null {
  if (!failedReviewIds.length) return null
  if (failedReviewIds.length === 1) {
    return 'Autosave is retrying after a storage error. Your latest review changes may not be saved yet.'
  }
  return `Autosave is retrying for ${String(failedReviewIds.length)} reviews after a storage error. Their latest changes may not be saved yet.`
}

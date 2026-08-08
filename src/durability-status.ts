export function autosaveFailureMessage(
  failedReviewIds: readonly string[]
): string | null {
  if (!failedReviewIds.length) return null
  if (failedReviewIds.length === 1) {
    return 'Autosave is delayed or retrying. Your latest review changes may not be saved yet.'
  }
  return `Autosave is delayed or retrying for ${String(failedReviewIds.length)} reviews. Their latest changes may not be saved yet.`
}

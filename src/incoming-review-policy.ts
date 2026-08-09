export type IncomingReviewAction = 'activate' | 'notify' | 'warn'

export interface IncomingReviewPolicyInput {
  focusState: MarkoverWindowFocusState
  hasActiveDocument: boolean
  idleMinutes: number
  now: number
  policy: IncomingReviewActivationPolicy
}

export interface IncomingReviewPrompt {
  reviewId: string
  sequence: number
}

export function appendIncomingReview(
  prompts: readonly IncomingReviewPrompt[],
  reviewId: string,
  sequence: number
): IncomingReviewPrompt[] {
  return [...prompts, { reviewId, sequence }]
}

export function removeIncomingReview(
  prompts: readonly IncomingReviewPrompt[],
  reviewId: string
): IncomingReviewPrompt[] {
  return prompts.filter((prompt) => prompt.reviewId !== reviewId)
}

export function retainIncomingReviewsAfter(
  prompts: readonly IncomingReviewPrompt[],
  sequence: number
): IncomingReviewPrompt[] {
  return prompts.filter((prompt) => prompt.sequence > sequence)
}

export function incomingReviewAction({
  focusState,
  hasActiveDocument,
  idleMinutes,
  now,
  policy
}: IncomingReviewPolicyInput): IncomingReviewAction {
  if (!hasActiveDocument || policy === 'always') return 'activate'
  if (policy === 'warn') return 'warn'
  if (policy === 'never') return 'notify'

  const idleMilliseconds = idleMinutes * 60_000
  return !focusState.focused &&
    focusState.blurredAt !== null &&
    now - focusState.blurredAt >= idleMilliseconds
    ? 'activate'
    : 'notify'
}

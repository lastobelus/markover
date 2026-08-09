export type IncomingReviewAction = 'activate' | 'notify' | 'warn'

export interface IncomingReviewPolicyInput {
  focusState: MarkoverWindowFocusState
  hasActiveDocument: boolean
  idleMinutes: number
  now: number
  policy: IncomingReviewActivationPolicy
}

export interface IncomingReviewBatch {
  count: number
  latestReviewId: string
}

export function appendIncomingReview(
  current: IncomingReviewBatch | null,
  reviewId: string
): IncomingReviewBatch {
  return {
    count: (current?.count ?? 0) + 1,
    latestReviewId: reviewId
  }
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

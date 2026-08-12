import { CANONICAL_INSTANCE_SCHEME } from './instance'
import { reviewUrl } from './review-url'

export interface ReviewLinkCopyFailure {
  message: string
  url: string
}

export interface ReviewLinkCopyDependencies {
  chooseAfterFailure: (
    failure: ReviewLinkCopyFailure
  ) => Promise<'retry' | 'cancel'>
  writeText: (text: string) => void
}

export type ReviewLinkCopyOutcome = 'copied' | 'cancelled'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function copyCanonicalReviewLink(
  reviewId: string,
  dependencies: ReviewLinkCopyDependencies
): Promise<ReviewLinkCopyOutcome> {
  const url = reviewUrl(CANONICAL_INSTANCE_SCHEME, reviewId)
  for (;;) {
    try {
      dependencies.writeText(url)
      return 'copied'
    } catch (error) {
      const choice = await dependencies.chooseAfterFailure({
        message: errorMessage(error),
        url
      })
      if (choice === 'cancel') return 'cancelled'
    }
  }
}

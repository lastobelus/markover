import { REVIEW_ID_PATTERN } from './review-store'

export interface ReviewUrl {
  reviewId: string
  scheme: string
  url: string
}

const INSTANCE_SCHEME_PATTERN = /^markover(?:-[1-9][0-9]*)?$/

export function isReviewInstanceScheme(value: string): boolean {
  return INSTANCE_SCHEME_PATTERN.test(value)
}

export function reviewUrl(scheme: string, reviewId: string): string {
  if (!isReviewInstanceScheme(scheme)) {
    throw new Error(`Invalid Markover URL scheme: ${scheme}`)
  }
  if (!REVIEW_ID_PATTERN.test(reviewId)) {
    throw new Error(`Invalid review ID: ${reviewId}`)
  }
  return `${scheme}://review/${reviewId}`
}

export function parseReviewUrl(
  value: string,
  expectedScheme?: string
): ReviewUrl | null {
  if (expectedScheme && !isReviewInstanceScheme(expectedScheme)) return null
  const match = /^(markover(?:-[1-9][0-9]*)?):\/\/review\/(mko_[a-zA-Z0-9]{6,32})$/.exec(value)
  if (!match) return null
  const scheme = match[1] as string
  const reviewId = match[2] as string
  if (expectedScheme && scheme !== expectedScheme) return null
  return { reviewId, scheme, url: value }
}

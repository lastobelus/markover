export const MARKOVER_INTERNAL_SCHEME = 'markover-app'
export const MARKOVER_INTERNAL_HOST = 'app'
export const MARKOVER_INTERNAL_ORIGIN =
  `${MARKOVER_INTERNAL_SCHEME}://${MARKOVER_INTERNAL_HOST}`
export const MARKOVER_RENDERER_ENTRY_PATH = '/src/index.html'
export const MARKOVER_RENDERER_ENTRY_URL =
  `${MARKOVER_INTERNAL_ORIGIN}${MARKOVER_RENDERER_ENTRY_PATH}`
export const MARKOVER_INTERNAL_SCHEME_PRIVILEGES = {
  secure: true,
  standard: true
} as const

const REVIEW_ID_PATTERN = /^mko_[a-zA-Z0-9]{6,32}$/
const ATTACHMENT_ID_PATTERN = /^img-[1-9]\d*$/

export function internalRendererEntryUrl(
  query: Readonly<Record<string, string>>
): string {
  const url = new URL(MARKOVER_RENDERER_ENTRY_URL)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return url.href
}

export function internalAttachmentUrl(
  reviewId: string,
  attachmentId: string
): string {
  if (!REVIEW_ID_PATTERN.test(reviewId)) {
    throw new Error(`Invalid internal attachment review ID: ${reviewId}`)
  }
  if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) {
    throw new Error(`Invalid internal attachment ID: ${attachmentId}`)
  }
  return `${MARKOVER_INTERNAL_ORIGIN}/reviews/${reviewId}/attachments/${attachmentId}`
}

export { ATTACHMENT_ID_PATTERN }

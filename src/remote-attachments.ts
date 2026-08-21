import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { MAXIMUM_ATTACHMENT_BYTES } from './attachment-limits'

const REVIEW_ID_PATTERN = /^mko_[a-zA-Z0-9]{6,32}$/
const ATTACHMENT_ID_PATTERN = /^img-[a-zA-Z0-9]{1,64}$/
const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/

export interface RemoteAttachmentSource {
  attachment: ReviewAttachment
  attachmentRoot: string
  filePath: string
}

export type LoadRemoteAttachment = (
  reviewId: string,
  attachmentId: string
) => Promise<RemoteAttachmentSource | null>

export interface VerifiedRemoteAttachment {
  bytes: Buffer
  mimeType: 'image/jpeg' | 'image/png'
}

export class RemoteAttachmentError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RemoteAttachmentError'
    this.code = code
  }
}

function attachmentError(code: string, message: string): RemoteAttachmentError {
  return new RemoteAttachmentError(code, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function attachmentEntries(value: unknown): ReviewAttachment[] {
  if (!isRecord(value) || !isRecord(value.root)) return []
  const entries: ReviewAttachment[] = []
  const visit = (node: unknown): void => {
    if (!isRecord(node)) return
    if (Array.isArray(node.attachments)) {
      for (const attachment of node.attachments) {
        if (isRecord(attachment)) entries.push(attachment as unknown as ReviewAttachment)
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  visit(value.root)
  return entries
}

function attachmentPath(reviewId: string, attachmentId: string): string {
  return `/reviews/${encodeURIComponent(reviewId)}/attachments/${encodeURIComponent(attachmentId)}`
}

function checkedMetadata(
  reviewId: string,
  attachmentId: string,
  source: RemoteAttachmentSource | null
): RemoteAttachmentSource {
  if (!source || source.attachment.id !== attachmentId) {
    throw attachmentError(
      'REMOTE_ATTACHMENT_NOT_FOUND',
      `Review ${reviewId} does not reference attachment ${attachmentId}.`
    )
  }
  if (
    source.attachment.type !== 'image' ||
    !['image/jpeg', 'image/png'].includes(source.attachment.mimeType ?? '') ||
    !source.attachment.checksum ||
    !CHECKSUM_PATTERN.test(source.attachment.checksum)
  ) {
    throw attachmentError(
      'REMOTE_ATTACHMENT_METADATA_INVALID',
      `Attachment ${attachmentId} does not have complete private-download metadata.`
    )
  }
  return source
}

export async function readVerifiedRemoteAttachment(
  reviewId: string,
  attachmentId: string,
  load: LoadRemoteAttachment,
  maximumBytes = MAXIMUM_ATTACHMENT_BYTES
): Promise<VerifiedRemoteAttachment> {
  if (!REVIEW_ID_PATTERN.test(reviewId) || !ATTACHMENT_ID_PATTERN.test(attachmentId)) {
    throw attachmentError('REMOTE_ATTACHMENT_NOT_FOUND', 'Attachment not found.')
  }
  const source = checkedMetadata(
    reviewId,
    attachmentId,
    await load(reviewId, attachmentId)
  )
  const noFollow = constants.O_NOFOLLOW
  let handle: fs.FileHandle | null = null
  try {
    const [realRoot, realFile] = await Promise.all([
      fs.realpath(source.attachmentRoot),
      fs.realpath(source.filePath)
    ])
    const relative = path.relative(realRoot, realFile)
    if (
      path.dirname(realFile) !== realRoot ||
      !relative ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !new RegExp(`^${attachmentId.replace('-', '\\-')}\\.[a-z0-9]+$`).test(
        path.basename(realFile)
      )
    ) {
      throw attachmentError('REMOTE_ATTACHMENT_NOT_FOUND', 'Attachment not found.')
    }
    const pathStats = await fs.lstat(realFile)
    if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
      throw attachmentError('REMOTE_ATTACHMENT_NOT_FOUND', 'Attachment not found.')
    }
    handle = await fs.open(realFile, constants.O_RDONLY | noFollow)
    const before = await handle.stat()
    if (!before.isFile() || before.size < 1 || before.size > maximumBytes) {
      throw attachmentError(
        before.size > maximumBytes
          ? 'REMOTE_ATTACHMENT_TOO_LARGE'
          : 'REMOTE_ATTACHMENT_LENGTH_MISMATCH',
        'The attachment length is invalid.'
      )
    }
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (
      bytes.byteLength !== before.size ||
      after.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino
    ) {
      throw attachmentError(
        'REMOTE_ATTACHMENT_LENGTH_MISMATCH',
        'The attachment changed while it was being read.'
      )
    }
    const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if (checksum !== source.attachment.checksum) {
      throw attachmentError(
        'REMOTE_ATTACHMENT_CHECKSUM_MISMATCH',
        'The attachment checksum does not match its review metadata.'
      )
    }
    const png = bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    const mimeType = source.attachment.mimeType as 'image/jpeg' | 'image/png'
    if ((mimeType === 'image/png' && !png) || (mimeType === 'image/jpeg' && !jpeg)) {
      throw attachmentError(
        'REMOTE_ATTACHMENT_TYPE_MISMATCH',
        'The attachment bytes do not match their declared image type.'
      )
    }
    return { bytes, mimeType }
  } catch (error) {
    if (error instanceof RemoteAttachmentError) throw error
    throw attachmentError('REMOTE_ATTACHMENT_NOT_FOUND', 'Attachment not found.')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function projectRemoteAttachments(
  artifact: unknown,
  load: LoadRemoteAttachment,
  maximumBytes = MAXIMUM_ATTACHMENT_BYTES
): Promise<unknown> {
  if (!isRecord(artifact) || !isRecord(artifact.review)) return artifact
  const reviewId = artifact.review.id
  if (typeof reviewId !== 'string' || !REVIEW_ID_PATTERN.test(reviewId)) return artifact
  const entries = attachmentEntries(artifact)
  if (!entries.length) return artifact
  const seen = new Set<string>()
  for (const attachment of entries) {
    if (!ATTACHMENT_ID_PATTERN.test(attachment.id) || seen.has(attachment.id)) {
      throw attachmentError(
        'REMOTE_ATTACHMENT_METADATA_INVALID',
        'The review contains invalid or duplicate attachment metadata.'
      )
    }
    seen.add(attachment.id)
    await readVerifiedRemoteAttachment(
      reviewId,
      attachment.id,
      load,
      maximumBytes
    )
  }
  const projected = structuredClone(artifact)
  for (const attachment of attachmentEntries(projected)) {
    delete attachment.path
    attachment.url = attachmentPath(reviewId, attachment.id)
  }
  return projected
}

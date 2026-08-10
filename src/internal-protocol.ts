import fs from 'node:fs/promises'
import path from 'node:path'

import {
  ATTACHMENT_ID_PATTERN,
  MARKOVER_INTERNAL_HOST,
  MARKOVER_INTERNAL_SCHEME,
  MARKOVER_RENDERER_ENTRY_PATH
} from './internal-url'
import { REVIEW_ID_PATTERN } from './review-store'

const RENDERER_ASSET_PATHS = new Set([
  'design/brand/markover-app-icon.png',
  'design/brand/markover-lockup.svg',
  'design/brand/markover-logotype.svg',
  'design/brand/markover-mark.svg',
  'src/index.html',
  'src/renderer.js',
  'src/renderer.js.map',
  'src/startup.js',
  'src/startup.js.map',
  'src/styles.css'
])

export type InternalProtocolRoute =
  | { kind: 'asset'; relativePath: string }
  | { kind: 'attachment'; attachmentId: string; reviewId: string }

export type InternalFileResolution =
  | { ok: true; filePath: string }
  | { ok: false; status: 400 | 404 }

interface AllowedAttachment {
  filePath: string
  root: string
}

function decodedPathSegments(pathname: string): string[] | null {
  if (!pathname.startsWith('/')) return null
  const encoded = pathname.slice(1).split('/')
  if (!encoded.length || encoded.some((segment) => !segment)) return null
  try {
    const decoded = encoded.map((segment) => decodeURIComponent(segment))
    if (decoded.some((segment) => (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment.includes('\0')
    ))) return null
    return decoded
  } catch {
    return null
  }
}

export function parseInternalProtocolRequest(
  value: string
): InternalProtocolRoute | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (
    url.protocol !== `${MARKOVER_INTERNAL_SCHEME}:` ||
    url.hostname !== MARKOVER_INTERNAL_HOST ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) return null

  const segments = decodedPathSegments(url.pathname)
  if (!segments) return null
  const relativePath = segments.join('/')
  if (RENDERER_ASSET_PATHS.has(relativePath)) {
    if (url.search && url.pathname !== MARKOVER_RENDERER_ENTRY_PATH) return null
    return { kind: 'asset', relativePath }
  }
  if (
    !url.search &&
    segments.length === 4 &&
    segments[0] === 'reviews' &&
    segments[2] === 'attachments' &&
    REVIEW_ID_PATTERN.test(segments[1] ?? '') &&
    ATTACHMENT_ID_PATTERN.test(segments[3] ?? '')
  ) {
    return {
      kind: 'attachment',
      reviewId: segments[1] as string,
      attachmentId: segments[3] as string
    }
  }
  return null
}

function attachmentKey(reviewId: string, attachmentId: string): string {
  return `${reviewId}\0${attachmentId}`
}

function attachmentEntries(root: ReviewNode): ReviewAttachment[] {
  const entries: ReviewAttachment[] = []
  const visit = (node: ReviewNode): void => {
    entries.push(...(node.attachments || []))
    for (const child of node.children) visit(child)
  }
  visit(root)
  return entries
}

export class InternalAttachmentAllowlist {
  private readonly entries = new Map<string, AllowedAttachment>()
  private readonly reviewsRoot: string

  constructor(reviewsRoot: string) {
    this.reviewsRoot = path.resolve(reviewsRoot)
  }

  replaceReview(reviewId: string, tree: Pick<ReviewTree, 'root'>): void {
    this.removeReview(reviewId)
    if (!REVIEW_ID_PATTERN.test(reviewId)) return
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const attachment of attachmentEntries(tree.root)) {
      if (seen.has(attachment.id)) duplicates.add(attachment.id)
      seen.add(attachment.id)
      this.register(reviewId, attachment.id, attachment.path)
    }
    for (const attachmentId of duplicates) {
      this.remove(reviewId, attachmentId)
    }
  }

  register(
    reviewId: string,
    attachmentId: string,
    filePath: string | null | undefined
  ): boolean {
    if (
      !REVIEW_ID_PATTERN.test(reviewId) ||
      !ATTACHMENT_ID_PATTERN.test(attachmentId) ||
      !filePath ||
      !path.isAbsolute(filePath)
    ) return false
    const root = path.join(this.reviewsRoot, reviewId, 'attachments')
    const resolved = path.resolve(filePath)
    if (
      path.dirname(resolved) !== root ||
      !new RegExp(`^${attachmentId.replace('-', '\\-')}\\.[a-z0-9]+$`).test(
        path.basename(resolved)
      )
    ) return false
    this.entries.set(attachmentKey(reviewId, attachmentId), {
      filePath: resolved,
      root
    })
    return true
  }

  remove(reviewId: string, attachmentId: string): void {
    this.entries.delete(attachmentKey(reviewId, attachmentId))
  }

  removeReview(reviewId: string): void {
    const prefix = `${reviewId}\0`
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }

  async resolve(reviewId: string, attachmentId: string): Promise<string | null> {
    const entry = this.entries.get(attachmentKey(reviewId, attachmentId))
    if (!entry) return null
    try {
      const [realRoot, realFile] = await Promise.all([
        fs.realpath(entry.root),
        fs.realpath(entry.filePath)
      ])
      const relative = path.relative(realRoot, realFile)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return null
      }
      const stats = await fs.stat(realFile)
      return stats.isFile() ? realFile : null
    } catch {
      return null
    }
  }
}

export async function resolveInternalRequestFile(
  value: string,
  applicationRoot: string,
  attachments: InternalAttachmentAllowlist
): Promise<InternalFileResolution> {
  const route = parseInternalProtocolRequest(value)
  if (!route) return { ok: false, status: 400 }
  const filePath = route.kind === 'asset'
    ? path.join(path.resolve(applicationRoot), route.relativePath)
    : await attachments.resolve(route.reviewId, route.attachmentId)
  if (!filePath) return { ok: false, status: 404 }
  try {
    const stats = await fs.lstat(filePath)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return { ok: false, status: 404 }
    }
    return { ok: true, filePath }
  } catch {
    return { ok: false, status: 404 }
  }
}

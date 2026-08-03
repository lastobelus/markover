import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  assertReviewArtifact,
  ReviewStore,
  type ReviewArtifact
} from './review-store'

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object'
    ? Reflect.get(error, 'code')
    : null
}

export function rewriteAttachmentPaths(
  artifact: ReviewArtifact,
  sourceReview: string,
  targetReview: string
): ReviewArtifact {
  const sourceAttachments = path.join(sourceReview, 'attachments')
  const targetAttachments = path.join(targetReview, 'attachments')
  const visit = (node: ReviewNode): void => {
    for (const attachment of node.attachments || []) {
      if (typeof attachment.path !== 'string') continue
      const relative = path.relative(sourceAttachments, attachment.path)
      if (
        relative &&
        !relative.startsWith(`..${path.sep}`) &&
        relative !== '..' &&
        !path.isAbsolute(relative)
      ) {
        attachment.path = path.join(targetAttachments, relative)
      }
    }
    for (const child of node.children) visit(child)
  }
  visit(artifact.root)
  return artifact
}

export async function importLegacyReviews(
  sourceDirectory: string,
  targetDirectory: string
): Promise<string[]> {
  if (path.resolve(sourceDirectory) === path.resolve(targetDirectory)) return []

  let reviews
  try {
    await fs.access(sourceDirectory)
    reviews = await new ReviewStore(sourceDirectory).list()
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }

  await fs.mkdir(targetDirectory, { recursive: true })
  const imported: string[] = []
  for (const review of reviews) {
    const reviewId = review.review.id
    const target = path.join(targetDirectory, reviewId)
    try {
      await fs.access(target)
      continue
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    }

    const staging = path.join(
      targetDirectory,
      `.import-${reviewId}-${randomBytes(6).toString('hex')}`
    )
    try {
      const sourceReview = path.join(sourceDirectory, reviewId)
      await fs.cp(sourceReview, staging, {
        recursive: true,
        errorOnExist: true,
        force: false
      })
      const reviewPath = path.join(staging, 'review.json')
      const parsed: unknown = JSON.parse(await fs.readFile(reviewPath, 'utf8'))
      assertReviewArtifact(parsed, reviewId)
      const artifact = rewriteAttachmentPaths(
        parsed,
        sourceReview,
        target
      )
      await fs.writeFile(reviewPath, `${JSON.stringify(artifact, null, 2)}\n`)
      await fs.rename(staging, target)
      imported.push(reviewId)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST' && errorCode(error) !== 'ENOTEMPTY') {
        throw error
      }
    } finally {
      await fs.rm(staging, { recursive: true, force: true })
    }
  }
  return imported
}

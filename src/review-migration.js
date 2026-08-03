const { randomBytes } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { ReviewStore } = require('./review-store')

function rewriteAttachmentPaths(artifact, sourceReview, targetReview) {
  const sourceAttachments = path.join(sourceReview, 'attachments')
  const targetAttachments = path.join(targetReview, 'attachments')
  const visit = (node) => {
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
    for (const child of node.children || []) visit(child)
  }
  visit(artifact.root)
  return artifact
}

async function importLegacyReviews(sourceDirectory, targetDirectory) {
  if (path.resolve(sourceDirectory) === path.resolve(targetDirectory)) return []

  let reviews
  try {
    await fs.access(sourceDirectory)
    reviews = await new ReviewStore(sourceDirectory).list()
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }

  await fs.mkdir(targetDirectory, { recursive: true })
  const imported = []
  for (const review of reviews) {
    const reviewId = review.review.id
    const target = path.join(targetDirectory, reviewId)
    try {
      await fs.access(target)
      continue
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
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
      const artifact = rewriteAttachmentPaths(
        JSON.parse(await fs.readFile(reviewPath, 'utf8')),
        sourceReview,
        target
      )
      await fs.writeFile(reviewPath, `${JSON.stringify(artifact, null, 2)}\n`)
      await fs.rename(staging, target)
      imported.push(reviewId)
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error
    } finally {
      await fs.rm(staging, { recursive: true, force: true })
    }
  }
  return imported
}

module.exports = { importLegacyReviews, rewriteAttachmentPaths }

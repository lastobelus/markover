import fs from 'node:fs/promises'
import path from 'node:path'

import { discoverRepositoryRoot } from './metadata-discovery'
import { reviewChecksum } from './review-format'

interface ReviewProjectContextOptions {
  discoverRoot?: (sourcePath: string) => Promise<string | null>
  readSource?: (sourcePath: string) => Promise<string>
}

export async function discoverVerifiedReviewProjectRoot(
  artifact: ReviewArtifact,
  {
    discoverRoot = discoverRepositoryRoot,
    readSource = (sourcePath) => fs.readFile(sourcePath, 'utf8')
  }: ReviewProjectContextOptions = {}
): Promise<string | null> {
  const snapshotPath = artifact.sourceDocument.path
  if (!snapshotPath) return null
  const sourcePath = path.resolve(snapshotPath)
  try {
    const currentSource = await readSource(sourcePath)
    if (reviewChecksum(currentSource) !== artifact.sourceDocument.checksum) {
      return null
    }
    return await discoverRoot(sourcePath)
  } catch {
    return null
  }
}

import {
  discoverGitMetadata,
  type GitMetadata
} from './metadata-discovery'
import {
  assertReviewTree,
  type ReviewArtifact,
  type ReviewStore
} from './review-store'

export const LOCAL_REVIEW_CONTEXT_SUMMARY = 'Opened locally in Markover.'

type LocalReviewStore = Pick<ReviewStore, 'create'>
type DiscoverGitMetadata = (sourcePath: string) => Promise<GitMetadata | null>

interface LocalReviewOptions {
  discoverGit?: DiscoverGitMetadata
  interpretationPolicy?: unknown
}

function assertCandidateMatchesTree(
  candidate: MarkoverDocument,
  tree: ReviewTree
): asserts candidate is MarkoverDocument & { path: string } {
  if (
    !candidate.path ||
    candidate.name !== tree.sourceDocument.name ||
    candidate.path !== tree.sourceDocument.path ||
    candidate.source !== tree.sourceDocument.content ||
    candidate.checksum !== tree.sourceDocument.checksum
  ) {
    throw new Error('The selected Markdown snapshot changed before it was saved.')
  }
}

export async function createLocalReview(
  candidate: MarkoverDocument,
  tree: unknown,
  store: LocalReviewStore,
  {
    discoverGit = discoverGitMetadata,
    interpretationPolicy
  }: LocalReviewOptions = {}
): Promise<ReviewArtifact> {
  assertReviewTree(tree)
  assertCandidateMatchesTree(candidate, tree)
  const git = await discoverGit(candidate.path).catch(() => null)
  return store.create({
    tree,
    contextSummary: LOCAL_REVIEW_CONTEXT_SUMMARY,
    git,
    interpretationPolicy
  })
}

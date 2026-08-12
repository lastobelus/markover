export const WORKSPACE_STATE_FORMAT = 'markover-workspace' as const
export const WORKSPACE_STATE_VERSION = 1 as const

export const DEFAULT_WORKSPACE_STATE: Readonly<MarkoverWorkspaceState> =
  Object.freeze({
    format: WORKSPACE_STATE_FORMAT,
    version: WORKSPACE_STATE_VERSION,
    initialized: false,
    navigationMode: 'inbox',
    projectExpansion: Object.freeze([]) as unknown as WorkspaceProjectExpansion[],
    threadExpansion: Object.freeze([]) as unknown as WorkspaceThreadExpansion[],
    openReviewIds: Object.freeze([]) as unknown as string[],
    activeReviewId: null,
    annotationPaneWidth: null,
    reviews: Object.freeze({})
  })

const REVIEW_ID_PATTERN = /^mko_[a-zA-Z0-9]{6,32}$/
const MAX_KEY_LENGTH = 4096
const MAX_COLLECTION_SIZE = 100_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(
  value: unknown,
  required: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  const expected = new Set(required)
  return keys.length === required.length && keys.every((key) => expected.has(key))
}

function nonemptyKey(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_KEY_LENGTH
}

function reviewId(value: unknown): value is string {
  return typeof value === 'string' && REVIEW_ID_PATTERN.test(value)
}

function uniqueStrings(
  value: unknown,
  predicate: (candidate: unknown) => candidate is string
): value is string[] {
  return Array.isArray(value) &&
    value.length <= MAX_COLLECTION_SIZE &&
    value.every(predicate) &&
    new Set(value).size === value.length
}

function isProjectExpansion(value: unknown): value is WorkspaceProjectExpansion {
  return hasExactKeys(value, ['projectKey', 'expanded']) &&
    nonemptyKey(value.projectKey) &&
    typeof value.expanded === 'boolean'
}

function isThreadExpansion(value: unknown): value is WorkspaceThreadExpansion {
  return hasExactKeys(value, ['projectKey', 'threadKey', 'expanded']) &&
    nonemptyKey(value.projectKey) &&
    nonemptyKey(value.threadKey) &&
    typeof value.expanded === 'boolean'
}

function isReviewViewState(value: unknown): value is WorkspaceReviewViewState {
  return hasExactKeys(value, [
    'selectedBlockId',
    'annotatedOnly',
    'annotationView',
    'sourceCollapsed',
    'collapsedBlockIds'
  ]) &&
    (value.selectedBlockId === null || nonemptyKey(value.selectedBlockId)) &&
    typeof value.annotatedOnly === 'boolean' &&
    (value.annotationView === 'selected' || value.annotationView === 'list') &&
    typeof value.sourceCollapsed === 'boolean' &&
    uniqueStrings(value.collapsedBlockIds, nonemptyKey)
}

export function isWorkspaceState(value: unknown): value is MarkoverWorkspaceState {
  if (!hasExactKeys(value, [
    'format',
    'version',
    'initialized',
    'navigationMode',
    'projectExpansion',
    'threadExpansion',
    'openReviewIds',
    'activeReviewId',
    'annotationPaneWidth',
    'reviews'
  ])) return false
  if (
    value.format !== WORKSPACE_STATE_FORMAT ||
    value.version !== WORKSPACE_STATE_VERSION ||
    typeof value.initialized !== 'boolean' ||
    (value.navigationMode !== 'inbox' && value.navigationMode !== 'projects') ||
    !Array.isArray(value.projectExpansion) ||
    value.projectExpansion.length > MAX_COLLECTION_SIZE ||
    !value.projectExpansion.every(isProjectExpansion) ||
    !Array.isArray(value.threadExpansion) ||
    value.threadExpansion.length > MAX_COLLECTION_SIZE ||
    !value.threadExpansion.every(isThreadExpansion) ||
    !uniqueStrings(value.openReviewIds, reviewId) ||
    (value.activeReviewId !== null && !reviewId(value.activeReviewId)) ||
    (
      value.annotationPaneWidth !== null &&
      (
        typeof value.annotationPaneWidth !== 'number' ||
        !Number.isInteger(value.annotationPaneWidth) ||
        value.annotationPaneWidth <= 0 ||
        value.annotationPaneWidth > 10_000
      )
    ) ||
    !isRecord(value.reviews) ||
    Object.keys(value.reviews).length > MAX_COLLECTION_SIZE
  ) return false
  const projectKeys = value.projectExpansion.map(({ projectKey }) => projectKey)
  if (new Set(projectKeys).size !== projectKeys.length) return false
  const threadKeys = value.threadExpansion.map(({ projectKey, threadKey }) => (
    `${projectKey}\0${threadKey}`
  ))
  if (new Set(threadKeys).size !== threadKeys.length) return false
  return Object.entries(value.reviews).every(([id, state]) => (
    reviewId(id) && isReviewViewState(state)
  ))
}

export function cloneWorkspaceState(
  value: MarkoverWorkspaceState
): MarkoverWorkspaceState {
  return {
    format: WORKSPACE_STATE_FORMAT,
    version: WORKSPACE_STATE_VERSION,
    initialized: value.initialized,
    navigationMode: value.navigationMode,
    projectExpansion: value.projectExpansion.map((project) => ({ ...project })),
    threadExpansion: value.threadExpansion.map((thread) => ({ ...thread })),
    openReviewIds: [...value.openReviewIds],
    activeReviewId: value.activeReviewId,
    annotationPaneWidth: value.annotationPaneWidth,
    reviews: Object.fromEntries(Object.entries(value.reviews).map(([id, state]) => [
      id,
      {
        ...state,
        collapsedBlockIds: [...state.collapsedBlockIds]
      }
    ]))
  }
}

export function defaultWorkspaceState(): MarkoverWorkspaceState {
  return cloneWorkspaceState(DEFAULT_WORKSPACE_STATE)
}

export function parseWorkspaceState(value: unknown): MarkoverWorkspaceState {
  if (!isWorkspaceState(value)) {
    throw new Error('Workspace state uses an unsupported or invalid private format.')
  }
  return cloneWorkspaceState(value)
}

export interface WorkspaceReviewScope {
  reviewId: string
  projectKey: string
  threadKey: string
  blockIds: readonly string[]
}

export function reconcileWorkspaceState(
  value: MarkoverWorkspaceState,
  scopes: readonly WorkspaceReviewScope[]
): MarkoverWorkspaceState {
  const scopeByReview = new Map(scopes.map((scope) => [scope.reviewId, scope]))
  const projectKeys = new Set(scopes.map((scope) => scope.projectKey))
  const threadKeys = new Set(scopes.map((scope) => (
    `${scope.projectKey}\0${scope.threadKey}`
  )))
  const openReviewIds = value.openReviewIds.filter((id) => scopeByReview.has(id))
  const activeReviewId = value.activeReviewId && openReviewIds.includes(
    value.activeReviewId
  )
    ? value.activeReviewId
    : null
  const reviews: Record<string, WorkspaceReviewViewState> = {}
  for (const [id, state] of Object.entries(value.reviews)) {
    const scope = scopeByReview.get(id)
    if (!scope) continue
    const blockIds = new Set(scope.blockIds)
    reviews[id] = {
      selectedBlockId: state.selectedBlockId && blockIds.has(state.selectedBlockId)
        ? state.selectedBlockId
        : null,
      annotatedOnly: state.annotatedOnly,
      annotationView: state.annotationView,
      sourceCollapsed: state.sourceCollapsed,
      collapsedBlockIds: state.collapsedBlockIds.filter((blockId) => (
        blockIds.has(blockId)
      ))
    }
  }
  return {
    ...cloneWorkspaceState(value),
    projectExpansion: value.projectExpansion.filter(({ projectKey }) => (
      projectKeys.has(projectKey)
    )),
    threadExpansion: value.threadExpansion.filter(({ projectKey, threadKey }) => (
      threadKeys.has(`${projectKey}\0${threadKey}`)
    )),
    openReviewIds,
    activeReviewId,
    reviews
  }
}

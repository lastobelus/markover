import {
  pullRequestObservation,
  type PullRequestStatus
} from './pull-request'

export type ReviewTitleSource =
  | 'thread-title'
  | 'context-summary'
  | 'document-name'

export interface ReviewInboxRow {
  attentionRequestedAt: number
  branch: string | null
  contextPath: string | null
  documentName: string
  lifecycleActivityAt: number
  local: boolean
  projectKey: string
  projectName: string
  provider: string | null
  pullRequestNumber: number | null
  pullRequestStatus: PullRequestStatus | null
  pullRequestStatusObservedAt: string | null
  pullRequestStatusSource: string | null
  reviewId: string
  status: ReviewSessionStatus
  threadKey: string
  title: string
  titleSource: ReviewTitleSource
}

export interface ReviewInboxThread {
  editingCount: number
  key: string
  latestActivityAt: number
  latestAttentionAt: number
  local: boolean
  provider: string | null
  reviews: ReviewInboxRow[]
  title: string
  titleSource: ReviewTitleSource
}

export interface ReviewInboxProject {
  editingCount: number
  key: string
  latestActivityAt: number
  latestAttentionAt: number
  name: string
  root: string | null
  threads: ReviewInboxThread[]
}

export interface ReviewInboxProjection {
  editing: ReviewInboxRow[]
  history: ReviewInboxRow[]
  projects: ReviewInboxProject[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringField(
  value: unknown,
  keys: readonly string[]
): string | null {
  if (!isRecord(value)) return null
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return null
}

function numberField(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null
  const candidate = value[key]
  return Number.isInteger(candidate) && Number(candidate) > 0
    ? Number(candidate)
    : null
}

function relativeDocumentPath(session: ReviewSession): string | null {
  if (!session.documentPath) return null
  const normalizedPath = session.documentPath.replace(/\\/g, '/')
  const normalizedRoot = session.projectRoot?.replace(/\\/g, '/').replace(/\/$/, '')
  if (
    normalizedRoot &&
    normalizedPath.startsWith(`${normalizedRoot}/`)
  ) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath
}

function rowTitle(
  session: ReviewSession,
  agentThread: unknown,
  local: boolean
): Pick<ReviewInboxRow, 'title' | 'titleSource'> {
  const requestingThreadTitle = stringField(agentThread, ['title', 'name'])
  if (requestingThreadTitle) {
    return { title: requestingThreadTitle, titleSource: 'thread-title' }
  }
  const contextSummary = session.tree.review.contextSummary?.trim()
  if (contextSummary && !local) {
    return { title: contextSummary, titleSource: 'context-summary' }
  }
  return {
    title: session.documentName,
    titleSource: 'document-name'
  }
}

function rowFromSession(session: ReviewSession): ReviewInboxRow {
  const review = session.tree.review
  const agentThread = review.agentThread
  const provider = stringField(agentThread, ['provider'])
  const threadId = stringField(agentThread, ['id', 'threadId'])
  const contextSummary = review.contextSummary?.trim() || ''
  const local = !provider && (
    contextSummary === 'Opened locally in Markover.' ||
    contextSummary === 'Opened in Markover from a local Markdown file.'
  )
  const title = rowTitle(session, agentThread, local)
  const branch = stringField(review.git, ['branch'])
  const pullRequestNumber = numberField(review.pullRequest, 'number')
  const pullRequestState = pullRequestObservation(review.pullRequest)
  const threadKey = local
    ? `local:${session.projectKey}`
    : threadId
      ? `${provider || 'agent'}:${threadId}`
      : `review:${session.reviewId}`

  return {
    attentionRequestedAt: session.attentionRequestedAt,
    branch,
    contextPath: relativeDocumentPath(session),
    documentName: session.documentName,
    lifecycleActivityAt: session.lifecycleActivityAt,
    local,
    projectKey: session.projectKey,
    projectName: session.projectName,
    provider,
    pullRequestNumber,
    pullRequestStatus: pullRequestState?.status ?? null,
    pullRequestStatusObservedAt: pullRequestState?.statusObservedAt ?? null,
    pullRequestStatusSource: pullRequestState?.statusSource ?? null,
    reviewId: session.reviewId,
    status: review.status,
    threadKey,
    ...title
  }
}

function compareRows(left: ReviewInboxRow, right: ReviewInboxRow): number {
  const leftEditing = left.status === 'editing'
  const rightEditing = right.status === 'editing'
  if (leftEditing !== rightEditing) return leftEditing ? -1 : 1
  const leftTime = leftEditing
    ? left.attentionRequestedAt
    : left.lifecycleActivityAt
  const rightTime = rightEditing
    ? right.attentionRequestedAt
    : right.lifecycleActivityAt
  return rightTime - leftTime || left.reviewId.localeCompare(right.reviewId)
}

function compareActionable(
  left: { editingCount: number; latestAttentionAt: number; latestActivityAt: number; key: string },
  right: { editingCount: number; latestAttentionAt: number; latestActivityAt: number; key: string }
): number {
  const leftActionable = left.editingCount > 0
  const rightActionable = right.editingCount > 0
  if (leftActionable !== rightActionable) return leftActionable ? -1 : 1
  const leftTime = leftActionable ? left.latestAttentionAt : left.latestActivityAt
  const rightTime = rightActionable ? right.latestAttentionAt : right.latestActivityAt
  return rightTime - leftTime || left.key.localeCompare(right.key)
}

function threadProjection(
  key: string,
  reviews: ReviewInboxRow[]
): ReviewInboxThread {
  const ordered = [...reviews].sort(compareRows)
  const first = ordered[0]
  if (!first) throw new Error(`Review thread ${key} cannot be empty.`)
  const editing = ordered.filter((review) => review.status === 'editing')
  return {
    editingCount: editing.length,
    key,
    latestActivityAt: Math.max(...ordered.map((review) => review.lifecycleActivityAt)),
    latestAttentionAt: editing.length
      ? Math.max(...editing.map((review) => review.attentionRequestedAt))
      : 0,
    local: first.local,
    provider: first.provider,
    reviews: ordered,
    title: first.local ? 'Local reviews' : first.title,
    titleSource: first.local ? 'document-name' : first.titleSource
  }
}

function projectProjection(
  key: string,
  rows: ReviewInboxRow[],
  sessions: ReviewSession[]
): ReviewInboxProject {
  const byThread = new Map<string, ReviewInboxRow[]>()
  for (const row of rows) {
    const reviews = byThread.get(row.threadKey) || []
    reviews.push(row)
    byThread.set(row.threadKey, reviews)
  }
  const threads = [...byThread.entries()]
    .map(([threadKey, reviews]) => threadProjection(threadKey, reviews))
    .sort(compareActionable)
  const editing = rows.filter((row) => row.status === 'editing')
  const firstSession = sessions.find((session) => session.projectKey === key)
  if (!firstSession) throw new Error(`Review project ${key} cannot be empty.`)
  return {
    editingCount: editing.length,
    key,
    latestActivityAt: Math.max(...rows.map((row) => row.lifecycleActivityAt)),
    latestAttentionAt: editing.length
      ? Math.max(...editing.map((row) => row.attentionRequestedAt))
      : 0,
    name: firstSession.projectName,
    root: firstSession.projectRoot,
    threads
  }
}

export function projectReviewInbox(
  sessions: ReviewSession[]
): ReviewInboxProjection {
  const rows = sessions.map(rowFromSession)
  const byProject = new Map<string, ReviewInboxRow[]>()
  for (const row of rows) {
    const projectRows = byProject.get(row.projectKey) || []
    projectRows.push(row)
    byProject.set(row.projectKey, projectRows)
  }
  return {
    editing: rows
      .filter((row) => row.status === 'editing')
      .sort(compareRows),
    history: rows
      .filter((row) => row.status !== 'editing')
      .sort(compareRows),
    projects: [...byProject.entries()]
      .map(([key, projectRows]) => projectProjection(key, projectRows, sessions))
      .sort(compareActionable)
  }
}

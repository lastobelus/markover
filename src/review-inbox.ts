import {
  pullRequestObservation,
  type PullRequestStatus
} from './pull-request'
import { isCodexProvider } from './provider-identity'

export type ReviewTitleSource =
  | 'thread-title'
  | 'thread-id'
  | 'context-summary'
  | 'document-name'

export interface ReviewInboxRow {
  agentThreadId: string | null
  attentionRequestedAt: number
  branch: string | null
  commit: string | null
  contextPath: string | null
  createdAt: string
  documentName: string
  lifecycleActivityAt: number
  local: boolean
  machine: string | null
  projectKey: string
  projectName: string
  projectRoot: string | null
  projectEvidence: ReviewProjectEvidence
  provider: string | null
  pullRequestNumber: number | null
  pullRequestUrl: string | null
  pullRequestStatus: PullRequestStatus | null
  pullRequestStatusObservedAt: string | null
  pullRequestStatusSource: string | null
  reviewId: string
  requestingThreadId: string | null
  requestingThreadTitle: string | null
  requestingThreadTitleStatus: 'available' | 'unavailable' | 'not-observed' | 'not-applicable'
  repositoryUrl: string | null
  sourcePath: string | null
  sourceState: ReviewSourceState
  status: ReviewSessionStatus
  threadKey: string
  threadHostKind: string | null
  threadHostThreadId: string | null
  title: string
  titleSource: ReviewTitleSource
  updatedAt: string
}

export interface ReviewInboxThread {
  editingCount: number
  key: string
  latestActivityAt: number
  latestAttentionAt: number
  local: boolean
  machine: string | null
  provider: string | null
  requestingThreadId: string | null
  threadHostKind: string | null
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

export type ReviewMetadataKey =
  | 'project'
  | 'source-path'
  | 'source-state'
  | 'repository'
  | 'branch'
  | 'commit'
  | 'pull-request'
  | 'pull-request-status'
  | 'requesting-thread'
  | 'requesting-thread-title'
  | 'thread-host'
  | 'provider'
  | 'host-thread'
  | 'machine'
  | 'review-status'
  | 'created'
  | 'updated'
  | 'attention-requested'

export interface ReviewMetadataField {
  error: boolean
  key: ReviewMetadataKey
  label: string
  value: string
}

export interface ReviewMetadataInventory {
  fields: ReviewMetadataField[]
  issues: string[]
}

export interface ReviewInboxTitleSources {
  codexThreadTitleStatus?: CodexThreadTitleStatus
  codexThreadTitles?: readonly CodexThreadTitle[]
  t3ThreadTitleStatus?: T3ThreadTitleStatus
  t3ThreadTitles?: readonly T3ThreadTitle[]
  titlePreference?: InboxTitlePreference
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

function dateValue(value: string | number): string | null {
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : null
}

export function reviewMetadataInventory(
  row: ReviewInboxRow
): ReviewMetadataInventory {
  const fields: ReviewMetadataField[] = []
  const issues: string[] = []
  const add = (
    key: ReviewMetadataKey,
    label: string,
    value: string | null,
    absent: 'missing' | 'unavailable' | 'not-observed' | 'not-applicable' = 'missing',
    error = false
  ): void => {
    const absentValue = absent === 'not-applicable'
      ? 'Not applicable'
      : absent === 'not-observed'
        ? 'Not observed'
        : absent === 'unavailable'
          ? 'Unavailable'
          : 'Missing'
    const fieldError = error || (!value && absent !== 'not-applicable')
    fields.push({ key, label, value: value || absentValue, error: fieldError })
    if (!value && fieldError) {
      issues.push(`${label} is ${absentValue.toLowerCase()}.`)
    }
  }

  add(
    'project',
    'Project',
    row.projectName,
    'unavailable',
    row.projectEvidence !== 'verified'
  )
  add('source-path', 'Source path', row.sourcePath)
  const sourceState = row.sourceState === 'unchanged'
    ? 'Unchanged since review opened'
    : row.sourceState === 'changed'
      ? 'Source changed since review opened'
      : row.sourceState === 'missing'
        ? 'Source is missing at its recorded path'
        : 'Source status unavailable'
  add(
    'source-state',
    'Source state',
    sourceState,
    'unavailable',
    row.sourceState !== 'unchanged'
  )
  add('repository', 'Repository', row.repositoryUrl)
  add(
    'branch',
    'Branch',
    row.branch,
    row.repositoryUrl ? 'missing' : 'not-applicable'
  )
  add(
    'commit',
    'Commit',
    row.commit,
    row.repositoryUrl ? 'missing' : 'not-applicable'
  )
  add(
    'pull-request',
    'Pull request',
    row.pullRequestNumber
      ? `#${String(row.pullRequestNumber)}${row.pullRequestUrl ? ` · ${row.pullRequestUrl}` : ''}`
      : null,
    'not-applicable'
  )
  add(
    'pull-request-status',
    'Pull request status',
    row.pullRequestStatus
      ? `${row.pullRequestStatus}${row.pullRequestStatusSource ? ` via ${row.pullRequestStatusSource}` : ''}${row.pullRequestStatusObservedAt ? ` · ${row.pullRequestStatusObservedAt}` : ''}`
      : null,
    row.pullRequestNumber ? 'not-observed' : 'not-applicable'
  )
  add(
    'requesting-thread',
    'Requesting thread',
    row.local ? null : row.agentThreadId,
    row.local ? 'not-applicable' : 'missing'
  )
  add(
    'requesting-thread-title',
    'Requesting thread title',
    row.requestingThreadTitle,
    row.requestingThreadTitleStatus === 'available'
      ? 'unavailable'
      : row.requestingThreadTitleStatus
  )
  add(
    'thread-host',
    'Thread host',
    row.local ? null : row.threadHostKind,
    row.local ? 'not-applicable' : 'missing'
  )
  add(
    'provider',
    'Provider',
    row.local ? null : row.provider,
    row.local ? 'not-applicable' : 'missing'
  )
  add(
    'host-thread',
    'Distinct host thread',
    row.local ? null : row.threadHostThreadId,
    'not-applicable'
  )
  add(
    'machine',
    'Machine',
    row.local ? null : row.machine,
    row.local ? 'not-applicable' : 'missing'
  )
  add('review-status', 'Review status', row.status)
  add('created', 'Created', dateValue(row.createdAt))
  add('updated', 'Updated', dateValue(row.updatedAt))
  add(
    'attention-requested',
    'Attention requested',
    dateValue(row.attentionRequestedAt),
    row.status === 'editing' ? 'missing' : 'not-applicable'
  )

  if (row.projectEvidence === 'conflict') {
    issues.unshift('Source now belongs to a different repository.')
  } else if (row.projectEvidence === 'unavailable') {
    issues.unshift('Live repository evidence is unavailable.')
  }
  if (row.sourceState === 'changed') {
    issues.unshift('Source changed since review opened.')
  } else if (row.sourceState === 'missing') {
    issues.unshift('Source is missing at its recorded path.')
  } else if (row.sourceState === 'unavailable') {
    issues.unshift('Source status is unavailable.')
  }

  return { fields, issues: [...new Set(issues)] }
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
  local: boolean,
  requestingThreadTitle: string | null,
  titlePreference: InboxTitlePreference
): Pick<ReviewInboxRow, 'title' | 'titleSource'> {
  if (
    requestingThreadTitle &&
    !local &&
    titlePreference === 'requesting-thread-title'
  ) {
    return { title: requestingThreadTitle, titleSource: 'thread-title' }
  }
  const contextSummary = session.tree.review.contextSummary.trim()
  if (contextSummary && !local) {
    return { title: contextSummary, titleSource: 'context-summary' }
  }
  return {
    title: session.documentName,
    titleSource: 'document-name'
  }
}

function rowFromSession(
  session: ReviewSession,
  t3Titles: ReadonlyMap<string, string>,
  codexTitles: ReadonlyMap<string, string>,
  t3ThreadTitleStatus: T3ThreadTitleStatus,
  codexThreadTitleStatus: CodexThreadTitleStatus,
  titlePreference: InboxTitlePreference
): ReviewInboxRow {
  const review = session.tree.review
  const agentThread = review.agentThread
  const threadHost = isRecord(agentThread) && isRecord(agentThread.threadHost)
    ? agentThread.threadHost
    : null
  const provider = stringField(threadHost, ['provider'])
  const threadHostKind = stringField(threadHost, ['kind'])
  const agentThreadId = stringField(agentThread, ['id'])
  const threadHostThreadId = stringField(threadHost, ['threadId'])
  const requestingThreadId = threadHostThreadId || agentThreadId
  const threadHostTitle = (
    threadHostKind?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') === 't3code' &&
    requestingThreadId
  ) ? t3Titles.get(requestingThreadId) || null : null
  const providerTitle = (
    isCodexProvider(provider) &&
    agentThreadId
  ) ? codexTitles.get(agentThreadId) || null : null
  const requestingThreadTitle = threadHostTitle || providerTitle
  const machine = stringField(threadHost, ['machine'])
  const local = review.origin === 'local'
  const title = rowTitle(
    session,
    local,
    requestingThreadTitle,
    titlePreference
  )
  const branch = stringField(review.git, ['branch'])
  const pullRequestNumber = numberField(review.pullRequest, 'number')
  const pullRequestState = pullRequestObservation(review.pullRequest)
  const titleSources = [
    threadHostKind?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') === 't3code'
      ? t3ThreadTitleStatus
      : null,
    isCodexProvider(provider) ? codexThreadTitleStatus : null
  ].filter((status): status is T3ThreadTitleStatus | CodexThreadTitleStatus => Boolean(status))
  const requestingThreadTitleStatus = local
    ? 'not-applicable'
    : requestingThreadTitle
      ? 'available'
      : titleSources.includes('available')
        ? 'not-observed'
        : 'unavailable'
  const threadKey = local
    ? `local:${session.projectKey}`
    : threadHostThreadId
      ? `${threadHostKind || 'thread-host'}:${threadHostThreadId}`
      : agentThreadId
      ? `${threadHostKind || 'thread-host'}:${agentThreadId}`
      : `review:${session.reviewId}`

  return {
    agentThreadId,
    attentionRequestedAt: session.attentionRequestedAt,
    branch,
    commit: stringField(review.git, ['commit']),
    contextPath: relativeDocumentPath(session),
    createdAt: review.createdAt,
    documentName: session.documentName,
    lifecycleActivityAt: session.lifecycleActivityAt,
    local,
    machine,
    projectKey: session.projectKey,
    projectName: session.projectName,
    projectRoot: session.projectRoot,
    projectEvidence: session.projectEvidence,
    provider,
    pullRequestNumber,
    pullRequestUrl: stringField(review.pullRequest, ['url']),
    pullRequestStatus: pullRequestState?.status ?? null,
    pullRequestStatusObservedAt: pullRequestState?.statusObservedAt ?? null,
    pullRequestStatusSource: pullRequestState?.statusSource ?? null,
    reviewId: session.reviewId,
    requestingThreadId,
    requestingThreadTitle,
    requestingThreadTitleStatus,
    repositoryUrl: stringField(review.git, ['repositoryUrl']),
    sourcePath: session.documentPath,
    sourceState: session.sourceState,
    status: review.status,
    threadKey,
    threadHostKind,
    threadHostThreadId,
    updatedAt: review.updatedAt,
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
  const titledReview = ordered.find((review) => review.requestingThreadTitle)
  return {
    editingCount: editing.length,
    key,
    latestActivityAt: Math.max(...ordered.map((review) => review.lifecycleActivityAt)),
    latestAttentionAt: editing.length
      ? Math.max(...editing.map((review) => review.attentionRequestedAt))
      : 0,
    local: first.local,
    machine: first.machine,
    provider: first.provider,
    requestingThreadId: first.requestingThreadId,
    threadHostKind: first.threadHostKind,
    reviews: ordered,
    title: first.local
      ? 'Local reviews'
      : titledReview?.requestingThreadTitle ||
        first.requestingThreadId ||
        'Thread title unavailable',
    titleSource: first.local
      ? 'document-name'
      : titledReview ? 'thread-title' : (
          first.requestingThreadId ? 'thread-id' : 'document-name'
        )
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
  const projectSessions = sessions.filter((session) => session.projectKey === key)
  const firstSession = projectSessions[0]
  if (!firstSession) throw new Error(`Review project ${key} cannot be empty.`)
  const roots = new Set(projectSessions.map((session) => session.projectRoot))
  return {
    editingCount: editing.length,
    key,
    latestActivityAt: Math.max(...rows.map((row) => row.lifecycleActivityAt)),
    latestAttentionAt: editing.length
      ? Math.max(...editing.map((row) => row.attentionRequestedAt))
      : 0,
    name: firstSession.projectName,
    root: roots.size === 1 ? firstSession.projectRoot : null,
    threads
  }
}

export function projectReviewInbox(
  sessions: ReviewSession[],
  {
    codexThreadTitleStatus = 'disabled',
    codexThreadTitles = [],
    t3ThreadTitleStatus = 'disabled',
    t3ThreadTitles = [],
    titlePreference = 'review-purpose'
  }: ReviewInboxTitleSources = {}
): ReviewInboxProjection {
  const t3Titles = new Map(
    t3ThreadTitles.map(({ threadId, title }) => [threadId, title])
  )
  const codexTitles = new Map(
    codexThreadTitles.map(({ threadId, title }) => [threadId, title])
  )
  const rows = sessions.map((session) => (
    rowFromSession(
      session,
      t3Titles,
      codexTitles,
      t3ThreadTitleStatus,
      codexThreadTitleStatus,
      titlePreference
    )
  ))
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

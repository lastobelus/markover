import { spawnSync } from 'node:child_process'

export const decisionGardenerOwnershipSchemaVersion = 1 as const
export const decisionGardenerPublicationMarker =
  '<!-- decision-gardener-publication: v1 -->'

const trustedAssociations = new Set(['COLLABORATOR', 'MEMBER', 'OWNER'])
const workIntentMarker = '<!-- start-issue-work-intent -->'

export interface GitHubCommandResult {
  status: number
  stderr: string
  stdout: string
}

export type GitHubCommandRunner = (
  repository: string,
  args: readonly string[]
) => GitHubCommandResult

export interface DecisionGardenerWorkIntent {
  association: 'COLLABORATOR' | 'MEMBER' | 'OWNER'
  author: string
  body: string
  createdAt: string
  id: number
  url: string
}

export interface DecisionGardenerOwnershipItem {
  assignees: readonly string[]
  body: string
  labels: readonly string[]
  milestone: string | null
  number: number
  state: 'open'
  title: string
  type: 'issue' | 'pull_request'
  url: string
  workIntents: readonly DecisionGardenerWorkIntent[]
}

export interface DecisionGardenerOwnershipSnapshot {
  capturedAt: string
  items: readonly DecisionGardenerOwnershipItem[]
  repository: string
  schemaVersion: typeof decisionGardenerOwnershipSchemaVersion
  source: 'github-rest'
}

interface GitHubIssueRecord {
  assignees?: readonly { login?: unknown }[]
  body?: unknown
  comments?: unknown
  html_url?: unknown
  labels?: readonly ({ name?: unknown } | string)[]
  milestone?: { title?: unknown } | null
  number?: unknown
  pull_request?: unknown
  state?: unknown
  title?: unknown
}

interface GitHubCommentRecord {
  author_association?: unknown
  body?: unknown
  created_at?: unknown
  html_url?: unknown
  id?: unknown
  user?: { login?: unknown }
}

export const runGitHubCommand: GitHubCommandRunner = (repository, args) => {
  const result = spawnSync('gh', [...args], {
    cwd: repository,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
  if (result.error) throw result.error
  return {
    status: result.status ?? 1,
    stderr: result.stderr,
    stdout: result.stdout
  }
}

function requireGitHub(
  runner: GitHubCommandRunner,
  repository: string,
  args: readonly string[],
  label: string
): string {
  assertReadOnlyGitHubArgs(args)
  const result = runner(repository, args)
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
}

export function assertReadOnlyGitHubArgs(args: readonly string[]): void {
  if (
    args[0] === 'repo' && args[1] === 'view' && args[2] === '--json' &&
    args.length === 4
  ) return
  if (
    args[0] === 'api' && args[1] === '--paginate' && args[2] === '--slurp' &&
    args.length === 4 && args[3]?.startsWith('repos/') === true
  ) return
  throw new Error(`Decision-gardener GitHub discovery rejected a non-read-only command: ${args.join(' ')}`)
}

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown
  } catch (error) {
    throw new Error(`${label} returned invalid JSON.`, { cause: error })
  }
}

function paginatedRecords(source: string, label: string): unknown[] {
  const pages = parseJson(source, label)
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    throw new Error(`${label} did not return paginated JSON arrays.`)
  }
  return pages.flatMap((page) => page as unknown[])
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is missing or invalid.`)
  }
  return value
}

function requiredInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} is missing or invalid.`)
  }
  return Number(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseWorkIntent(value: unknown): DecisionGardenerWorkIntent | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GitHub returned an invalid issue comment.')
  }
  const comment = value as GitHubCommentRecord
  if (typeof comment.body !== 'string' || !comment.body.includes(workIntentMarker)) {
    return null
  }
  if (
    typeof comment.author_association !== 'string' ||
    !trustedAssociations.has(comment.author_association)
  ) return null
  const association = comment.author_association as DecisionGardenerWorkIntent['association']
  return {
    association,
    author: requiredString(comment.user?.login, 'Work-intent author'),
    body: comment.body,
    createdAt: requiredString(comment.created_at, 'Work-intent creation time'),
    id: requiredInteger(comment.id, 'Work-intent comment ID'),
    url: requiredString(comment.html_url, 'Work-intent URL')
  }
}

function stringNames(
  values: readonly unknown[] | undefined,
  label: string
): string[] {
  if (values === undefined) return []
  if (!Array.isArray(values)) throw new Error(`${label} is invalid.`)
  return values.map((value) => {
    if (typeof value === 'string') return requiredString(value, label)
    if (!isRecord(value)) throw new Error(`${label} is invalid.`)
    return requiredString(value.name, label)
  }).sort()
}

function assigneeNames(values: readonly { login?: unknown }[] | undefined): string[] {
  if (values === undefined) return []
  if (!Array.isArray(values)) throw new Error('GitHub issue assignees are invalid.')
  return values.map(({ login }) => requiredString(login, 'GitHub assignee')).sort()
}

function parseIssue(value: unknown): GitHubIssueRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GitHub returned an invalid open issue or pull request.')
  }
  return value
}

export function collectGitHubOwnershipSnapshot({
  capturedAt = new Date().toISOString(),
  maxBytes = 512 * 1024,
  repository,
  runner = runGitHubCommand
}: {
  capturedAt?: string
  maxBytes?: number
  repository: string
  runner?: GitHubCommandRunner
}): DecisionGardenerOwnershipSnapshot {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('The ownership snapshot byte limit must be a positive safe integer.')
  }
  const repoValue = parseJson(requireGitHub(
    runner,
    repository,
    ['repo', 'view', '--json', 'nameWithOwner,url'],
    'Resolve the GitHub repository'
  ), 'Resolve the GitHub repository')
  if (repoValue === null || typeof repoValue !== 'object' || Array.isArray(repoValue)) {
    throw new Error('GitHub returned invalid repository metadata.')
  }
  const nameWithOwner = requiredString(
    (repoValue as { nameWithOwner?: unknown }).nameWithOwner,
    'GitHub repository name'
  )
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(nameWithOwner)) {
    throw new Error(`GitHub returned an unsafe repository name: ${nameWithOwner}`)
  }
  const records = paginatedRecords(requireGitHub(
    runner,
    repository,
    ['api', '--paginate', '--slurp', `repos/${nameWithOwner}/issues?state=open&per_page=100`],
    'Read open GitHub work items'
  ), 'Read open GitHub work items')
  const items: DecisionGardenerOwnershipItem[] = []
  for (const value of records) {
    const issue = parseIssue(value)
    const number = requiredInteger(issue.number, 'GitHub work-item number')
    if (issue.state !== 'open') {
      throw new Error(`GitHub work item #${String(number)} is not open.`)
    }
    const commentCount = issue.comments === undefined ? 0 : Number(issue.comments)
    if (!Number.isSafeInteger(commentCount) || commentCount < 0) {
      throw new Error(`GitHub work item #${String(number)} has an invalid comment count.`)
    }
    const workIntents = commentCount === 0
      ? []
      : paginatedRecords(requireGitHub(
          runner,
          repository,
          ['api', '--paginate', '--slurp',
            `repos/${nameWithOwner}/issues/${String(number)}/comments?per_page=100`],
          `Read GitHub work-item #${String(number)} comments`
        ), `Read GitHub work-item #${String(number)} comments`)
        .map(parseWorkIntent)
        .filter((intent): intent is DecisionGardenerWorkIntent => intent !== null)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id - right.id)
    items.push({
      assignees: assigneeNames(issue.assignees),
      body: typeof issue.body === 'string' ? issue.body : '',
      labels: stringNames(issue.labels, 'GitHub label'),
      milestone: issue.milestone === null || issue.milestone === undefined
        ? null
        : requiredString(issue.milestone.title, 'GitHub milestone'),
      number,
      state: 'open',
      title: requiredString(issue.title, `GitHub work-item #${String(number)} title`),
      type: issue.pull_request === undefined ? 'issue' : 'pull_request',
      url: requiredString(issue.html_url, `GitHub work-item #${String(number)} URL`),
      workIntents
    })
  }
  items.sort((left, right) => left.number - right.number)
  const snapshot: DecisionGardenerOwnershipSnapshot = {
    capturedAt,
    items,
    repository: nameWithOwner,
    schemaVersion: decisionGardenerOwnershipSchemaVersion,
    source: 'github-rest'
  }
  const bytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(
      `The GitHub ownership snapshot is ${String(bytes)} bytes; the limit is ${String(maxBytes)}.`
    )
  }
  return snapshot
}

export function findOpenGardenerPublication(
  snapshot: DecisionGardenerOwnershipSnapshot
): DecisionGardenerOwnershipItem | null {
  return snapshot.items.find((item) =>
    item.type === 'pull_request' && item.body.includes(decisionGardenerPublicationMarker)
  ) ?? null
}

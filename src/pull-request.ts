export type PullRequestStatus = 'draft' | 'open' | 'merged' | 'closed'

export interface GitHubPullRequestIdentity {
  number: number
  repository: string
  url: string
}

export interface PullRequestObservation {
  status: PullRequestStatus
  statusObservedAt: string
  statusSource: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isPullRequestStatus(value: unknown): value is PullRequestStatus {
  return value === 'draft' ||
    value === 'open' ||
    value === 'merged' ||
    value === 'closed'
}

export function githubRepositoryIdentity(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const remote = value.trim()
  const scp = /^(?:[^@]+@)?github\.com:([^/]+)\/(.+)$/i.exec(remote)
  if (scp) {
    return repositoryIdentity(scp[1] as string, scp[2] as string)
  }

  let parsed: URL
  try {
    parsed = new URL(remote)
  } catch {
    return null
  }
  if (parsed.hostname.toLowerCase() !== 'github.com') return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 2) return null
  return repositoryIdentity(segments[0] as string, segments[1] as string)
}

function repositoryIdentity(owner: string, repository: string): string | null {
  const normalizedOwner = owner.trim()
  const normalizedRepository = repository.trim().replace(/\.git$/i, '')
  if (!normalizedOwner || !normalizedRepository) return null
  return `${normalizedOwner.toLowerCase()}/${normalizedRepository.toLowerCase()}`
}

export function parseGitHubPullRequestUrl(
  value: unknown
): GitHubPullRequestIdentity | null {
  if (typeof value !== 'string' || !value.trim()) return null
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
    return null
  }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/.exec(
    parsed.pathname
  )
  if (!match) return null
  const repository = repositoryIdentity(
    match[1] as string,
    match[2] as string
  )
  if (!repository) return null
  const number = Number(match[3])
  return {
    number,
    repository,
    url: `https://github.com/${repository}/pull/${String(number)}`
  }
}

export function reviewPullRequestIdentity(
  pullRequest: unknown,
  git: unknown
): GitHubPullRequestIdentity | null {
  if (!isRecord(pullRequest)) return null
  if (
    typeof pullRequest.number !== 'number' ||
    !Number.isSafeInteger(pullRequest.number) ||
    pullRequest.number < 1
  ) return null

  const explicit = parseGitHubPullRequestUrl(pullRequest.url)
  if (Object.prototype.hasOwnProperty.call(pullRequest, 'url')) {
    return explicit?.number === pullRequest.number ? explicit : null
  }
  if (!isRecord(git)) return null
  const repository = githubRepositoryIdentity(git.repositoryUrl)
  if (!repository) return null
  return {
    number: pullRequest.number,
    repository,
    url: `https://github.com/${repository}/pull/${String(pullRequest.number)}`
  }
}

export function canonicalPullRequestMetadata(
  pullRequest: unknown,
  git: unknown
): Record<string, unknown> | null {
  const identity = reviewPullRequestIdentity(pullRequest, git)
  if (!identity || !isRecord(pullRequest)) return null
  return {
    ...pullRequest,
    number: identity.number,
    url: identity.url
  }
}

export function pullRequestObservation(
  pullRequest: unknown
): PullRequestObservation | null {
  if (!isRecord(pullRequest)) return null
  const hasStatus = Object.prototype.hasOwnProperty.call(pullRequest, 'status')
  const hasObservedAt = Object.prototype.hasOwnProperty.call(
    pullRequest,
    'statusObservedAt'
  )
  const hasSource = Object.prototype.hasOwnProperty.call(
    pullRequest,
    'statusSource'
  )
  if (!hasStatus && !hasObservedAt && !hasSource) return null
  if (
    !hasStatus ||
    !hasObservedAt ||
    !hasSource ||
    !isPullRequestStatus(pullRequest.status) ||
    typeof pullRequest.statusObservedAt !== 'string' ||
    !pullRequest.statusObservedAt ||
    typeof pullRequest.statusSource !== 'string' ||
    !pullRequest.statusSource.trim()
  ) return null
  const observedAt = new Date(pullRequest.statusObservedAt)
  if (
    Number.isNaN(observedAt.valueOf()) ||
    observedAt.toISOString() !== pullRequest.statusObservedAt
  ) return null
  return {
    status: pullRequest.status,
    statusObservedAt: pullRequest.statusObservedAt,
    statusSource: pullRequest.statusSource
  }
}

export function hasPullRequestObservationFields(value: unknown): boolean {
  return isRecord(value) && (
    Object.prototype.hasOwnProperty.call(value, 'status') ||
    Object.prototype.hasOwnProperty.call(value, 'statusObservedAt') ||
    Object.prototype.hasOwnProperty.call(value, 'statusSource')
  )
}

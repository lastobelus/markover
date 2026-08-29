import * as childProcess from 'node:child_process'

import {
  readGitHubCi,
  type GitHubCiEvidence
} from './markover-github-ci'

const GITHUB_REPOSITORY = process.env.MARKOVER_GITHUB_REPOSITORY ?? 'lastobelus/markover'
const BASE_BRANCH = 'main'
const CODEX_LOGINS = new Set([
  'chatgpt-codex-connector',
  'chatgpt-codex-connector[bot]'
])
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const POLL_INTERVAL_MILLISECONDS = 60_000
const COMMAND_TIMEOUT_MILLISECONDS = 30_000
export const CI_REGISTRATION_TIMEOUT_MILLISECONDS = 10 * 60_000
export const MERGE_RECOMPUTE_TIMEOUT_MILLISECONDS = 10 * 60_000
export const REVIEW_TIMEOUT_MILLISECONDS = 30 * 60_000

interface PullRequestState {
  number: number
  url: string
  state: string
  isDraft: boolean
  headRefOid: string
  baseRefOid: string
  baseRefName: string
  mergeable: string
  mergeStateStatus: string
  potentialMergeCommit?: { oid?: string } | null
}

interface GitHubActor {
  login?: string
}

interface FormalReview {
  id: number
  user?: GitHubActor
  body?: string
  state?: string
  commit_id?: string | null
  submitted_at?: string | null
}

interface IssueComment {
  id: number
  user?: GitHubActor
  author_association?: string
  body?: string
  created_at?: string
  updated_at?: string
}

interface ReviewComment {
  id: number
  user?: GitHubActor
  commit_id?: string | null
  created_at?: string
}

interface Reaction {
  id: number
  user?: GitHubActor
  content?: string
  created_at?: string
}

export interface ReviewArtifact {
  key: string
  observedAt: string
}

export interface ReviewState {
  terminalArtifacts: ReadonlyArray<ReviewArtifact>
  requestPresent: boolean
  pending: boolean
  ready: boolean
  latestTriggerId: number | null
}

export interface LocalState {
  branch: string
  head: string
  clean: boolean
}

export interface WaitObservation {
  pullRequest: PullRequestState
  ci: GitHubCiEvidence
  review: ReviewState
  unresolvedReviewThreads: number
  local: LocalState
}

export type WaitDecision =
  | {
      kind: 'wait'
      reason: 'ci-pending' | 'ci-registration' | 'mergeability-pending' | 'review-pending'
    }
  | {
      kind: 'wake'
      reason:
        | 'base-changed'
        | 'ci-configuration'
        | 'ci-failed'
        | 'ci-registration-timeout'
        | 'head-changed'
        | 'local-head-changed'
        | 'merge-blocked'
        | 'merge-recompute-timeout'
        | 'pr-changed'
        | 'pr-closed'
        | 'pr-draft'
        | 'ready'
        | 'review-not-requested'
        | 'review-timeout'
        | 'review-unhandled'
        | 'review-unresolved'
        | 'unexpected-base'
        | 'worktree-changed'
      detail: string
    }

export function pullRequestViewArgs(
  repository: string,
  branch: string
): ReadonlyArray<string> {
  if (branch.length === 0) throw new Error('Wait for PR requires a checked-out branch.')
  return [
    'pr',
    'view',
    branch,
    '--repo',
    repository,
    '--json',
    'number,url,state,isDraft,headRefOid,baseRefOid,baseRefName,mergeable,mergeStateStatus,potentialMergeCommit'
  ]
}

export function samePullRequestRevision(
  initial: Pick<PullRequestState, 'number' | 'headRefOid' | 'baseRefOid'>,
  final: Pick<PullRequestState, 'number' | 'headRefOid' | 'baseRefOid'>
): boolean {
  return initial.number === final.number &&
    initial.headRefOid === final.headRefOid &&
    initial.baseRefOid === final.baseRefOid
}

const REVIEW_THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!,$endCursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:100,after:$endCursor){
        nodes{id isResolved}
        pageInfo{hasNextPage endCursor}
      }
    }
  }
}`

export function reviewThreadsArgs(
  repository: string,
  pullRequestNumber: number
): ReadonlyArray<string> {
  const [owner, name, ...rest] = repository.split('/')
  if (!owner || !name || rest.length > 0) {
    throw new Error(`Invalid GitHub repository: ${repository}`)
  }
  return [
    'api',
    'graphql',
    '--paginate',
    '--slurp',
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
    '-F',
    `number=${pullRequestNumber}`,
    '-f',
    `query=${REVIEW_THREADS_QUERY}`
  ]
}

function timestamp(value: string | null | undefined): number {
  const parsed = value === null || value === undefined ? Number.NaN : Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function isCodex(login: string | undefined): boolean {
  return login !== undefined && CODEX_LOGINS.has(login)
}

function currentHeadMatches(candidate: string | null | undefined, headSha: string): boolean {
  return typeof candidate === 'string' &&
    candidate.length >= 7 &&
    headSha.startsWith(candidate)
}

function reviewedCommitFromBody(body: string | undefined): string | null {
  if (!body?.startsWith('Codex Review:')) return null
  return /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`/i.exec(body)?.[1] ?? null
}

function cleanReviewedCommitFromBody(body: string | undefined): string | null {
  if (!/^Codex Review: Didn['’]t find any major issues\./.test(body ?? '')) return null
  return reviewedCommitFromBody(body)
}

function summaryCommit(body: string | undefined, completedOnly: boolean): string | null {
  if (!(body ?? '').includes('<!-- codex-pull-request-review-summary -->')) return null
  const rows = (body ?? '').split('\n')
  for (const row of rows) {
    if (completedOnly && !row.includes('Completed')) continue
    const commit = /\|\s*`([0-9a-f]{7,40})`\s*\|/.exec(row)?.[1]
    if (commit) return commit
  }
  return null
}

function isGenericFormalReviewWrapper(body: string | undefined): boolean {
  return (body ?? '').includes('### 💡 Codex Review') &&
    (body ?? '').includes('Here are some automated review suggestions for this pull request.')
}

function requestedHeadFromBody(body: string | undefined): string | null {
  return /^@codex review\s*\n<!-- markover-review-head: ([0-9a-f]{40}) -->\s*$/i.exec(
    body ?? ''
  )?.[1] ?? null
}

function handledArtifactFromBody(body: string | undefined, headSha: string): string | null {
  const match = /^<!-- markover-review-handled: ((?:comment|review):\d+) head: ([0-9a-f]{40}) -->$/i.exec(
    body ?? ''
  )
  return match?.[2] === headSha ? (match[1] ?? null) : null
}

export function latestCodexReviewTrigger(
  comments: ReadonlyArray<IssueComment>,
  headSha: string
): IssueComment | null {
  return comments
    .filter((comment) =>
      !isCodex(comment.user?.login) &&
      TRUSTED_ASSOCIATIONS.has(comment.author_association ?? '') &&
      currentHeadMatches(requestedHeadFromBody(comment.body), headSha)
    )
    .sort((left, right) =>
      timestamp(right.created_at) - timestamp(left.created_at) || right.id - left.id
    )[0] ?? null
}

function newestReaction(
  reactions: ReadonlyArray<Reaction>,
  content: string
): Reaction | null {
  return reactions
    .filter((reaction) => isCodex(reaction.user?.login) && reaction.content === content)
    .sort((left, right) =>
      timestamp(right.created_at) - timestamp(left.created_at) || right.id - left.id
    )[0] ?? null
}

export function deriveReviewState(input: {
  headSha: string
  formalReviews: ReadonlyArray<FormalReview>
  issueComments: ReadonlyArray<IssueComment>
  reviewComments: ReadonlyArray<ReviewComment>
  triggerReactions: ReadonlyArray<Reaction>
  pullRequestReactions: ReadonlyArray<Reaction>
}): ReviewState {
  const artifacts: ReviewArtifact[] = []
  const readyArtifacts = new Set<string>()

  for (const review of input.formalReviews) {
    const cleanCommit = cleanReviewedCommitFromBody(review.body)
    const clean = review.state === 'APPROVED' || currentHeadMatches(cleanCommit, input.headSha)
    const finding = review.state === 'CHANGES_REQUESTED'
    if (
      isCodex(review.user?.login) &&
      review.state !== 'PENDING' &&
      currentHeadMatches(review.commit_id, input.headSha) &&
      (clean || finding || (Boolean(review.body?.trim()) && !isGenericFormalReviewWrapper(review.body)))
    ) {
      const key = `review:${review.id}`
      artifacts.push({ key, observedAt: review.submitted_at ?? '' })
      if (clean) readyArtifacts.add(key)
    }
  }

  for (const comment of input.reviewComments) {
    if (isCodex(comment.user?.login) && currentHeadMatches(comment.commit_id, input.headSha)) {
      const key = `comment:${comment.id}`
      artifacts.push({ key, observedAt: comment.created_at ?? '' })
      readyArtifacts.add(key)
    }
  }

  let summaryRequest: IssueComment | null = null
  let completedSummary: IssueComment | null = null
  for (const comment of input.issueComments) {
    const reviewedCommit = reviewedCommitFromBody(comment.body)
    if (isCodex(comment.user?.login) && currentHeadMatches(reviewedCommit, input.headSha)) {
      const key = `comment:${comment.id}`
      artifacts.push({ key, observedAt: comment.updated_at ?? comment.created_at ?? '' })
      if (currentHeadMatches(cleanReviewedCommitFromBody(comment.body), input.headSha)) {
        readyArtifacts.add(key)
      }
    }
    if (
      isCodex(comment.user?.login) &&
      currentHeadMatches(summaryCommit(comment.body, false), input.headSha) &&
      (summaryRequest === null || timestamp(comment.updated_at) >= timestamp(summaryRequest.updated_at))
    ) summaryRequest = comment
    if (
      isCodex(comment.user?.login) &&
      currentHeadMatches(summaryCommit(comment.body, true), input.headSha) &&
      (completedSummary === null || timestamp(comment.updated_at) >= timestamp(completedSummary.updated_at))
    ) completedSummary = comment
  }

  const latestTrigger = latestCodexReviewTrigger(input.issueComments, input.headSha)
  const reactions = latestTrigger === null
    ? input.pullRequestReactions
    : input.triggerReactions
  const cleanReaction = newestReaction(reactions, '+1')
  const eyesReaction = newestReaction(reactions, 'eyes')
  const cleanReactionMatches = cleanReaction !== null &&
    (latestTrigger !== null || completedSummary !== null) &&
    (eyesReaction === null ||
      timestamp(cleanReaction.created_at) > timestamp(eyesReaction.created_at) ||
      (timestamp(cleanReaction.created_at) === timestamp(eyesReaction.created_at) &&
        cleanReaction.id >= eyesReaction.id))
  if (cleanReactionMatches) {
    const key = `reaction:${cleanReaction.id}`
    artifacts.push({ key, observedAt: cleanReaction.created_at ?? '' })
    readyArtifacts.add(key)
  }

  const artifactKeys = new Set(artifacts.map(({ key }) => key))
  for (const comment of input.issueComments) {
    if (!TRUSTED_ASSOCIATIONS.has(comment.author_association ?? '')) continue
    const handled = handledArtifactFromBody(comment.body, input.headSha)
    if (handled && artifactKeys.has(handled)) readyArtifacts.add(handled)
  }

  const latestTerminalAt = Math.max(0, ...artifacts.map(({ observedAt }) => timestamp(observedAt)))
  const latestPendingAt = Math.max(
    timestamp(latestTrigger?.created_at),
    timestamp(eyesReaction?.created_at),
    completedSummary === null ? timestamp(summaryRequest?.updated_at) : 0
  )
  const requestPresent = latestTrigger !== null || summaryRequest !== null
  return {
    terminalArtifacts: artifacts,
    requestPresent,
    pending: requestPresent && !cleanReactionMatches && latestTerminalAt <= latestPendingAt,
    ready: artifacts.length > 0 && artifacts.every(({ key }) => readyArtifacts.has(key)),
    latestTriggerId: latestTrigger?.id ?? null
  }
}

export function decideWaitForPr(
  baseline: WaitObservation,
  current: WaitObservation
): WaitDecision {
  const pullRequest = current.pullRequest
  if (!current.local.clean) {
    return {
      kind: 'wake',
      reason: 'worktree-changed',
      detail: 'The worktree became dirty while waiting for pull request gates.'
    }
  }
  if (current.local.branch !== baseline.local.branch || current.local.head !== baseline.local.head) {
    return {
      kind: 'wake',
      reason: 'local-head-changed',
      detail: `Local revision changed from ${baseline.local.branch}@${baseline.local.head} to ${current.local.branch}@${current.local.head}.`
    }
  }
  if (pullRequest.number !== baseline.pullRequest.number) {
    return {
      kind: 'wake',
      reason: 'pr-changed',
      detail: `Checked-out branch now resolves to pull request #${pullRequest.number}, not #${baseline.pullRequest.number}.`
    }
  }
  if (pullRequest.state !== 'OPEN') {
    return {
      kind: 'wake',
      reason: 'pr-closed',
      detail: `Pull request #${pullRequest.number} is ${pullRequest.state.toLowerCase()}.`
    }
  }
  if (pullRequest.isDraft) {
    return {
      kind: 'wake',
      reason: 'pr-draft',
      detail: `Pull request #${pullRequest.number} is still a draft.`
    }
  }
  if (pullRequest.baseRefName !== BASE_BRANCH) {
    return {
      kind: 'wake',
      reason: 'unexpected-base',
      detail: `Pull request #${pullRequest.number} targets ${pullRequest.baseRefName}, not ${BASE_BRANCH}.`
    }
  }
  if (pullRequest.headRefOid !== baseline.pullRequest.headRefOid) {
    return {
      kind: 'wake',
      reason: 'head-changed',
      detail: `PR head changed from ${baseline.pullRequest.headRefOid} to ${pullRequest.headRefOid}.`
    }
  }
  if (pullRequest.baseRefOid !== baseline.pullRequest.baseRefOid) {
    return {
      kind: 'wake',
      reason: 'base-changed',
      detail: `PR base changed from ${baseline.pullRequest.baseRefOid} to ${pullRequest.baseRefOid}.`
    }
  }
  if (
    pullRequest.mergeable === 'CONFLICTING' ||
    pullRequest.mergeStateStatus === 'BEHIND' ||
    pullRequest.mergeStateStatus === 'DIRTY'
  ) {
    return {
      kind: 'wake',
      reason: 'merge-blocked',
      detail: `Pull request #${pullRequest.number} needs attention (${pullRequest.mergeStateStatus}).`
    }
  }
  if (current.ci.state === 'failure') {
    return {
      kind: 'wake',
      reason: current.ci.reason === 'configuration' ? 'ci-configuration' : 'ci-failed',
      detail: current.ci.detail
    }
  }
  if (!current.review.requestPresent) {
    return {
      kind: 'wake',
      reason: 'review-not-requested',
      detail: `No current-head Codex review request or terminal result was found for pull request #${pullRequest.number}.`
    }
  }
  if (current.unresolvedReviewThreads > 0) {
    return {
      kind: 'wake',
      reason: 'review-unresolved',
      detail: `Pull request #${pullRequest.number} has ${current.unresolvedReviewThreads} unresolved review thread${current.unresolvedReviewThreads === 1 ? '' : 's'}.`
    }
  }
  if (!current.review.pending && !current.review.ready) {
    return {
      kind: 'wake',
      reason: 'review-unhandled',
      detail: `Pull request #${pullRequest.number} has an unhandled top-level Codex finding.`
    }
  }
  if (pullRequest.mergeable === 'UNKNOWN' || pullRequest.mergeStateStatus === 'UNKNOWN') {
    return { kind: 'wait', reason: 'mergeability-pending' }
  }
  if (
    current.ci.state === 'satisfied' &&
    !current.review.pending &&
    current.review.ready &&
    pullRequest.mergeStateStatus === 'BLOCKED'
  ) {
    return {
      kind: 'wake',
      reason: 'merge-blocked',
      detail: `Pull request #${pullRequest.number} is blocked by a repository merge requirement.`
    }
  }
  if (current.ci.state === 'satisfied' && !current.review.pending && current.review.ready) {
    return {
      kind: 'wake',
      reason: 'ready',
      detail: `GitHub CI and the handled Codex review are complete for pull request #${pullRequest.number}.`
    }
  }
  if (current.ci.state === 'pending' && current.ci.reason === 'run-registration') {
    return { kind: 'wait', reason: 'ci-registration' }
  }
  if (current.review.pending) return { kind: 'wait', reason: 'review-pending' }
  return { kind: 'wait', reason: 'ci-pending' }
}

export function waitTimeoutClass(
  reason: Extract<WaitDecision, { kind: 'wait' }>['reason']
): 'ci-registration' | 'merge-recompute' | 'review' | null {
  if (reason === 'ci-registration') return 'ci-registration'
  if (reason === 'mergeability-pending') return 'merge-recompute'
  if (reason === 'review-pending') return 'review'
  return null
}

export function decideWaitTimeout(
  reason: Extract<WaitDecision, { kind: 'wait' }>['reason'],
  elapsedMilliseconds: number
): WaitDecision | null {
  if (
    reason === 'ci-registration' &&
    elapsedMilliseconds >= CI_REGISTRATION_TIMEOUT_MILLISECONDS
  ) {
    return {
      kind: 'wake',
      reason: 'ci-registration-timeout',
      detail: `Expected GitHub CI did not register within ${CI_REGISTRATION_TIMEOUT_MILLISECONDS / 60_000} minutes.`
    }
  }
  if (
    reason === 'mergeability-pending' &&
    elapsedMilliseconds >= MERGE_RECOMPUTE_TIMEOUT_MILLISECONDS
  ) {
    return {
      kind: 'wake',
      reason: 'merge-recompute-timeout',
      detail: `GitHub did not establish the PR merge revision within ${MERGE_RECOMPUTE_TIMEOUT_MILLISECONDS / 60_000} minutes.`
    }
  }
  if (
    reason === 'review-pending' &&
    elapsedMilliseconds >= REVIEW_TIMEOUT_MILLISECONDS
  ) {
    return {
      kind: 'wake',
      reason: 'review-timeout',
      detail: `Codex review remained pending for ${REVIEW_TIMEOUT_MILLISECONDS / 60_000} minutes.`
    }
  }
  return null
}

function runGitHubJson(args: ReadonlyArray<string>): unknown {
  const result = childProcess.spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: COMMAND_TIMEOUT_MILLISECONDS,
    maxBuffer: 16 * 1024 * 1024
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh ${args.join(' ')} failed.`)
  }
  return JSON.parse(result.stdout) as unknown
}

function paginatedGitHubApi(endpoint: string): ReadonlyArray<unknown> {
  return (runGitHubJson([
    'api',
    '--paginate',
    '--slurp',
    endpoint
  ]) as ReadonlyArray<ReadonlyArray<unknown>>).flat()
}

interface ReviewThreadsPage {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: ReadonlyArray<{ id?: string, isResolved?: boolean }>
        }
      }
    }
  }
}

function reviewThreadsSnapshot(
  repository: string,
  pullRequestNumber: number
): { unresolvedCount: number, fingerprint: string } {
  const pages = runGitHubJson(
    reviewThreadsArgs(repository, pullRequestNumber)
  ) as ReadonlyArray<ReviewThreadsPage>
  return {
    unresolvedCount: pages.reduce((count, page) =>
      count + (page.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [])
        .filter(({ isResolved }) => isResolved === false).length,
    0),
    fingerprint: JSON.stringify(pages)
  }
}

function runGitText(args: ReadonlyArray<string>): string {
  const result = childProcess.spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: COMMAND_TIMEOUT_MILLISECONDS
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`)
  }
  return result.stdout.trim()
}

function currentBranch(): string {
  const branch = runGitText(['branch', '--show-current'])
  if (branch.length === 0) throw new Error('Wait for PR requires a checked-out branch.')
  return branch
}

function readLocalState(): LocalState {
  return {
    branch: currentBranch(),
    head: runGitText(['rev-parse', 'HEAD']),
    clean: runGitText(['status', '--porcelain=v1', '--untracked-files=all']).length === 0
  }
}

function sameLocalState(left: LocalState, right: LocalState): boolean {
  return left.branch === right.branch &&
    left.head === right.head &&
    left.clean === right.clean
}

export function assertWaitStart(observation: WaitObservation): void {
  if (!observation.local.clean) throw new Error('Wait for PR requires a clean worktree.')
  if (observation.local.head !== observation.pullRequest.headRefOid) {
    throw new Error(
      `Local HEAD ${observation.local.head} does not match PR head ${observation.pullRequest.headRefOid}.`
    )
  }
}

interface ReviewDataSnapshot {
  review: ReviewState
  unresolvedReviewThreads: number
  fingerprint: string
}

function readReviewData(
  repository: string,
  pullRequest: PullRequestState
): ReviewDataSnapshot {
  const issueComments = paginatedGitHubApi(
    `repos/${repository}/issues/${pullRequest.number}/comments?per_page=100`
  ) as ReadonlyArray<IssueComment>
  const latestTrigger = latestCodexReviewTrigger(issueComments, pullRequest.headRefOid)
  const triggerReactions = latestTrigger === null
    ? []
    : paginatedGitHubApi(
      `repos/${repository}/issues/comments/${latestTrigger.id}/reactions?per_page=100`
    ) as ReadonlyArray<Reaction>
  const pullRequestReactions = paginatedGitHubApi(
    `repos/${repository}/issues/${pullRequest.number}/reactions?per_page=100`
  ) as ReadonlyArray<Reaction>
  const formalReviews = paginatedGitHubApi(
    `repos/${repository}/pulls/${pullRequest.number}/reviews?per_page=100`
  ) as ReadonlyArray<FormalReview>
  const reviewComments = paginatedGitHubApi(
    `repos/${repository}/pulls/${pullRequest.number}/comments?per_page=100`
  ) as ReadonlyArray<ReviewComment>
  const reviewThreads = reviewThreadsSnapshot(repository, pullRequest.number)
  return {
    review: deriveReviewState({
      headSha: pullRequest.headRefOid,
      formalReviews,
      issueComments,
      reviewComments,
      triggerReactions,
      pullRequestReactions
    }),
    unresolvedReviewThreads: reviewThreads.unresolvedCount,
    fingerprint: JSON.stringify({
      issueComments,
      triggerReactions,
      pullRequestReactions,
      formalReviews,
      reviewComments,
      reviewThreads: reviewThreads.fingerprint
    })
  }
}

export function requiresReadyConfirmation(observation: WaitObservation): boolean {
  return observation.ci.state === 'satisfied' &&
    !observation.review.pending &&
    observation.review.ready &&
    observation.unresolvedReviewThreads === 0
}

function readObservation(repository: string, branch: string): WaitObservation {
  for (;;) {
    const initialLocal = readLocalState()
    const initialPullRequest = runGitHubJson(
      pullRequestViewArgs(repository, branch)
    ) as PullRequestState
    const initialReviewData = readReviewData(repository, initialPullRequest)
    const ci = readGitHubCi(repository, initialPullRequest, runGitHubJson)
    const pullRequest = runGitHubJson(
      pullRequestViewArgs(repository, branch)
    ) as PullRequestState
    const local = readLocalState()
    if (
      !samePullRequestRevision(initialPullRequest, pullRequest) ||
      !sameLocalState(initialLocal, local)
    ) continue

    const observation = {
      pullRequest,
      ci,
      review: initialReviewData.review,
      unresolvedReviewThreads: initialReviewData.unresolvedReviewThreads,
      local
    }
    if (!requiresReadyConfirmation(observation)) return observation

    const confirmedReviewData = readReviewData(repository, pullRequest)
    const confirmedCi = readGitHubCi(repository, pullRequest, runGitHubJson)
    const confirmedPullRequest = runGitHubJson(
      pullRequestViewArgs(repository, branch)
    ) as PullRequestState
    const confirmedLocal = readLocalState()
    if (
      !samePullRequestRevision(pullRequest, confirmedPullRequest) ||
      !sameLocalState(local, confirmedLocal) ||
      confirmedReviewData.fingerprint !== initialReviewData.fingerprint ||
      JSON.stringify(confirmedCi) !== JSON.stringify(ci)
    ) continue
    return {
      pullRequest: confirmedPullRequest,
      ci: confirmedCi,
      review: confirmedReviewData.review,
      unresolvedReviewThreads: confirmedReviewData.unresolvedReviewThreads,
      local: confirmedLocal
    }
  }
}

function observationSummary(observation: WaitObservation): string {
  return JSON.stringify({
    pr: observation.pullRequest.number,
    head: observation.pullRequest.headRefOid,
    base: observation.pullRequest.baseRefOid,
    merge: observation.ci.testedMergeSha ?? observation.pullRequest.potentialMergeCommit?.oid ?? null,
    ci: observation.ci.state,
    ciReason: observation.ci.reason,
    review: observation.review.pending
      ? 'pending'
      : observation.review.ready
        ? 'completed'
        : observation.review.terminalArtifacts.length > 0
          ? 'unhandled'
          : 'missing',
    unresolvedReviewThreads: observation.unresolvedReviewThreads
  })
}

export function formatWaitForPrSummary(
  decision: Extract<WaitDecision, { kind: 'wake' }>,
  observation: WaitObservation
): string {
  return `[wait-for-pr] Summary: ${JSON.stringify({
    reason: decision.reason,
    detail: decision.detail,
    pr: observation.pullRequest.number,
    url: observation.pullRequest.url,
    head: observation.pullRequest.headRefOid,
    base: observation.pullRequest.baseRefOid,
    testedMerge: observation.ci.testedMergeSha ?? null,
    ci: observation.ci,
    reviewPending: observation.review.pending,
    reviewReady: observation.review.ready,
    reviewArtifacts: observation.review.terminalArtifacts.map(({ key }) => key),
    unresolvedReviewThreads: observation.unresolvedReviewThreads
  })}`
}

export function formatWaitForPrFailureSummary(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, ' ')
    .trim()
  return `[wait-for-pr] Summary: failed: ${message || 'Unknown error.'}`
}

const sleep = (durationMilliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMilliseconds))

async function main(): Promise<void> {
  const branch = currentBranch()
  const baseline = readObservation(GITHUB_REPOSITORY, branch)
  assertWaitStart(baseline)
  process.stdout.write(`[wait-for-pr] Baseline ${observationSummary(baseline)}\n`)

  let current = baseline
  let previousSummary = ''
  let pendingClass: ReturnType<typeof waitTimeoutClass> = null
  let pendingSince = Date.now()
  for (;;) {
    let decision = decideWaitForPr(baseline, current)
    if (decision.kind === 'wait') {
      const nextPendingClass = waitTimeoutClass(decision.reason)
      if (pendingClass !== nextPendingClass) {
        pendingClass = nextPendingClass
        pendingSince = Date.now()
      }
      decision = decideWaitTimeout(decision.reason, Date.now() - pendingSince) ?? decision
    }
    if (decision.kind === 'wake') {
      process.stdout.write(`${formatWaitForPrSummary(decision, current)}\n`)
      return
    }

    const currentSummary = observationSummary(current)
    if (currentSummary !== previousSummary) {
      process.stdout.write(`[wait-for-pr] Waiting (${decision.reason}) ${currentSummary}\n`)
      previousSummary = currentSummary
    }
    await sleep(POLL_INTERVAL_MILLISECONDS)
    current = readObservation(GITHUB_REPOSITORY, branch)
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${formatWaitForPrFailureSummary(error)}\n`)
    process.exitCode = 1
  })
}

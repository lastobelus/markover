export const MARKOVER_CI_WORKFLOW = 'ci.yml'
export const MARKOVER_CI_GATE = 'Verify (Node 24)'

export interface GitHubWorkflow {
  id?: number
  path?: string
  state?: string
}

export interface GitHubWorkflowRun {
  id?: number
  display_title?: string
  event?: string
  head_sha?: string
  status?: string
  conclusion?: string | null
  created_at?: string
  html_url?: string
}

export interface GitHubWorkflowJob {
  name?: string
  status?: string
  conclusion?: string | null
}

export type GitHubCiEvidence =
  | {
      state: 'satisfied'
      reason: 'exact-run'
      runId: number
      runUrl?: string
      testedMergeSha: string
    }
  | {
      state: 'pending'
      reason: 'run-in-progress' | 'run-registration'
      runId?: number
      runUrl?: string
      testedMergeSha?: string
    }
  | {
      state: 'failure'
      reason: 'configuration' | 'terminal-run' | 'verify-gate'
      detail: string
      runId?: number
      runUrl?: string
      testedMergeSha?: string
    }

export interface GitHubCiEvaluationInput {
  workflow: GitHubWorkflow
  pullRequestNumber: number
  headSha: string
  baseSha: string
  workflowRuns: ReadonlyArray<GitHubWorkflowRun>
  jobs: ReadonlyArray<GitHubWorkflowJob> | null
}

export interface GitHubCiPullRequest {
  number: number
  headRefOid: string
  baseRefOid: string
}

export type RunGitHubJson = (args: ReadonlyArray<string>) => unknown

interface WorkflowRunsResponse {
  workflow_runs?: ReadonlyArray<GitHubWorkflowRun>
}

interface WorkflowJobsResponse {
  jobs?: ReadonlyArray<GitHubWorkflowJob>
}

function runTimestamp(run: GitHubWorkflowRun): number {
  const parsed = Date.parse(run.created_at ?? '')
  return Number.isNaN(parsed) ? 0 : parsed
}

export function githubCiWorkflowArgs(repository: string): ReadonlyArray<string> {
  return ['api', `repos/${repository}/actions/workflows/${MARKOVER_CI_WORKFLOW}`]
}

export function githubCiRunsArgs(
  repository: string,
  headSha: string
): ReadonlyArray<string> {
  return [
    'api',
    `repos/${repository}/actions/workflows/${MARKOVER_CI_WORKFLOW}/runs?event=pull_request&head_sha=${headSha}&per_page=100`
  ]
}

export function githubCiRunTitle(input: {
  pullRequestNumber: number
  headSha: string
  baseSha: string
  mergeSha: string
}): string {
  return `CI pull_request PR #${input.pullRequestNumber} head ${input.headSha} base ${input.baseSha} merge ${input.mergeSha}`
}

export function testedMergeShaFromGitHubCiRunTitle(
  title: string | undefined,
  input: {
    pullRequestNumber: number
    headSha: string
    baseSha: string
  }
): string | null {
  const prefix = `CI pull_request PR #${input.pullRequestNumber} head ${input.headSha} base ${input.baseSha} merge `
  if (!title?.startsWith(prefix)) return null
  const testedMergeSha = title.slice(prefix.length)
  return /^[0-9a-f]{40}$/.test(testedMergeSha) ? testedMergeSha : null
}

export function githubCiJobsArgs(
  repository: string,
  runId: number
): ReadonlyArray<string> {
  return ['api', `repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`]
}

const configurationFailure = (detail: string): GitHubCiEvidence => ({
  state: 'failure',
  reason: 'configuration',
  detail
})

export function evaluateGitHubCi(input: GitHubCiEvaluationInput): GitHubCiEvidence {
  if (input.workflow.state !== 'active') {
    return configurationFailure(
      `Workflow ${MARKOVER_CI_WORKFLOW} is ${input.workflow.state ?? 'missing'}, not active.`
    )
  }

  const exactRuns = input.workflowRuns
    .filter((run) =>
      run.event === 'pull_request' &&
      run.head_sha === input.headSha &&
      testedMergeShaFromGitHubCiRunTitle(run.display_title, input) !== null &&
      run.id !== undefined
    )
    .sort((left, right) =>
      runTimestamp(right) - runTimestamp(left) ||
      (right.id ?? 0) - (left.id ?? 0)
    )
  const run = exactRuns[0]
  if (!run) return { state: 'pending', reason: 'run-registration' }

  const runId = run.id
  if (runId === undefined) return configurationFailure('Exact workflow run has no ID.')
  const testedMergeSha = testedMergeShaFromGitHubCiRunTitle(run.display_title, input)
  if (!testedMergeSha) return configurationFailure('Exact workflow run has no tested merge SHA.')
  const identity = run.html_url
    ? { runId, runUrl: run.html_url, testedMergeSha }
    : { runId, testedMergeSha }

  if (run.status !== 'completed') {
    if (['queued', 'in_progress', 'pending', 'requested', 'waiting'].includes(run.status ?? '')) {
      return { state: 'pending', reason: 'run-in-progress', ...identity }
    }
    return {
      state: 'failure',
      reason: 'configuration',
      detail: `Workflow run ${runId} has unsupported status ${run.status ?? 'missing'}.`,
      ...identity
    }
  }
  if (run.conclusion !== 'success') {
    return {
      state: 'failure',
      reason: 'terminal-run',
      detail: `Workflow run ${runId} completed with ${run.conclusion ?? 'no conclusion'}.`,
      ...identity
    }
  }

  const gates = (input.jobs ?? []).filter(({ name }) => name === MARKOVER_CI_GATE)
  if (gates.length !== 1) {
    return {
      state: 'failure',
      reason: 'configuration',
      detail: `Workflow run ${runId} reported ${gates.length} ${MARKOVER_CI_GATE} jobs.`,
      ...identity
    }
  }
  const gate = gates[0]
  if (gate?.status !== 'completed') {
    return {
      state: 'failure',
      reason: 'configuration',
      detail: `${MARKOVER_CI_GATE} did not complete with its workflow run.`,
      ...identity
    }
  }
  if (gate.conclusion !== 'success') {
    return {
      state: 'failure',
      reason: 'verify-gate',
      detail: `${MARKOVER_CI_GATE} completed with ${gate.conclusion ?? 'no conclusion'}.`,
      ...identity
    }
  }
  return { state: 'satisfied', reason: 'exact-run', ...identity }
}

export function readGitHubCi(
  repository: string,
  pullRequest: GitHubCiPullRequest,
  runGitHubJson: RunGitHubJson
): GitHubCiEvidence {
  const workflow = runGitHubJson(githubCiWorkflowArgs(repository)) as GitHubWorkflow
  const workflowRuns = (runGitHubJson(
    githubCiRunsArgs(repository, pullRequest.headRefOid)
  ) as WorkflowRunsResponse).workflow_runs ?? []
  const evaluation = {
    workflow,
    pullRequestNumber: pullRequest.number,
    headSha: pullRequest.headRefOid,
    baseSha: pullRequest.baseRefOid,
    workflowRuns,
    jobs: null
  } as const
  const provisional = evaluateGitHubCi(evaluation)
  const completedSuccessRun = workflowRuns.find((run) =>
    run.id === provisional.runId &&
    run.status === 'completed' &&
    run.conclusion === 'success'
  )
  if (!completedSuccessRun?.id) return provisional
  const jobs = (runGitHubJson(
    githubCiJobsArgs(repository, completedSuccessRun.id)
  ) as WorkflowJobsResponse).jobs ?? []
  return evaluateGitHubCi({ ...evaluation, jobs })
}

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateGitHubCi,
  githubCiJobsArgs,
  githubCiRunsArgs,
  githubCiRunTitle,
  githubCiWorkflowArgs,
  readGitHubCi,
  testedMergeShaFromGitHubCiRunTitle,
  type GitHubCiEvaluationInput
} from '../scripts/markover-github-ci'

const MERGE = '1'.repeat(40)
const HEAD = '2'.repeat(40)
const BASE = '3'.repeat(40)
const TITLE = githubCiRunTitle({
  pullRequestNumber: 210,
  headSha: HEAD,
  baseSha: BASE,
  mergeSha: MERGE
})

function input(
  overrides: Partial<GitHubCiEvaluationInput> = {}
): GitHubCiEvaluationInput {
  return {
    workflow: { id: 1, state: 'active' },
    pullRequestNumber: 210,
    headSha: HEAD,
    baseSha: BASE,
    workflowRuns: [{
      id: 2,
      display_title: TITLE,
      event: 'pull_request',
      head_sha: HEAD,
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-08-29T10:00:00Z',
      html_url: 'https://github.com/lastobelus/markover/actions/runs/2'
    }],
    jobs: [{
      name: 'Verify (Node 24)',
      status: 'completed',
      conclusion: 'success'
    }],
    ...overrides
  }
}

test('builds exact workflow, run, and job queries', () => {
  assert.deepEqual(githubCiWorkflowArgs('lastobelus/markover'), [
    'api',
    'repos/lastobelus/markover/actions/workflows/ci.yml'
  ])
  assert.deepEqual(githubCiRunsArgs('lastobelus/markover', HEAD), [
    'api',
    `repos/lastobelus/markover/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${HEAD}&per_page=100`
  ])
  assert.deepEqual(githubCiJobsArgs('lastobelus/markover', 2), [
    'api',
    'repos/lastobelus/markover/actions/runs/2/jobs?filter=latest&per_page=100'
  ])
  assert.equal(
    testedMergeShaFromGitHubCiRunTitle(TITLE, {
      pullRequestNumber: 210,
      headSha: HEAD,
      baseSha: BASE
    }),
    MERGE
  )
})

test('reads exact run and verify job evidence through one path', () => {
  const responses = new Map<string, unknown>([
    [githubCiWorkflowArgs('lastobelus/markover').join(' '), { state: 'active' }],
    [githubCiRunsArgs('lastobelus/markover', HEAD).join(' '), {
      workflow_runs: input().workflowRuns
    }],
    [githubCiJobsArgs('lastobelus/markover', 2).join(' '), {
      jobs: input().jobs
    }]
  ])
  const evidence = readGitHubCi(
    'lastobelus/markover',
    { number: 210, headRefOid: HEAD, baseRefOid: BASE },
    (args: ReadonlyArray<string>): unknown => responses.get(args.join(' '))
  )
  assert.deepEqual(evidence, {
    state: 'satisfied',
    reason: 'exact-run',
    runId: 2,
    runUrl: 'https://github.com/lastobelus/markover/actions/runs/2',
    testedMergeSha: MERGE
  })
})

test('waits for registration and the newest exact run', () => {
  assert.deepEqual(
    evaluateGitHubCi(input({ workflowRuns: [], jobs: null })),
    { state: 'pending', reason: 'run-registration' }
  )
  assert.deepEqual(
    evaluateGitHubCi(input({
      workflowRuns: [
        ...input().workflowRuns,
        {
          id: 3,
          display_title: TITLE,
          event: 'pull_request',
          head_sha: HEAD,
          status: 'in_progress',
          conclusion: null,
          created_at: '2026-08-29T10:01:00Z'
        }
      ],
      jobs: null
    })),
    {
      state: 'pending',
      reason: 'run-in-progress',
      runId: 3,
      testedMergeSha: MERGE
    }
  )
})

test('ignores runs for another head or base', () => {
  const wrongHead = input().workflowRuns.map((run) => ({
    ...run,
    head_sha: '4'.repeat(40)
  }))
  assert.deepEqual(
    evaluateGitHubCi(input({ workflowRuns: wrongHead, jobs: null })),
    { state: 'pending', reason: 'run-registration' }
  )
  const wrongBaseTitle = githubCiRunTitle({
    pullRequestNumber: 210,
    headSha: HEAD,
    baseSha: '5'.repeat(40),
    mergeSha: MERGE
  })
  assert.deepEqual(
    evaluateGitHubCi(input({
      workflowRuns: input().workflowRuns.map((run) => ({
        ...run,
        display_title: wrongBaseTitle
      })),
      jobs: null
    })),
    { state: 'pending', reason: 'run-registration' }
  )
})

test('fails closed for workflow, run, and verify-job problems', () => {
  assert.equal(evaluateGitHubCi(input({
    workflow: { state: 'disabled_manually' }
  })).state, 'failure')
  assert.equal(evaluateGitHubCi(input({
    workflowRuns: input().workflowRuns.map((run) => ({
      ...run,
      conclusion: 'cancelled'
    })),
    jobs: null
  })).state, 'failure')
  assert.equal(evaluateGitHubCi(input({ jobs: [] })).state, 'failure')
  assert.equal(evaluateGitHubCi(input({
    jobs: [{
      name: 'Verify (Node 24)',
      status: 'completed',
      conclusion: 'failure'
    }]
  })).state, 'failure')
})

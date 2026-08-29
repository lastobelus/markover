import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertWaitStart,
  CI_REGISTRATION_TIMEOUT_MILLISECONDS,
  decideWaitForPr,
  decideWaitTimeout,
  deriveReviewState,
  formatWaitForPrFailureSummary,
  formatWaitForPrSummary,
  latestCodexReviewTrigger,
  MERGE_RECOMPUTE_TIMEOUT_MILLISECONDS,
  pullRequestViewArgs,
  REVIEW_TIMEOUT_MILLISECONDS,
  requiresReadyConfirmation,
  reviewThreadsArgs,
  samePullRequestRevision,
  waitTimeoutClass,
  type ReviewState,
  type WaitObservation
} from '../scripts/markover-wait-for-pr'

const HEAD = '1'.repeat(40)
const BASE = '2'.repeat(40)
const MERGE = '3'.repeat(40)

const reviewRequest = (head = HEAD): string =>
  `@codex review\n<!-- markover-review-head: ${head} -->`

const pendingReview: ReviewState = {
  terminalArtifacts: [],
  requestPresent: true,
  pending: true,
  ready: false,
  latestTriggerId: 10
}

const handledReview: ReviewState = {
  terminalArtifacts: [{ key: 'reaction:20', observedAt: '2026-08-29T10:05:00Z' }],
  requestPresent: true,
  pending: false,
  ready: true,
  latestTriggerId: 10
}

const pendingCi: WaitObservation['ci'] = {
  state: 'pending',
  reason: 'run-in-progress',
  runId: 1,
  testedMergeSha: MERGE
}

const satisfiedCi: WaitObservation['ci'] = {
  state: 'satisfied',
  reason: 'exact-run',
  runId: 1,
  testedMergeSha: MERGE
}

function observation(input: {
  ci?: WaitObservation['ci']
  number?: number
  review?: ReviewState
  head?: string
  base?: string
  state?: string
  isDraft?: boolean
  mergeable?: string
  mergeStateStatus?: string
  baseRefName?: string
  unresolvedReviewThreads?: number
  localHead?: string
  localBranch?: string
  clean?: boolean
} = {}): WaitObservation {
  return {
    pullRequest: {
      number: input.number ?? 210,
      url: 'https://github.com/lastobelus/markover/pull/210',
      state: input.state ?? 'OPEN',
      isDraft: input.isDraft ?? false,
      headRefOid: input.head ?? HEAD,
      baseRefOid: input.base ?? BASE,
      baseRefName: input.baseRefName ?? 'main',
      mergeable: input.mergeable ?? 'MERGEABLE',
      mergeStateStatus: input.mergeStateStatus ?? 'CLEAN',
      potentialMergeCommit: { oid: MERGE }
    },
    ci: input.ci ?? pendingCi,
    review: input.review ?? pendingReview,
    unresolvedReviewThreads: input.unresolvedReviewThreads ?? 0,
    local: {
      branch: input.localBranch ?? 't3code/adapt-babysit-resumable-actions',
      head: input.localHead ?? HEAD,
      clean: input.clean ?? true
    }
  }
}

test('builds branch-scoped PR and paginated review-thread queries', () => {
  assert.deepEqual(
    pullRequestViewArgs('lastobelus/markover', 't3code/example'),
    [
      'pr',
      'view',
      't3code/example',
      '--repo',
      'lastobelus/markover',
      '--json',
      'number,url,state,isDraft,headRefOid,baseRefOid,baseRefName,mergeable,mergeStateStatus,potentialMergeCommit'
    ]
  )
  assert.throws(() => pullRequestViewArgs('lastobelus/markover', ''), /checked-out branch/)
  const threads = reviewThreadsArgs('lastobelus/markover', 210)
  assert.ok(threads.includes('--paginate'))
  assert.ok(threads.includes('owner=lastobelus'))
  assert.ok(threads.includes('name=markover'))
  assert.ok(threads.includes('number=210'))
  assert.throws(() => reviewThreadsArgs('invalid', 210), /Invalid GitHub repository/)
})

test('binds observations to one exact PR head and base', () => {
  const initial = observation().pullRequest
  assert.equal(samePullRequestRevision(initial, observation().pullRequest), true)
  assert.equal(samePullRequestRevision(
    initial,
    observation({ head: '4'.repeat(40) }).pullRequest
  ), false)
  assert.equal(samePullRequestRevision(
    initial,
    observation({ base: '5'.repeat(40) }).pullRequest
  ), false)
  assert.equal(samePullRequestRevision(
    initial,
    observation({ number: 211 }).pullRequest
  ), false)
})

test('waits for both exact CI and current-head review', () => {
  const baseline = observation()
  assert.deepEqual(
    decideWaitForPr(baseline, observation({ ci: satisfiedCi })),
    { kind: 'wait', reason: 'review-pending' }
  )
  assert.deepEqual(
    decideWaitForPr(baseline, observation({ review: handledReview })),
    { kind: 'wait', reason: 'ci-pending' }
  )
  assert.equal(
    decideWaitForPr(
      observation({ review: handledReview }),
      observation({ ci: satisfiedCi, review: handledReview })
    ).reason,
    'ready'
  )
})

test('wakes for actionable CI, review, merge, and target changes', () => {
  const baseline = observation()
  const cases: Array<[WaitObservation, string]> = [
    [observation({
      ci: { state: 'failure', reason: 'terminal-run', detail: 'CI failed.' }
    }), 'ci-failed'],
    [observation({
      review: {
        terminalArtifacts: [{ key: 'review:2', observedAt: '2026-08-29T10:05:00Z' }],
        requestPresent: true,
        pending: false,
        ready: false,
        latestTriggerId: 10
      }
    }), 'review-unhandled'],
    [observation({ unresolvedReviewThreads: 2 }), 'review-unresolved'],
    [observation({ head: '4'.repeat(40) }), 'head-changed'],
    [observation({ base: '5'.repeat(40) }), 'base-changed'],
    [observation({ number: 211 }), 'pr-changed'],
    [observation({ mergeable: 'CONFLICTING' }), 'merge-blocked'],
    [observation({ mergeStateStatus: 'BEHIND' }), 'merge-blocked'],
    [observation({ state: 'CLOSED' }), 'pr-closed'],
    [observation({ isDraft: true }), 'pr-draft'],
    [observation({ baseRefName: 'release' }), 'unexpected-base'],
    [observation({ clean: false }), 'worktree-changed'],
    [observation({ localHead: '6'.repeat(40) }), 'local-head-changed']
  ]
  for (const [current, reason] of cases) {
    assert.equal(decideWaitForPr(baseline, current).reason, reason)
  }
})

test('fails fast at launch for dirty or mismatched local state', () => {
  assert.doesNotThrow(() => { assertWaitStart(observation()) })
  assert.throws(() => { assertWaitStart(observation({ clean: false })) }, /clean worktree/)
  assert.throws(
    () => { assertWaitStart(observation({ localHead: '6'.repeat(40) })) },
    /does not match PR head/
  )
})

test('bounds registration, merge recomputation, and review waits', () => {
  assert.equal(waitTimeoutClass('ci-registration'), 'ci-registration')
  assert.equal(waitTimeoutClass('mergeability-pending'), 'merge-recompute')
  assert.equal(waitTimeoutClass('review-pending'), 'review')
  assert.equal(waitTimeoutClass('ci-pending'), null)
  assert.equal(
    decideWaitTimeout('ci-registration', CI_REGISTRATION_TIMEOUT_MILLISECONDS - 1),
    null
  )
  assert.equal(
    decideWaitTimeout('ci-registration', CI_REGISTRATION_TIMEOUT_MILLISECONDS)?.reason,
    'ci-registration-timeout'
  )
  assert.equal(
    decideWaitTimeout('mergeability-pending', MERGE_RECOMPUTE_TIMEOUT_MILLISECONDS)?.reason,
    'merge-recompute-timeout'
  )
  assert.equal(
    decideWaitTimeout('review-pending', REVIEW_TIMEOUT_MILLISECONDS)?.reason,
    'review-timeout'
  )
})

test('recognizes exact-head marked requests and ignores untrusted markers', () => {
  const latest = latestCodexReviewTrigger([
    {
      id: 10,
      user: { login: 'lastobelus' },
      author_association: 'OWNER',
      body: reviewRequest(),
      created_at: '2026-08-29T10:00:00Z'
    },
    {
      id: 11,
      user: { login: 'outsider' },
      author_association: 'CONTRIBUTOR',
      body: reviewRequest(),
      created_at: '2026-08-29T10:01:00Z'
    }
  ], HEAD)
  assert.equal(latest?.id, 10)
})

test('keeps eyes pending and accepts thumbs-up on a marked request', () => {
  const issueComments = [{
    id: 10,
    user: { login: 'lastobelus' },
    author_association: 'OWNER',
    body: reviewRequest(),
    created_at: '2026-08-29T10:00:00Z'
  }]
  const pending = deriveReviewState({
    headSha: HEAD,
    formalReviews: [],
    issueComments,
    reviewComments: [],
    triggerReactions: [{
      id: 11,
      user: { login: 'chatgpt-codex-connector[bot]' },
      content: 'eyes',
      created_at: '2026-08-29T10:01:00Z'
    }],
    pullRequestReactions: []
  })
  assert.deepEqual(
    { requestPresent: pending.requestPresent, pending: pending.pending, ready: pending.ready },
    { requestPresent: true, pending: true, ready: false }
  )
  const clean = deriveReviewState({
    headSha: HEAD,
    formalReviews: [],
    issueComments,
    reviewComments: [],
    triggerReactions: [{
      id: 12,
      user: { login: 'chatgpt-codex-connector[bot]' },
      content: '+1',
      created_at: '2026-08-29T10:02:00Z'
    }],
    pullRequestReactions: []
  })
  assert.equal(clean.ready, true)
})

test('accepts the current Codex summary plus pull-request thumbs-up', () => {
  const review = deriveReviewState({
    headSha: HEAD,
    formalReviews: [],
    issueComments: [{
      id: 20,
      user: { login: 'chatgpt-codex-connector[bot]' },
      body: [
        '<!-- codex-pull-request-review-summary -->',
        '| Review | Status | Commit | Review trigger |',
        '| --- | --- | --- | --- |',
        `| Code Review | ✅ Completed | \`${HEAD.slice(0, 7)}\` | Draft marked ready |`
      ].join('\n'),
      created_at: '2026-08-29T10:00:00Z',
      updated_at: '2026-08-29T10:05:00Z'
    }],
    reviewComments: [],
    triggerReactions: [],
    pullRequestReactions: [{
      id: 21,
      user: { login: 'chatgpt-codex-connector[bot]' },
      content: '+1',
      created_at: '2026-08-29T10:05:01Z'
    }]
  })
  assert.deepEqual(
    { requestPresent: review.requestPresent, pending: review.pending, ready: review.ready },
    { requestPresent: true, pending: false, ready: true }
  )
})

test('requires a handled marker for body-only top-level findings', () => {
  const formalReviews = [{
    id: 30,
    user: { login: 'chatgpt-codex-connector[bot]' },
    state: 'COMMENTED',
    commit_id: HEAD,
    submitted_at: '2026-08-29T10:03:00Z',
    body: 'The fallback can accept stale evidence.'
  }]
  const issueComments = [{
    id: 31,
    user: { login: 'lastobelus' },
    author_association: 'OWNER',
    body: reviewRequest(),
    created_at: '2026-08-29T10:00:00Z'
  }]
  const finding = deriveReviewState({
    headSha: HEAD,
    formalReviews,
    issueComments,
    reviewComments: [],
    triggerReactions: [],
    pullRequestReactions: []
  })
  assert.equal(finding.ready, false)
  const handled = deriveReviewState({
    headSha: HEAD,
    formalReviews,
    issueComments: [
      ...issueComments,
      {
        id: 32,
        user: { login: 'lastobelus' },
        author_association: 'OWNER',
        body: `<!-- markover-review-handled: review:30 head: ${HEAD} -->`,
        created_at: '2026-08-29T10:04:00Z'
      }
    ],
    reviewComments: [],
    triggerReactions: [],
    pullRequestReactions: []
  })
  assert.equal(handled.ready, true)
})

test('confirms ready observations and emits concise final summaries', () => {
  const ready = observation({ ci: satisfiedCi, review: handledReview })
  assert.equal(requiresReadyConfirmation(ready), true)
  const decision = decideWaitForPr(observation({ review: handledReview }), ready)
  assert.equal(decision.kind, 'wake')
  const summary = formatWaitForPrSummary(decision, ready)
  assert.match(summary, /^\[wait-for-pr\] Summary: /)
  assert.match(summary, /"reason":"ready"/)
  assert.match(summary, /"testedMerge":"3333333333333333333333333333333333333333"/)
  assert.equal(
    formatWaitForPrFailureSummary(new Error('gh failed\nrequest timed out')),
    '[wait-for-pr] Summary: failed: gh failed request timed out'
  )
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

interface EvaluationResult {
  pass: boolean
  missing: string[]
  forbidden: string[]
}

interface NegativeControl {
  signals: string[]
  expectedMissing: string[]
  expectedForbidden: string[]
}

interface StartIssueCase {
  id: string
  description: string
  provenance: {
    kind: 'synthetic' | 'live-thread'
    sourceThreadIds: string[]
    observation?: string
  }
  observations: Record<string, unknown>
  requiredActions: string[]
  forbiddenActions: string[]
  controls: {
    positive: string[]
    negative: NegativeControl
  }
}

const root = path.resolve(__dirname, '../..')
const casesPath = path.join(root, 'evals/start-issue/cases.json')
const casesSource = fs.readFileSync(casesPath, 'utf8')
const cases = JSON.parse(casesSource) as StartIssueCase[]
const skillDirectory = path.join(root, '.agents/skills/start-issue')
const skillSource = fs.readFileSync(path.join(skillDirectory, 'SKILL.md'), 'utf8')
const agentsSource = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')

function readReference(name: string): string {
  return fs.readFileSync(
    path.join(skillDirectory, 'references', name),
    'utf8'
  )
}

function evaluate(
  evaluationCase: StartIssueCase,
  observedActions: string[]
): EvaluationResult {
  const observed = new Set(observedActions)
  const missing = evaluationCase.requiredActions.filter(
    (action) => !observed.has(action)
  )
  const forbidden = evaluationCase.forbiddenActions.filter(
    (action) => observed.has(action)
  )
  return {
    pass: missing.length === 0 && forbidden.length === 0,
    missing,
    forbidden
  }
}

test('start-issue corpus covers the eleven coordination branches', () => {
  assert.deepEqual(cases.map(({ id }) => id), [
    'untracked-single-session-work-uses-direct-pr',
    'untracked-durable-work-uses-issue',
    'confirmed-new-project-uses-repository-owner',
    'new-milestone-interviews-before-creation',
    'multiple-trackers-retain-all-active-attachments',
    'post-claim-scan-reconstructs-unmarked-items',
    'merged-pr-followup-apply-now-reuses-tracker',
    'merged-pr-followup-issue-only-chooses-tracker',
    'open-pr-artifact-review-uses-canonical-instance',
    'requested-dev-instance-opens-pr-checklist',
    'numbered-slices-use-slice-pr-language'
  ])
  assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length)
})

test('initial response identifies the live issue and title first', () => {
  assert.match(
    skillSource,
    /## How to respond to initial start-issue prompt[\s\S]*```markdown\n# #52—Open a specific review through a clickable Markover deep link/
  )
})

test('future pull requests use slice ordinals instead of GitHub numbers', () => {
  assert.match(
    skillSource,
    /## 4\. Interview[\s\S]*`slice-3 PR`, `third PR`, or `PR for\n+slice 3`/
  )
  assert.match(
    skillSource,
    /Reserve `PR #N` for an existing GitHub pull request numbered `N`/
  )
})

test('branch-only guidance is progressively disclosed', () => {
  assert.doesNotMatch(skillSource, /^### Follow-ups to merged pull requests$/m)
  assert.match(
    skillSource,
    /Untracked or post-merge work:[\s\S]*references\/work-item-routing\.md/
  )
  assert.match(
    skillSource,
    /Tracker selection:[\s\S]*references\/tracker-selection\.md/
  )
  assert.match(
    skillSource,
    /material decision remains unresolved[\s\S]*references\/interview\.md/
  )
  assert.match(
    skillSource,
    /target already has one or more trusted marked comments[\s\S]*references\/existing-claim\.md/
  )
  assert.match(
    skillSource,
    /Markover instance selection:[\s\S]*references\/markover-review\.md/
  )

  assert.match(readReference('work-item-routing.md'), /## Follow-up after merge/)
  assert.match(readReference('tracker-selection.md'), /## Discover candidates/)
  assert.match(readReference('interview.md'), /# Implementation interview/)
  assert.match(readReference('existing-claim.md'), /# Existing work-intent claim/)
  const markoverReference = readReference('markover-review.md')
  assert.match(markoverReference, /Use canonical for reviews of plans/)
  assert.match(markoverReference, /--instance dev open PATH/)
  assert.match(markoverReference, /tmp\/pr-N-dev-checklist\.md/)
  assert.match(markoverReference, /do not launch the instance separately/)
  assert.doesNotMatch(markoverReference, /open '<reviewUrl>'/)
})

test('root guidance owns the terminal-friendly Markover handoff', () => {
  assert.match(agentsSource, /^`open '<reviewUrl>'`$/m)
  assert.match(agentsSource, /best-effort Markdown link and raw review ID/)
  assert.match(agentsSource, /T3Code and Codex may strip or decline them/)
  for (const fencedBlock of agentsSource.match(/```[\s\S]*?```/g) ?? []) {
    assert.doesNotMatch(fencedBlock, /open '<reviewUrl>'/)
  }
})

test('fixtures contain normalized observations rather than live GitHub output', () => {
  const forbiddenKeys = new Set([
    'createdAt',
    'endCursor',
    'itemNodeId',
    'nodeId',
    'totalCount',
    'updatedAt'
  ])

  function inspect(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(inspect)
      return
    }
    if (typeof value !== 'object' || value === null) return

    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `volatile fixture key: ${key}`)
      inspect(child)
    }
  }

  cases.forEach(({ observations }) => {
    inspect(observations)
  })
  assert.doesNotMatch(casesSource, /\b(?:PVT|PVTI|PVTSSF)_[A-Za-z0-9_-]+\b/)
})

test('live provenance stays explanatory rather than becoming fixture input', () => {
  for (const evaluationCase of cases) {
    assert.ok(evaluationCase.description.length > 0)
    if (evaluationCase.provenance.kind === 'synthetic') {
      assert.deepEqual(evaluationCase.provenance.sourceThreadIds, [])
      assert.equal(evaluationCase.provenance.observation, undefined)
    } else {
      assert.ok(evaluationCase.provenance.sourceThreadIds.length > 0)
      assert.ok(evaluationCase.provenance.observation)
    }
  }
})

test('post-claim freshness case records both independent live observations', () => {
  const evaluationCase = cases.find(
    ({ id }) => id === 'post-claim-scan-reconstructs-unmarked-items'
  )
  assert.ok(evaluationCase)
  assert.equal(evaluationCase.provenance.kind, 'live-thread')
  assert.deepEqual(evaluationCase.provenance.sourceThreadIds, [
    '6bcd8df5-d1e2-4ebc-90c4-7c765ffd56af',
    '2fdb0272-8eb1-4549-a47a-2051b6d37b01'
  ])
  assert.match(evaluationCase.provenance.observation ?? '', /reused pre-claim/)
})

test('post-merge cases record the issue-and-PR live failure', () => {
  const evaluationCases = cases.filter(({ id }) =>
    id.startsWith('merged-pr-followup-')
  )
  assert.equal(evaluationCases.length, 2)
  evaluationCases.forEach((evaluationCase) => {
    assert.equal(evaluationCase.provenance.kind, 'live-thread')
    assert.deepEqual(evaluationCase.provenance.sourceThreadIds, [
      '04ce5c52-8191-4917-8d4a-0503e18f1850'
    ])
  })
  const applyNowCase = evaluationCases[0]
  assert.ok(applyNowCase)
  assert.match(
    applyNowCase.provenance.observation ?? '',
    /created issue #72.*opened draft PR #73/
  )
})

for (const evaluationCase of cases) {
  test(`${evaluationCase.id} accepts its positive control`, () => {
    assert.deepEqual(evaluate(
      evaluationCase,
      evaluationCase.controls.positive
    ), {
      pass: true,
      missing: [],
      forbidden: []
    })
  })

  test(`${evaluationCase.id} rejects its negative control as declared`, () => {
    const negative = evaluationCase.controls.negative
    assert.deepEqual(evaluate(evaluationCase, negative.signals), {
      pass: false,
      missing: negative.expectedMissing,
      forbidden: negative.expectedForbidden
    })
  })
}

test('every action and control is deliberate', () => {
  for (const evaluationCase of cases) {
    assert.ok(evaluationCase.requiredActions.length > 0)
    assert.ok(evaluationCase.forbiddenActions.length > 0)
    assert.equal(
      new Set(evaluationCase.requiredActions).size,
      evaluationCase.requiredActions.length
    )
    assert.equal(
      new Set(evaluationCase.forbiddenActions).size,
      evaluationCase.forbiddenActions.length
    )
    assert.equal(evaluationCase.controls.negative.expectedMissing.length > 0, true)
    assert.equal(
      evaluationCase.controls.negative.expectedForbidden.length > 0,
      true
    )
  }
})

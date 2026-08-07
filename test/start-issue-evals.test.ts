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

test('start-issue corpus covers the four v1 coordination branches', () => {
  assert.deepEqual(cases.map(({ id }) => id), [
    'untracked-work-selects-tracker-before-write',
    'confirmed-new-project-uses-repository-owner',
    'new-milestone-interviews-before-creation',
    'multiple-trackers-retain-all-active-attachments'
  ])
  assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length)
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

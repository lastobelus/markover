import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

interface EvaluationControls {
  positive: { observedSignals: string[] }
  negative: { observedSignals: string[] }
}

interface EvaluationCase {
  id: string
  description: string
  review: {
    source: string
    annotations: Array<{
      block: string
      feedback: string
      sourceEdit?: { original: string; current: string }
    }>
  }
  requiredSignals: string[]
  forbiddenSignals: string[]
  controls: EvaluationControls
}

interface EvaluationResult {
  pass: boolean
  missing: string[]
  forbidden: string[]
}

const root = path.resolve(__dirname, '../..')
const cases = JSON.parse(fs.readFileSync(path.join(
  root,
  'evals/annotation-interpretation/cases.json'
), 'utf8')) as EvaluationCase[]

function evaluate(
  evaluationCase: EvaluationCase,
  observedSignals: string[]
): EvaluationResult {
  const observed = new Set(observedSignals)
  const missing = evaluationCase.requiredSignals.filter(
    (signal) => !observed.has(signal)
  )
  const forbidden = evaluationCase.forbiddenSignals.filter(
    (signal) => observed.has(signal)
  )
  return {
    pass: missing.length === 0 && forbidden.length === 0,
    missing,
    forbidden
  }
}

test('interpretation corpus covers every contract intent', () => {
  assert.equal(cases.length, 4)
  const corpus = JSON.stringify(cases)
  for (const intent of [
    'revision',
    'question',
    'discussion',
    'context',
    'proposal'
  ]) {
    assert.match(corpus, new RegExp(intent))
  }
  assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length)
})

for (const evaluationCase of cases) {
  test(`${evaluationCase.id} accepts its positive control`, () => {
    assert.deepEqual(evaluate(
      evaluationCase,
      evaluationCase.controls.positive.observedSignals
    ), {
      pass: true,
      missing: [],
      forbidden: []
    })
  })

  test(`${evaluationCase.id} rejects its negative control`, () => {
    const result = evaluate(
      evaluationCase,
      evaluationCase.controls.negative.observedSignals
    )
    assert.equal(result.pass, false)
    assert.ok(result.missing.length > 0 || result.forbidden.length > 0)
  })
}

test('acting on a question without acknowledging it is an explicit failure', () => {
  const evaluationCase = cases.find(
    ({ id }) => id === 'question-as-useful-direction'
  )
  assert.ok(evaluationCase)

  assert.deepEqual(evaluate(evaluationCase, [
    'revision-applied:remove-legacy-fallback',
    'question-silently-converted-to-edit:legacy-fallback'
  ]), {
    pass: false,
    missing: ['question-acknowledged:legacy-fallback'],
    forbidden: ['question-silently-converted-to-edit:legacy-fallback']
  })
})

test('addressing context cannot excuse an invented rationale', () => {
  const evaluationCase = cases.find(
    ({ id }) => id === 'discussion-with-context'
  )
  assert.ok(evaluationCase)

  assert.deepEqual(evaluate(evaluationCase, [
    'discussion-addressed:latency-tradeoff',
    'revision-applied:invent-latency-rationale'
  ]), {
    pass: false,
    missing: [],
    forbidden: ['revision-applied:invent-latency-rationale']
  })
})

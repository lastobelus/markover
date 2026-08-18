import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildMatrix,
  buildPrompt,
  conditionPayload,
  decideGuidance,
  scoreGuidanceOutput,
  type GuidanceCase,
  type GuidanceConfig,
  type GuidanceOutput,
  type GuidanceTrialResult,
  type JsonObject
} from '../scripts/thread-metadata-guidance-eval'
import { helpPayload } from '../scripts/markover'

const root = path.resolve(__dirname, '../..')
const evaluationDirectory = path.join(root, 'evals/thread-metadata-guidance')
const json = (name: string): unknown => JSON.parse(
  fs.readFileSync(path.join(evaluationDirectory, name), 'utf8')
)
const config = json('config.json') as GuidanceConfig
const cases = json('cases.json') as GuidanceCase[]
const candidate = json('candidate.json') as JsonObject

function passingOutput(item: GuidanceCase): GuidanceOutput {
  const argumentsSource = Object.entries(item.expectedArguments)
    .map(([flag, value]) => `${flag} ${value}`)
    .join(' ')
  return {
    caseId: item.id,
    markoverInput: `${item.command} review.md ${argumentsSource}`,
    portableAgentThreadJson: JSON.stringify(item.expectedAgentThread),
    inputMode: 'CLI flags only; JSON is not an input mode.',
    explanation: 'Uses the observed values and omits unavailable fields.'
  }
}

function trial(
  item: GuidanceCase,
  model: string,
  condition: 'baseline' | 'candidate',
  repetition: number,
  passes: boolean
): GuidanceTrialResult {
  const output = passingOutput(item)
  const score = scoreGuidanceOutput(item, output)
  return {
    spec: {
      id: `${item.id}__${model}__${condition}__${repetition}`,
      caseId: item.id,
      condition,
      model,
      reasoningEffort: 'medium',
      repetition
    },
    output,
    score: passes ? score : {
      ...score,
      exactConformance: false,
      failures: ['synthetic semantic failure']
    },
    infrastructureAttempts: 1,
    effectiveModel: model,
    usage: null,
    durationMs: 1
  }
}

test('configuration expands to the finite authorized 24-trial matrix', () => {
  const matrix = buildMatrix(config, cases)
  assert.equal(matrix.length, 24)
  assert.deepEqual(config.conditions, ['baseline', 'candidate'])
  assert.deepEqual(config.models, [
    { model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
    { model: 'gpt-5.6-luna', reasoningEffort: 'medium' }
  ])
  assert.equal(config.trialsPerCondition, 2)
  assert.equal(new Set(matrix.map(({ id }) => id)).size, matrix.length)
  for (const item of cases) {
    assert.equal(matrix.filter(({ caseId }) => caseId === item.id).length, 8)
  }
})

test('recorded decision stays within the evaluated open-command boundary', () => {
  assert.ok(cases.length > 0)
  assert.ok(cases.every(({ command }) => command === 'open'))

  const decision = fs.readFileSync(
    path.join(evaluationDirectory, 'decision.md'),
    'utf8'
  )
  assert.match(decision, /threadMetadata\.commands\.open/)
  assert.match(decision, /review\.agentReviewer\.agentThread/)
  assert.match(decision, /broader candidate statement is not accepted/)
})

test('candidate is additive and the neutral output schema hides the nested shape', () => {
  const baseline = helpPayload() as unknown as JsonObject
  const baselineCondition = conditionPayload(
    'baseline',
    baseline,
    candidate
  )
  const candidateCondition = conditionPayload(
    'candidate',
    baseline,
    candidate
  )
  assert.deepEqual(baselineCondition, baseline)
  assert.deepEqual(candidateCondition, {
    ...baseline,
    threadMetadata: candidate
  })
  assert.equal(candidate.inputMode, 'flags-only')
  assert.equal(
    (candidate.example as Record<string, unknown>).normative,
    false
  )
  const schema = fs.readFileSync(
    path.join(evaluationDirectory, 'output.schema.json'),
    'utf8'
  )
  assert.match(schema, /portableAgentThreadJson/)
  assert.doesNotMatch(schema, /threadHost/)
  assert.doesNotMatch(schema, /threadId/)
})

test('prompts expose condition guidance without evaluator answers', () => {
  const item = cases[0]
  assert.ok(item)
  const baseline = helpPayload() as unknown as JsonObject
  const baselinePrompt = buildPrompt(
    item,
    conditionPayload('baseline', baseline, candidate)
  )
  const candidatePrompt = buildPrompt(
    item,
    conditionPayload('candidate', baseline, candidate)
  )
  for (const prompt of [baselinePrompt, candidatePrompt]) {
    assert.match(prompt, new RegExp(item.scenario.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(prompt, /expectedArguments/)
    assert.doesNotMatch(prompt, /forbiddenFlags/)
    assert.doesNotMatch(prompt, /exactConformance/)
  }
  assert.doesNotMatch(baselinePrompt, /"threadMetadata"/)
  assert.match(candidatePrompt, /"threadMetadata"/)
})

test('deterministic scorer accepts every exact scenario result', () => {
  for (const item of cases) {
    const score = scoreGuidanceOutput(item, passingOutput(item))
    assert.equal(score.exactConformance, true, item.id)
    assert.equal(score.jsonInputMisconception, false, item.id)
    assert.equal(score.guessedMetadata, false, item.id)
    assert.deepEqual(score.failures, [], item.id)
  }
})

test('deterministic scorer separates JSON input, omissions, and guesses', () => {
  const item = cases[1]
  assert.ok(item)
  const jsonInput = passingOutput(item)
  jsonInput.markoverInput = JSON.stringify({ agentThread: item.expectedAgentThread })
  jsonInput.inputMode = 'Nested JSON input'
  const jsonScore = scoreGuidanceOutput(item, jsonInput)
  assert.equal(jsonScore.exactConformance, false)
  assert.equal(jsonScore.jsonInputMisconception, true)

  const omission = passingOutput(item)
  omission.markoverInput = omission.markoverInput.replace(
    / --thread-host-provider claude/,
    ''
  )
  const omissionScore = scoreGuidanceOutput(item, omission)
  assert.equal(omissionScore.exactConformance, false)
  assert.equal(omissionScore.guessedMetadata, false)

  const guess = passingOutput(item)
  const portable = structuredClone(item.expectedAgentThread) as Record<string, unknown>
  const host = portable.threadHost as Record<string, unknown>
  host.threadId = 'invented-host-thread'
  guess.portableAgentThreadJson = JSON.stringify(portable)
  const guessScore = scoreGuidanceOutput(item, guess)
  assert.equal(guessScore.exactConformance, false)
  assert.equal(guessScore.guessedMetadata, true)
})

test('precommitted rule requires zero critical errors, no strata regression, and both model improvements', () => {
  const models = config.models.map(({ model }) => model)
  const results = buildMatrix(config, cases).map((spec) => {
    const item = cases.find(({ id }) => id === spec.caseId)
    assert.ok(item)
    const baselinePass = spec.repetition === 1
    const candidatePass = (
      spec.repetition === 1 ||
      (spec.caseId === 'explicit-runtime-complete')
    )
    return trial(
      item,
      spec.model,
      spec.condition,
      spec.repetition,
      spec.condition === 'baseline' ? baselinePass : candidatePass
    )
  })
  const passingDecision = decideGuidance(
    results,
    models,
    cases.map(({ id }) => id)
  )
  assert.equal(passingDecision.outcome, 'plan-structured-guidance')
  assert.equal(passingDecision.candidateCriticalErrors, 0)
  assert.equal(passingDecision.noCaseModelRegression, true)
  assert.equal(passingDecision.improvesBothModels, true)

  const tied = results.map((result) => (
    result.spec.condition === 'candidate' && result.spec.repetition === 2
      ? { ...result, score: { ...result.score, exactConformance: false } }
      : result
  ))
  assert.equal(
    decideGuidance(tied, models, cases.map(({ id }) => id)).outcome,
    'retain-current-guidance'
  )

  const critical = structuredClone(results)
  const candidateTrial = critical.find(({ spec }) => spec.condition === 'candidate')
  assert.ok(candidateTrial)
  candidateTrial.score.jsonInputMisconception = true
  assert.equal(
    decideGuidance(critical, models, cases.map(({ id }) => id)).outcome,
    'retain-current-guidance'
  )
})

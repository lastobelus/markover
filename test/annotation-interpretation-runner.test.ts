import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildAgentPrompt,
  buildCodexArgs,
  buildJudgePrompt,
  buildMatrix,
  parseCodexJsonl,
  sanitizeEvidenceText,
  validateJudgeOutput,
  type EvaluationCase,
  type EvaluationConfig
} from '../scripts/annotation-interpretation-eval'
import { FIXED_CONTRACT } from '../src/agent-guidance'

const root = path.resolve(__dirname, '../..')
const evaluationDirectory = path.join(root, 'evals/annotation-interpretation')
const read = (name: string): string =>
  fs.readFileSync(path.join(evaluationDirectory, name), 'utf8')
const cases = JSON.parse(read('cases.json')) as EvaluationCase[]
const config = JSON.parse(read('config.json')) as EvaluationConfig

test('versioned configuration expands to the agreed 48-trial matrix', () => {
  const matrix = buildMatrix(config, cases)
  assert.equal(matrix.length, 48)
  assert.deepEqual(config.models, [
    { model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
    { model: 'gpt-5.6-luna', reasoningEffort: 'medium' }
  ])
  assert.deepEqual(config.judge, {
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high'
  })
  assert.equal(config.trialsPerCondition, 3)
  assert.deepEqual(config.conditions, ['guided', 'unguided'])
  assert.equal(new Set(matrix.map(({ id }) => id)).size, matrix.length)
  for (const evaluationCase of cases) {
    assert.equal(
      matrix.filter(({ caseId }) => caseId === evaluationCase.id).length,
      12
    )
  }
})

test('guided and unguided prompts differ only by Markover guidance', () => {
  const evaluationCase = cases[0]
  assert.ok(evaluationCase)
  const guided = buildAgentPrompt(evaluationCase, 'guided')
  const unguided = buildAgentPrompt(evaluationCase, 'unguided')

  assert.match(guided, /Respond to the Markover review in review\.json/)
  assert.match(unguided, /Respond to the Markover review in review\.json/)
  assert.match(guided, new RegExp(FIXED_CONTRACT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(unguided, /Never silently consume a question/)
  for (const prompt of [guided, unguided]) {
    assert.doesNotMatch(prompt, /requiredSignals|forbiddenSignals/)
    assert.doesNotMatch(prompt, /question-acknowledged:/)
  }
})

test('Codex commands isolate config, tools, network, sessions, and reasoning', () => {
  const agentArgs = buildCodexArgs({
    model: 'gpt-5.6-luna',
    reasoningEffort: 'medium',
    workspace: '/private/tmp/trial',
    sandbox: 'workspace-write'
  })
  const judgeArgs = buildCodexArgs({
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    workspace: '/private/tmp/judge',
    sandbox: 'read-only',
    schemaPath: '/repo/evals/judge-output.schema.json',
    disableShell: true
  })

  for (const args of [agentArgs, judgeArgs]) {
    assert.ok(args.includes('--ephemeral'))
    assert.ok(args.includes('--ignore-user-config'))
    assert.ok(args.includes('--ignore-rules'))
    assert.ok(args.includes('--strict-config'))
    assert.ok(args.includes('--json'))
    assert.ok(args.includes('agents.enabled=false'))
    assert.ok(args.includes('apps._default.enabled=false'))
    assert.ok(args.includes('web_search="disabled"'))
    assert.ok(args.includes('project_doc_max_bytes=0'))
    assert.ok(!args.some((arg) => arg.startsWith('tools.view_image=')))
  }
  assert.ok(agentArgs.includes('model_reasoning_effort="medium"'))
  assert.ok(agentArgs.includes('sandbox_workspace_write.network_access=false'))
  assert.ok(agentArgs.includes('features.shell_tool=true'))
  assert.ok(judgeArgs.includes('model_reasoning_effort="high"'))
  assert.ok(judgeArgs.includes('features.shell_tool=false'))
  assert.ok(judgeArgs.includes('--output-schema'))
  assert.ok(judgeArgs.includes('read-only'))
})

test('judge prompt carries the exact case artifacts and rubric', () => {
  const evaluationCase = cases[0]
  assert.ok(evaluationCase)
  const prompt = buildJudgePrompt({
    evaluationCase,
    rubric: '# Strict rubric',
    agentResponse: 'I renamed the section and addressed the question.',
    finalDocument: '## Persistence\n'
  })
  assert.match(prompt, /# Strict rubric/)
  assert.match(prompt, /## Persistence/)
  assert.match(prompt, /I renamed the section/)
  for (const signal of [
    ...evaluationCase.requiredSignals,
    ...evaluationCase.forbiddenSignals
  ]) {
    assert.match(prompt, new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('deterministic controls are explicit and authoritative to the judge', () => {
  const evaluationCase = cases[0]
  assert.ok(evaluationCase)
  const prompt = buildJudgePrompt({
    evaluationCase,
    rubric: read('rubric.md'),
    controlSignals: evaluationCase.controls.negative,
    controlKind: 'negative'
  })
  assert.match(prompt, /Deterministic control/)
  assert.match(prompt, /authoritative observed signal list/)
  assert.match(prompt, /question-silently-converted-to-edit/)
})

test('Codex JSONL parsing captures final response, usage, and completion', () => {
  const parsed = parseCodexJsonl([
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-1', model: 'effective-model' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Handled.' }
    }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 10, output_tokens: 4 }
    }),
    ''
  ].join('\n'))

  assert.equal(parsed.threadId, 'thread-1')
  assert.equal(parsed.effectiveModel, 'effective-model')
  assert.equal(parsed.finalMessage, 'Handled.')
  assert.deepEqual(parsed.usage, { input_tokens: 10, output_tokens: 4 })
  assert.equal(parsed.completed, true)
  assert.equal(parsed.failed, false)
})

test('judge output must cover exact signals and derive pass consistently', () => {
  const evaluationCase = cases[0]
  assert.ok(evaluationCase)
  const output = {
    caseId: evaluationCase.id,
    pass: true,
    requiredSignals: evaluationCase.requiredSignals.map((signal) => ({
      signal,
      observed: true,
      evidence: 'observable'
    })),
    forbiddenSignals: evaluationCase.forbiddenSignals.map((signal) => ({
      signal,
      observed: false,
      evidence: 'absent'
    })),
    summary: 'Pass.'
  }
  assert.deepEqual(validateJudgeOutput(output, evaluationCase), output)
  assert.throws(
    () => validateJudgeOutput({ ...output, pass: false }, evaluationCase),
    /inconsistent/
  )
  assert.throws(
    () => validateJudgeOutput({
      ...output,
      requiredSignals: output.requiredSignals.slice(1)
    }, evaluationCase),
    /exact required signal set/
  )
})

test('published event streams replace local absolute paths', () => {
  const source = '/repo/tmp/run/workspace/document.md and /repo/source.ts'
  assert.equal(sanitizeEvidenceText(source, [
    ['/repo/tmp/run/workspace', '<workspace>'],
    ['/repo', '<repository>']
  ]), '<workspace>/document.md and <repository>/source.ts')
})

test('rubric, schema, and package scripts preserve the agreed gates', () => {
  const rubric = read('rubric.md')
  const schema = JSON.parse(read('judge-output.schema.json')) as {
    additionalProperties: boolean
  }
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  ) as { scripts: Record<string, string> }

  for (const vocabulary of [
    'revision-applied',
    'question-acknowledged',
    'question-silently-converted-to-edit',
    'discussion-addressed',
    'proposal-considered'
  ]) {
    assert.match(rubric, new RegExp(vocabulary))
  }
  assert.equal(schema.additionalProperties, false)
  assert.match(packageJson.scripts['eval:annotation'] ?? '', / run$/)
  assert.match(packageJson.scripts['eval:annotation:validate'] ?? '', / validate$/)
  assert.deepEqual(config.thresholds, {
    judgeControlAccuracy: 1,
    guidedRequiredSignalRate: 1,
    guidedForbiddenSignalCount: 0
  })
})

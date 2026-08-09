import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildAgentPrompt,
  buildCodexArgs,
  buildJudgePrompt,
  buildMatrix,
  controlJudgmentMatches,
  executeWithInfrastructureRetries,
  inspectTrialWorkspace,
  parseCodexJsonl,
  pinnedJudgeSchemaPath,
  reserveRunRoot,
  resetTrialWorkspace,
  sanitizeCodexJsonl,
  sanitizeEvidenceDirectory,
  sanitizeEvidenceText,
  sanitizeEvidenceValue,
  trialPass,
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
  const guided = buildAgentPrompt('guided')
  const unguided = buildAgentPrompt('unguided')

  assert.match(guided, /Respond to the Markover review in review\.json/)
  assert.match(unguided, /Respond to the Markover review in review\.json/)
  assert.match(guided, new RegExp(FIXED_CONTRACT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(unguided, /Never silently consume a question/)
  for (const prompt of [guided, unguided]) {
    assert.doesNotMatch(prompt, /requiredSignals|forbiddenSignals/)
    assert.doesNotMatch(prompt, /question-acknowledged:/)
    assert.doesNotMatch(prompt, /Case description:/)
    assert.doesNotMatch(prompt, new RegExp(
      evaluationCase.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ))
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

test('judge invocations use the recorded run-local schema snapshot', () => {
  const evidenceDirectory = '/run/evidence'
  assert.equal(
    pinnedJudgeSchemaPath(evidenceDirectory),
    '/run/evidence/inputs/judge-output.schema.json'
  )
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

test('invalid final documents are visible to the judge and fail the trial', () => {
  const evaluationCase = cases[1]
  assert.ok(evaluationCase)
  const prompt = buildJudgePrompt({
    evaluationCase,
    rubric: '# Strict rubric',
    agentResponse: 'Removed the document.',
    finalDocument: null,
    finalDocumentStatus: 'missing'
  })
  assert.match(
    prompt,
    /## Final document\nStatus: missing\n<document\.md missing>/
  )
  const judgment = {
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
    summary: 'Signals pass.'
  }
  assert.equal(trialPass('regular', 'valid', judgment), true)
  assert.equal(trialPass('missing', 'valid', judgment), false)
  assert.equal(trialPass('invalid', 'valid', judgment), false)
  assert.equal(trialPass('regular', 'invalid', judgment), false)
})

test('trial workspaces reject review mutations and unexpected entries', async (t) => {
  const directory = await fsPromises.mkdtemp(path.join(
    os.tmpdir(),
    'markover-trial-workspace-'
  ))
  t.after(() => fsPromises.rm(directory, { recursive: true, force: true }))
  const workspace = path.join(directory, 'workspace')
  const review = cases[0]?.review
  assert.ok(review)

  await resetTrialWorkspace(workspace, review)
  assert.deepEqual(await inspectTrialWorkspace(workspace, review), {
    status: 'valid',
    violations: []
  })

  await Promise.all([
    fsPromises.writeFile(path.join(workspace, 'review.json'), '{}\n'),
    fsPromises.writeFile(path.join(workspace, 'extra.txt'), 'unexpected')
  ])
  assert.deepEqual(await inspectTrialWorkspace(workspace, review), {
    status: 'invalid',
    violations: ['unexpected-entry', 'review-modified']
  })

  await resetTrialWorkspace(workspace, review)
  await fsPromises.rm(path.join(workspace, 'review.json'))
  assert.deepEqual(await inspectTrialWorkspace(workspace, review), {
    status: 'invalid',
    violations: ['review-missing']
  })

  await resetTrialWorkspace(workspace, review)
  await fsPromises.rm(path.join(workspace, '.git'), { recursive: true })
  assert.deepEqual(await inspectTrialWorkspace(workspace, review), {
    status: 'invalid',
    violations: ['workspace-metadata-missing']
  })

  await fsPromises.rm(workspace, { recursive: true })
  assert.deepEqual(await inspectTrialWorkspace(workspace, review), {
    status: 'invalid',
    violations: ['workspace-missing']
  })
})

test('judge controls require semantic inference from fixed artifacts', () => {
  const evaluationCase = cases[2]
  assert.ok(evaluationCase)
  const control = evaluationCase.controls.positive
  const prompt = buildJudgePrompt({
    evaluationCase,
    rubric: read('rubric.md'),
    agentResponse: control.agentResponse,
    finalDocument: control.finalDocument,
    finalDocumentStatus: 'regular'
  })
  assert.match(prompt, /budget is 200ms/)
  assert.match(prompt, /latency concern is valid/)
  assert.doesNotMatch(prompt, /authoritative observed signal list/)
  assert.doesNotMatch(prompt, /Control kind|positive control|negative control/)
  assert.doesNotMatch(prompt, /context-used:mobile-client-budget/)
})

test('judge controls compare every expected signal decision', () => {
  const evaluationCase = cases[0]
  assert.ok(evaluationCase)
  const control = evaluationCase.controls.negative
  const judgment = {
    caseId: evaluationCase.id,
    pass: false,
    requiredSignals: evaluationCase.requiredSignals.map((signal) => ({
      signal,
      observed: control.observedSignals.includes(signal),
      evidence: 'control artifact'
    })),
    forbiddenSignals: evaluationCase.forbiddenSignals.map((signal) => ({
      signal,
      observed: control.observedSignals.includes(signal),
      evidence: 'control artifact'
    })),
    summary: 'Expected negative control decisions.'
  }
  assert.equal(controlJudgmentMatches(control, judgment), true)

  const wrongReason = {
    ...judgment,
    forbiddenSignals: judgment.forbiddenSignals.map((decision) => ({
      ...decision,
      observed: false
    }))
  }
  assert.equal(wrongReason.pass, false)
  assert.equal(controlJudgmentMatches(control, wrongReason), false)
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

test('published event streams redact command output but retain useful events', () => {
  const source = [
    JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'ls -la',
        aggregated_output: 'drwxr-xr-x lasto staff /repo/workspace',
        status: 'completed',
        exit_code: 0
      }
    }),
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Updated /repo/workspace/document.md' }
    }),
    ''
  ].join('\n')
  const sanitized = sanitizeCodexJsonl(source, [
    ['/repo/workspace', '<workspace>']
  ])
  const events = sanitized.trim().split('\n').map((line) =>
    JSON.parse(line) as { item: Record<string, unknown> }
  )

  assert.deepEqual(events[0]?.item, {
    type: 'command_execution',
    command: 'ls -la',
    aggregated_output: '<redacted command output>',
    status: 'completed',
    exit_code: 0
  })
  assert.equal(events[1]?.item.text, 'Updated <workspace>/document.md')
  assert.doesNotMatch(sanitized, /lasto|staff/)
})

test('published structured values and files replace local absolute paths', async (t) => {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'markover-evidence-sanitization-')
  )
  t.after(async () => fsPromises.rm(directory, { recursive: true, force: true }))
  const replacements = [[directory, '<workspace>']] as const
  const nested = {
    response: `${directory}/document.md`,
    decisions: [{ evidence: `Read ${directory}/review.json` }]
  }
  assert.deepEqual(sanitizeEvidenceValue(nested, replacements), {
    response: '<workspace>/document.md',
    decisions: [{ evidence: 'Read <workspace>/review.json' }]
  })
  const child = path.join(directory, 'published')
  await fsPromises.mkdir(child)
  await fsPromises.writeFile(path.join(child, 'artifact.json'), JSON.stringify(nested))
  await sanitizeEvidenceDirectory(child, replacements)
  assert.doesNotMatch(
    await fsPromises.readFile(path.join(child, 'artifact.json'), 'utf8'),
    new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  )
})

test('infrastructure retries restore the pristine trial workspace', async (t) => {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'markover-eval-retry-')
  )
  t.after(async () => fsPromises.rm(directory, { recursive: true, force: true }))
  const workspace = path.join(directory, 'workspace')
  const evidenceDirectory = path.join(directory, 'evidence')
  const rawDirectory = path.join(directory, 'raw')
  const review = {
    source: 'Original document.\n',
    annotations: [{ block: 'Original document.', feedback: 'Review it.' }]
  }
  let invocations = 0
  const successfulJsonl = [
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-2' }),
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Handled.' }
    }),
    JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 1 } }),
    ''
  ].join('\n')

  const output = await executeWithInfrastructureRetries({
    command: {
      executable: 'codex',
      args: [],
      cwd: workspace,
      prompt: 'Handle the review.',
      timeoutMs: 1000
    },
    evidenceDirectory,
    rawDirectory,
    replacements: [[directory, '<run-root>']],
    maxRetries: 1,
    retryDelayMs: 0,
    decode: (message) => message,
    beforeAttempt: async () => resetTrialWorkspace(workspace, review),
    invoke: async () => {
      invocations += 1
      if (invocations === 1) {
        await Promise.all([
          fsPromises.writeFile(path.join(workspace, 'document.md'), 'Mutated.'),
          fsPromises.writeFile(path.join(workspace, 'extra.txt'), 'unexpected')
        ])
        return {
          exitCode: 1,
          signal: null,
          stdout: '',
          stderr: 'transient failure',
          durationMs: 1,
          timedOut: false
        }
      }
      assert.equal(
        await fsPromises.readFile(path.join(workspace, 'document.md'), 'utf8'),
        review.source
      )
      await assert.rejects(fsPromises.access(path.join(workspace, 'extra.txt')))
      return {
        exitCode: 0,
        signal: null,
        stdout: successfulJsonl,
        stderr: '',
        durationMs: 1,
        timedOut: false
      }
    }
  })

  assert.equal(output.value, 'Handled.')
  assert.equal(output.attempts.length, 2)
})

test('an existing run workspace is rejected without reusing stale artifacts', async (t) => {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'markover-eval-run-root-')
  )
  t.after(async () => fsPromises.rm(directory, { recursive: true, force: true }))
  const runRoot = path.join(directory, 'fixed-run-id')
  await reserveRunRoot(runRoot)
  const staleArtifact = path.join(runRoot, 'attempt-3.json')
  await fsPromises.writeFile(staleArtifact, 'stale')

  await assert.rejects(reserveRunRoot(runRoot), /Run workspace already exists/)
  assert.equal(await fsPromises.readFile(staleArtifact, 'utf8'), 'stale')
})

test('rubric, schema, and package scripts preserve the agreed gates', () => {
  const rubric = read('rubric.md')
  const eslintConfig = fs.readFileSync(
    path.join(root, 'eslint.config.js'),
    'utf8'
  )
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
  assert.match(eslintConfig, /'evals\/\*\*\/results\/\*\*'/)
  assert.match(eslintConfig, /'tmp\/\*\*'/)
  assert.match(packageJson.scripts['eval:annotation'] ?? '', / run$/)
  assert.match(packageJson.scripts['eval:annotation:validate'] ?? '', / validate$/)
  assert.equal(config.runnerVersion, 5)
  assert.deepEqual(config.thresholds, {
    judgeControlAccuracy: 1,
    guidedRequiredSignalRate: 1,
    guidedForbiddenSignalCount: 0
  })
})

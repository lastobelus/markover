#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

import {
  DEFAULT_INTERPRETATION_POLICY,
  FIXED_CONTRACT
} from '../src/agent-guidance'

const execFileAsync = promisify(execFile)

export type EvaluationCondition = 'guided' | 'unguided'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type FinalDocumentStatus = 'regular' | 'missing' | 'invalid'
export type TrialWorkspaceStatus = 'valid' | 'invalid'
export type TrialWorkspaceViolation =
  | 'workspace-missing'
  | 'workspace-metadata-missing'
  | 'workspace-metadata-invalid'
  | 'review-missing'
  | 'review-invalid'
  | 'review-modified'
  | 'unexpected-entry'

export interface EvaluationCase {
  id: string
  description: string
  review: {
    source: string
    annotations: Array<{
      block: string
      feedback: string
      sourceEdit?: {
        original: string
        current: string
      }
    }>
  }
  requiredSignals: string[]
  forbiddenSignals: string[]
  controls: {
    positive: ControlArtifact
    negative: ControlArtifact
  }
}

export interface ControlArtifact {
  finalDocument: string
  agentResponse: string
  observedSignals: string[]
}

export interface EvaluationConfig {
  schemaVersion: number
  runnerVersion: number
  trialsPerCondition: number
  conditions: EvaluationCondition[]
  models: Array<{
    model: string
    reasoningEffort: ReasoningEffort
  }>
  judge: {
    model: string
    reasoningEffort: ReasoningEffort
  }
  maxInfrastructureRetries: number
  retryDelayMs: number
  invocationTimeoutMs: number
  thresholds: {
    judgeControlAccuracy: number
    guidedRequiredSignalRate: number
    guidedForbiddenSignalCount: number
  }
}

export interface TrialSpec {
  id: string
  caseId: string
  model: string
  reasoningEffort: ReasoningEffort
  condition: EvaluationCondition
  trial: number
}

export interface SignalDecision {
  signal: string
  observed: boolean
  evidence: string
}

export interface JudgeOutput {
  caseId: string
  pass: boolean
  requiredSignals: SignalDecision[]
  forbiddenSignals: SignalDecision[]
  summary: string
}

export interface CodexCommand {
  executable: string
  args: string[]
  cwd: string
  prompt: string
  timeoutMs: number
}

export interface CodexCommandResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

export interface ParsedCodexEvents {
  events: JsonObject[]
  finalMessage: string | null
  usage: JsonObject | null
  threadId: string | null
  effectiveModel: string | null
  completed: boolean
  failed: boolean
}

interface EvaluationDefinition {
  config: EvaluationConfig
  cases: EvaluationCase[]
  rubric: string
  judgeSchema: JsonObject
  sources: {
    cases: string
    config: string
    rubric: string
    judgeSchema: string
    runner: string
    agentGuidance: string
  }
  hashes: Record<string, string>
}

interface AttemptRecord {
  attempt: number
  command: CodexCommand
  result: CodexCommandResult
  parsed: ParsedCodexEvents | null
  infrastructureError: string | null
}

interface SuccessfulAttempt<T> {
  attempts: AttemptRecord[]
  value: T
}

interface ControlResult {
  id: string
  caseId: string
  kind: 'positive' | 'negative'
  expectedPass: boolean
  expectedObservedSignals: string[]
  actualPass: boolean
  signalDecisionsCorrect: boolean
  correct: boolean
  judgment: JudgeOutput
  attempts: number
  effectiveModel: string | null
  usage: JsonObject | null
}

interface TrialResult {
  spec: TrialSpec
  agentResponse: string
  finalDocument: string | null
  finalDocumentStatus: FinalDocumentStatus
  workspaceStatus: TrialWorkspaceStatus
  workspaceViolations: TrialWorkspaceViolation[]
  pass: boolean
  judgment: JudgeOutput
  agentAttempts: number
  judgeAttempts: number
  usage: {
    agent: JsonObject | null
    judge: JsonObject | null
  }
  effectiveModels: {
    agent: string | null
    judge: string | null
  }
}

interface GitProvenance {
  commit: string
  branch: string
  dirty: boolean
}

interface ModelCatalogEntry {
  slug: string
  displayName: string | null
  description: string | null
  defaultReasoningLevel: string | null
  supportedReasoningLevels: string[]
  contextWindow: number | null
  compHash: string | null
  serviceTiers: string[]
}

type JsonObject = { [key: string]: JsonValue }
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]

const projectRoot = path.resolve(__dirname, '../..')
const evaluationDirectory = path.join(
  projectRoot,
  'evals/annotation-interpretation'
)
const runnerSourcePath = path.join(
  projectRoot,
  'scripts/annotation-interpretation-eval.ts'
)

const commonConfigOverrides = Object.freeze([
  'approval_policy="never"',
  'agents.enabled=false',
  'apps._default.enabled=false',
  'web_search="disabled"',
  'tools.web_search=false',
  'features.skill_mcp_dependency_install=false',
  'shell_environment_policy.inherit="core"',
  'shell_environment_policy.ignore_default_excludes=false',
  'project_doc_max_bytes=0'
])

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

async function readSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(evaluationDirectory, relativePath), 'utf8')
}

function parseJsonObject(source: string, label: string): JsonObject {
  const value = JSON.parse(source) as unknown
  if (!isObject(value)) throw new Error(`${label} must contain a JSON object`)
  return value
}

function parseJsonArray(source: string, label: string): unknown[] {
  const value = JSON.parse(source) as unknown
  if (!Array.isArray(value)) throw new Error(`${label} must contain a JSON array`)
  return value
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates`)
  }
}

function parseControlArtifact(value: unknown, label: string): ControlArtifact {
  if (
    !isObject(value) ||
    typeof value.finalDocument !== 'string' ||
    typeof value.agentResponse !== 'string' ||
    !isStringArray(value.observedSignals)
  ) {
    throw new Error(
      `${label} must contain finalDocument, agentResponse, and observedSignals`
    )
  }
  return {
    finalDocument: value.finalDocument,
    agentResponse: value.agentResponse,
    observedSignals: value.observedSignals
  }
}

function parseCases(source: string): EvaluationCase[] {
  const rawCases = parseJsonArray(source, 'cases.json')
  return rawCases.map((rawCase, index) => {
    if (!isObject(rawCase)) throw new Error(`Case ${index + 1} must be an object`)
    const review = rawCase.review
    const controls = rawCase.controls
    if (
      typeof rawCase.id !== 'string' ||
      typeof rawCase.description !== 'string' ||
      !isObject(review) ||
      typeof review.source !== 'string' ||
      !Array.isArray(review.annotations) ||
      !isStringArray(rawCase.requiredSignals) ||
      !isStringArray(rawCase.forbiddenSignals) ||
      !isObject(controls) ||
      !isObject(controls.positive) ||
      !isObject(controls.negative)
    ) {
      throw new Error(`Case ${index + 1} has an invalid shape`)
    }
    const caseId = rawCase.id
    const annotations = review.annotations.map((annotation, annotationIndex) => {
      if (
        !isObject(annotation) ||
        typeof annotation.block !== 'string' ||
        typeof annotation.feedback !== 'string'
      ) {
        throw new Error(
          `Case ${caseId} annotation ${annotationIndex + 1} is invalid`
        )
      }
      const sourceEdit = annotation.sourceEdit
      if (sourceEdit !== undefined && (
        !isObject(sourceEdit) ||
        typeof sourceEdit.original !== 'string' ||
        typeof sourceEdit.current !== 'string'
      )) {
        throw new Error(
          `Case ${caseId} annotation ${annotationIndex + 1} source edit is invalid`
        )
      }
      return sourceEdit === undefined
        ? { block: annotation.block, feedback: annotation.feedback }
        : {
            block: annotation.block,
            feedback: annotation.feedback,
            sourceEdit: {
              original: sourceEdit.original as string,
              current: sourceEdit.current as string
            }
          }
    })
    return {
      id: caseId,
      description: rawCase.description,
      review: { source: review.source, annotations },
      requiredSignals: rawCase.requiredSignals,
      forbiddenSignals: rawCase.forbiddenSignals,
      controls: {
        positive: parseControlArtifact(
          controls.positive,
          `${caseId} positive control`
        ),
        negative: parseControlArtifact(
          controls.negative,
          `${caseId} negative control`
        )
      }
    }
  })
}

function parseReasoningEffort(value: unknown, label: string): ReasoningEffort {
  if (!['low', 'medium', 'high', 'xhigh'].includes(String(value))) {
    throw new Error(`${label} is not a supported reasoning effort`)
  }
  return value as ReasoningEffort
}

function requiredNumber(
  object: JsonObject,
  key: string,
  label: string
): number {
  const value = object[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}.${key} must be a finite number`)
  }
  return value
}

function parseConfig(source: string): EvaluationConfig {
  const raw = parseJsonObject(source, 'config.json')
  if (!Array.isArray(raw.conditions) || !Array.isArray(raw.models)) {
    throw new Error('config.json conditions and models must be arrays')
  }
  const conditions = raw.conditions.map((condition) => {
    if (condition !== 'guided' && condition !== 'unguided') {
      throw new Error(`Unknown evaluation condition: ${JSON.stringify(condition)}`)
    }
    return condition
  })
  const models = raw.models.map((model, index) => {
    if (!isObject(model) || typeof model.model !== 'string') {
      throw new Error(`Model ${index + 1} is invalid`)
    }
    return {
      model: model.model,
      reasoningEffort: parseReasoningEffort(
        model.reasoningEffort,
        `models[${index}].reasoningEffort`
      )
    }
  })
  if (!isObject(raw.judge) || typeof raw.judge.model !== 'string') {
    throw new Error('config.json judge is invalid')
  }
  if (!isObject(raw.thresholds)) {
    throw new Error('config.json thresholds are invalid')
  }
  return {
    schemaVersion: requiredNumber(raw, 'schemaVersion', 'config'),
    runnerVersion: requiredNumber(raw, 'runnerVersion', 'config'),
    trialsPerCondition: requiredNumber(raw, 'trialsPerCondition', 'config'),
    conditions,
    models,
    judge: {
      model: raw.judge.model,
      reasoningEffort: parseReasoningEffort(
        raw.judge.reasoningEffort,
        'judge.reasoningEffort'
      )
    },
    maxInfrastructureRetries: requiredNumber(
      raw,
      'maxInfrastructureRetries',
      'config'
    ),
    retryDelayMs: requiredNumber(raw, 'retryDelayMs', 'config'),
    invocationTimeoutMs: requiredNumber(raw, 'invocationTimeoutMs', 'config'),
    thresholds: {
      judgeControlAccuracy: requiredNumber(
        raw.thresholds,
        'judgeControlAccuracy',
        'thresholds'
      ),
      guidedRequiredSignalRate: requiredNumber(
        raw.thresholds,
        'guidedRequiredSignalRate',
        'thresholds'
      ),
      guidedForbiddenSignalCount: requiredNumber(
        raw.thresholds,
        'guidedForbiddenSignalCount',
        'thresholds'
      )
    }
  }
}

function validateDefinition(definition: EvaluationDefinition): void {
  const { cases, config, judgeSchema, rubric } = definition
  if (config.schemaVersion !== 1 || config.runnerVersion !== 5) {
    throw new Error('Only annotation evaluation schema 1 and runner version 5 are supported')
  }
  if (!Number.isInteger(config.trialsPerCondition) || config.trialsPerCondition < 1) {
    throw new Error('trialsPerCondition must be a positive integer')
  }
  if (
    !Number.isInteger(config.maxInfrastructureRetries) ||
    config.maxInfrastructureRetries < 0
  ) {
    throw new Error('maxInfrastructureRetries must be a non-negative integer')
  }
  if (config.retryDelayMs < 0 || config.invocationTimeoutMs <= 0) {
    throw new Error('Retry delay and invocation timeout must be valid durations')
  }
  assertUnique(config.conditions, 'conditions')
  assertUnique(config.models.map(({ model }) => model), 'models')
  assertUnique(cases.map(({ id }) => id), 'case ids')
  if (cases.length === 0 || config.models.length === 0) {
    throw new Error('At least one case and evaluated model are required')
  }
  if (
    config.conditions.length !== 2 ||
    !config.conditions.includes('guided') ||
    !config.conditions.includes('unguided')
  ) {
    throw new Error('Version 1 requires exactly guided and unguided conditions')
  }
  for (const evaluationCase of cases) {
    assertUnique(evaluationCase.requiredSignals, `${evaluationCase.id} required signals`)
    assertUnique(evaluationCase.forbiddenSignals, `${evaluationCase.id} forbidden signals`)
    if (evaluationCase.review.annotations.length === 0) {
      throw new Error(`${evaluationCase.id} must include at least one annotation`)
    }
    if (
      evaluationCase.requiredSignals.length === 0 ||
      evaluationCase.forbiddenSignals.length === 0
    ) {
      throw new Error(`${evaluationCase.id} must define required and forbidden signals`)
    }
    for (const kind of ['positive', 'negative'] as const) {
      const control = evaluationCase.controls[kind]
      assertUnique(
        control.observedSignals,
        `${evaluationCase.id} ${kind} control observed signals`
      )
      const expectedPass = evaluationCase.requiredSignals.every((signal) =>
        control.observedSignals.includes(signal)
      ) && evaluationCase.forbiddenSignals.every((signal) =>
        !control.observedSignals.includes(signal)
      )
      if (expectedPass !== (kind === 'positive')) {
        throw new Error(
          `${evaluationCase.id} ${kind} control has inconsistent expected signals`
        )
      }
    }
  }
  if (rubric.trim().length === 0) throw new Error('rubric.md must not be empty')
  if (
    judgeSchema.type !== 'object' ||
    judgeSchema.additionalProperties !== false
  ) {
    throw new Error('Judge schema must be a closed object schema')
  }
  for (const threshold of Object.values(config.thresholds)) {
    if (threshold < 0 || threshold > 1) {
      throw new Error('Evaluation thresholds must be between zero and one')
    }
  }
}

async function loadDefinition(): Promise<EvaluationDefinition> {
  const [
    casesSource,
    configSource,
    rubricSource,
    schemaSource,
    runnerSource
  ] = await Promise.all([
    readSource('cases.json'),
    readSource('config.json'),
    readSource('rubric.md'),
    readSource('judge-output.schema.json'),
    fs.readFile(runnerSourcePath, 'utf8')
  ])
  const agentGuidanceSource = `${JSON.stringify({
    fixedContract: FIXED_CONTRACT,
    interpretationPolicy: DEFAULT_INTERPRETATION_POLICY
  }, null, 2)}\n`
  const sources = {
    cases: casesSource,
    config: configSource,
    rubric: rubricSource,
    judgeSchema: schemaSource,
    runner: runnerSource,
    agentGuidance: agentGuidanceSource
  }
  const definition: EvaluationDefinition = {
    cases: parseCases(casesSource),
    config: parseConfig(configSource),
    rubric: rubricSource,
    judgeSchema: parseJsonObject(schemaSource, 'judge-output.schema.json'),
    sources,
    hashes: Object.fromEntries(
      Object.entries(sources).map(([name, source]) => [name, sha256(source)])
    )
  }
  validateDefinition(definition)
  return definition
}

export function buildMatrix(
  config: EvaluationConfig,
  cases: readonly EvaluationCase[]
): TrialSpec[] {
  const trials: TrialSpec[] = []
  for (const evaluationCase of cases) {
    for (const model of config.models) {
      for (const condition of config.conditions) {
        for (let trial = 1; trial <= config.trialsPerCondition; trial += 1) {
          trials.push({
            id: [
              evaluationCase.id,
              model.model,
              condition,
              String(trial)
            ].join('__'),
            caseId: evaluationCase.id,
            model: model.model,
            reasoningEffort: model.reasoningEffort,
            condition,
            trial
          })
        }
      }
    }
  }
  return trials
}

export function buildAgentPrompt(
  condition: EvaluationCondition
): string {
  const guidance = condition === 'guided'
    ? [
        '',
        'Markover guidance:',
        FIXED_CONTRACT,
        DEFAULT_INTERPRETATION_POLICY
      ]
    : []
  return [
    'Respond to the Markover review in review.json.',
    'The reviewed Markdown is document.md.',
    'Read both files, make any useful revision directly in document.md, and then respond naturally to the reviewer.',
    'Address the review as a real document task. Do not mention this evaluation or invent facts not supported by the review.',
    'Do not create, rename, or delete files.',
    ...guidance,
    ''
  ].join('\n')
}

interface JudgePromptInput {
  evaluationCase: EvaluationCase
  rubric: string
  agentResponse?: string
  finalDocument?: string | null
  finalDocumentStatus?: FinalDocumentStatus
}

export function buildJudgePrompt(input: JudgePromptInput): string {
  const { evaluationCase } = input
  const finalDocument = input.finalDocument === undefined
    ? evaluationCase.review.source
    : input.finalDocument ?? `<document.md ${input.finalDocumentStatus ?? 'invalid'}>`
  const finalDocumentStatus = input.finalDocumentStatus ?? 'regular'
  return [
    'Evaluate this annotation-interpretation outcome using the supplied rubric.',
    'Return only the structured JSON required by the output schema.',
    '',
    input.rubric.trim(),
    '',
    '## Case',
    `Case ID: ${evaluationCase.id}`,
    `Description: ${evaluationCase.description}`,
    '',
    'Required signals:',
    JSON.stringify(evaluationCase.requiredSignals, null, 2),
    '',
    'Forbidden signals:',
    JSON.stringify(evaluationCase.forbiddenSignals, null, 2),
    '',
    '## Review',
    JSON.stringify(evaluationCase.review, null, 2),
    '',
    '## Original document',
    evaluationCase.review.source,
    '',
    '## Final document',
    `Status: ${finalDocumentStatus}`,
    finalDocument,
    '',
    '## Agent response',
    input.agentResponse ?? '',
    ''
  ].join('\n')
}

interface BuildCodexArgsInput {
  model: string
  reasoningEffort: ReasoningEffort
  workspace: string
  sandbox: 'read-only' | 'workspace-write'
  schemaPath?: string
  disableShell?: boolean
}

export function buildCodexArgs(input: BuildCodexArgsInput): string[] {
  const args = [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    '--json',
    '--model',
    input.model,
    '--sandbox',
    input.sandbox,
    '--config',
    `model_reasoning_effort="${input.reasoningEffort}"`
  ]
  for (const override of commonConfigOverrides) {
    args.push('--config', override)
  }
  args.push(
    '--config',
    `features.shell_tool=${input.disableShell === true ? 'false' : 'true'}`
  )
  if (input.sandbox === 'workspace-write') {
    args.push('--config', 'sandbox_workspace_write.network_access=false')
  }
  if (input.schemaPath !== undefined) {
    args.push('--output-schema', input.schemaPath)
  }
  args.push('--cd', input.workspace, '-')
  return args
}

export function parseCodexJsonl(source: string): ParsedCodexEvents {
  const events = source.split('\n').filter((line) => line.trim().length > 0)
    .map((line, index) => {
      let value: unknown
      try {
        value = JSON.parse(line) as unknown
      } catch {
        throw new Error(`Codex JSONL line ${index + 1} is not valid JSON`)
      }
      if (!isObject(value)) {
        throw new Error(`Codex JSONL line ${index + 1} is not an object`)
      }
      return value
    })
  let finalMessage: string | null = null
  let usage: JsonObject | null = null
  let threadId: string | null = null
  let effectiveModel: string | null = null
  let completed = false
  let failed = false
  for (const event of events) {
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      threadId = event.thread_id
    }
    if (
      (event.type === 'thread.started' || event.type === 'turn.started') &&
      typeof event.model === 'string'
    ) {
      effectiveModel = event.model
    }
    if (event.type === 'turn.completed') {
      completed = true
      if (isObject(event.usage)) usage = event.usage
    }
    if (event.type === 'turn.failed') failed = true
    if (event.type === 'item.completed' && isObject(event.item)) {
      if (
        event.item.type === 'agent_message' &&
        typeof event.item.text === 'string'
      ) {
        finalMessage = event.item.text
      }
    }
  }
  return {
    events,
    finalMessage,
    usage,
    threadId,
    effectiveModel,
    completed,
    failed
  }
}

function parseSignalDecisions(value: unknown, label: string): SignalDecision[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((decision, index) => {
    if (
      !isObject(decision) ||
      typeof decision.signal !== 'string' ||
      typeof decision.observed !== 'boolean' ||
      typeof decision.evidence !== 'string'
    ) {
      throw new Error(`${label}[${index}] is invalid`)
    }
    return {
      signal: decision.signal,
      observed: decision.observed,
      evidence: decision.evidence
    }
  })
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    actual.every((value) => expected.includes(value))
}

export function validateJudgeOutput(
  value: unknown,
  evaluationCase: EvaluationCase
): JudgeOutput {
  if (
    !isObject(value) ||
    value.caseId !== evaluationCase.id ||
    typeof value.pass !== 'boolean' ||
    typeof value.summary !== 'string'
  ) {
    throw new Error(`Judge output for ${evaluationCase.id} has an invalid shape`)
  }
  const requiredSignals = parseSignalDecisions(
    value.requiredSignals,
    'requiredSignals'
  )
  const forbiddenSignals = parseSignalDecisions(
    value.forbiddenSignals,
    'forbiddenSignals'
  )
  assertUnique(requiredSignals.map(({ signal }) => signal), 'judge required signals')
  assertUnique(forbiddenSignals.map(({ signal }) => signal), 'judge forbidden signals')
  if (!sameMembers(
    requiredSignals.map(({ signal }) => signal),
    evaluationCase.requiredSignals
  )) {
    throw new Error('Judge output does not cover the exact required signal set')
  }
  if (!sameMembers(
    forbiddenSignals.map(({ signal }) => signal),
    evaluationCase.forbiddenSignals
  )) {
    throw new Error('Judge output does not cover the exact forbidden signal set')
  }
  const derivedPass = requiredSignals.every(({ observed }) => observed) &&
    forbiddenSignals.every(({ observed }) => !observed)
  if (value.pass !== derivedPass) {
    throw new Error('Judge pass value is inconsistent with its signal decisions')
  }
  return {
    caseId: value.caseId,
    pass: value.pass,
    requiredSignals,
    forbiddenSignals,
    summary: value.summary
  }
}

export function controlJudgmentMatches(
  control: ControlArtifact,
  judgment: JudgeOutput
): boolean {
  return [
    ...judgment.requiredSignals,
    ...judgment.forbiddenSignals
  ].every(({ signal, observed }) =>
    observed === control.observedSignals.includes(signal)
  )
}

function replaceAll(source: string, value: string, replacement: string): string {
  return value.length === 0 ? source : source.split(value).join(replacement)
}

export function sanitizeEvidenceText(
  source: string,
  replacements: ReadonlyArray<readonly [string, string]>
): string {
  return replacements.reduce(
    (sanitized, [value, replacement]) => replaceAll(
      replaceAll(sanitized, value, replacement),
      value.replaceAll('\\', '/'),
      replacement
    ),
    source
  )
}

export function sanitizeEvidenceValue(
  value: unknown,
  replacements: ReadonlyArray<readonly [string, string]>
): unknown {
  if (typeof value === 'string') {
    return sanitizeEvidenceText(value, replacements)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeEvidenceValue(item, replacements))
  }
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      sanitizeEvidenceValue(item, replacements)
    ]))
  }
  return value
}

function redactCommandOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCommandOutput)
  if (!isObject(value)) return value
  const redacted = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactCommandOutput(item)])
  )
  if (value.type === 'command_execution') {
    for (const key of ['aggregated_output', 'output', 'stdout', 'stderr']) {
      if (typeof value[key] === 'string') redacted[key] = '<redacted command output>'
    }
  }
  return redacted
}

export function sanitizeCodexJsonl(
  source: string,
  replacements: ReadonlyArray<readonly [string, string]>
): string {
  return source.split('\n').map((line) => {
    if (line.trim().length === 0) return ''
    try {
      const event = sanitizeEvidenceValue(JSON.parse(line) as unknown, replacements)
      return JSON.stringify(redactCommandOutput(event))
    } catch {
      return JSON.stringify({ type: 'redacted_unparseable_event' })
    }
  }).join('\n')
}

export async function invokeCodex(
  command: CodexCommand
): Promise<CodexCommandResult> {
  const started = process.hrtime.bigint()
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let timedOut = false
    let forceKill: NodeJS.Timeout | null = null
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceKill = setTimeout(() => child.kill('SIGKILL'), 5000)
    }, command.timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timeout)
      if (forceKill !== null) clearTimeout(forceKill)
      reject(error)
    })
    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout)
      if (forceKill !== null) clearTimeout(forceKill)
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        durationMs,
        timedOut
      })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(command.prompt)
  })
}

function infrastructureFailure(
  result: CodexCommandResult,
  parsed: ParsedCodexEvents | null
): string | null {
  if (result.timedOut) return 'Codex invocation timed out'
  if (result.exitCode !== 0) return `Codex exited with status ${String(result.exitCode)}`
  if (parsed === null) return 'Codex JSONL could not be parsed'
  if (parsed.failed) return 'Codex emitted turn.failed'
  if (!parsed.completed) return 'Codex did not emit turn.completed'
  if (parsed.finalMessage === null) return 'Codex did not emit a final agent message'
  return null
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, value)
}

async function writeEvidenceJson(
  filePath: string,
  value: unknown,
  replacements: ReadonlyArray<readonly [string, string]>
): Promise<void> {
  await writeJson(filePath, sanitizeEvidenceValue(value, replacements))
}

async function writeEvidenceText(
  filePath: string,
  value: string,
  replacements: ReadonlyArray<readonly [string, string]>
): Promise<void> {
  await writeText(filePath, sanitizeEvidenceText(value, replacements))
}

function commandEvidence(
  command: CodexCommand,
  replacements: ReadonlyArray<readonly [string, string]>
): JsonObject {
  return {
    executable: sanitizeEvidenceText(command.executable, replacements),
    args: command.args.map((argument) => sanitizeEvidenceText(
      argument,
      replacements
    )),
    cwd: sanitizeEvidenceText(command.cwd, replacements),
    promptSha256: sha256(command.prompt),
    timeoutMs: command.timeoutMs
  }
}

async function recordAttempt(
  evidenceDirectory: string,
  rawDirectory: string,
  record: AttemptRecord,
  replacements: ReadonlyArray<readonly [string, string]>
): Promise<void> {
  const attemptName = `attempt-${record.attempt}`
  const sanitizedStdout = sanitizeCodexJsonl(record.result.stdout, replacements)
  const sanitizedStderr = sanitizeEvidenceText(record.result.stderr, replacements)
  await Promise.all([
    writeEvidenceText(
      path.join(evidenceDirectory, attemptName, 'prompt.md'),
      record.command.prompt,
      replacements
    ),
    writeText(path.join(evidenceDirectory, attemptName, 'codex.jsonl'), sanitizedStdout),
    writeText(path.join(evidenceDirectory, attemptName, 'stderr.txt'), sanitizedStderr),
    writeEvidenceJson(
      path.join(evidenceDirectory, attemptName, 'command.json'),
      commandEvidence(record.command, replacements),
      replacements
    ),
    writeEvidenceJson(
      path.join(evidenceDirectory, attemptName, 'metadata.json'),
      {
        attempt: record.attempt,
        exitCode: record.result.exitCode,
        signal: record.result.signal,
        timedOut: record.result.timedOut,
        durationMs: record.result.durationMs,
        infrastructureError: record.infrastructureError,
        threadId: record.parsed?.threadId ?? null,
        effectiveModel: record.parsed?.effectiveModel ?? null,
        usage: record.parsed?.usage ?? null
      },
      replacements
    ),
    writeText(path.join(rawDirectory, attemptName, 'codex.raw.jsonl'), record.result.stdout),
    writeText(path.join(rawDirectory, attemptName, 'stderr.raw.txt'), record.result.stderr)
  ])
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds === 0) return
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export interface RetryInput<T> {
  command: CodexCommand
  evidenceDirectory: string
  rawDirectory: string
  replacements: ReadonlyArray<readonly [string, string]>
  maxRetries: number
  retryDelayMs: number
  decode: (message: string) => T
  beforeAttempt?: (attempt: number) => Promise<void>
  invoke?: (command: CodexCommand) => Promise<CodexCommandResult>
}

export async function executeWithInfrastructureRetries<T>(
  input: RetryInput<T>
): Promise<SuccessfulAttempt<T>> {
  const attempts: AttemptRecord[] = []
  for (let attempt = 1; attempt <= input.maxRetries + 1; attempt += 1) {
    let result: CodexCommandResult
    let parsed: ParsedCodexEvents | null = null
    let failure: string | null = null
    try {
      await input.beforeAttempt?.(attempt)
      result = await (input.invoke ?? invokeCodex)(input.command)
      try {
        parsed = parseCodexJsonl(result.stdout)
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
      failure ??= infrastructureFailure(result, parsed)
      if (failure === null && parsed !== null && parsed.finalMessage !== null) {
        try {
          const value = input.decode(parsed.finalMessage)
          const record = { attempt, command: input.command, result, parsed, infrastructureError: null }
          attempts.push(record)
          await recordAttempt(
            input.evidenceDirectory,
            input.rawDirectory,
            record,
            input.replacements
          )
          return { attempts, value }
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error)
        }
      }
    } catch (error) {
      result = {
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: 0,
        timedOut: false
      }
      failure = `Failed to invoke Codex: ${result.stderr}`
    }
    const record = {
      attempt,
      command: input.command,
      result,
      parsed,
      infrastructureError: failure ?? 'Unknown infrastructure failure'
    }
    attempts.push(record)
    await recordAttempt(
      input.evidenceDirectory,
      input.rawDirectory,
      record,
      input.replacements
    )
    if (attempt <= input.maxRetries) {
      await delay(input.retryDelayMs * attempt)
    }
  }
  const last = attempts.at(-1)
  throw new Error(
    `Infrastructure retries exhausted: ${last?.infrastructureError ?? 'unknown error'}`
  )
}

async function initializeWorkspace(workspace: string): Promise<void> {
  await fs.mkdir(workspace, { recursive: true })
  await execFileAsync('git', ['init', '--quiet'], { cwd: workspace })
}

export async function resetTrialWorkspace(
  workspace: string,
  review: EvaluationCase['review']
): Promise<void> {
  await fs.rm(workspace, { recursive: true, force: true })
  await initializeWorkspace(workspace)
  await Promise.all([
    writeText(path.join(workspace, 'document.md'), review.source),
    writeJson(path.join(workspace, 'review.json'), review)
  ])
}

export async function inspectTrialWorkspace(
  workspace: string,
  review: EvaluationCase['review']
): Promise<{
  status: TrialWorkspaceStatus
  violations: TrialWorkspaceViolation[]
}> {
  const violations: TrialWorkspaceViolation[] = []
  let entries: string[]
  try {
    entries = await fs.readdir(workspace)
  } catch (error) {
    const code = isObject(error) && typeof error.code === 'string'
      ? error.code
      : null
    if (code !== 'ENOENT') throw error
    return { status: 'invalid', violations: ['workspace-missing'] }
  }
  if (entries.some((entry) => ![
    '.git',
    'document.md',
    'review.json'
  ].includes(entry))) {
    violations.push('unexpected-entry')
  }
  try {
    const metadata = await fs.lstat(path.join(workspace, '.git'))
    if (!metadata.isDirectory()) violations.push('workspace-metadata-invalid')
  } catch (error) {
    const code = isObject(error) && typeof error.code === 'string'
      ? error.code
      : null
    if (code !== 'ENOENT') throw error
    violations.push('workspace-metadata-missing')
  }
  try {
    const reviewPath = path.join(workspace, 'review.json')
    const reviewStat = await fs.lstat(reviewPath)
    if (!reviewStat.isFile() || reviewStat.size > 1024 * 1024) {
      violations.push('review-invalid')
    } else if (
      await fs.readFile(reviewPath, 'utf8') !== `${JSON.stringify(review, null, 2)}\n`
    ) {
      violations.push('review-modified')
    }
  } catch (error) {
    const code = isObject(error) && typeof error.code === 'string'
      ? error.code
      : null
    if (code !== 'ENOENT') throw error
    violations.push('review-missing')
  }
  return {
    status: violations.length === 0 ? 'valid' : 'invalid',
    violations
  }
}

export function trialPass(
  finalDocumentStatus: FinalDocumentStatus,
  workspaceStatus: TrialWorkspaceStatus,
  judgment: JudgeOutput
): boolean {
  return finalDocumentStatus === 'regular' &&
    workspaceStatus === 'valid' &&
    judgment.pass
}

function findCase(
  cases: readonly EvaluationCase[],
  caseId: string
): EvaluationCase {
  const evaluationCase = cases.find(({ id }) => id === caseId)
  if (evaluationCase === undefined) throw new Error(`Unknown case: ${caseId}`)
  return evaluationCase
}

function lastParsed(attempts: readonly AttemptRecord[]): ParsedCodexEvents {
  const parsed = attempts.at(-1)?.parsed
  if (parsed === undefined || parsed === null) {
    throw new Error('Successful attempt is missing parsed Codex events')
  }
  return parsed
}

interface RuntimeDirectories {
  runRoot: string
  evidence: string
  raw: string
  workspaces: string
  judgeWorkspace: string
}

function runtimeDirectories(runId: string): RuntimeDirectories {
  const runRoot = path.join(projectRoot, 'tmp/annotation-interpretation', runId)
  return {
    runRoot,
    evidence: path.join(runRoot, 'evidence'),
    raw: path.join(runRoot, 'raw'),
    workspaces: path.join(runRoot, 'workspaces'),
    judgeWorkspace: path.join(runRoot, 'judge-workspace')
  }
}

function replacementsFor(
  directories: RuntimeDirectories,
  workspace?: string
): ReadonlyArray<readonly [string, string]> {
  return [
    ...(workspace === undefined
      ? []
      : [[workspace, '<workspace>'] as const]),
    [directories.runRoot, '<run-root>'],
    [projectRoot, '<repository>']
  ]
}

async function runJudge(
  input: {
    codexPath: string
    definition: EvaluationDefinition
    directories: RuntimeDirectories
    schemaPath: string
    evaluationCase: EvaluationCase
    prompt: string
    evidenceDirectory: string
    rawDirectory: string
  }
): Promise<SuccessfulAttempt<JudgeOutput>> {
  const config = input.definition.config
  const command: CodexCommand = {
    executable: input.codexPath,
    args: buildCodexArgs({
      model: config.judge.model,
      reasoningEffort: config.judge.reasoningEffort,
      workspace: input.directories.judgeWorkspace,
      sandbox: 'read-only',
      schemaPath: input.schemaPath,
      disableShell: true
    }),
    cwd: projectRoot,
    prompt: input.prompt,
    timeoutMs: config.invocationTimeoutMs
  }
  return executeWithInfrastructureRetries({
    command,
    evidenceDirectory: input.evidenceDirectory,
    rawDirectory: input.rawDirectory,
    replacements: replacementsFor(input.directories),
    maxRetries: config.maxInfrastructureRetries,
    retryDelayMs: config.retryDelayMs,
    decode: (message) => validateJudgeOutput(
      JSON.parse(message) as unknown,
      input.evaluationCase
    )
  })
}

async function runControls(
  codexPath: string,
  definition: EvaluationDefinition,
  directories: RuntimeDirectories,
  schemaPath: string
): Promise<ControlResult[]> {
  const results: ControlResult[] = []
  const totalControls = definition.cases.length * 2
  for (const evaluationCase of definition.cases) {
    for (const kind of ['positive', 'negative'] as const) {
      const id = `${evaluationCase.id}__${kind}`
      const expectedPass = kind === 'positive'
      const control = evaluationCase.controls[kind]
      const output = await runJudge({
        codexPath,
        definition,
        directories,
        schemaPath,
        evaluationCase,
        prompt: buildJudgePrompt({
          evaluationCase,
          rubric: definition.rubric,
          agentResponse: control.agentResponse,
          finalDocument: control.finalDocument,
          finalDocumentStatus: 'regular'
        }),
        evidenceDirectory: path.join(directories.evidence, 'controls', id, 'judge'),
        rawDirectory: path.join(directories.raw, 'controls', id, 'judge')
      })
      const signalDecisionsCorrect = controlJudgmentMatches(control, output.value)
      const result: ControlResult = {
        id,
        caseId: evaluationCase.id,
        kind,
        expectedPass,
        expectedObservedSignals: control.observedSignals,
        actualPass: output.value.pass,
        signalDecisionsCorrect,
        correct: output.value.pass === expectedPass && signalDecisionsCorrect,
        judgment: output.value,
        attempts: output.attempts.length,
        effectiveModel: lastParsed(output.attempts).effectiveModel,
        usage: lastParsed(output.attempts).usage
      }
      results.push(result)
      await writeEvidenceJson(
        path.join(directories.evidence, 'controls', id, 'result.json'),
        result,
        replacementsFor(directories)
      )
      process.stdout.write(`judge control ${results.length}/${totalControls}: ${id}\n`)
    }
  }
  await writeEvidenceJson(
    path.join(directories.evidence, 'controls.json'),
    results,
    replacementsFor(directories)
  )
  return results
}

async function runTrial(
  codexPath: string,
  definition: EvaluationDefinition,
  directories: RuntimeDirectories,
  schemaPath: string,
  spec: TrialSpec
): Promise<TrialResult> {
  const evaluationCase = findCase(definition.cases, spec.caseId)
  const workspace = path.join(directories.workspaces, spec.id)
  const agentPrompt = buildAgentPrompt(spec.condition)
  const agentCommand: CodexCommand = {
    executable: codexPath,
    args: buildCodexArgs({
      model: spec.model,
      reasoningEffort: spec.reasoningEffort,
      workspace,
      sandbox: 'workspace-write'
    }),
    cwd: projectRoot,
    prompt: agentPrompt,
    timeoutMs: definition.config.invocationTimeoutMs
  }
  const agent = await executeWithInfrastructureRetries({
    command: agentCommand,
    evidenceDirectory: path.join(directories.evidence, 'trials', spec.id, 'agent'),
    rawDirectory: path.join(directories.raw, 'trials', spec.id, 'agent'),
    replacements: replacementsFor(directories, workspace),
    maxRetries: definition.config.maxInfrastructureRetries,
    retryDelayMs: definition.config.retryDelayMs,
    decode: (message) => message,
    beforeAttempt: async () => resetTrialWorkspace(
      workspace,
      evaluationCase.review
    )
  })
  let finalDocument: string | null = null
  let finalDocumentStatus: TrialResult['finalDocumentStatus'] = 'missing'
  try {
    const documentPath = path.join(workspace, 'document.md')
    const documentStat = await fs.lstat(documentPath)
    if (documentStat.isFile() && documentStat.size <= 1024 * 1024) {
      finalDocument = await fs.readFile(documentPath, 'utf8')
      finalDocumentStatus = 'regular'
    } else {
      finalDocumentStatus = 'invalid'
    }
  } catch (error) {
    const code = isObject(error) && typeof error.code === 'string'
      ? error.code
      : null
    if (code !== 'ENOENT') throw error
  }
  const workspaceInspection = await inspectTrialWorkspace(
    workspace,
    evaluationCase.review
  )
  const judge = await runJudge({
    codexPath,
    definition,
    directories,
    schemaPath,
    evaluationCase,
    prompt: buildJudgePrompt({
      evaluationCase,
      rubric: definition.rubric,
      agentResponse: agent.value,
      finalDocument,
      finalDocumentStatus
    }),
    evidenceDirectory: path.join(directories.evidence, 'trials', spec.id, 'judge'),
    rawDirectory: path.join(directories.raw, 'trials', spec.id, 'judge')
  })
  const result: TrialResult = {
    spec,
    agentResponse: agent.value,
    finalDocument,
    finalDocumentStatus,
    workspaceStatus: workspaceInspection.status,
    workspaceViolations: workspaceInspection.violations,
    pass: trialPass(
      finalDocumentStatus,
      workspaceInspection.status,
      judge.value
    ),
    judgment: judge.value,
    agentAttempts: agent.attempts.length,
    judgeAttempts: judge.attempts.length,
    usage: {
      agent: lastParsed(agent.attempts).usage,
      judge: lastParsed(judge.attempts).usage
    },
    effectiveModels: {
      agent: lastParsed(agent.attempts).effectiveModel,
      judge: lastParsed(judge.attempts).effectiveModel
    }
  }
  const trialDirectory = path.join(directories.evidence, 'trials', spec.id)
  const evidenceReplacements = replacementsFor(directories, workspace)
  await Promise.all([
    writeEvidenceJson(
      path.join(trialDirectory, 'trial.json'),
      result,
      evidenceReplacements
    ),
    writeEvidenceJson(
      path.join(trialDirectory, 'review.json'),
      evaluationCase.review,
      evidenceReplacements
    ),
    writeEvidenceText(
      path.join(trialDirectory, 'original.md'),
      evaluationCase.review.source,
      evidenceReplacements
    ),
    writeEvidenceText(
      path.join(trialDirectory, 'final.md'),
      finalDocument ?? `<document.md ${finalDocumentStatus}>\n`,
      evidenceReplacements
    ),
    writeEvidenceText(
      path.join(trialDirectory, 'agent-response.md'),
      agent.value,
      evidenceReplacements
    ),
    writeEvidenceJson(
      path.join(trialDirectory, 'judgment.json'),
      judge.value,
      evidenceReplacements
    ),
  ])
  return result
}

async function gitProvenance(): Promise<GitProvenance> {
  const [commit, branch, status] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot }),
    execFileAsync('git', ['branch', '--show-current'], { cwd: projectRoot }),
    execFileAsync('git', ['status', '--porcelain'], { cwd: projectRoot })
  ])
  return {
    commit: commit.stdout.trim(),
    branch: branch.stdout.trim(),
    dirty: status.stdout.trim().length > 0
  }
}

async function codexVersion(codexPath: string): Promise<string> {
  const result = await execFileAsync(codexPath, ['--version'], { cwd: projectRoot })
  return result.stdout.trim()
}

async function selectedModelCatalog(
  codexPath: string,
  models: readonly string[]
): Promise<ModelCatalogEntry[]> {
  const result = await execFileAsync(
    codexPath,
    ['debug', 'models', '--bundled'],
    { cwd: projectRoot, maxBuffer: 20 * 1024 * 1024 }
  )
  const catalog = parseJsonObject(result.stdout, 'Codex model catalog')
  if (!Array.isArray(catalog.models)) {
    throw new Error('Codex model catalog does not contain a models array')
  }
  const catalogModels = catalog.models
  return models.map((model) => {
    const entry = catalogModels.find((candidate) =>
      isObject(candidate) && candidate.slug === model
    )
    if (!isObject(entry) || typeof entry.slug !== 'string') {
      throw new Error(`Codex bundled catalog does not contain ${model}`)
    }
    const supportedReasoningLevels = Array.isArray(entry.supported_reasoning_levels)
      ? entry.supported_reasoning_levels.flatMap((level) => {
          if (!isObject(level) || typeof level.effort !== 'string') return []
          return [level.effort]
        })
      : []
    const serviceTiers = Array.isArray(entry.service_tiers)
      ? entry.service_tiers.flatMap((tier) => {
          if (!isObject(tier) || typeof tier.id !== 'string') return []
          return [tier.id]
        })
      : []
    return {
      slug: entry.slug,
      displayName: typeof entry.display_name === 'string'
        ? entry.display_name
        : null,
      description: typeof entry.description === 'string'
        ? entry.description
        : null,
      defaultReasoningLevel: typeof entry.default_reasoning_level === 'string'
        ? entry.default_reasoning_level
        : null,
      supportedReasoningLevels,
      contextWindow: typeof entry.context_window === 'number'
        ? entry.context_window
        : null,
      compHash: typeof entry.comp_hash === 'string' ? entry.comp_hash : null,
      serviceTiers
    }
  })
}

function validateCatalogSelections(
  config: EvaluationConfig,
  catalog: readonly ModelCatalogEntry[]
): void {
  const selections = [...config.models, config.judge]
  for (const selection of selections) {
    const entry = catalog.find(({ slug }) => slug === selection.model)
    if (entry === undefined) {
      throw new Error(`Model catalog selection is missing ${selection.model}`)
    }
    if (!entry.supportedReasoningLevels.includes(selection.reasoningEffort)) {
      throw new Error(
        `${selection.model} does not advertise ${selection.reasoningEffort} reasoning`
      )
    }
  }
}

function summarizeTrials(trials: readonly TrialResult[]): JsonObject[] {
  const groups = new Map<string, TrialResult[]>()
  for (const trial of trials) {
    const key = `${trial.spec.model}__${trial.spec.condition}`
    groups.set(key, [...(groups.get(key) ?? []), trial])
  }
  return [...groups.entries()].map(([key, groupedTrials]) => {
    const [model, condition] = key.split('__')
    return {
      model: model ?? '',
      condition: condition ?? '',
      trials: groupedTrials.length,
      passed: groupedTrials.filter(({ pass }) => pass).length,
      failed: groupedTrials.filter(({ pass }) => !pass).length
    }
  })
}

function aggregateGates(
  definition: EvaluationDefinition,
  controls: readonly ControlResult[],
  trials: readonly TrialResult[]
): JsonObject {
  const guided = trials.filter(({ spec }) => spec.condition === 'guided')
  const required = guided.flatMap(({ judgment }) => judgment.requiredSignals)
  const forbidden = guided.flatMap(({ judgment }) => judgment.forbiddenSignals)
  const controlAccuracy = controls.filter(({ correct }) => correct).length /
    controls.length
  const requiredSignalRate = required.filter(({ observed }) => observed).length /
    required.length
  const forbiddenSignalCount = forbidden.filter(({ observed }) => observed).length
  const guidedPassCount = guided.filter(({ pass }) => pass).length
  const pass =
    controlAccuracy === definition.config.thresholds.judgeControlAccuracy &&
    requiredSignalRate === definition.config.thresholds.guidedRequiredSignalRate &&
    forbiddenSignalCount === definition.config.thresholds.guidedForbiddenSignalCount &&
    guidedPassCount === guided.length
  return {
    pass,
    controlAccuracy,
    requiredSignalRate,
    forbiddenSignalCount,
    guidedPassCount,
    guidedTrialCount: guided.length,
    thresholds: definition.config.thresholds
  }
}

function reportScalar(value: JsonValue | undefined, label: string): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }
  throw new Error(`Evaluation manifest ${label} must be a scalar`)
}

function reportMarkdown(manifest: JsonObject): string {
  const gates = manifest.gates
  const provenance = manifest.provenance
  const summary = manifest.summary
  if (!isObject(gates) || !isObject(provenance) || !Array.isArray(summary)) {
    throw new Error('Cannot render an incomplete evaluation manifest')
  }
  const rows = summary.filter(isObject).map((row) =>
    `| ${reportScalar(row.model, 'summary.model')} | ${reportScalar(row.condition, 'summary.condition')} | ${reportScalar(row.trials, 'summary.trials')} | ${reportScalar(row.passed, 'summary.passed')} | ${reportScalar(row.failed, 'summary.failed')} |`
  )
  const status = gates.pass === true ? 'PASS' : 'FAIL'
  return [
    '# Annotation interpretation evaluation',
    '',
    `**Result: ${status}**`,
    '',
    `Run ID: \`${reportScalar(manifest.runId, 'runId')}\``,
    '',
    '## Reliability gates',
    '',
    '| Gate | Observed | Required |',
    '| --- | ---: | ---: |',
    `| Judge control accuracy | ${reportScalar(gates.controlAccuracy, 'gates.controlAccuracy')} | 1 |`,
    `| Guided required-signal rate | ${reportScalar(gates.requiredSignalRate, 'gates.requiredSignalRate')} | 1 |`,
    `| Guided forbidden-signal count | ${reportScalar(gates.forbiddenSignalCount, 'gates.forbiddenSignalCount')} | 0 |`,
    `| Guided passing trials | ${reportScalar(gates.guidedPassCount, 'gates.guidedPassCount')}/${reportScalar(gates.guidedTrialCount, 'gates.guidedTrialCount')} | all |`,
    '',
    '## Trial summary',
    '',
    '| Model | Condition | Trials | Passed | Failed |',
    '| --- | --- | ---: | ---: | ---: |',
    ...rows,
    '',
    'The unguided condition is descriptive. It does not impose an improvement gate when the baseline already passes.',
    '',
    '## Provenance',
    '',
    `- Git commit: \`${reportScalar(provenance.gitCommit, 'provenance.gitCommit')}\``,
    `- Git branch: \`${reportScalar(provenance.gitBranch, 'provenance.gitBranch')}\``,
    `- Codex CLI: \`${reportScalar(provenance.codexVersion, 'provenance.codexVersion')}\``,
    `- Started: ${reportScalar(manifest.startedAt, 'startedAt')}`,
    `- Completed: ${reportScalar(manifest.completedAt, 'completedAt')}`,
    '',
    '## Evidence layout',
    '',
    '- `manifest.json` contains machine-readable configuration, provenance, gates, control results, and trial summaries.',
    '- `inputs/` contains the exact versioned cases, config, rubric, judge schema, and agent guidance used by the run.',
    '- `controls/` contains every structured judge-control invocation and judgment.',
    '- `trials/` contains prompts, sanitized JSONL event streams, stderr, timing, usage, responses, documents, workspace-integrity status, and judgments.',
    '',
    'Absolute local paths are replaced with stable placeholders, and command-output payloads are redacted from published JSONL. Credentials and unrelated environment variables are never collected.',
    ''
  ].join('\n')
}

function createRunId(commit: string, configHash: string): string {
  const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
  return `${timestamp}__${commit.slice(0, 7)}__${configHash.slice(0, 8)}`
}

function validateRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(runId)) {
    throw new Error('Run ID must be path-safe and at most 120 characters')
  }
}

export function pinnedJudgeSchemaPath(evidenceDirectory: string): string {
  return path.join(evidenceDirectory, 'inputs', 'judge-output.schema.json')
}

async function writeInputs(
  definition: EvaluationDefinition,
  evidenceDirectory: string
): Promise<string> {
  const inputDirectory = path.join(evidenceDirectory, 'inputs')
  await Promise.all([
    writeText(path.join(inputDirectory, 'cases.json'), definition.sources.cases),
    writeText(path.join(inputDirectory, 'config.json'), definition.sources.config),
    writeText(path.join(inputDirectory, 'rubric.md'), definition.sources.rubric),
    writeText(
      path.join(inputDirectory, 'judge-output.schema.json'),
      definition.sources.judgeSchema
    ),
    writeText(path.join(inputDirectory, 'runner.ts'), definition.sources.runner),
    writeText(
      path.join(inputDirectory, 'agent-guidance.json'),
      definition.sources.agentGuidance
    )
  ])
  return pinnedJudgeSchemaPath(evidenceDirectory)
}

export async function reserveRunRoot(runRoot: string): Promise<void> {
  await fs.mkdir(path.dirname(runRoot), { recursive: true })
  try {
    await fs.mkdir(runRoot)
  } catch (error) {
    const code = isObject(error) && typeof error.code === 'string'
      ? error.code
      : null
    if (code === 'EEXIST') {
      throw new Error(`Run workspace already exists: ${runRoot}`, { cause: error })
    }
    throw error
  }
}

export async function sanitizeEvidenceDirectory(
  directory: string,
  replacements: ReadonlyArray<readonly [string, string]>
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await sanitizeEvidenceDirectory(entryPath, replacements)
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`Evidence contains a non-regular entry: ${entryPath}`)
    }
    const source = await fs.readFile(entryPath, 'utf8')
    const sanitized = sanitizeEvidenceText(source, replacements)
    if (sanitized !== source) await fs.writeFile(entryPath, sanitized)
  }
}

async function publishEvidence(
  runId: string,
  evidenceDirectory: string,
  replacements: ReadonlyArray<readonly [string, string]>
): Promise<string> {
  const resultsRoot = path.join(evaluationDirectory, 'results')
  const resultDirectory = path.join(resultsRoot, runId)
  const stagingDirectory = path.join(
    resultsRoot,
    `.${runId}.staging-${String(process.pid)}`
  )
  try {
    await fs.access(resultDirectory)
    throw new Error(`Result directory already exists: ${resultDirectory}`)
  } catch (error) {
    const code = isObject(error) && typeof error.code === 'string'
      ? error.code
      : null
    if (code !== 'ENOENT') throw error
  }
  await fs.mkdir(resultsRoot, { recursive: true })
  await fs.rm(stagingDirectory, { recursive: true, force: true })
  try {
    await fs.cp(evidenceDirectory, stagingDirectory, { recursive: true })
    await sanitizeEvidenceDirectory(stagingDirectory, replacements)
    await fs.rename(stagingDirectory, resultDirectory)
    return resultDirectory
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true })
    throw error
  }
}

interface RunOptions {
  codexPath: string
  requestedRunId?: string
}

interface RunResult {
  resultDirectory: string
  passed: boolean
}

async function runEvaluation(options: RunOptions): Promise<RunResult> {
  const definition = await loadDefinition()
  const git = await gitProvenance()
  if (git.dirty) {
    throw new Error('Live evaluations require a clean Git worktree for reproducible provenance')
  }
  const version = await codexVersion(options.codexPath)
  const selectedModels = [
    ...definition.config.models.map(({ model }) => model),
    definition.config.judge.model
  ]
  const catalog = await selectedModelCatalog(
    options.codexPath,
    [...new Set(selectedModels)]
  )
  validateCatalogSelections(definition.config, catalog)
  const runId = options.requestedRunId ?? createRunId(
    git.commit,
    definition.hashes.config ?? ''
  )
  validateRunId(runId)
  const directories = runtimeDirectories(runId)
  await reserveRunRoot(directories.runRoot)
  await Promise.all([
    fs.mkdir(directories.evidence, { recursive: true }),
    fs.mkdir(directories.raw, { recursive: true }),
    fs.mkdir(directories.workspaces, { recursive: true }),
    initializeWorkspace(directories.judgeWorkspace)
  ])
  const judgeSchemaPath = await writeInputs(definition, directories.evidence)
  const startedAt = new Date().toISOString()
  let controls: ControlResult[] = []
  const trials: TrialResult[] = []
  try {
    controls = await runControls(
      options.codexPath,
      definition,
      directories,
      judgeSchemaPath
    )
    const controlAccuracy = controls.filter(({ correct }) => correct).length /
      controls.length
    if (controlAccuracy !== definition.config.thresholds.judgeControlAccuracy) {
      throw new Error(
        `Judge controls failed (${controls.filter(({ correct }) => correct).length}/${controls.length}); matrix not started`
      )
    }
    const matrix = buildMatrix(definition.config, definition.cases)
    for (const spec of matrix) {
      const result = await runTrial(
        options.codexPath,
        definition,
        directories,
        judgeSchemaPath,
        spec
      )
      trials.push(result)
      process.stdout.write(`trial ${trials.length}/${matrix.length}: ${spec.id}\n`)
    }
  } catch (error) {
    const message = sanitizeEvidenceText(
      error instanceof Error ? error.message : String(error),
      replacementsFor(directories)
    )
    await writeJson(path.join(directories.evidence, 'incomplete-run.json'), {
      runId,
      status: controls.length === definition.cases.length * 2 &&
        controls.some(({ correct }) => !correct)
        ? 'judge-controls-failed'
        : 'infrastructure-incomplete',
      startedAt,
      stoppedAt: new Date().toISOString(),
      controlsCompleted: controls.length,
      trialsCompleted: trials.length,
      error: message
    })
    throw error
  }
  const completedAt = new Date().toISOString()
  const gates = aggregateGates(definition, controls, trials)
  const manifest = {
    schemaVersion: 1,
    runnerVersion: definition.config.runnerVersion,
    runId,
    status: gates.pass === true ? 'passed' : 'failed',
    startedAt,
    completedAt,
    configuration: definition.config as unknown as JsonObject,
    provenance: {
      gitCommit: git.commit,
      gitBranch: git.branch,
      gitDirty: git.dirty,
      codexVersion: version,
      modelCatalog: catalog,
      sourceHashes: definition.hashes,
      requestedModels: definition.config.models,
      requestedJudge: definition.config.judge
    },
    sanitization: {
      absolutePaths: 'replaced with <repository>, <run-root>, or <workspace>',
      commandOutput: 'redacted from published JSONL event streams',
      environment: 'not collected',
      credentials: 'not collected',
      rawUnsanitizedLocation: 'ignored tmp/ only; not published'
    },
    counts: {
      controls: controls.length,
      agentExecutions: trials.length,
      trialJudgments: trials.length,
      successfulCodexInvocations: controls.length + (trials.length * 2),
      infrastructureAttempts: controls.reduce(
        (sum, control) => sum + control.attempts,
        0
      ) + trials.reduce(
        (sum, trial) => sum + trial.agentAttempts + trial.judgeAttempts,
        0
      )
    },
    gates,
    summary: summarizeTrials(trials),
    controls,
    trials: trials.map((trial) => ({
      id: trial.spec.id,
      caseId: trial.spec.caseId,
      model: trial.spec.model,
      reasoningEffort: trial.spec.reasoningEffort,
      condition: trial.spec.condition,
      trial: trial.spec.trial,
      pass: trial.pass,
      finalDocumentStatus: trial.finalDocumentStatus,
      workspaceStatus: trial.workspaceStatus,
      workspaceViolations: trial.workspaceViolations,
      agentAttempts: trial.agentAttempts,
      judgeAttempts: trial.judgeAttempts,
      usage: trial.usage,
      effectiveModels: trial.effectiveModels
    }))
  } as unknown as JsonObject
  const evidenceReplacements = replacementsFor(directories)
  await Promise.all([
    writeEvidenceJson(
      path.join(directories.evidence, 'manifest.json'),
      manifest,
      evidenceReplacements
    ),
    writeEvidenceText(
      path.join(directories.evidence, 'README.md'),
      reportMarkdown(manifest),
      evidenceReplacements
    )
  ])
  return {
    resultDirectory: await publishEvidence(
      runId,
      directories.evidence,
      evidenceReplacements
    ),
    passed: gates.pass === true
  }
}

interface CliOptions {
  command: 'run' | 'validate'
  codexPath: string
  runId?: string
}

function parseCli(args: readonly string[]): CliOptions {
  const [command, ...flags] = args
  if (command !== 'run' && command !== 'validate') {
    throw new Error('Usage: annotation-interpretation-eval <validate|run> [--codex=PATH] [--run-id=ID]')
  }
  let codexPath = 'codex'
  let runId: string | undefined
  for (const flag of flags) {
    if (flag.startsWith('--codex=')) {
      codexPath = flag.slice('--codex='.length)
    } else if (flag.startsWith('--run-id=')) {
      runId = flag.slice('--run-id='.length)
    } else {
      throw new Error(`Unknown argument: ${flag}`)
    }
  }
  if (codexPath.length === 0) throw new Error('--codex must not be empty')
  if (runId !== undefined) validateRunId(runId)
  return runId === undefined
    ? { command, codexPath }
    : { command, codexPath, runId }
}

async function validateCommand(codexPath: string): Promise<void> {
  const definition = await loadDefinition()
  const matrix = buildMatrix(definition.config, definition.cases)
  const version = await codexVersion(codexPath)
  const catalog = await selectedModelCatalog(codexPath, [
    ...new Set([
      ...definition.config.models.map(({ model }) => model),
      definition.config.judge.model
    ])
  ])
  validateCatalogSelections(definition.config, catalog)
  process.stdout.write(`${JSON.stringify({
    valid: true,
    cases: definition.cases.length,
    controls: definition.cases.length * 2,
    agentExecutions: matrix.length,
    trialJudgments: matrix.length,
    successfulCodexInvocations: (definition.cases.length * 2) + (matrix.length * 2),
    codexVersion: version,
    models: catalog.map(({ slug }) => slug),
    hashes: definition.hashes
  }, null, 2)}\n`)
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseCli(args)
  if (options.command === 'validate') {
    await validateCommand(options.codexPath)
    return
  }
  const result = await runEvaluation({
    codexPath: options.codexPath,
    ...(options.runId === undefined ? {} : { requestedRunId: options.runId })
  })
  process.stdout.write(`Published evaluation evidence: ${result.resultDirectory}\n`)
  if (!result.passed) process.exitCode = 2
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

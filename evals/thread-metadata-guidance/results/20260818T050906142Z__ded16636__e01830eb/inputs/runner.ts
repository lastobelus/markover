#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  buildCodexArgs,
  invokeCodex,
  parseCodexJsonl,
  type CodexCommandResult,
  type ReasoningEffort
} from './annotation-interpretation-eval'
import { helpPayload } from './markover'

const execFileAsync = promisify(execFile)

export type GuidanceCondition = 'baseline' | 'candidate'
export type JsonObject = { [key: string]: JsonValue }
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]

export interface GuidanceConfig {
  schemaVersion: number
  runnerVersion: number
  trialsPerCondition: number
  conditions: GuidanceCondition[]
  models: Array<{
    model: string
    reasoningEffort: ReasoningEffort
  }>
  maxInfrastructureRetries: number
  invocationTimeoutMs: number
}

export interface GuidanceCase {
  id: string
  scenario: string
  command: 'open' | 'get-for-review'
  expectedArguments: Record<string, string>
  forbiddenFlags: string[]
  expectedAgentThread: JsonObject | null
}

export interface GuidanceTrialSpec {
  id: string
  caseId: string
  condition: GuidanceCondition
  model: string
  reasoningEffort: ReasoningEffort
  repetition: number
}

export interface GuidanceOutput {
  caseId: string
  markoverInput: string
  portableAgentThreadJson: string
  inputMode: string
  explanation: string
}

export interface GuidanceScore {
  exactConformance: boolean
  commandPresent: boolean
  argumentsMatch: boolean
  portableShapeMatches: boolean
  inputModeCorrect: boolean
  jsonInputMisconception: boolean
  guessedMetadata: boolean
  failures: string[]
}

export interface GuidanceTrialResult {
  spec: GuidanceTrialSpec
  output: GuidanceOutput | null
  score: GuidanceScore
  infrastructureAttempts: number
  effectiveModel: string | null
  usage: JsonObject | null
  durationMs: number
}

export interface GuidanceDecision {
  outcome: 'plan-structured-guidance' | 'retain-current-guidance'
  candidateCriticalErrors: number
  noCaseModelRegression: boolean
  improvesBothModels: boolean
  modelTotals: Array<{
    model: string
    baselinePassed: number
    candidatePassed: number
    improved: boolean
  }>
  strata: Array<{
    caseId: string
    model: string
    baselinePassed: number
    candidatePassed: number
    regressed: boolean
  }>
}

interface EvaluationDefinition {
  config: GuidanceConfig
  cases: GuidanceCase[]
  candidate: JsonObject
  outputSchema: JsonObject
  sources: Record<string, string>
  hashes: Record<string, string>
}

interface ModelCatalogEntry {
  slug: string
  supportedReasoningLevels: string[]
  compHash: string | null
}

interface InvocationAttempt {
  result: CodexCommandResult
  parsed: ReturnType<typeof parseCodexJsonl> | null
  infrastructureError: string | null
}

const projectRoot = path.resolve(__dirname, '../..')
const evaluationDirectory = path.join(
  projectRoot,
  'evals/thread-metadata-guidance'
)
const metadataFlags = new Set([
  '--thread-id',
  '--handoff-key',
  '--thread-host-kind',
  '--thread-host-provider',
  '--thread-host-thread-id',
  '--thread-host-machine',
  '--input'
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

function parseJsonObject(source: string, label: string): JsonObject {
  const value = JSON.parse(source) as unknown
  if (!isObject(value)) throw new Error(`${label} must contain a JSON object`)
  return value
}

function parseReasoningEffort(value: unknown, label: string): ReasoningEffort {
  if (
    value !== 'low' &&
    value !== 'medium' &&
    value !== 'high' &&
    value !== 'xhigh'
  ) {
    throw new Error(`${label} is not a supported reasoning effort`)
  }
  return value
}

function parseConfig(source: string): GuidanceConfig {
  const value = parseJsonObject(source, 'config.json')
  if (
    typeof value.schemaVersion !== 'number' ||
    typeof value.runnerVersion !== 'number' ||
    typeof value.trialsPerCondition !== 'number' ||
    !Array.isArray(value.conditions) ||
    !Array.isArray(value.models) ||
    typeof value.maxInfrastructureRetries !== 'number' ||
    typeof value.invocationTimeoutMs !== 'number'
  ) {
    throw new Error('config.json has an invalid shape')
  }
  const conditions = value.conditions.map((condition, index) => {
    if (condition !== 'baseline' && condition !== 'candidate') {
      throw new Error(`conditions[${index}] is invalid`)
    }
    return condition
  })
  const models = value.models.map((model, index) => {
    if (!isObject(model) || typeof model.model !== 'string') {
      throw new Error(`models[${index}] is invalid`)
    }
    return {
      model: model.model,
      reasoningEffort: parseReasoningEffort(
        model.reasoningEffort,
        `models[${index}].reasoningEffort`
      )
    }
  })
  return {
    schemaVersion: value.schemaVersion,
    runnerVersion: value.runnerVersion,
    trialsPerCondition: value.trialsPerCondition,
    conditions,
    models,
    maxInfrastructureRetries: value.maxInfrastructureRetries,
    invocationTimeoutMs: value.invocationTimeoutMs
  }
}

function parseCases(source: string): GuidanceCase[] {
  const value = JSON.parse(source) as unknown
  if (!Array.isArray(value)) throw new Error('cases.json must contain an array')
  return value.map((item, index) => {
    if (
      !isObject(item) ||
      typeof item.id !== 'string' ||
      typeof item.scenario !== 'string' ||
      (item.command !== 'open' && item.command !== 'get-for-review') ||
      !isObject(item.expectedArguments) ||
      !Object.values(item.expectedArguments).every(
        (argument) => typeof argument === 'string'
      ) ||
      !isStringArray(item.forbiddenFlags) ||
      (item.expectedAgentThread !== null && !isObject(item.expectedAgentThread))
    ) {
      throw new Error(`cases[${index}] has an invalid shape`)
    }
    return {
      id: item.id,
      scenario: item.scenario,
      command: item.command,
      expectedArguments: item.expectedArguments as Record<string, string>,
      forbiddenFlags: item.forbiddenFlags,
      expectedAgentThread: item.expectedAgentThread
    }
  })
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates`)
  }
}

function validateDefinition(definition: EvaluationDefinition): void {
  const { config, cases, candidate, outputSchema } = definition
  if (config.schemaVersion !== 1 || config.runnerVersion !== 1) {
    throw new Error('Only guidance evaluation schema and runner version 1 are supported')
  }
  if (
    config.trialsPerCondition !== 2 ||
    config.conditions.length !== 2 ||
    config.conditions[0] !== 'baseline' ||
    config.conditions[1] !== 'candidate'
  ) {
    throw new Error('Version 1 requires baseline/candidate with two repetitions')
  }
  if (config.models.length !== 2 || cases.length !== 3) {
    throw new Error('Version 1 requires exactly two models and three cases')
  }
  if (
    !Number.isInteger(config.maxInfrastructureRetries) ||
    config.maxInfrastructureRetries < 0 ||
    !Number.isFinite(config.invocationTimeoutMs) ||
    config.invocationTimeoutMs <= 0
  ) {
    throw new Error('Retry and timeout configuration must be finite and nonnegative')
  }
  assertUnique(cases.map(({ id }) => id), 'case IDs')
  assertUnique(config.models.map(({ model }) => model), 'model IDs')
  for (const item of cases) {
    assertUnique(Object.keys(item.expectedArguments), `${item.id} expected flags`)
    assertUnique(item.forbiddenFlags, `${item.id} forbidden flags`)
    if (item.forbiddenFlags.some((flag) => flag in item.expectedArguments)) {
      throw new Error(`${item.id} has a flag that is both expected and forbidden`)
    }
  }
  if (candidate.inputMode !== 'flags-only') {
    throw new Error('candidate.json must declare flags-only input')
  }
  if (candidate.example === undefined) {
    throw new Error('candidate.json must include its non-normative example')
  }
  if (
    outputSchema.type !== 'object' ||
    outputSchema.additionalProperties !== false
  ) {
    throw new Error('output.schema.json must be a closed object schema')
  }
  if (buildMatrix(config, cases).length !== 24) {
    throw new Error('The finite guidance matrix must contain 24 trials')
  }
}

async function loadDefinition(): Promise<EvaluationDefinition> {
  const names = ['config.json', 'cases.json', 'candidate.json', 'output.schema.json']
  const sources: Record<string, string> = {}
  await Promise.all(names.map(async (name) => {
    sources[name] = await fs.readFile(path.join(evaluationDirectory, name), 'utf8')
  }))
  const definition = {
    config: parseConfig(sources['config.json'] ?? ''),
    cases: parseCases(sources['cases.json'] ?? ''),
    candidate: parseJsonObject(sources['candidate.json'] ?? '', 'candidate.json'),
    outputSchema: parseJsonObject(
      sources['output.schema.json'] ?? '',
      'output.schema.json'
    ),
    sources,
    hashes: Object.fromEntries(
      Object.entries(sources).map(([name, source]) => [name, sha256(source)])
    )
  }
  validateDefinition(definition)
  return definition
}

export function buildMatrix(
  config: GuidanceConfig,
  cases: readonly GuidanceCase[]
): GuidanceTrialSpec[] {
  const matrix: GuidanceTrialSpec[] = []
  for (const item of cases) {
    for (const model of config.models) {
      for (const condition of config.conditions) {
        for (
          let repetition = 1;
          repetition <= config.trialsPerCondition;
          repetition += 1
        ) {
          matrix.push({
            id: `${item.id}__${model.model}__${condition}__${repetition}`,
            caseId: item.id,
            condition,
            model: model.model,
            reasoningEffort: model.reasoningEffort,
            repetition
          })
        }
      }
    }
  }
  return matrix
}

function canonicalHelpPayload(): JsonObject {
  const previousInvocation = process.env.MARKOVER_INVOCATION
  delete process.env.MARKOVER_INVOCATION
  try {
    return structuredClone(helpPayload()) as unknown as JsonObject
  } finally {
    if (previousInvocation === undefined) {
      delete process.env.MARKOVER_INVOCATION
    } else {
      process.env.MARKOVER_INVOCATION = previousInvocation
    }
  }
}

export function conditionPayload(
  condition: GuidanceCondition,
  baseline: JsonObject,
  candidate: JsonObject
): JsonObject {
  return condition === 'baseline'
    ? structuredClone(baseline)
    : { ...structuredClone(baseline), threadMetadata: structuredClone(candidate) }
}

export function buildPrompt(
  item: GuidanceCase,
  guidance: JsonObject
): string {
  return [
    'Use only the supplied Markover machine-readable help and scenario.',
    'Prepare the Markover metadata input an agent would use and state the portable review.agentThread a successful command stores.',
    'Return exactly the requested structured output.',
    'portableAgentThreadJson must be a JSON serialization of review.agentThread, not a Markdown code block.',
    'inputMode must state whether metadata is provided through flags, JSON input, or another mode.',
    '',
    '## Machine-readable help',
    JSON.stringify(guidance, null, 2),
    '',
    '## Scenario',
    item.scenario,
    '',
    `Use caseId ${item.id}.`
  ].join('\n')
}

export function parseGuidanceOutput(source: string): GuidanceOutput {
  const value = parseJsonObject(source, 'Agent output')
  for (const field of [
    'caseId',
    'markoverInput',
    'portableAgentThreadJson',
    'inputMode',
    'explanation'
  ]) {
    if (typeof value[field] !== 'string') {
      throw new Error(`Agent output ${field} must be a string`)
    }
  }
  return value as unknown as GuidanceOutput
}

function tokenizeShellLike(source: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  for (const character of source.trim()) {
    if (escaped) {
      token += character
      escaped = false
    } else if (character === '\\' && quote !== "'") {
      escaped = true
    } else if (quote !== null) {
      if (character === quote) quote = null
      else token += character
    } else if (character === "'" || character === '"') {
      quote = character
    } else if (/\s/.test(character)) {
      if (token.length > 0) {
        tokens.push(token)
        token = ''
      }
    } else {
      token += character
    }
  }
  if (escaped) token += '\\'
  if (token.length > 0) tokens.push(token)
  return tokens
}

function argumentMap(tokens: readonly string[]): {
  values: Map<string, string[]>
  malformedFlags: string[]
} {
  const values = new Map<string, string[]>()
  const malformedFlags: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined || !token.startsWith('--')) continue
    const equals = token.indexOf('=')
    const flag = equals === -1 ? token : token.slice(0, equals)
    const inline = equals === -1 ? null : token.slice(equals + 1)
    const next = tokens[index + 1]
    const value = inline ?? (
      next !== undefined && !next.startsWith('--') ? next : null
    )
    if (value === null || value.length === 0) {
      malformedFlags.push(flag)
      continue
    }
    values.set(flag, [...(values.get(flag) ?? []), value])
    if (inline === null) index += 1
  }
  return { values, malformedFlags }
}

function claimsJsonInput(inputMode: string): boolean {
  const normalized = inputMode.toLowerCase()
  if (!normalized.includes('json')) return false
  return !/(?:no|not|does not|isn.t|is not|without).{0,24}json|json.{0,24}(?:no|not|unsupported)/.test(
    normalized
  )
}

function containsUnexpectedValue(actual: unknown, expected: unknown): boolean {
  if (actual === null || expected === null) return actual !== expected && actual !== null
  if (typeof actual !== typeof expected) return true
  if (typeof expected === 'string') return actual !== expected
  if (!isObject(actual) || !isObject(expected)) return !isDeepStrictEqual(actual, expected)
  for (const [key, value] of Object.entries(actual)) {
    if (!(key in expected) || containsUnexpectedValue(value, expected[key])) return true
  }
  return false
}

function failedScore(reason: string): GuidanceScore {
  return {
    exactConformance: false,
    commandPresent: false,
    argumentsMatch: false,
    portableShapeMatches: false,
    inputModeCorrect: false,
    jsonInputMisconception: false,
    guessedMetadata: false,
    failures: [reason]
  }
}

export function scoreGuidanceOutput(
  item: GuidanceCase,
  output: GuidanceOutput
): GuidanceScore {
  const failures: string[] = []
  const tokens = tokenizeShellLike(output.markoverInput.replace(/^\$\s*/, ''))
  const commandPresent = tokens.includes(item.command)
  if (!commandPresent) failures.push(`missing ${item.command} command`)
  const parsedArguments = argumentMap(tokens)
  let argumentsMatch = parsedArguments.malformedFlags.length === 0
  if (parsedArguments.malformedFlags.length > 0) {
    failures.push('one or more flags has no value')
  }
  for (const [flag, expected] of Object.entries(item.expectedArguments)) {
    const values = parsedArguments.values.get(flag) ?? []
    if (values.length !== 1 || values[0] !== expected) {
      argumentsMatch = false
      failures.push(`${flag} does not have the expected single value`)
    }
  }
  for (const flag of item.forbiddenFlags) {
    if (parsedArguments.values.has(flag) || parsedArguments.malformedFlags.includes(flag)) {
      argumentsMatch = false
      failures.push(`${flag} must be absent`)
    }
  }
  for (const flag of metadataFlags) {
    if (
      parsedArguments.values.has(flag) &&
      !(flag in item.expectedArguments) &&
      !item.forbiddenFlags.includes(flag)
    ) {
      argumentsMatch = false
      failures.push(`${flag} is unexpected`)
    }
  }

  let portableShapeMatches = false
  let guessedMetadata = false
  try {
    const portableValue = JSON.parse(output.portableAgentThreadJson) as unknown
    portableShapeMatches = isDeepStrictEqual(
      portableValue,
      item.expectedAgentThread
    )
    guessedMetadata = containsUnexpectedValue(
      portableValue,
      item.expectedAgentThread
    )
  } catch {
    failures.push('portableAgentThreadJson is not valid JSON')
  }
  if (!portableShapeMatches && !failures.includes('portableAgentThreadJson is not valid JSON')) {
    failures.push('portable review.agentThread does not match the scenario')
  }
  if (guessedMetadata) failures.push('portable metadata contains a guessed value')

  const mode = output.inputMode.toLowerCase()
  const inputModeCorrect = mode.includes('flag') && !claimsJsonInput(mode)
  if (!inputModeCorrect) failures.push('input mode does not clearly state flags-only')
  const trimmedInput = output.markoverInput.trim()
  const jsonInputMisconception = (
    trimmedInput.startsWith('{') ||
    trimmedInput.startsWith('[') ||
    parsedArguments.values.has('--input') ||
    parsedArguments.malformedFlags.includes('--input') ||
    claimsJsonInput(mode)
  )
  if (jsonInputMisconception) failures.push('output treats JSON as Markover metadata input')
  if (output.caseId !== item.id) failures.push('caseId does not match')

  return {
    exactConformance: (
      output.caseId === item.id &&
      commandPresent &&
      argumentsMatch &&
      portableShapeMatches &&
      inputModeCorrect &&
      !jsonInputMisconception &&
      !guessedMetadata
    ),
    commandPresent,
    argumentsMatch,
    portableShapeMatches,
    inputModeCorrect,
    jsonInputMisconception,
    guessedMetadata,
    failures
  }
}

export function decideGuidance(
  results: readonly GuidanceTrialResult[],
  models: readonly string[],
  cases: readonly string[]
): GuidanceDecision {
  const passed = (
    model: string,
    condition: GuidanceCondition,
    caseId?: string
  ): number => results.filter((result) => (
    result.spec.model === model &&
    result.spec.condition === condition &&
    (caseId === undefined || result.spec.caseId === caseId) &&
    result.score.exactConformance
  )).length
  const modelTotals = models.map((model) => {
    const baselinePassed = passed(model, 'baseline')
    const candidatePassed = passed(model, 'candidate')
    return {
      model,
      baselinePassed,
      candidatePassed,
      improved: candidatePassed > baselinePassed
    }
  })
  const strata = cases.flatMap((caseId) => models.map((model) => {
    const baselinePassed = passed(model, 'baseline', caseId)
    const candidatePassed = passed(model, 'candidate', caseId)
    return {
      caseId,
      model,
      baselinePassed,
      candidatePassed,
      regressed: candidatePassed < baselinePassed
    }
  }))
  const candidateCriticalErrors = results.filter((result) => (
    result.spec.condition === 'candidate' &&
    (result.score.jsonInputMisconception || result.score.guessedMetadata)
  )).length
  const noCaseModelRegression = strata.every(({ regressed }) => !regressed)
  const improvesBothModels = modelTotals.every(({ improved }) => improved)
  return {
    outcome: (
      candidateCriticalErrors === 0 &&
      noCaseModelRegression &&
      improvesBothModels
    ) ? 'plan-structured-guidance' : 'retain-current-guidance',
    candidateCriticalErrors,
    noCaseModelRegression,
    improvesBothModels,
    modelTotals,
    strata
  }
}

function infrastructureFailure(
  result: CodexCommandResult,
  parsed: ReturnType<typeof parseCodexJsonl> | null
): string | null {
  if (result.timedOut) return 'Codex invocation timed out'
  if (result.exitCode !== 0) return `Codex exited with status ${String(result.exitCode)}`
  if (parsed === null) return 'Codex JSONL could not be parsed'
  if (parsed.failed) return 'Codex emitted turn.failed'
  if (!parsed.completed) return 'Codex did not emit turn.completed'
  if (parsed.finalMessage === null) return 'Codex did not emit a final agent message'
  return null
}

async function runInvocation(
  codexPath: string,
  spec: GuidanceTrialSpec,
  prompt: string,
  workspace: string,
  schemaPath: string,
  config: GuidanceConfig,
  rawDirectory: string
): Promise<{ attempts: InvocationAttempt[]; output: GuidanceOutput | null }> {
  const attempts: InvocationAttempt[] = []
  for (
    let attempt = 1;
    attempt <= config.maxInfrastructureRetries + 1;
    attempt += 1
  ) {
    const result = await invokeCodex({
      executable: codexPath,
      args: buildCodexArgs({
        model: spec.model,
        reasoningEffort: spec.reasoningEffort,
        workspace,
        sandbox: 'read-only',
        schemaPath,
        disableShell: true
      }),
      cwd: projectRoot,
      prompt,
      timeoutMs: config.invocationTimeoutMs
    })
    let parsed: ReturnType<typeof parseCodexJsonl> | null
    try {
      parsed = parseCodexJsonl(result.stdout)
    } catch {
      parsed = null
    }
    const infrastructureError = infrastructureFailure(result, parsed)
    attempts.push({ result, parsed, infrastructureError })
    await fs.mkdir(rawDirectory, { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(rawDirectory, `attempt-${attempt}.stdout.jsonl`), result.stdout),
      fs.writeFile(path.join(rawDirectory, `attempt-${attempt}.stderr.txt`), result.stderr)
    ])
    if (infrastructureError !== null) {
      if (attempt <= config.maxInfrastructureRetries) continue
      return { attempts, output: null }
    }
    const finalMessage = parsed?.finalMessage
    if (finalMessage === null || finalMessage === undefined) {
      return { attempts, output: null }
    }
    try {
      return { attempts, output: parseGuidanceOutput(finalMessage) }
    } catch {
      return { attempts, output: null }
    }
  }
  return { attempts, output: null }
}

function lastAttempt(attempts: readonly InvocationAttempt[]): InvocationAttempt {
  const attempt = attempts.at(-1)
  if (attempt === undefined) throw new Error('Invocation did not record an attempt')
  return attempt
}

async function initializeWorkspace(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  await execFileAsync('git', ['init', '--quiet'], { cwd: directory })
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function gitProvenance(): Promise<{
  commit: string
  branch: string
  dirty: boolean
}> {
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

async function modelCatalog(
  codexPath: string,
  models: readonly { model: string; reasoningEffort: ReasoningEffort }[]
): Promise<ModelCatalogEntry[]> {
  const result = await execFileAsync(
    codexPath,
    ['debug', 'models', '--bundled'],
    { cwd: projectRoot, maxBuffer: 20 * 1024 * 1024 }
  )
  const value = parseJsonObject(result.stdout, 'Codex model catalog')
  if (!Array.isArray(value.models)) {
    throw new Error('Codex model catalog does not contain a models array')
  }
  const catalogModels = value.models
  return models.map((selection) => {
    const entry = catalogModels.find((item) => (
      isObject(item) && item.slug === selection.model
    ))
    if (!isObject(entry) || typeof entry.slug !== 'string') {
      throw new Error(`Codex bundled catalog does not contain ${selection.model}`)
    }
    const levels = Array.isArray(entry.supported_reasoning_levels)
      ? entry.supported_reasoning_levels.flatMap((level) => (
        isObject(level) && typeof level.effort === 'string' ? [level.effort] : []
      ))
      : []
    if (!levels.includes(selection.reasoningEffort)) {
      throw new Error(
        `${selection.model} does not advertise ${selection.reasoningEffort} reasoning`
      )
    }
    return {
      slug: entry.slug,
      supportedReasoningLevels: levels,
      compHash: typeof entry.comp_hash === 'string' ? entry.comp_hash : null
    }
  })
}

function runId(commit: string, configHash: string): string {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '')
  return `${timestamp}__${commit.slice(0, 8)}__${configHash.slice(0, 8)}`
}

function reportString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function reportNumber(value: JsonValue | undefined, label: string): number {
  if (typeof value !== 'number') throw new Error(`${label} must be a number`)
  return value
}

function reportMarkdown(manifest: JsonObject): string {
  const decision = manifest.decision as JsonObject
  const modelTotals = decision.modelTotals as JsonObject[]
  const lines = [
    '# Thread-metadata guidance result',
    '',
    `Run: \`${reportString(manifest.runId, 'runId')}\``,
    '',
    '## Outcome',
    '',
    decision.outcome === 'plan-structured-guidance'
      ? 'The structured candidate met every gate. Plan the narrow projection-and-contract-test implementation.'
      : 'Retain the current prose-and-flags help. The structured candidate did not meet every precommitted gate.',
    '',
    '## Exact conformance',
    '',
    '| Model | Baseline | Candidate | Improved |',
    '| --- | ---: | ---: | --- |',
    ...modelTotals.map((item) => (
      `| ${reportString(item.model, 'model')} | ${reportNumber(item.baselinePassed, 'baselinePassed')}/6 | ${reportNumber(item.candidatePassed, 'candidatePassed')}/6 | ${item.improved === true ? 'yes' : 'no'} |`
    )),
    '',
    '## Gates',
    '',
    `- Candidate critical errors: ${reportNumber(decision.candidateCriticalErrors, 'candidateCriticalErrors')}.`,
    `- No case/model regression: ${decision.noCaseModelRegression === true ? 'pass' : 'fail'}.`,
    `- Improved in both models: ${decision.improvesBothModels === true ? 'pass' : 'fail'}.`,
    '',
    'The machine-readable manifest retains every trial output, deterministic score, input hash, model selection, and Git provenance. Raw Codex event streams remain in the ignored run workspace and are not published.',
    ''
  ]
  return lines.join('\n')
}

async function writeInputSnapshots(
  definition: EvaluationDefinition,
  baseline: JsonObject,
  evidenceDirectory: string
): Promise<string> {
  const inputDirectory = path.join(evidenceDirectory, 'inputs')
  await fs.mkdir(inputDirectory, { recursive: true })
  await Promise.all([
    ...Object.entries(definition.sources).map(([name, source]) => (
      fs.writeFile(path.join(inputDirectory, name), source)
    )),
    writeJson(path.join(inputDirectory, 'baseline-help.json'), baseline),
    fs.copyFile(
      path.join(projectRoot, 'scripts/thread-metadata-guidance-eval.ts'),
      path.join(inputDirectory, 'runner.ts')
    )
  ])
  return path.join(inputDirectory, 'output.schema.json')
}

async function publishResult(
  temporaryEvidence: string,
  resultDirectory: string
): Promise<void> {
  try {
    await fs.access(resultDirectory)
    throw new Error(`Result directory already exists: ${resultDirectory}`)
  } catch (error) {
    if (!isObject(error) || error.code !== 'ENOENT') throw error
  }
  await fs.mkdir(path.dirname(resultDirectory), { recursive: true })
  await fs.rename(temporaryEvidence, resultDirectory)
}

async function validateCommand(codexPath: string): Promise<void> {
  const definition = await loadDefinition()
  const version = await codexVersion(codexPath)
  const catalog = await modelCatalog(codexPath, definition.config.models)
  process.stdout.write(`${JSON.stringify({
    valid: true,
    cases: definition.cases.length,
    trials: buildMatrix(definition.config, definition.cases).length,
    conditions: definition.config.conditions,
    codexVersion: version,
    models: catalog.map(({ slug }) => slug),
    hashes: definition.hashes
  }, null, 2)}\n`)
}

async function runEvaluation(codexPath: string): Promise<{
  resultDirectory: string
  decision: GuidanceDecision
}> {
  const definition = await loadDefinition()
  const git = await gitProvenance()
  if (git.dirty) {
    throw new Error('Live guidance evaluations require a clean Git worktree')
  }
  const version = await codexVersion(codexPath)
  const catalog = await modelCatalog(codexPath, definition.config.models)
  const baseline = canonicalHelpPayload()
  const matrix = buildMatrix(definition.config, definition.cases)
  const id = runId(git.commit, definition.hashes['config.json'] ?? '')
  const runRoot = path.join(projectRoot, 'tmp/thread-metadata-guidance', id)
  const evidenceDirectory = path.join(runRoot, 'evidence')
  const rawRoot = path.join(runRoot, 'raw')
  const workspaceRoot = path.join(runRoot, 'workspaces')
  await fs.mkdir(evidenceDirectory, { recursive: true })
  const schemaPath = await writeInputSnapshots(
    definition,
    baseline,
    evidenceDirectory
  )
  const startedAt = new Date().toISOString()
  const results: GuidanceTrialResult[] = []
  for (const [index, spec] of matrix.entries()) {
    const item = definition.cases.find(({ id: caseId }) => caseId === spec.caseId)
    if (item === undefined) throw new Error(`Missing case ${spec.caseId}`)
    const workspace = path.join(workspaceRoot, spec.id)
    await initializeWorkspace(workspace)
    process.stderr.write(
      `[${index + 1}/${matrix.length}] ${spec.caseId} ${spec.model} ${spec.condition} repetition ${spec.repetition}\n`
    )
    const invocation = await runInvocation(
      codexPath,
      spec,
      buildPrompt(
        item,
        conditionPayload(spec.condition, baseline, definition.candidate)
      ),
      workspace,
      schemaPath,
      definition.config,
      path.join(rawRoot, spec.id)
    )
    const last = lastAttempt(invocation.attempts)
    const score = invocation.output === null
      ? failedScore(
        last.infrastructureError ?? 'agent output did not match the output contract'
      )
      : scoreGuidanceOutput(item, invocation.output)
    results.push({
      spec,
      output: invocation.output,
      score,
      infrastructureAttempts: invocation.attempts.length,
      effectiveModel: last.parsed?.effectiveModel ?? null,
      usage: last.parsed?.usage ?? null,
      durationMs: invocation.attempts.reduce(
        (total, attempt) => total + attempt.result.durationMs,
        0
      )
    })
  }
  const decision = decideGuidance(
    results,
    definition.config.models.map(({ model }) => model),
    definition.cases.map(({ id: caseId }) => caseId)
  )
  const baselineSource = `${JSON.stringify(baseline, null, 2)}\n`
  const runnerSource = await fs.readFile(
    path.join(projectRoot, 'scripts/thread-metadata-guidance-eval.ts'),
    'utf8'
  )
  const manifest = {
    format: 'markover-thread-metadata-guidance-eval',
    version: 1,
    runId: id,
    startedAt,
    completedAt: new Date().toISOString(),
    git,
    codex: {
      version,
      models: catalog
    },
    matrix: {
      cases: definition.cases.length,
      conditions: definition.config.conditions,
      models: definition.config.models,
      repetitions: definition.config.trialsPerCondition,
      trials: matrix.length
    },
    hashes: {
      ...definition.hashes,
      'baseline-help.json': sha256(baselineSource),
      'runner.ts': sha256(runnerSource)
    },
    decision,
    trials: results
  } as unknown as JsonObject
  await Promise.all([
    writeJson(path.join(evidenceDirectory, 'manifest.json'), manifest),
    fs.writeFile(path.join(evidenceDirectory, 'README.md'), reportMarkdown(manifest))
  ])
  const resultDirectory = path.join(evaluationDirectory, 'results', id)
  await publishResult(evidenceDirectory, resultDirectory)
  return { resultDirectory, decision }
}

interface CliOptions {
  command: 'validate' | 'run'
  codexPath: string
}

function parseCli(args: readonly string[]): CliOptions {
  const [command, ...flags] = args
  if (command !== 'validate' && command !== 'run') {
    throw new Error(
      'Usage: thread-metadata-guidance-eval <validate|run> [--codex=PATH]'
    )
  }
  let codexPath = 'codex'
  for (const flag of flags) {
    if (flag.startsWith('--codex=')) codexPath = flag.slice('--codex='.length)
    else throw new Error(`Unknown argument: ${flag}`)
  }
  if (codexPath.length === 0) throw new Error('--codex must not be empty')
  return { command, codexPath }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseCli(args)
  if (options.command === 'validate') {
    await validateCommand(options.codexPath)
    return
  }
  const result = await runEvaluation(options.codexPath)
  process.stdout.write(`${JSON.stringify({
    resultDirectory: result.resultDirectory,
    outcome: result.decision.outcome
  }, null, 2)}\n`)
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

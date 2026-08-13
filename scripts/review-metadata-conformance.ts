import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  decodeReviewArtifact,
  isCanonicalReviewTimestamp
} from '../src/review-format'
import {
  githubRepositoryIdentity,
  parseGitHubPullRequestUrl
} from '../src/pull-request'

const evidenceSchemaVersion = 1
const matrixSchemaVersion = 1
const evidenceIdPattern = /^\d{4}-\d{2}-\d{2}__[a-z0-9]+(?:-[a-z0-9]+)*__[a-z0-9]{8}$/
const fullCommitPattern = /^(?!0{40}$)[0-9a-f]{40}$/
const runtimeTokenSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/
const runtimeTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}(?: [A-Za-z0-9][A-Za-z0-9._+-]{0,39}){0,4}$/
const redactedProviderThreadId = '<redacted-provider-thread-id>'
const redactedThreadHostThreadId = '<redacted-thread-host-thread-id>'
const redactedMachine = '<redacted-machine>'
const runnerSourcePaths = [
  'AGENTS.md',
  'evals/review-metadata/README.md',
  'evals/review-metadata/exercise-source.md',
  'evals/review-metadata/exercises',
  'evals/review-metadata/matrix.json',
  'evals/review-metadata/rubric.md',
  'package-lock.json',
  'package.json',
  'scripts',
  'src',
  'tsconfig.build.json',
  'tsconfig.json'
]

type DiscoveryStatus = 'not-applicable' | 'observed' | 'unavailable'
type DiscoverySource =
  | 'agent-runtime'
  | 'hostname-command'
  | 'not-exposed'
  | 'not-applicable'
  | 'thread-context'
  | 'thread-host-runtime'
type IdentityExpectation = 'required' | 'unavailable-allowed'
type ExpansionReason = 'no-live-thread' | 'provider-not-observed'
type VersionSource = 'command' | 'not-exposed' | 'runtime-context'

interface DiscoveryObservation {
  source: DiscoverySource
  status: DiscoveryStatus
}

interface MatrixEntry {
  availability: 'available'
  evidence: string[]
  exercise: string
  hostProduct: string
  id: string
  identityExpectation: IdentityExpectation
  providerProduct: string
  threadHost: {
    kind: string
    provider: string
  }
}

export interface MetadataMatrix {
  classification: {
    authorityIssue: 134
    status: 'observational-evidence'
  }
  entries: MatrixEntry[]
  expansionCandidates: Array<{
    hostProduct: string
    providerSelection: 'discover-at-exercise'
    reasonCode: ExpansionReason
  }>
  schemaVersion: number
}

interface RuntimeObservation {
  hostVersion: string | null
  hostVersionSource: VersionSource
  providerModel: string | null
  providerModelSource: VersionSource
  providerVersion: string | null
  providerVersionSource: VersionSource
}

export interface CaptureObservation {
  discovery: {
    hostKind: DiscoveryObservation
    hostProvider: DiscoveryObservation
    hostThreadId: DiscoveryObservation
    machine: DiscoveryObservation
    providerThreadId: DiscoveryObservation
  }
  evidenceId: string
  exercisedAt: string
  limitations: string[]
  matrixEntryId: string
  runtime: RuntimeObservation
  schemaVersion: number
  sourceCommit: string
  sourcePullRequest: string
  truthfulnessAttested: true
}

interface ConformanceChecks {
  threadHostIdAccepted: true
  guessedValuesAbsent: true
  machineAttempted: true
  nullFallbackTruthful: true
  portableV1Valid: true
  requiredFieldsObserved: true
  sanitized: true
  supportedCombination: true
}

export interface SanitizedEvidence {
  checks: ConformanceChecks
  discovery: CaptureObservation['discovery']
  evidenceId: string
  exercisedAt: string
  matrixEntryId: string
  relationships: {
    identity: 'identified' | 'truthful-null'
    threadHostId: 'distinct' | 'equal' | 'omitted'
  }
  runtime: RuntimeObservation
  sanitizedAgentThread: null | {
    id: typeof redactedProviderThreadId
    threadHost: {
      kind: string
      machine?: typeof redactedMachine
      provider: string
      threadId?: typeof redactedThreadHostThreadId
    }
  }
  schemaVersion: number
  sourceCommit: string
  sourcePullRequest: string
}

export interface SanitizedFailureEvidence {
  evidenceId: string
  exercisedAt: string
  failure: {
    defectIssue: number
    kind: 'automatic-check-failed'
  }
  matrixEntryId: string
  outcome: 'failed'
  schemaVersion: number
  sourceCommit: string
  sourcePullRequest: string
}

type CorpusEvidence = SanitizedEvidence | SanitizedFailureEvidence

type JsonRecord = Record<string, unknown>

interface GitResult {
  status: number | null
  stderr: string
  stdout: string
}

type GitRunner = (args: string[], cwd: string) => GitResult
type GitHubRunner = (args: string[], cwd: string) => GitResult
type DefectVerifier = (
  sourcePullRequest: string,
  defectIssue: number,
  cwd?: string
) => void

const projectRoot = path.resolve(__dirname, '../..')
const evaluationDirectory = path.join(projectRoot, 'evals/review-metadata')
const matrixPath = path.join(evaluationDirectory, 'matrix.json')

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  return value
}

function assertExactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  label: string
): void {
  const allowedKeys = new Set(allowed)
  const unrecognized = Object.keys(value).filter((key) => !allowedKeys.has(key))
  if (unrecognized.length > 0) {
    throw new Error(
      `${label} contains unrecognized fields: ${unrecognized.sort().join(', ')}.`
    )
  }
}

function nonblank(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a nonblank string.`)
  }
  return value
}

function exercisePath(value: unknown, label: string): string {
  const parsed = nonblank(value, label)
  const normalized = path.posix.normalize(parsed)
  if (
    normalized !== parsed ||
    !/^exercises\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(parsed)
  ) {
    throw new Error(
      `${label} must be a normalized relative Markdown path beneath exercises/.`
    )
  }
  return parsed
}

function nullableNonblank(value: unknown, label: string): string | null {
  if (value === null) return null
  return nonblank(value, label)
}

function nullableRuntimeToken(value: unknown, label: string): string | null {
  const parsed = nullableNonblank(value, label)
  if (parsed !== null && !runtimeTokenPattern.test(parsed)) {
    throw new Error(
      `${label} must be a normalized version/model token without paths or command output.`
    )
  }
  return parsed
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  const result = value.map((item, index) => nonblank(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} must not contain duplicates.`)
  }
  return result
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

function assertNoDuplicateJsonKeys(source: string, label: string): void {
  let cursor = 0

  const skipWhitespace = (): void => {
    while (/\s/.test(source[cursor] ?? '')) cursor += 1
  }
  const parseString = (): string => {
    const start = cursor
    cursor += 1
    while (cursor < source.length) {
      if (source[cursor] === '\\') {
        cursor += 2
      } else if (source[cursor] === '"') {
        cursor += 1
        return JSON.parse(source.slice(start, cursor)) as string
      } else {
        cursor += 1
      }
    }
    throw new Error(`${label} contains an unterminated JSON string.`)
  }
  const parseValue = (): void => {
    skipWhitespace()
    if (source[cursor] === '{') {
      cursor += 1
      const keys = new Set<string>()
      skipWhitespace()
      while (source[cursor] !== '}' && cursor < source.length) {
        if (source[cursor] !== '"') break
        const key = parseString()
        if (keys.has(key)) throw new Error(`${label} contains duplicate key: ${key}.`)
        keys.add(key)
        skipWhitespace()
        if (source[cursor] !== ':') break
        cursor += 1
        parseValue()
        skipWhitespace()
        if (source[cursor] !== ',') break
        cursor += 1
        skipWhitespace()
      }
      if (source[cursor] === '}') cursor += 1
      return
    }
    if (source[cursor] === '[') {
      cursor += 1
      skipWhitespace()
      while (source[cursor] !== ']' && cursor < source.length) {
        parseValue()
        skipWhitespace()
        if (source[cursor] !== ',') break
        cursor += 1
        skipWhitespace()
      }
      if (source[cursor] === ']') cursor += 1
      return
    }
    if (source[cursor] === '"') {
      parseString()
      return
    }
    while (cursor < source.length && !/[\s,\]}]/.test(source[cursor] ?? '')) cursor += 1
  }

  parseValue()
}

function readJson(filePath: string): unknown {
  const source = fs.readFileSync(filePath, 'utf8')
  assertNoDuplicateJsonKeys(source, filePath)
  return JSON.parse(source) as unknown
}

function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout
  }
}

function runGitHub(args: string[], cwd: string): GitResult {
  const result = spawnSync('gh', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout
  }
}

export function verifyContractDefectIssue(
  sourcePullRequest: string,
  defectIssue: number,
  cwd = projectRoot,
  github: GitHubRunner = runGitHub
): void {
  const pullRequest = parseGitHubPullRequestUrl(sourcePullRequest)
  if (!pullRequest) throw new Error('Cannot verify a defect for a non-canonical PR.')
  if (!Number.isSafeInteger(defectIssue) || defectIssue < 1 || defectIssue === 99) {
    throw new Error('Contract defect must be a positive descendant issue, not #99 itself.')
  }
  const visited = new Set<number>()
  let current = defectIssue
  for (let depth = 0; depth < 32; depth += 1) {
    if (visited.has(current)) {
      throw new Error('Contract defect parent hierarchy contains a cycle.')
    }
    visited.add(current)
    const result = github([
      'issue',
      'view',
      String(current),
      '--repo',
      pullRequest.repository,
      '--json',
      'number,parent'
    ], cwd)
    if (result.status !== 0) {
      throw new Error(
        `Cannot verify contract defect #${String(current)}: ${result.stderr.trim()}`
      )
    }
    let value: unknown
    try {
      value = JSON.parse(result.stdout) as unknown
    } catch (error) {
      throw new Error('GitHub returned invalid contract-defect JSON.', { cause: error })
    }
    const issue = record(value, `Contract defect #${String(current)}`)
    if (issue.number !== current) {
      throw new Error('GitHub returned the wrong contract defect issue.')
    }
    if (issue.parent === null) {
      throw new Error(
        `Contract defect #${String(defectIssue)} must descend from issue #99.`
      )
    }
    const parent = record(issue.parent, `Contract defect #${String(current)} parent`)
    const repository = record(
      parent.repository,
      `Contract defect #${String(current)} parent repository`
    )
    if (
      typeof repository.nameWithOwner !== 'string' ||
      repository.nameWithOwner.toLowerCase() !== pullRequest.repository
    ) {
      throw new Error('Contract defect parent must remain in the source repository.')
    }
    if (!Number.isSafeInteger(parent.number) || (parent.number as number) < 1) {
      throw new Error('Contract defect parent has an invalid issue number.')
    }
    if (parent.number === 99) return
    current = parent.number as number
  }
  throw new Error('Contract defect hierarchy exceeds the 32-level verification bound.')
}

export function verifySourceCommitPullRequest(
  observation: CaptureObservation,
  cwd = projectRoot,
  git: GitRunner = runGit
): void {
  const pullRequest = parseGitHubPullRequestUrl(observation.sourcePullRequest)
  if (!pullRequest) {
    throw new Error('Cannot verify non-canonical sourcePullRequest provenance.')
  }
  const origin = git(['remote', 'get-url', 'origin'], cwd)
  if (origin.status !== 0) {
    throw new Error(`Cannot read origin for sourcePullRequest verification: ${origin.stderr.trim()}`)
  }
  if (githubRepositoryIdentity(origin.stdout.trim()) !== pullRequest.repository) {
    throw new Error(
      'Capture observation sourcePullRequest repository must match the origin repository.'
    )
  }
  const pullRequestRef = `refs/pull/${String(pullRequest.number)}/head`
  const fetch = git(
    ['fetch', '--quiet', '--no-tags', 'origin', pullRequestRef],
    cwd
  )
  if (fetch.status !== 0) {
    throw new Error(
      `Cannot fetch sourcePullRequest head for provenance verification: ${fetch.stderr.trim()}`
    )
  }
  const ancestor = git(
    ['merge-base', '--is-ancestor', observation.sourceCommit, 'FETCH_HEAD'],
    cwd
  )
  if (ancestor.status === 1) {
    throw new Error(
      'Capture observation sourceCommit must belong to the sourcePullRequest head history.'
    )
  }
  if (ancestor.status !== 0) {
    throw new Error(
      `Cannot verify sourceCommit ancestry in sourcePullRequest: ${ancestor.stderr.trim()}`
    )
  }
  const matchingSources = git(
    ['diff', '--quiet', observation.sourceCommit, '--', ...runnerSourcePaths],
    cwd
  )
  if (matchingSources.status === 1) {
    throw new Error(
      'Running metadata recorder sources must match the declared sourceCommit.'
    )
  }
  if (matchingSources.status !== 0) {
    throw new Error(
      `Cannot bind running recorder sources to sourceCommit: ${matchingSources.stderr.trim()}`
    )
  }
  const untrackedSources = git(
    ['ls-files', '--others', '--exclude-standard', '--', ...runnerSourcePaths],
    cwd
  )
  if (untrackedSources.status !== 0) {
    throw new Error(
      `Cannot inspect untracked metadata recorder sources: ${untrackedSources.stderr.trim()}`
    )
  }
  if (untrackedSources.stdout.trim()) {
    throw new Error(
      'Running metadata recorder sources must not contain untracked inputs.'
    )
  }
  const ignoredSources = git(
    [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      ...runnerSourcePaths
    ],
    cwd
  )
  if (ignoredSources.status !== 0) {
    throw new Error(
      `Cannot inspect ignored metadata recorder sources: ${ignoredSources.stderr.trim()}`
    )
  }
  if (ignoredSources.stdout.trim()) {
    throw new Error(
      'Running metadata recorder sources must not contain ignored inputs.'
    )
  }
}

function parseDiscovery(
  value: unknown,
  label: string,
  allowed: readonly DiscoveryObservation[]
): DiscoveryObservation {
  const item = record(value, label)
  assertExactKeys(item, ['source', 'status'], label)
  const observation: DiscoveryObservation = {
    source: oneOf(item.source, [
      'agent-runtime',
      'hostname-command',
      'not-exposed',
      'not-applicable',
      'thread-context',
      'thread-host-runtime'
    ], `${label}.source`),
    status: oneOf(item.status, [
      'not-applicable',
      'observed',
      'unavailable'
    ], `${label}.status`)
  }
  const valid = allowed.some(
    ({ source, status }) => source === observation.source && status === observation.status
  )
  if (!valid) {
    throw new Error(
      `${label} source ${observation.source} contradicts status ${observation.status} ` +
      'or is not permitted for this field.'
    )
  }
  return observation
}

function parseRuntime(value: unknown, label: string): RuntimeObservation {
  const item = record(value, label)
  assertExactKeys(item, [
    'hostVersion',
    'hostVersionSource',
    'providerModel',
    'providerModelSource',
    'providerVersion',
    'providerVersionSource'
  ], label)
  const runtime: RuntimeObservation = {
    hostVersion: nullableRuntimeToken(item.hostVersion, `${label}.hostVersion`),
    hostVersionSource: oneOf(item.hostVersionSource, [
      'command', 'not-exposed', 'runtime-context'
    ], `${label}.hostVersionSource`),
    providerModel: nullableRuntimeToken(item.providerModel, `${label}.providerModel`),
    providerModelSource: oneOf(item.providerModelSource, [
      'command', 'not-exposed', 'runtime-context'
    ], `${label}.providerModelSource`),
    providerVersion: nullableRuntimeToken(item.providerVersion, `${label}.providerVersion`),
    providerVersionSource: oneOf(item.providerVersionSource, [
      'command', 'not-exposed', 'runtime-context'
    ], `${label}.providerVersionSource`)
  }
  for (const [field, sourceField] of [
    ['hostVersion', 'hostVersionSource'],
    ['providerModel', 'providerModelSource'],
    ['providerVersion', 'providerVersionSource']
  ] as const) {
    const present = runtime[field] !== null
    const unavailable = runtime[sourceField] === 'not-exposed'
    if (present === unavailable) {
      throw new Error(
        `${label}.${field} must be null exactly when ${label}.${sourceField} is not-exposed.`
      )
    }
  }
  return runtime
}

export function parseCaptureObservation(value: unknown): CaptureObservation {
  const item = record(value, 'Capture observation')
  assertExactKeys(item, [
    'discovery',
    'evidenceId',
    'exercisedAt',
    'limitations',
    'matrixEntryId',
    'runtime',
    'schemaVersion',
    'sourceCommit',
    'sourcePullRequest',
    'truthfulnessAttested'
  ], 'Capture observation')
  if (item.schemaVersion !== evidenceSchemaVersion) {
    throw new Error(`Capture observation schemaVersion must be ${evidenceSchemaVersion}.`)
  }
  const evidenceId = nonblank(item.evidenceId, 'Capture observation evidenceId')
  if (!evidenceIdPattern.test(evidenceId)) {
    throw new Error('Capture observation evidenceId has an invalid format.')
  }
  const matrixEntryId = nonblank(
    item.matrixEntryId,
    'Capture observation matrixEntryId'
  )
  if (evidenceId.split('__')[1] !== matrixEntryId) {
    throw new Error(
      'Capture observation evidenceId slug must equal matrixEntryId.'
    )
  }
  const exercisedAt = nonblank(item.exercisedAt, 'Capture observation exercisedAt')
  if (!isCanonicalReviewTimestamp(exercisedAt)) {
    throw new Error('Capture observation exercisedAt must be a canonical UTC timestamp.')
  }
  if (evidenceId.slice(0, 10) !== exercisedAt.slice(0, 10)) {
    throw new Error(
      'Capture observation evidenceId date must equal the exercisedAt UTC date.'
    )
  }
  const sourceCommit = nonblank(item.sourceCommit, 'Capture observation sourceCommit')
  if (!fullCommitPattern.test(sourceCommit)) {
    throw new Error(
      'Capture observation sourceCommit must be a non-placeholder full Git commit.'
    )
  }
  const sourcePullRequest = nonblank(
    item.sourcePullRequest,
    'Capture observation sourcePullRequest'
  )
  if (parseGitHubPullRequestUrl(sourcePullRequest)?.url !== sourcePullRequest) {
    throw new Error('Capture observation sourcePullRequest must be a canonical GitHub URL.')
  }
  if (item.truthfulnessAttested !== true) {
    throw new Error('Capture observation must attest truthful discovery.')
  }
  const discovery = record(item.discovery, 'Capture observation discovery')
  assertExactKeys(discovery, [
    'hostKind',
    'hostProvider',
    'hostThreadId',
    'machine',
    'providerThreadId'
  ], 'Capture observation discovery')
  return {
    discovery: {
      hostKind: parseDiscovery(discovery.hostKind, 'discovery.hostKind', [
        { source: 'thread-context', status: 'observed' },
        { source: 'not-applicable', status: 'not-applicable' }
      ]),
      hostProvider: parseDiscovery(discovery.hostProvider, 'discovery.hostProvider', [
        { source: 'thread-context', status: 'observed' },
        { source: 'not-applicable', status: 'not-applicable' }
      ]),
      hostThreadId: parseDiscovery(discovery.hostThreadId, 'discovery.hostThreadId', [
        { source: 'thread-host-runtime', status: 'observed' },
        { source: 'not-exposed', status: 'unavailable' },
        { source: 'not-applicable', status: 'not-applicable' }
      ]),
      machine: parseDiscovery(discovery.machine, 'discovery.machine', [
        { source: 'hostname-command', status: 'observed' },
        { source: 'hostname-command', status: 'unavailable' }
      ]),
      providerThreadId: parseDiscovery(
        discovery.providerThreadId,
        'discovery.providerThreadId',
        [
          { source: 'agent-runtime', status: 'observed' },
          { source: 'not-exposed', status: 'unavailable' }
        ]
      )
    },
    evidenceId,
    exercisedAt,
    limitations: stringArray(item.limitations, 'Capture observation limitations'),
    matrixEntryId,
    runtime: parseRuntime(item.runtime, 'Capture observation runtime'),
    schemaVersion: evidenceSchemaVersion,
    sourceCommit,
    sourcePullRequest,
    truthfulnessAttested: true
  }
}

function parseMatrixEntry(value: unknown, label: string): MatrixEntry {
  const item = record(value, label)
  assertExactKeys(item, [
    'availability',
    'evidence',
    'exercise',
    'hostProduct',
    'id',
    'identityExpectation',
    'providerProduct',
    'threadHost'
  ], label)
  const threadHost = record(item.threadHost, `${label}.threadHost`)
  assertExactKeys(threadHost, ['kind', 'provider'], `${label}.threadHost`)
  if (item.availability !== 'available') {
    throw new Error(`${label}.availability must be available for a supported entry.`)
  }
  return {
    availability: 'available',
    evidence: stringArray(item.evidence, `${label}.evidence`),
    exercise: exercisePath(item.exercise, `${label}.exercise`),
    hostProduct: nonblank(item.hostProduct, `${label}.hostProduct`),
    id: nonblank(item.id, `${label}.id`),
    identityExpectation: oneOf(item.identityExpectation, [
      'required', 'unavailable-allowed'
    ], `${label}.identityExpectation`),
    providerProduct: nonblank(item.providerProduct, `${label}.providerProduct`),
    threadHost: {
      kind: nonblank(threadHost.kind, `${label}.threadHost.kind`),
      provider: nonblank(threadHost.provider, `${label}.threadHost.provider`)
    }
  }
}

export function parseMetadataMatrix(value: unknown): MetadataMatrix {
  const item = record(value, 'Metadata matrix')
  assertExactKeys(
    item,
    ['classification', 'entries', 'expansionCandidates', 'schemaVersion'],
    'Metadata matrix'
  )
  if (item.schemaVersion !== matrixSchemaVersion) {
    throw new Error(`Metadata matrix schemaVersion must be ${matrixSchemaVersion}.`)
  }
  const classification = record(item.classification, 'Metadata matrix classification')
  assertExactKeys(
    classification,
    ['authorityIssue', 'status'],
    'Metadata matrix classification'
  )
  if (
    classification.authorityIssue !== 134 ||
    classification.status !== 'observational-evidence'
  ) {
    throw new Error(
      'Metadata matrix must retain observational product evidence under issue #134 role semantics.'
    )
  }
  if (!Array.isArray(item.entries) || item.entries.length === 0) {
    throw new Error('Metadata matrix must contain supported entries.')
  }
  const entries = item.entries.map((entry, index) => (
    parseMatrixEntry(entry, `Metadata matrix entries[${index}]`)
  ))
  const entryIds = entries.map(({ id }) => id)
  if (new Set(entryIds).size !== entryIds.length) {
    throw new Error('Metadata matrix entry IDs must be unique.')
  }
  if (!Array.isArray(item.expansionCandidates)) {
    throw new Error('Metadata matrix expansionCandidates must be an array.')
  }
  const expansionCandidates = item.expansionCandidates.map((candidate, index) => {
    const value = record(candidate, `expansionCandidates[${index}]`)
    assertExactKeys(
      value,
      ['hostProduct', 'providerSelection', 'reasonCode'],
      `expansionCandidates[${index}]`
    )
    if (value.providerSelection !== 'discover-at-exercise') {
      throw new Error(
        `expansionCandidates[${index}].providerSelection must be discover-at-exercise.`
      )
    }
    return {
      hostProduct: nonblank(
        value.hostProduct,
        `expansionCandidates[${index}].hostProduct`
      ),
      providerSelection: 'discover-at-exercise' as const,
      reasonCode: oneOf(value.reasonCode, [
        'no-live-thread',
        'provider-not-observed'
      ], `expansionCandidates[${index}].reasonCode`)
    }
  })
  return {
    classification: {
      authorityIssue: 134,
      status: 'observational-evidence'
    },
    entries,
    expansionCandidates,
    schemaVersion: matrixSchemaVersion
  }
}

function matrixEntry(matrix: MetadataMatrix, id: string): MatrixEntry {
  const entry = matrix.entries.find((candidate) => candidate.id === id)
  if (entry === undefined) throw new Error(`Unknown metadata matrix entry: ${id}.`)
  return entry
}

function assertObserved(
  observation: DiscoveryObservation,
  field: string
): void {
  if (observation.status !== 'observed') {
    throw new Error(`${field} is present but was not observed; omit guessed values.`)
  }
}

function trueChecks(): ConformanceChecks {
  return {
    threadHostIdAccepted: true,
    guessedValuesAbsent: true,
    machineAttempted: true,
    nullFallbackTruthful: true,
    portableV1Valid: true,
    requiredFieldsObserved: true,
    sanitized: true,
    supportedCombination: true
  }
}

function assertSensitiveLeavesRedacted(
  values: Array<{ raw: string; sanitized: string | undefined }>
): void {
  for (const { raw, sanitized } of values) {
    if (sanitized === raw) {
      throw new Error('Sanitized evidence still contains a raw identity value.')
    }
  }
}

function assertEvidenceIdIndependent(
  evidenceId: string,
  privateValues: Array<string | null | undefined>,
  alwaysPrivate: Array<string | null | undefined> = [],
  completePrivate: Array<string | null | undefined> = [],
  shortPrivateIdentifiers: Array<string | null | undefined> = [],
  shortPrivateKeys: Array<string | null | undefined> = [],
  shortPrivateValues: Array<string | null | undefined> = []
): void {
  const suffix = evidenceId.slice(-8).toLowerCase()
  const suffixValues = [suffix, ...reversibleDecodedVariants(suffix)]
  const privateCandidates = privateValueCandidates(
    privateValues,
    alwaysPrivate,
    completePrivate
  )
  const suffixIsPrivateSubstring = [
    ...privateContainmentCandidates(alwaysPrivate, completePrivate)
  ].some((privateCandidate) => suffixValues.some((value) =>
    privateCandidate.includes(value.toLowerCase())))
  const shortExplicitPrivateCandidates =
    shortExplicitPrivateContainmentCandidates(alwaysPrivate)
  const shortIdentifierCandidates = new Set([
    ...shortIdentifierContainmentCandidates(shortPrivateIdentifiers),
    ...shortIdentifierContainmentCandidates(shortPrivateKeys, 4),
    ...shortIdentifierContainmentCandidates(shortPrivateValues)
  ])
  const containmentPrivateCandidates = new Set([
    ...privateContainmentCandidates(alwaysPrivate, completePrivate),
    ...shortExplicitPrivateCandidates,
    ...shortIdentifierCandidates
  ])
  const privateNumericIdentities = new Set([
    ...canonicalNumericIdentityCandidates(completePrivate),
    ...canonicalNumericIdentityCandidates(
      shortPrivateIdentifiers,
      true,
      4,
      true
    ),
    ...canonicalNumericIdentityCandidates(
      shortPrivateValues,
      false,
      1,
      true
    )
  ])
  const suffixNumericIdentities = canonicalNumericIdentityCandidates(
    suffixValues,
    true,
    1,
    true
  )
  const suffixContainsPrivate = [...containmentPrivateCandidates].some(
    (privateCandidate) =>
    (privateCandidate.length >= 8 ||
      (privateCandidate.length >= 4 &&
        shortExplicitPrivateCandidates.has(privateCandidate)) ||
      shortIdentifierCandidates.has(privateCandidate)) &&
    suffixValues.some((value) => value.toLowerCase().includes(privateCandidate)))
  if (
    suffixValues.some((value) => privateCandidates.has(value.toLowerCase())) ||
    suffixIsPrivateSubstring ||
    suffixContainsPrivate ||
    [...suffixNumericIdentities].some((value) =>
      privateNumericIdentities.has(value))
  ) {
    throw new Error(
      'Evidence ID suffix must be independent of private artifact values.'
    )
  }
}

function artifactStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        'Raw artifact contains a non-safe numeric value that cannot be sanitized exactly.'
      )
    }
    return [String(value)]
  }
  if (Array.isArray(value)) return value.flatMap(artifactStrings)
  if (isRecord(value)) {
    return Object.values(value).flatMap(artifactStrings)
  }
  return []
}

function privateCaptureStrings(
  artifactValue: unknown,
  observation: CaptureObservation
): string[] {
  return [
    ...artifactStrings(artifactValue),
    ...observation.limitations
  ]
}

function completePrivateCaptureStrings(
  artifactValue: unknown,
  observation: CaptureObservation
): string[] {
  const publicValuePaths = new Set([
    'format',
    'review.agentThread.threadHost.kind',
    'review.agentThread.threadHost.provider',
    'review.origin',
    'review.pullRequest.status',
    'review.pullRequest.statusSource',
    'review.status'
  ])
  const isPublicStringPath = (fields: string[]): boolean =>
    /^root(?:\.children\.\d+)*\.marker$/.test(fields.join('.'))
  const isPublicNumericPath = (fields: string[]): boolean => {
    const joined = fields.join('.')
    return joined === 'version' ||
      joined === 'review.pullRequest.number' ||
      /^unsupported\.\d+\.line$/.test(joined) ||
      /^root(?:\.children\.\d+)*\.(?:level|lineEnd|lineStart|listLength|listPosition)$/.test(
        joined
      ) ||
      /^root(?:\.children\.\d+)*\.attachments\.\d+\.(?:height|width)$/.test(
        joined
      )
  }
  const visit = (value: unknown, fields: string[]): string[] => {
    if (typeof value === 'string') {
      return publicValuePaths.has(fields.join('.')) || isPublicStringPath(fields)
        ? []
        : [value]
    }
    if (typeof value === 'number') {
      if (isPublicNumericPath(fields)) return []
      if (!Number.isSafeInteger(value)) {
        throw new Error(
          'Raw artifact contains a non-safe numeric value that cannot be sanitized exactly.'
        )
      }
      return [String(value)]
    }
    if (Array.isArray(value)) {
      return value.flatMap((nested, index) => visit(
        nested,
        [...fields, String(index)]
      ))
    }
    if (isRecord(value)) {
      return Object.entries(value).flatMap(([key, nested]) =>
        visit(nested, [...fields, key]))
    }
    return []
  }
  return [...visit(artifactValue, []), ...observation.limitations]
}

function privateIdentifierArtifactStrings(artifactValue: unknown): string[] {
  const isIdentifierField = (field: string): boolean =>
    field === 'id' ||
    field === 'machine' ||
    /(?:id|identifier)$/i.test(field) ||
    /(?:^|[-_])(?:id|identifier)$/i.test(field)
  const isPublicStructuralIdentifier = (fields: string[]): boolean => {
    const joined = fields.join('.')
    return /^root(?:\.children\.\d+)*\.(?:id|listId)$/.test(joined)
  }
  const identifierLeaves = (value: unknown): string[] => {
    if (typeof value === 'string') return [value]
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return [String(value)]
    }
    if (Array.isArray(value)) return value.flatMap(identifierLeaves)
    if (isRecord(value)) {
      return Object.values(value).flatMap(identifierLeaves)
    }
    return []
  }
  const visit = (value: unknown, fields: string[] = []): string[] => {
    if (Array.isArray(value)) {
      return value.flatMap((nested, index) =>
        visit(nested, [...fields, String(index)]))
    }
    if (!isRecord(value)) return []
    return Object.entries(value).flatMap(([field, nested]) => {
      const identifiers: string[] = []
      const nestedFields = [...fields, field]
      if (
        isIdentifierField(field) &&
        !isPublicStructuralIdentifier(nestedFields)
      ) {
        identifiers.push(...identifierLeaves(nested))
      }
      return [...identifiers, ...visit(nested, nestedFields)]
    })
  }
  return visit(artifactValue)
}

function privateAdditiveArtifactInputs(artifactValue: unknown): {
  keys: string[]
  scalarValues: string[]
} {
  const knownFields = (
    fields: string[],
    value: JsonRecord
  ): Set<string> | undefined => {
    const joined = fields.join('.')
    if (!joined) {
      return new Set([
        'format', 'version', 'sourceDocument', 'unsupported', 'root', 'review'
      ])
    }
    if (joined === 'sourceDocument') {
      return new Set(['name', 'path', 'content', 'checksum'])
    }
    if (/^unsupported\.\d+$/.test(joined)) {
      return new Set(['line', 'text'])
    }
    if (/^root(?:\.children\.\d+)*$/.test(joined)) {
      const commonNodeFields = [
        'id', 'type', 'raw', 'text', 'lineStart', 'lineEnd', 'feedback',
        'children', 'sourceEditable', 'sourceEdit', 'attachments'
      ]
      const typeSpecificFields: Record<string, string[]> = {
        heading: ['level'],
        code: ['language'],
        'frontmatter-entry': ['key'],
        'ordered-item': [
          'marker', 'listId', 'listPosition', 'listLength', 'task', 'checked'
        ],
        'unordered-item': [
          'marker', 'listId', 'listPosition', 'listLength', 'task', 'checked'
        ]
      }
      const nodeType = typeof value.type === 'string' ? value.type : ''
      return new Set([
        ...commonNodeFields,
        ...(typeSpecificFields[nodeType] ?? [])
      ])
    }
    if (/^root(?:\.children\.\d+)*\.sourceEdit$/.test(joined)) {
      return new Set(['original', 'current'])
    }
    if (/^root(?:\.children\.\d+)*\.attachments\.\d+$/.test(joined)) {
      return new Set([
        'id', 'type', 'label', 'path', 'mimeType', 'url', 'checksum',
        'width', 'height'
      ])
    }
    if (joined === 'review') {
      return new Set([
        'id', 'status', 'origin', 'createdAt', 'updatedAt',
        'attentionRequestedAt', 'contextSummary', 'agentThread', 'git',
        'pullRequest', 'agentGuidance'
      ])
    }
    if (joined === 'review.agentThread') {
      return new Set(['id', 'threadHost'])
    }
    if (joined === 'review.agentThread.threadHost') {
      return new Set(['kind', 'provider', 'threadId', 'machine'])
    }
    if (joined === 'review.git') {
      return new Set(['repositoryUrl', 'branch', 'commit'])
    }
    if (joined === 'review.pullRequest') {
      return new Set([
        'number', 'url', 'status', 'statusObservedAt', 'statusSource'
      ])
    }
    if (joined === 'review.agentGuidance') {
      return new Set(['fixedContract', 'interpretationPolicy'])
    }
    return undefined
  }
  const result = { keys: [] as string[], scalarValues: [] as string[] }
  const privateScalarLeaves = (value: unknown): string[] => {
    if (typeof value === 'string') return [value]
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return [String(value)]
    }
    if (Array.isArray(value)) return value.flatMap(privateScalarLeaves)
    if (isRecord(value)) {
      return Object.values(value).flatMap(privateScalarLeaves)
    }
    return []
  }
  const visit = (value: unknown, fields: string[] = []): void => {
    if (Array.isArray(value)) {
      value.forEach((nested, index) => {
        visit(nested, [...fields, String(index)])
      })
      return
    }
    if (!isRecord(value)) return
    const known = knownFields(fields, value)
    for (const [field, nested] of Object.entries(value)) {
      const additive = known?.has(field) !== true
      if (additive) {
        result.keys.push(field)
        result.scalarValues.push(...privateScalarLeaves(nested))
      }
      visit(nested, [...fields, field])
    }
  }
  visit(artifactValue)
  return result
}

function explicitlyPrivateArtifactStrings(artifactValue: unknown): string[] {
  if (!isRecord(artifactValue)) return []
  const attachmentLocations: string[] = []
  const collectAttachmentLocations = (
    value: unknown,
    fields: string[] = []
  ): void => {
    if (Array.isArray(value)) {
      value.forEach((nested, index) => {
        collectAttachmentLocations(nested, [...fields, String(index)])
      })
      return
    }
    if (!isRecord(value)) return
    const insideAttachments = fields.includes('attachments')
    for (const [field, nested] of Object.entries(value)) {
      if (
        insideAttachments &&
        (field === 'path' || field === 'url') &&
        typeof nested === 'string'
      ) {
        attachmentLocations.push(nested)
      }
      collectAttachmentLocations(nested, [...fields, field])
    }
  }
  collectAttachmentLocations(artifactValue)
  const sourceDocument = isRecord(artifactValue.sourceDocument)
    ? artifactValue.sourceDocument
    : undefined
  const review = isRecord(artifactValue.review)
    ? artifactValue.review
    : undefined
  const git = review && isRecord(review.git) ? review.git : undefined
  const pullRequest = review && isRecord(review.pullRequest)
    ? review.pullRequest
    : undefined
  const agentThread = review && isRecord(review.agentThread)
    ? review.agentThread
    : undefined
  const threadHost = agentThread && isRecord(agentThread.threadHost)
    ? agentThread.threadHost
    : undefined
  return [
    sourceDocument?.path,
    review?.id,
    git?.repositoryUrl,
    git?.branch,
    git?.commit,
    pullRequest?.url,
    agentThread?.id,
    threadHost?.threadId,
    threadHost?.machine,
    ...attachmentLocations
  ].filter((value): value is string => typeof value === 'string')
}

function percentDecodedVariants(value: string): string[] {
  const variants: string[] = []
  let current = value
  const decodeOnce = (encoded: string): string => {
    let decoded: string
    try {
      decoded = decodeURIComponent(encoded)
    } catch {
      decoded = encoded.replace(
        /%([0-7][0-9a-f])/gi,
        (_match: string, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16))
      )
    }
    return decoded
  }
  const maximumPasses = 32
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const decoded = decodeOnce(current)
    if (decoded === current) break
    variants.push(decoded)
    current = decoded
  }
  if (decodeOnce(current) !== current) {
    throw new Error(
      'Raw artifact contains percent encoding beyond the safe decoding depth.'
    )
  }
  return variants
}

function base64DecodedVariants(value: string): string[] {
  const variants: string[] = []
  let current = value
  const decodeOnce = (encoded: string): string | null => {
    if (
      encoded.length < 2 ||
      encoded.length > 256 ||
      !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)
    ) {
      return null
    }
    const unpadded = encoded.replace(/=+$/, '')
    if (unpadded.length % 4 === 1) return null
    const normalized = unpadded
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(unpadded.length / 4) * 4, '=')
    const bytes = Buffer.from(normalized, 'base64')
    const canonical = bytes.toString('base64').replace(/=+$/, '')
    const canonicalUrl = canonical.replace(/\+/g, '-').replace(/\//g, '_')
    if (unpadded !== canonical && unpadded !== canonicalUrl) return null
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return decoded && decoded !== encoded ? decoded : null
    } catch {
      return null
    }
  }
  const maximumPasses = 4
  let completedPasses = 0
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const decoded = decodeOnce(current)
    if (decoded === null) break
    variants.push(decoded)
    current = decoded
    completedPasses += 1
  }
  if (completedPasses === maximumPasses && decodeOnce(current) !== null) {
    throw new Error(
      'Sanitized evidence contains Base64 encoding beyond the safe decoding depth.'
    )
  }
  return variants
}

function base32DecodedVariants(value: string): string[] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const encode = (bytes: Uint8Array): string => {
    let bits = 0
    let buffer = 0
    let encoded = ''
    for (const byte of bytes) {
      buffer = (buffer << 8) | byte
      bits += 8
      while (bits >= 5) {
        bits -= 5
        encoded += alphabet.charAt((buffer >>> bits) & 31)
      }
    }
    if (bits > 0) encoded += alphabet.charAt((buffer << (5 - bits)) & 31)
    return encoded
  }
  const decodeOnce = (encoded: string): string | null => {
    if (
      encoded.length < 2 ||
      encoded.length > 256 ||
      !/^[A-Z2-7]+={0,6}$/i.test(encoded)
    ) {
      return null
    }
    const unpadded = encoded.replace(/=+$/, '').toUpperCase()
    let bits = 0
    let buffer = 0
    const bytes: number[] = []
    for (const character of unpadded) {
      const value = alphabet.indexOf(character)
      if (value < 0) return null
      buffer = (buffer << 5) | value
      bits += 5
      if (bits >= 8) {
        bits -= 8
        bytes.push((buffer >>> bits) & 255)
      }
    }
    if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return null
    const byteArray = Uint8Array.from(bytes)
    if (encode(byteArray) !== unpadded) return null
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(byteArray)
      return decoded && decoded !== encoded ? decoded : null
    } catch {
      return null
    }
  }
  const variants: string[] = []
  let current = value
  const maximumPasses = 4
  let completedPasses = 0
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const decoded = decodeOnce(current)
    if (decoded === null) break
    variants.push(decoded)
    current = decoded
    completedPasses += 1
  }
  if (completedPasses === maximumPasses && decodeOnce(current) !== null) {
    throw new Error(
      'Sanitized evidence contains Base32 encoding beyond the safe decoding depth.'
    )
  }
  return variants
}

function base32hexDecodedVariants(value: string): string[] {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUV'
  const encode = (bytes: Uint8Array): string => {
    let bits = 0
    let buffer = 0
    let encoded = ''
    for (const byte of bytes) {
      buffer = (buffer << 8) | byte
      bits += 8
      while (bits >= 5) {
        bits -= 5
        encoded += alphabet.charAt((buffer >>> bits) & 31)
      }
    }
    if (bits > 0) encoded += alphabet.charAt((buffer << (5 - bits)) & 31)
    return encoded
  }
  const decodeOnce = (encoded: string): string | null => {
    if (
      encoded.length < 2 ||
      encoded.length > 256 ||
      !/^[0-9A-V]+={0,6}$/i.test(encoded)
    ) return null
    const unpadded = encoded.replace(/=+$/, '').toUpperCase()
    let bits = 0
    let buffer = 0
    const bytes: number[] = []
    for (const character of unpadded) {
      const value = alphabet.indexOf(character)
      if (value < 0) return null
      buffer = (buffer << 5) | value
      bits += 5
      if (bits >= 8) {
        bits -= 8
        bytes.push((buffer >>> bits) & 255)
      }
    }
    if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return null
    const byteArray = Uint8Array.from(bytes)
    if (encode(byteArray) !== unpadded) return null
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(byteArray)
      return decoded && decoded !== encoded ? decoded : null
    } catch {
      return null
    }
  }
  const variants: string[] = []
  let current = value
  const maximumPasses = 4
  let completedPasses = 0
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const decoded = decodeOnce(current)
    if (decoded === null) break
    variants.push(decoded)
    current = decoded
    completedPasses += 1
  }
  if (completedPasses === maximumPasses && decodeOnce(current) !== null) {
    throw new Error(
      'Sanitized evidence contains Base32hex encoding beyond the safe decoding depth.'
    )
  }
  return variants
}

function base58btcDecodedVariants(value: string): string[] {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const encode = (bytes: Uint8Array): string => {
    let leadingZeroes = 0
    while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) {
      leadingZeroes += 1
    }
    let integer = 0n
    for (const byte of bytes) integer = integer * 256n + BigInt(byte)
    let encoded = ''
    while (integer > 0n) {
      encoded = alphabet.charAt(Number(integer % 58n)) + encoded
      integer /= 58n
    }
    return `${'1'.repeat(leadingZeroes)}${encoded}`
  }
  const decodeOnce = (encoded: string): string | null => {
    if (
      encoded.length < 1 ||
      encoded.length > 256 ||
      !/^[1-9A-HJ-NP-Za-km-z]+$/.test(encoded)
    ) {
      return null
    }
    let integer = 0n
    for (const character of encoded) {
      const digit = alphabet.indexOf(character)
      if (digit < 0) return null
      integer = integer * 58n + BigInt(digit)
    }
    const bytes: number[] = []
    while (integer > 0n) {
      bytes.unshift(Number(integer % 256n))
      integer /= 256n
    }
    const leadingZeroes = /^1*/.exec(encoded)?.[0].length ?? 0
    const byteArray = Uint8Array.from([
      ...Array.from({ length: leadingZeroes }, () => 0),
      ...bytes
    ])
    if (encode(byteArray) !== encoded) return null
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(byteArray)
      return decoded && decoded !== encoded ? decoded : null
    } catch {
      return null
    }
  }
  const variants: string[] = []
  let current = value
  const maximumPasses = 4
  let completedPasses = 0
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const decoded = decodeOnce(current)
    if (decoded === null) break
    variants.push(decoded)
    current = decoded
    completedPasses += 1
  }
  if (completedPasses === maximumPasses && decodeOnce(current) !== null) {
    throw new Error(
      'Sanitized evidence contains Base58btc encoding beyond the safe decoding depth.'
    )
  }
  return variants
}

function hexadecimalDecodedVariants(value: string): string[] {
  const decodeOnce = (encoded: string): string | null => {
    if (
      encoded.length < 2 ||
      encoded.length > 256 ||
      encoded.length % 2 !== 0 ||
      !/^[0-9a-f]+$/i.test(encoded)
    ) {
      return null
    }
    const bytes = Buffer.from(encoded, 'hex')
    if (bytes.toString('hex') !== encoded.toLowerCase()) return null
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return decoded && decoded !== encoded ? decoded : null
    } catch {
      return null
    }
  }
  const variants: string[] = []
  let current = value
  const maximumPasses = 4
  let completedPasses = 0
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const decoded = decodeOnce(current)
    if (decoded === null) break
    variants.push(decoded)
    current = decoded
    completedPasses += 1
  }
  if (completedPasses === maximumPasses && decodeOnce(current) !== null) {
    throw new Error(
      'Sanitized evidence contains hexadecimal encoding beyond the safe decoding depth.'
    )
  }
  return variants
}

function multibaseDecodedVariants(value: string): string[] {
  if (value.length < 2) return []
  const body = value.slice(1)
  switch (value[0]) {
    case '9':
      return [body]
    case '0':
      return [/^[01]+$/.test(body) ? `0b${body}` : body]
    case '7':
      return [/^[0-7]+$/.test(body) ? `0o${body}` : body]
    case 'z':
      return base58btcDecodedVariants(body)
    case 'b':
    case 'B':
      return base32DecodedVariants(body)
    case 'v':
    case 'V':
      return base32hexDecodedVariants(body)
    case 'k':
    case 'K':
      return [body]
    case 'm':
    case 'M':
    case 'u':
    case 'U':
      return base64DecodedVariants(body)
    case 'f':
    case 'F':
      return hexadecimalDecodedVariants(body)
    default:
      return []
  }
}

function reversibleDecodedVariants(value: string): string[] {
  const variants = new Set<string>()
  const pending = [value]
  const maximumVariants = 256
  while (pending.length > 0) {
    const current = pending.shift()
    if (current === undefined) break
    for (const candidate of [
      ...percentDecodedVariants(current),
      ...base64DecodedVariants(current),
      ...base32DecodedVariants(current),
      ...base32hexDecodedVariants(current),
      ...base58btcDecodedVariants(current),
      ...hexadecimalDecodedVariants(current),
      ...multibaseDecodedVariants(current)
    ]) {
      if (candidate === value || variants.has(candidate)) continue
      if (variants.size >= maximumVariants) {
        throw new Error(
          'Sanitized evidence contains reversible encoding beyond the safe variant bound.'
        )
      }
      variants.add(candidate)
      pending.push(candidate)
    }
  }
  return [...variants]
}

function privateValueCandidates(
  values: Array<string | null | undefined>,
  alwaysPrivate: Array<string | null | undefined> = [],
  completePrivate: Array<string | null | undefined> = []
): Set<string> {
  const candidates = new Set<string>()
  const addValue = (
    value: string,
    minimumLength: number,
    retainCompleteValue = false
  ): void => {
    if (retainCompleteValue || value.length >= minimumLength) {
      candidates.add(value.toLowerCase())
    }
    const delimiterStripped = value.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
    if (delimiterStripped.length >= minimumLength) {
      candidates.add(delimiterStripped)
    }
    for (const segments of [
      value
        .split(/[^A-Za-z0-9._+-]+/)
        .filter((segment) => runtimeTokenSegmentPattern.test(segment)),
      value.split(/[^A-Za-z0-9]+/).filter(Boolean)
    ]) {
      for (let start = 0; start < segments.length; start += 1) {
        for (
          let end = start + 1;
          end <= Math.min(start + 5, segments.length);
          end += 1
        ) {
          const candidate = segments.slice(start, end).join(' ').toLowerCase()
          if (candidate.length >= minimumLength) candidates.add(candidate)
          if (minimumLength === 1) {
            const delimiterStrippedCandidate = candidate.replace(
              /[^a-z0-9]/g,
              ''
            )
            if (delimiterStrippedCandidate) {
              candidates.add(delimiterStrippedCandidate)
            }
          }
        }
      }
    }
  }
  for (const value of values) {
    if (value !== null && value !== undefined) {
      addValue(value, 8)
      for (const decoded of reversibleDecodedVariants(value)) {
        addValue(decoded, 8)
      }
    }
  }
  for (const value of alwaysPrivate) {
    if (value !== null && value !== undefined) {
      addValue(value, 1)
      for (const decoded of reversibleDecodedVariants(value)) {
        addValue(decoded, 1)
      }
    }
  }
  for (const value of completePrivate) {
    if (value !== null && value !== undefined) {
      addValue(value, 8, true)
      for (const decoded of reversibleDecodedVariants(value)) {
        addValue(decoded, 8, true)
      }
    }
  }
  return candidates
}

function privateContainmentCandidates(
  alwaysPrivate: Array<string | null | undefined>,
  completePrivate: Array<string | null | undefined>
): Set<string> {
  return privateValueCandidates(
    completePrivate,
    alwaysPrivate,
    completePrivate
  )
}

function shortIdentifierContainmentCandidates(
  values: Array<string | null | undefined>,
  minimumLength = 1
): Set<string> {
  const candidates = new Set<string>()
  for (const value of values) {
    if (value === null || value === undefined) continue
    for (const variant of [value, ...reversibleDecodedVariants(value)]) {
      if (variant.length >= minimumLength) candidates.add(variant.toLowerCase())
      const stripped = variant.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
      if (stripped.length >= minimumLength) candidates.add(stripped)
      for (const segment of variant
        .split(/[^A-Za-z0-9]+/)
        .filter((candidate) => candidate.length >= Math.max(4, minimumLength))) {
        candidates.add(segment.toLowerCase())
      }
    }
  }
  return candidates
}

function shortExplicitPrivateContainmentCandidates(
  values: Array<string | null | undefined>
): Set<string> {
  const pathValues = values.filter((value): value is string =>
    typeof value === 'string' && /[\\/]/.test(value))
  return new Set([
    ...shortIdentifierContainmentCandidates(values),
    ...privateValueCandidates([], pathValues)
  ])
}

function canonicalNumericIdentityCandidates(
  values: Array<string | null | undefined>,
  extractEmbedded = false,
  minimumEmbeddedWidth = 1,
  includeAlphabeticBase36 = false
): Set<string> {
  const canonicalDecimalInteger = (value: string): string | null => {
    const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(
      value
    )
    if (!match) return null
    const fraction = match[3] ?? match[4] ?? ''
    let digits = `${match[2] ?? ''}${fraction}`.replace(/^0+/, '')
    if (!digits) return '0@0'
    let exponent = BigInt(match[5] ?? '0') - BigInt(fraction.length)
    const trailingZeroCount = /0+$/.exec(digits)?.[0].length ?? 0
    if (trailingZeroCount > 0) {
      digits = digits.slice(0, -trailingZeroCount)
      exponent += BigInt(trailingZeroCount)
    }
    const sign = match[1] === '-' ? '-' : ''
    return `${sign}${digits}@${exponent}`
  }
  const canonicalBase36Integer = (value: string): string | null => {
    const match = /^([+-]?)([0-9a-z]{4,40})$/i.exec(value)
    const body = match?.[2]
    if (
      body === undefined ||
      (!includeAlphabeticBase36 && !/^\d/.test(body)) ||
      !/[a-z]/i.test(body)
    ) return null
    let decimal = 0n
    for (const character of body.toLowerCase()) {
      const digit = Number.parseInt(character, 36)
      if (!Number.isSafeInteger(digit) || digit < 0 || digit >= 36) return null
      decimal = decimal * 36n + BigInt(digit)
    }
    return canonicalDecimalInteger(
      `${match?.[1] === '-' ? '-' : ''}${decimal.toString()}`
    )
  }
  const candidates = new Set<string>()
  for (const value of values) {
    if (value === null || value === undefined) continue
    for (const variant of [value, ...reversibleDecodedVariants(value)]) {
      const segments = variant.split(' ')
      const numericSegments = new Set([variant])
      for (let start = 0; start < segments.length; start += 1) {
        for (let end = start + 1; end <= segments.length; end += 1) {
          numericSegments.add(segments.slice(start, end).join(''))
        }
      }
      for (const segment of numericSegments) {
        const reconstructedSegments = new Set([
          segment.replace(/_/g, ''),
          segment.replace(/[^A-Za-z0-9]/g, '')
        ])
        const numericValues = new Set<string>()
        for (const normalizedValue of reconstructedSegments) {
          numericValues.add(normalizedValue)
          const base36Canonical = canonicalBase36Integer(normalizedValue)
          if (base36Canonical !== null) candidates.add(base36Canonical)
          const fixedWidthHex = /^([+-]?)([0-9a-f]+)$/i.exec(
            normalizedValue
          )
          if (fixedWidthHex !== null) {
            const decimal = BigInt(`0x${fixedWidthHex[2]}`).toString()
            const canonical = canonicalDecimalInteger(
              `${fixedWidthHex[1] === '-' ? '-' : ''}${decimal}`
            )
            if (canonical !== null) candidates.add(canonical)
          }
          if (extractEmbedded) {
            for (let offset = 0; offset < normalizedValue.length; offset += 1) {
              const match = /^[+-]?(?:0x[0-9a-f]+|0o[0-7]+|0b[01]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i.exec(
                normalizedValue.slice(offset)
              )
              if (match === null) continue
              const embeddedWidth = match[0]
                .replace(/^[+-]/, '')
                .replace(/^0[xob]/i, '')
                .replace(/[._+-]/g, '')
                .length
              if (embeddedWidth < minimumEmbeddedWidth) continue
              const nextCharacter = normalizedValue[
                offset + match[0].length
              ]
              if (
                /^[+-]?0[xob]/i.test(match[0]) &&
                nextCharacter !== undefined &&
                /[A-Za-z0-9]/.test(nextCharacter)
              ) {
                throw new Error(
                  'Sanitized evidence runtime contains an ambiguous embedded radix value.'
                )
              }
              numericValues.add(match[0])
              const scientific = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)e[+-]?)(\d+)$/i.exec(
                match[0]
              )
              const scientificPrefix = scientific?.[1]
              const exponentDigits = scientific?.[2]
              if (
                scientificPrefix !== undefined &&
                exponentDigits !== undefined
              ) {
                for (
                  let length = 1;
                  length < exponentDigits.length;
                  length += 1
                ) {
                  numericValues.add(
                    `${scientificPrefix}${exponentDigits.slice(0, length)}`
                  )
                }
              }
            }
            for (const match of normalizedValue.matchAll(/[0-9a-f]+/gi)) {
              for (
                let width = Math.max(4, minimumEmbeddedWidth);
                width <= match[0].length;
                width += 1
              ) {
                for (let start = 0; start + width <= match[0].length; start += 1) {
                  const window = match[0].slice(start, start + width)
                  const decimal = BigInt(`0x${window}`).toString()
                  const unsignedCanonical = canonicalDecimalInteger(decimal)
                  if (unsignedCanonical !== null) {
                    candidates.add(unsignedCanonical)
                  }
                  const absoluteStart = match.index + start
                  if (
                    absoluteStart > 0 &&
                    normalizedValue[absoluteStart - 1] === '-'
                  ) {
                    const signedCanonical = canonicalDecimalInteger(`-${decimal}`)
                    if (signedCanonical !== null) {
                      candidates.add(signedCanonical)
                    }
                  }
                }
              }
            }
          }
        }
        for (const numericLiteral of numericValues) {
          const radixInteger = /^([+-]?)(0x[0-9a-f]+|0o[0-7]+|0b[01]+)$/i.exec(
            numericLiteral
          )
          const radixBody = radixInteger?.[2]
          const canonical = radixBody !== undefined
            ? canonicalDecimalInteger(
                `${radixInteger?.[1] === '-' ? '-' : ''}${BigInt(radixBody).toString()}`
              )
            : canonicalDecimalInteger(numericLiteral)
          if (canonical !== null) candidates.add(canonical)
          if (extractEmbedded && radixBody !== undefined) {
            const radixPrefix = radixBody.slice(0, 2)
            const radixDigits = radixBody.slice(2)
            for (let start = 0; start < radixDigits.length; start += 1) {
              for (let end = start + 1; end <= radixDigits.length; end += 1) {
                if (end - start < minimumEmbeddedWidth) continue
                const subrangeDecimal = BigInt(
                  `${radixPrefix}${radixDigits.slice(start, end)}`
                ).toString()
                const unsignedCanonical = canonicalDecimalInteger(subrangeDecimal)
                if (unsignedCanonical !== null) candidates.add(unsignedCanonical)
                if (radixInteger?.[1] === '-') {
                  const signedCanonical = canonicalDecimalInteger(
                    `-${subrangeDecimal}`
                  )
                  if (signedCanonical !== null) candidates.add(signedCanonical)
                }
              }
            }
          }
        }
      }
    }
  }
  return candidates
}

function assertPrivateArtifactValuesAbsentFromRuntime(
  values: Array<string | null | undefined>,
  runtime: RuntimeObservation,
  alwaysPrivate: Array<string | null | undefined> = [],
  completePrivate: Array<string | null | undefined> = [],
  shortPrivateIdentifiers: Array<string | null | undefined> = [],
  shortPrivateKeys: Array<string | null | undefined> = [],
  shortPrivateValues: Array<string | null | undefined> = []
): void {
  const persistedRuntimeValues = [
    runtime.hostVersion,
    runtime.providerModel,
    runtime.providerVersion
  ]
  const expandedRuntimeValues = persistedRuntimeValues.flatMap((value) =>
    value === null ? [value] : [value, ...reversibleDecodedVariants(value)])
  const privateCandidates = privateValueCandidates(
    values,
    alwaysPrivate,
    completePrivate
  )
  const persistedRuntimeCandidates = privateValueCandidates(
    expandedRuntimeValues,
    expandedRuntimeValues
  )
  const embeddedPrivateCandidates = privateContainmentCandidates(
    alwaysPrivate,
    completePrivate
  )
  const embeddedShortExplicitPrivate =
    shortExplicitPrivateContainmentCandidates(alwaysPrivate)
  const embeddedShortIdentifiers = new Set([
    ...shortIdentifierContainmentCandidates(shortPrivateIdentifiers),
    ...shortIdentifierContainmentCandidates(shortPrivateKeys, 4),
    ...shortIdentifierContainmentCandidates(shortPrivateValues)
  ])
  const containmentPrivateCandidates = new Set([
    ...embeddedPrivateCandidates,
    ...embeddedShortExplicitPrivate,
    ...embeddedShortIdentifiers
  ])
  const privateNumericIdentities = new Set([
    ...canonicalNumericIdentityCandidates(completePrivate),
    ...canonicalNumericIdentityCandidates(
      shortPrivateIdentifiers,
      true,
      4,
      true
    ),
    ...canonicalNumericIdentityCandidates(
      shortPrivateValues,
      false,
      1,
      true
    )
  ])
  const runtimeNumericIdentities = canonicalNumericIdentityCandidates(
    expandedRuntimeValues,
    true,
    1,
    true
  )
  const embedsPrivateCandidate = [...persistedRuntimeCandidates].some(
    (runtimeCandidate) =>
      [...containmentPrivateCandidates].some((privateCandidate) =>
        (privateCandidate.length >= 8 ||
          (privateCandidate.length >= 4 &&
            embeddedShortExplicitPrivate.has(privateCandidate)) ||
          embeddedShortIdentifiers.has(privateCandidate)) &&
        runtimeCandidate.includes(privateCandidate)))
  const runtimeIsPrivateSubstring = [...persistedRuntimeCandidates].some(
    (runtimeCandidate) =>
      runtimeCandidate.length >= 8 &&
      [...embeddedPrivateCandidates].some((privateCandidate) =>
        privateCandidate.includes(runtimeCandidate))
  )
  if (
    embedsPrivateCandidate ||
    runtimeIsPrivateSubstring ||
    [...runtimeNumericIdentities].some((value) =>
      privateNumericIdentities.has(value)) ||
    [...persistedRuntimeCandidates].some((value) => privateCandidates.has(value))
  ) {
    throw new Error('Sanitized evidence runtime still contains a private artifact value.')
  }
}

function assertNullThreadHostNotObserved(
  discovery: CaptureObservation['discovery']
): void {
  for (const [field, value] of [
    ['threadHost.kind', discovery.hostKind],
    ['threadHost.provider', discovery.hostProvider],
    ['threadHost.threadId', discovery.hostThreadId]
  ] as const) {
    if (value.status === 'observed') {
      throw new Error(`${field} was observed but is absent from null evidence.`)
    }
  }
}

export function buildSanitizedEvidence(
  artifactValue: unknown,
  observationValue: unknown,
  matrixValue: unknown
): SanitizedEvidence {
  const artifact = decodeReviewArtifact(artifactValue)
  const observation = parseCaptureObservation(observationValue)
  const matrix = parseMetadataMatrix(matrixValue)
  const entry = matrixEntry(matrix, observation.matrixEntryId)
  const thread = artifact.review.agentThread
  const exerciseSource = fs.readFileSync(
    path.join(evaluationDirectory, 'exercise-source.md'),
    'utf8'
  )
  if (artifact.sourceDocument.content !== exerciseSource) {
    throw new Error(
      'Metadata conformance evidence must use the maintained exercise source.'
    )
  }
  if (artifact.review.origin !== 'agent') {
    throw new Error('Metadata conformance evidence requires an agent-origin review.')
  }
  const sensitiveLeaves: Array<{ raw: string; sanitized: string | undefined }> = []
  let threadHostId: SanitizedEvidence['relationships']['threadHostId'] = 'omitted'

  if (thread === null) {
    if (entry.identityExpectation === 'required') {
      throw new Error(`${entry.id} requires reliable requesting-thread identity.`)
    }
    if (observation.discovery.providerThreadId.status !== 'unavailable') {
      throw new Error('A null agentThread requires requesting-thread identity to be unavailable.')
    }
    assertNullThreadHostNotObserved(observation.discovery)
    throw new Error(
      'A null agentThread cannot verify the selected host/provider combination; ' +
      'do not record passing evidence.'
    )
  }
  if (
    thread.threadHost.kind !== entry.threadHost.kind ||
    thread.threadHost.provider !== entry.threadHost.provider
  ) {
    throw new Error(`Captured thread metadata does not match ${entry.id}.`)
  }
  assertObserved(observation.discovery.providerThreadId, 'agentThread.id')
  assertObserved(observation.discovery.hostKind, 'threadHost.kind')
  assertObserved(observation.discovery.hostProvider, 'threadHost.provider')
  const sanitizedThreadHost: NonNullable<
    SanitizedEvidence['sanitizedAgentThread']
  >['threadHost'] = {
    kind: thread.threadHost.kind,
    provider: thread.threadHost.provider
  }
  if (thread.threadHost.threadId !== undefined) {
    assertObserved(observation.discovery.hostThreadId, 'threadHost.threadId')
    sanitizedThreadHost.threadId = redactedThreadHostThreadId
    threadHostId = thread.threadHost.threadId === thread.id ? 'equal' : 'distinct'
  } else if (observation.discovery.hostThreadId.status === 'observed') {
    throw new Error('Host thread identity was observed but omitted from the artifact.')
  }
  if (thread.threadHost.machine !== undefined) {
    assertObserved(observation.discovery.machine, 'threadHost.machine')
    sanitizedThreadHost.machine = redactedMachine
  }
  const sanitizedAgentThread: NonNullable<SanitizedEvidence['sanitizedAgentThread']> = {
    id: redactedProviderThreadId,
    threadHost: sanitizedThreadHost
  }
  sensitiveLeaves.push({
    raw: thread.id,
    sanitized: sanitizedAgentThread.id
  })
  if (thread.threadHost.threadId !== undefined) {
    sensitiveLeaves.push({
      raw: thread.threadHost.threadId,
      sanitized: sanitizedAgentThread.threadHost.threadId
    })
  }
  if (thread.threadHost.machine !== undefined) {
    sensitiveLeaves.push({
      raw: thread.threadHost.machine,
      sanitized: sanitizedAgentThread.threadHost.machine
    })
  }
  if (observation.discovery.machine.source !== 'hostname-command') {
    throw new Error('Machine discovery must record an attempted hostname command.')
  }
  if (
    thread.threadHost.machine === undefined &&
    observation.discovery.machine.status === 'observed'
  ) {
    throw new Error('An observed machine value must be present in the artifact.')
  }

  const evidence: SanitizedEvidence = {
    checks: trueChecks(),
    discovery: observation.discovery,
    evidenceId: observation.evidenceId,
    exercisedAt: observation.exercisedAt,
    matrixEntryId: observation.matrixEntryId,
    relationships: { identity: 'identified', threadHostId },
    runtime: observation.runtime,
    sanitizedAgentThread,
    schemaVersion: evidenceSchemaVersion,
    sourceCommit: observation.sourceCommit,
    sourcePullRequest: observation.sourcePullRequest
  }
  assertSensitiveLeavesRedacted(sensitiveLeaves)
  const privateInputs = privateCaptureStrings(artifact, observation)
  const privateIdentities = sensitiveLeaves.map(({ raw }) => raw)
  const explicitlyPrivateInputs = [
    ...explicitlyPrivateArtifactStrings(artifact),
    ...privateIdentities
  ]
  const completePrivateInputs = completePrivateCaptureStrings(
    artifact,
    observation
  )
  const additivePrivateInputs = privateAdditiveArtifactInputs(artifact)
  assertEvidenceIdIndependent(
    evidence.evidenceId,
    privateInputs,
    explicitlyPrivateInputs,
    completePrivateInputs,
    privateIdentifierArtifactStrings(artifact),
    additivePrivateInputs.keys,
    additivePrivateInputs.scalarValues
  )
  assertPrivateArtifactValuesAbsentFromRuntime(
    privateInputs,
    evidence.runtime,
    explicitlyPrivateInputs,
    completePrivateInputs,
    privateIdentifierArtifactStrings(artifact),
    additivePrivateInputs.keys,
    additivePrivateInputs.scalarValues
  )
  return evidence
}

export function buildSanitizedFailureEvidence(
  observationValue: unknown,
  matrixValue: unknown,
  defectIssue: number
): SanitizedFailureEvidence {
  const observation = parseCaptureObservation(observationValue)
  const matrix = parseMetadataMatrix(matrixValue)
  matrixEntry(matrix, observation.matrixEntryId)
  if (!Number.isSafeInteger(defectIssue) || defectIssue < 1) {
    throw new Error('Failure evidence defectIssue must be a positive issue number.')
  }
  return {
    evidenceId: observation.evidenceId,
    exercisedAt: observation.exercisedAt,
    failure: {
      defectIssue,
      kind: 'automatic-check-failed'
    },
    matrixEntryId: observation.matrixEntryId,
    outcome: 'failed',
    schemaVersion: evidenceSchemaVersion,
    sourceCommit: observation.sourceCommit,
    sourcePullRequest: observation.sourcePullRequest
  }
}

export function recordConformanceEvidence(
  artifactValue: unknown,
  observationValue: unknown,
  matrixValue: unknown,
  defectIssue?: number
): CorpusEvidence {
  parseCaptureObservation(observationValue)
  parseMetadataMatrix(matrixValue)
  try {
    return buildSanitizedEvidence(artifactValue, observationValue, matrixValue)
  } catch (error) {
    if (defectIssue === undefined) {
      throw new Error(
        'Automatic conformance check failed; link a contract defect and rerun ' +
        'record with --defect-issue NUMBER to retain sanitized failure evidence.',
        { cause: error }
      )
    }
    const observation = parseCaptureObservation(observationValue)
    const additivePrivateInputs = privateAdditiveArtifactInputs(artifactValue)
    try {
      assertEvidenceIdIndependent(
        observation.evidenceId,
        privateCaptureStrings(artifactValue, observation),
        explicitlyPrivateArtifactStrings(artifactValue),
        completePrivateCaptureStrings(artifactValue, observation),
        privateIdentifierArtifactStrings(artifactValue),
        additivePrivateInputs.keys,
        additivePrivateInputs.scalarValues
      )
    } catch (privacyError) {
      if (
        !(privacyError instanceof Error) ||
        privacyError.message !==
          'Evidence ID suffix must be independent of private artifact values.'
      ) {
        throw privacyError
      }
      throw new Error(
        'Failure evidence ID suffix must be independent of every raw artifact string and key.',
        { cause: privacyError }
      )
    }
    return buildSanitizedFailureEvidence(
      observationValue,
      matrixValue,
      defectIssue
    )
  }
}

function assertTrueChecks(value: unknown): ConformanceChecks {
  const checks = record(value, 'Evidence checks')
  const fields = [
    'threadHostIdAccepted',
    'guessedValuesAbsent',
    'machineAttempted',
    'nullFallbackTruthful',
    'portableV1Valid',
    'requiredFieldsObserved',
    'sanitized',
    'supportedCombination'
  ] as const
  assertExactKeys(checks, fields, 'Evidence checks')
  for (const field of fields) {
    if (checks[field] !== true) throw new Error(`Evidence check ${field} must pass.`)
  }
  return trueChecks()
}

export function validateSanitizedEvidence(
  value: unknown,
  matrixValue: unknown
): SanitizedEvidence {
  const item = record(value, 'Sanitized evidence')
  assertExactKeys(item, [
    'checks',
    'discovery',
    'evidenceId',
    'exercisedAt',
    'matrixEntryId',
    'relationships',
    'runtime',
    'sanitizedAgentThread',
    'schemaVersion',
    'sourceCommit',
    'sourcePullRequest'
  ], 'Sanitized evidence')
  if (item.schemaVersion !== evidenceSchemaVersion) {
    throw new Error(`Sanitized evidence schemaVersion must be ${evidenceSchemaVersion}.`)
  }
  const observation = parseCaptureObservation({
    discovery: item.discovery,
    evidenceId: item.evidenceId,
    exercisedAt: item.exercisedAt,
    limitations: [],
    matrixEntryId: item.matrixEntryId,
    runtime: item.runtime,
    schemaVersion: item.schemaVersion,
    sourceCommit: item.sourceCommit,
    sourcePullRequest: item.sourcePullRequest,
    truthfulnessAttested: true
  })
  const matrix = parseMetadataMatrix(matrixValue)
  const entry = matrixEntry(matrix, observation.matrixEntryId)
  const relationships = record(item.relationships, 'Evidence relationships')
  assertExactKeys(
    relationships,
    ['identity', 'threadHostId'],
    'Evidence relationships'
  )
  const identity = oneOf(relationships.identity, [
    'identified', 'truthful-null'
  ], 'Evidence relationships.identity')
  const threadHostId = oneOf(relationships.threadHostId, [
    'distinct', 'equal', 'omitted'
  ], 'Evidence relationships.threadHostId')
  let sanitizedAgentThread: SanitizedEvidence['sanitizedAgentThread']
  if (item.sanitizedAgentThread === null) {
    throw new Error(
      `${entry.id} evidence cannot verify a host/provider combination with null ` +
      'agentThread metadata.'
    )
  } else {
    const thread = record(item.sanitizedAgentThread, 'Evidence sanitizedAgentThread')
    assertExactKeys(
      thread,
      ['id', 'threadHost'],
      'Evidence sanitizedAgentThread'
    )
    const host = record(thread.threadHost, 'Evidence sanitizedAgentThread.threadHost')
    assertExactKeys(
      host,
      ['kind', 'machine', 'provider', 'threadId'],
      'Evidence sanitizedAgentThread.threadHost'
    )
    if (thread.id !== redactedProviderThreadId) {
      throw new Error('Evidence requesting-thread ID must use the redaction marker.')
    }
    if (host.kind !== entry.threadHost.kind || host.provider !== entry.threadHost.provider) {
      throw new Error(`Evidence thread metadata does not match ${entry.id}.`)
    }
    const sanitizedHost: NonNullable<
      SanitizedEvidence['sanitizedAgentThread']
    >['threadHost'] = {
      kind: entry.threadHost.kind,
      provider: entry.threadHost.provider
    }
    assertObserved(observation.discovery.providerThreadId, 'agentThread.id')
    assertObserved(observation.discovery.hostKind, 'threadHost.kind')
    assertObserved(observation.discovery.hostProvider, 'threadHost.provider')
    if (host.threadId !== undefined) {
      assertObserved(observation.discovery.hostThreadId, 'threadHost.threadId')
      if (
        host.threadId !== redactedThreadHostThreadId ||
        (threadHostId !== 'distinct' && threadHostId !== 'equal')
      ) {
        throw new Error('Evidence host thread ID must record an accepted relationship and use the redaction marker.')
      }
      sanitizedHost.threadId = redactedThreadHostThreadId
    } else {
      if (threadHostId !== 'omitted') {
        throw new Error('Evidence relationship requires a redacted host thread ID.')
      }
      if (observation.discovery.hostThreadId.status === 'observed') {
        throw new Error('Observed host thread identity is absent from evidence.')
      }
    }
    if (host.machine !== undefined) {
      assertObserved(observation.discovery.machine, 'threadHost.machine')
      if (host.machine !== redactedMachine) {
        throw new Error('Evidence machine must use the redaction marker.')
      }
      sanitizedHost.machine = redactedMachine
    } else if (observation.discovery.machine.status === 'observed') {
      throw new Error('Observed machine value is absent from evidence.')
    }
    if (identity !== 'identified') {
      throw new Error('Non-null evidence must record identified identity.')
    }
    sanitizedAgentThread = {
      id: redactedProviderThreadId,
      threadHost: sanitizedHost
    }
  }
  if (observation.discovery.machine.source !== 'hostname-command') {
    throw new Error('Evidence must record an attempted hostname command.')
  }
  return {
    checks: assertTrueChecks(item.checks),
    discovery: observation.discovery,
    evidenceId: observation.evidenceId,
    exercisedAt: observation.exercisedAt,
    matrixEntryId: observation.matrixEntryId,
    relationships: { identity, threadHostId },
    runtime: observation.runtime,
    sanitizedAgentThread,
    schemaVersion: evidenceSchemaVersion,
    sourceCommit: observation.sourceCommit,
    sourcePullRequest: observation.sourcePullRequest
  }
}

export function validateSanitizedFailureEvidence(
  value: unknown,
  matrixValue: unknown
): SanitizedFailureEvidence {
  const item = record(value, 'Sanitized failure evidence')
  assertExactKeys(item, [
    'evidenceId',
    'exercisedAt',
    'failure',
    'matrixEntryId',
    'outcome',
    'schemaVersion',
    'sourceCommit',
    'sourcePullRequest'
  ], 'Sanitized failure evidence')
  if (item.schemaVersion !== evidenceSchemaVersion || item.outcome !== 'failed') {
    throw new Error('Sanitized failure evidence has an invalid schema or outcome.')
  }
  const evidenceId = nonblank(item.evidenceId, 'Failure evidence evidenceId')
  const matrixEntryId = nonblank(
    item.matrixEntryId,
    'Failure evidence matrixEntryId'
  )
  if (!evidenceIdPattern.test(evidenceId) || evidenceId.split('__')[1] !== matrixEntryId) {
    throw new Error('Failure evidence ID must use the selected matrix entry slug.')
  }
  const exercisedAt = nonblank(item.exercisedAt, 'Failure evidence exercisedAt')
  if (!isCanonicalReviewTimestamp(exercisedAt)) {
    throw new Error('Failure evidence exercisedAt must be a canonical UTC timestamp.')
  }
  if (evidenceId.slice(0, 10) !== exercisedAt.slice(0, 10)) {
    throw new Error('Failure evidence ID date must equal the exercisedAt UTC date.')
  }
  const sourceCommit = nonblank(item.sourceCommit, 'Failure evidence sourceCommit')
  if (!fullCommitPattern.test(sourceCommit)) {
    throw new Error('Failure evidence sourceCommit must be a full Git commit.')
  }
  const sourcePullRequest = nonblank(
    item.sourcePullRequest,
    'Failure evidence sourcePullRequest'
  )
  if (parseGitHubPullRequestUrl(sourcePullRequest)?.url !== sourcePullRequest) {
    throw new Error('Failure evidence sourcePullRequest must be canonical.')
  }
  const failure = record(item.failure, 'Failure evidence failure')
  assertExactKeys(failure, ['defectIssue', 'kind'], 'Failure evidence failure')
  if (
    failure.kind !== 'automatic-check-failed' ||
    !Number.isSafeInteger(failure.defectIssue) ||
    (failure.defectIssue as number) < 1
  ) {
    throw new Error('Failure evidence must link an automatic-check contract defect.')
  }
  const matrix = parseMetadataMatrix(matrixValue)
  matrixEntry(matrix, matrixEntryId)
  return {
    evidenceId,
    exercisedAt,
    failure: {
      defectIssue: failure.defectIssue as number,
      kind: 'automatic-check-failed'
    },
    matrixEntryId,
    outcome: 'failed',
    schemaVersion: evidenceSchemaVersion,
    sourceCommit,
    sourcePullRequest
  }
}

export function validateMetadataCorpus(
  root = projectRoot,
  requireComplete = false,
  verifyDefect: DefectVerifier = verifyContractDefectIssue
): { evidenceCount: number; matrixEntryCount: number } {
  const directory = path.join(root, 'evals/review-metadata')
  const matrixFile = path.join(directory, 'matrix.json')
  const evidenceFolder = path.join(directory, 'evidence')
  const matrixValue = readJson(matrixFile)
  const matrix = parseMetadataMatrix(matrixValue)
  const evidenceEntries = fs.readdirSync(evidenceFolder, { withFileTypes: true })
  for (const entry of evidenceEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      throw new Error(
        `Evidence directory contains unexpected entry: ${entry.name}.`
      )
    }
  }
  const evidenceFiles = evidenceEntries
    .map(({ name }) => name)
    .sort()
  const evidenceById = new Map<string, CorpusEvidence>()
  for (const name of evidenceFiles) {
    const value = readJson(path.join(evidenceFolder, name))
    const evidence = isRecord(value) && value.outcome === 'failed'
      ? validateSanitizedFailureEvidence(value, matrixValue)
      : validateSanitizedEvidence(value, matrixValue)
    if ('outcome' in evidence) {
      verifyDefect(
        evidence.sourcePullRequest,
        evidence.failure.defectIssue,
        root
      )
    }
    if (name !== `${evidence.evidenceId}.json`) {
      throw new Error(`Evidence filename does not match ${evidence.evidenceId}.`)
    }
    if (evidenceById.has(evidence.evidenceId)) {
      throw new Error(`Duplicate evidence ID: ${evidence.evidenceId}.`)
    }
    evidenceById.set(evidence.evidenceId, evidence)
  }
  const referencedEvidence = new Set<string>()
  const realExerciseDirectory = fs.realpathSync(path.join(directory, 'exercises'))
  for (const entry of matrix.entries) {
    const exercisePath = path.join(directory, entry.exercise)
    let exercise: fs.Stats
    try {
      exercise = fs.lstatSync(exercisePath)
    } catch {
      throw new Error(`${entry.id} exercise does not exist: ${entry.exercise}.`)
    }
    if (!exercise.isFile()) {
      throw new Error(`${entry.id} exercise must be a regular file: ${entry.exercise}.`)
    }
    const realExercisePath = fs.realpathSync(exercisePath)
    const relativeExercisePath = path.relative(
      realExerciseDirectory,
      realExercisePath
    )
    if (
      relativeExercisePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeExercisePath)
    ) {
      throw new Error(`${entry.id} exercise must resolve beneath exercises/.`)
    }
    if (
      requireComplete &&
      !entry.evidence.some((evidenceId) => {
        const evidence = evidenceById.get(evidenceId)
        return evidence !== undefined && !('outcome' in evidence)
      })
    ) {
      throw new Error(`${entry.id} has no committed live evidence.`)
    }
    for (const evidenceId of entry.evidence) {
      const evidence = evidenceById.get(evidenceId)
      if (evidence === undefined) {
        throw new Error(`${entry.id} references missing evidence ${evidenceId}.`)
      }
      if (evidence.matrixEntryId !== entry.id) {
        throw new Error(`${evidenceId} belongs to ${evidence.matrixEntryId}, not ${entry.id}.`)
      }
      if (referencedEvidence.has(evidenceId)) {
        throw new Error(`${evidenceId} is referenced by more than one matrix entry.`)
      }
      referencedEvidence.add(evidenceId)
    }
  }
  for (const evidenceId of evidenceById.keys()) {
    if (!referencedEvidence.has(evidenceId)) {
      throw new Error(`Unreferenced evidence: ${evidenceId}.`)
    }
  }
  return { evidenceCount: evidenceById.size, matrixEntryCount: matrix.entries.length }
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`)
  }
  return value
}

function optionalPositiveIntegerOption(
  args: string[],
  name: string
): number | undefined {
  if (!args.includes(name)) return undefined
  const value = Number(option(args, name))
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return value
}

function writeExclusiveJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  })
}

function main(): void {
  const [command = 'validate', ...args] = process.argv.slice(2)
  if (command === 'validate') {
    const unknown = args.filter((argument) => argument !== '--require-complete')
    if (unknown.length > 0) throw new Error(`Unknown validate option: ${unknown[0]}.`)
    const result = validateMetadataCorpus(projectRoot, args.includes('--require-complete'))
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`)
    return
  }
  if (command === 'record') {
    const reviewPath = path.resolve(option(args, '--review'))
    const observationPath = path.resolve(option(args, '--observation'))
    const outputPath = path.resolve(option(args, '--output'))
    const observation = parseCaptureObservation(readJson(observationPath))
    verifySourceCommitPullRequest(observation)
    const evidence = recordConformanceEvidence(
      readJson(reviewPath),
      observation,
      readJson(matrixPath),
      optionalPositiveIntegerOption(args, '--defect-issue')
    )
    if ('outcome' in evidence) {
      verifyContractDefectIssue(
        evidence.sourcePullRequest,
        evidence.failure.defectIssue
      )
    }
    writeExclusiveJson(outputPath, evidence)
    process.stdout.write(`${JSON.stringify({
      evidenceId: evidence.evidenceId,
      ok: true,
      output: outputPath
    })}\n`)
    return
  }
  throw new Error(
    'Usage: review-metadata-conformance <validate [--require-complete] | record --review PATH --observation PATH --output PATH [--defect-issue NUMBER]>'
  )
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}

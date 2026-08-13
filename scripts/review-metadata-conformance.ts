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
const runtimeTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}(?: [A-Za-z0-9][A-Za-z0-9._+-]{0,39}){0,4}$/
const redactedProviderThreadId = '<redacted-provider-thread-id>'
const redactedThreadHostThreadId = '<redacted-thread-host-thread-id>'
const redactedMachine = '<redacted-machine>'
const runnerSourcePaths = [
  'evals/review-metadata/exercise-source.md',
  'evals/review-metadata/matrix.json',
  'package-lock.json',
  'package.json',
  'scripts/review-metadata-conformance.ts',
  'src/pull-request.ts',
  'src/review-format.ts',
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
    status: 'provisional-evidence'
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
  distinctThreadHostId: true
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
    threadHostId: 'distinct' | 'omitted'
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
    classification.status !== 'provisional-evidence'
  ) {
    throw new Error(
      'Metadata matrix classifications must remain provisional evidence owned by issue #134.'
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
      status: 'provisional-evidence'
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
    distinctThreadHostId: true,
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
  privateValues: Array<string | null | undefined>
): void {
  const suffix = evidenceId.slice(-8)
  if (privateValues.some((value) => value === suffix)) {
    throw new Error(
      'Evidence ID suffix must be independent of private artifact values.'
    )
  }
}

function assertPrivateArtifactValuesAbsentFromRuntime(
  values: Array<string | null | undefined>,
  runtime: RuntimeObservation
): void {
  const persistedRuntimeValues = [
    runtime.hostVersion,
    runtime.providerModel,
    runtime.providerVersion
  ]
  const persistedRuntimeSegments = persistedRuntimeValues.flatMap((value) => (
    value === null ? [] : value.split(/\s+/)
  ))
  if (values.some((value) => value !== null && value !== undefined &&
    (persistedRuntimeValues.includes(value) || persistedRuntimeSegments.includes(value)))) {
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
      throw new Error(`${entry.id} requires reliable provider thread identity.`)
    }
    if (observation.discovery.providerThreadId.status !== 'unavailable') {
      throw new Error('A null agentThread requires provider identity to be unavailable.')
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
    threadHostId = 'distinct'
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
  const privateArtifactValues = [
    artifact.sourceDocument.name,
    artifact.sourceDocument.path,
    artifact.sourceDocument.checksum,
    artifact.review.id,
    artifact.review.git?.repositoryUrl,
    artifact.review.git?.branch,
    artifact.review.git?.commit,
    artifact.review.pullRequest?.url,
    ...sensitiveLeaves.map(({ raw }) => raw)
  ]
  assertEvidenceIdIndependent(evidence.evidenceId, privateArtifactValues)
  assertPrivateArtifactValuesAbsentFromRuntime(
    privateArtifactValues,
    evidence.runtime
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
    const suffix = parseCaptureObservation(observationValue).evidenceId.slice(-8)
    const rawContainsSuffix = (value: unknown): boolean => {
      if (typeof value === 'string') return value === suffix
      if (Array.isArray(value)) return value.some(rawContainsSuffix)
      if (isRecord(value)) return Object.values(value).some(rawContainsSuffix)
      return false
    }
    if (rawContainsSuffix(artifactValue)) {
      throw new Error(
        'Failure evidence ID suffix must be independent of every raw artifact value.',
        { cause: error }
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
    'distinctThreadHostId',
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
    'distinct', 'omitted'
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
      throw new Error('Evidence provider thread ID must use the redaction marker.')
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
      if (host.threadId !== redactedThreadHostThreadId || threadHostId !== 'distinct') {
        throw new Error('Evidence host thread ID must be distinct and redacted.')
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

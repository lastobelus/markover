import fs from 'node:fs'
import path from 'node:path'

import {
  decodeReviewArtifact,
  isCanonicalReviewTimestamp
} from '../src/review-format'

const evidenceSchemaVersion = 1
const matrixSchemaVersion = 1
const evidenceIdPattern = /^\d{4}-\d{2}-\d{2}__[a-z0-9]+(?:-[a-z0-9]+)*__[a-z0-9]{8}$/
const fullCommitPattern = /^[0-9a-f]{40}$/
const redactedProviderThreadId = '<redacted-provider-thread-id>'
const redactedThreadHostThreadId = '<redacted-thread-host-thread-id>'
const redactedMachine = '<redacted-machine>'

type DiscoveryStatus = 'not-applicable' | 'observed' | 'unavailable'
type DiscoverySource =
  | 'agent-runtime'
  | 'hostname-command'
  | 'not-exposed'
  | 'not-applicable'
  | 'thread-context'
  | 'thread-host-runtime'
type IdentityExpectation = 'required' | 'unavailable-allowed'
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
  entries: MatrixEntry[]
  expansionCandidates: Array<{
    hostProduct: string
    providerSelection: 'discover-at-exercise'
    reason: string
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
  limitations: string[]
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
}

type JsonRecord = Record<string, unknown>

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

function nullableNonblank(value: unknown, label: string): string | null {
  if (value === null) return null
  return nonblank(value, label)
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

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
}

function parseDiscovery(value: unknown, label: string): DiscoveryObservation {
  const item = record(value, label)
  assertExactKeys(item, ['source', 'status'], label)
  return {
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
    hostVersion: nullableNonblank(item.hostVersion, `${label}.hostVersion`),
    hostVersionSource: oneOf(item.hostVersionSource, [
      'command', 'not-exposed', 'runtime-context'
    ], `${label}.hostVersionSource`),
    providerModel: nullableNonblank(item.providerModel, `${label}.providerModel`),
    providerModelSource: oneOf(item.providerModelSource, [
      'command', 'not-exposed', 'runtime-context'
    ], `${label}.providerModelSource`),
    providerVersion: nullableNonblank(item.providerVersion, `${label}.providerVersion`),
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
    'truthfulnessAttested'
  ], 'Capture observation')
  if (item.schemaVersion !== evidenceSchemaVersion) {
    throw new Error(`Capture observation schemaVersion must be ${evidenceSchemaVersion}.`)
  }
  const evidenceId = nonblank(item.evidenceId, 'Capture observation evidenceId')
  if (!evidenceIdPattern.test(evidenceId)) {
    throw new Error('Capture observation evidenceId has an invalid format.')
  }
  const exercisedAt = nonblank(item.exercisedAt, 'Capture observation exercisedAt')
  if (!isCanonicalReviewTimestamp(exercisedAt)) {
    throw new Error('Capture observation exercisedAt must be a canonical UTC timestamp.')
  }
  const sourceCommit = nonblank(item.sourceCommit, 'Capture observation sourceCommit')
  if (!fullCommitPattern.test(sourceCommit)) {
    throw new Error('Capture observation sourceCommit must be a full Git commit.')
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
      hostKind: parseDiscovery(discovery.hostKind, 'discovery.hostKind'),
      hostProvider: parseDiscovery(discovery.hostProvider, 'discovery.hostProvider'),
      hostThreadId: parseDiscovery(discovery.hostThreadId, 'discovery.hostThreadId'),
      machine: parseDiscovery(discovery.machine, 'discovery.machine'),
      providerThreadId: parseDiscovery(
        discovery.providerThreadId,
        'discovery.providerThreadId'
      )
    },
    evidenceId,
    exercisedAt,
    limitations: stringArray(item.limitations, 'Capture observation limitations'),
    matrixEntryId: nonblank(item.matrixEntryId, 'Capture observation matrixEntryId'),
    runtime: parseRuntime(item.runtime, 'Capture observation runtime'),
    schemaVersion: evidenceSchemaVersion,
    sourceCommit,
    truthfulnessAttested: true
  }
}

function parseMatrixEntry(value: unknown, label: string): MatrixEntry {
  const item = record(value, label)
  const threadHost = record(item.threadHost, `${label}.threadHost`)
  if (item.availability !== 'available') {
    throw new Error(`${label}.availability must be available for a supported entry.`)
  }
  return {
    availability: 'available',
    evidence: stringArray(item.evidence, `${label}.evidence`),
    exercise: nonblank(item.exercise, `${label}.exercise`),
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
  if (item.schemaVersion !== matrixSchemaVersion) {
    throw new Error(`Metadata matrix schemaVersion must be ${matrixSchemaVersion}.`)
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
      reason: nonblank(value.reason, `expansionCandidates[${index}].reason`)
    }
  })
  return { entries, expansionCandidates, schemaVersion: matrixSchemaVersion }
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

function scanForRawValues(evidence: SanitizedEvidence, values: string[]): void {
  const serialized = JSON.stringify(evidence)
  for (const value of values) {
    if (serialized.includes(value)) {
      throw new Error('Sanitized evidence still contains a raw identity value.')
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
  const rawValues: string[] = []
  let sanitizedAgentThread: SanitizedEvidence['sanitizedAgentThread'] = null
  let identity: SanitizedEvidence['relationships']['identity'] = 'truthful-null'
  let threadHostId: SanitizedEvidence['relationships']['threadHostId'] = 'omitted'

  if (thread === null) {
    if (entry.identityExpectation === 'required') {
      throw new Error(`${entry.id} requires reliable provider thread identity.`)
    }
    if (observation.discovery.providerThreadId.status !== 'unavailable') {
      throw new Error('A null agentThread requires provider identity to be unavailable.')
    }
  } else {
    if (
      thread.threadHost.kind !== entry.threadHost.kind ||
      thread.threadHost.provider !== entry.threadHost.provider
    ) {
      throw new Error(`Captured thread metadata does not match ${entry.id}.`)
    }
    assertObserved(observation.discovery.providerThreadId, 'agentThread.id')
    assertObserved(observation.discovery.hostKind, 'threadHost.kind')
    assertObserved(observation.discovery.hostProvider, 'threadHost.provider')
    rawValues.push(thread.id)
    const sanitizedThreadHost: NonNullable<
      SanitizedEvidence['sanitizedAgentThread']
    >['threadHost'] = {
      kind: thread.threadHost.kind,
      provider: thread.threadHost.provider
    }
    if (thread.threadHost.threadId !== undefined) {
      assertObserved(observation.discovery.hostThreadId, 'threadHost.threadId')
      rawValues.push(thread.threadHost.threadId)
      sanitizedThreadHost.threadId = redactedThreadHostThreadId
      threadHostId = 'distinct'
    } else if (observation.discovery.hostThreadId.status === 'observed') {
      throw new Error('Host thread identity was observed but omitted from the artifact.')
    }
    if (thread.threadHost.machine !== undefined) {
      assertObserved(observation.discovery.machine, 'threadHost.machine')
      rawValues.push(thread.threadHost.machine)
      sanitizedThreadHost.machine = redactedMachine
    }
    identity = 'identified'
    sanitizedAgentThread = {
      id: redactedProviderThreadId,
      threadHost: sanitizedThreadHost
    }
  }
  if (observation.discovery.machine.source !== 'hostname-command') {
    throw new Error('Machine discovery must record an attempted hostname command.')
  }
  if (thread?.threadHost.machine === undefined && observation.discovery.machine.status === 'observed') {
    throw new Error('An observed machine value must be present in the artifact.')
  }

  const evidence: SanitizedEvidence = {
    checks: trueChecks(),
    discovery: observation.discovery,
    evidenceId: observation.evidenceId,
    exercisedAt: observation.exercisedAt,
    limitations: observation.limitations,
    matrixEntryId: observation.matrixEntryId,
    relationships: { identity, threadHostId },
    runtime: observation.runtime,
    sanitizedAgentThread,
    schemaVersion: evidenceSchemaVersion,
    sourceCommit: observation.sourceCommit
  }
  scanForRawValues(evidence, rawValues)
  return evidence
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
    'limitations',
    'matrixEntryId',
    'relationships',
    'runtime',
    'sanitizedAgentThread',
    'schemaVersion',
    'sourceCommit'
  ], 'Sanitized evidence')
  if (item.schemaVersion !== evidenceSchemaVersion) {
    throw new Error(`Sanitized evidence schemaVersion must be ${evidenceSchemaVersion}.`)
  }
  const observation = parseCaptureObservation({
    discovery: item.discovery,
    evidenceId: item.evidenceId,
    exercisedAt: item.exercisedAt,
    limitations: item.limitations,
    matrixEntryId: item.matrixEntryId,
    runtime: item.runtime,
    schemaVersion: item.schemaVersion,
    sourceCommit: item.sourceCommit,
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
    if (entry.identityExpectation === 'required' || identity !== 'truthful-null') {
      throw new Error(`${entry.id} evidence requires identified agentThread metadata.`)
    }
    if (threadHostId !== 'omitted') {
      throw new Error('Null evidence cannot record a distinct host thread ID.')
    }
    if (observation.discovery.providerThreadId.status !== 'unavailable') {
      throw new Error('Null evidence requires provider identity to be unavailable.')
    }
    for (const [field, discovery] of [
      ['threadHost.kind', observation.discovery.hostKind],
      ['threadHost.provider', observation.discovery.hostProvider],
      ['threadHost.threadId', observation.discovery.hostThreadId],
      ['threadHost.machine', observation.discovery.machine]
    ] as const) {
      if (discovery.status === 'observed') {
        throw new Error(`${field} was observed but is absent from null evidence.`)
      }
    }
    sanitizedAgentThread = null
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
    limitations: observation.limitations,
    matrixEntryId: observation.matrixEntryId,
    relationships: { identity, threadHostId },
    runtime: observation.runtime,
    sanitizedAgentThread,
    schemaVersion: evidenceSchemaVersion,
    sourceCommit: observation.sourceCommit
  }
}

export function validateMetadataCorpus(
  root = projectRoot,
  requireComplete = false
): { evidenceCount: number; matrixEntryCount: number } {
  const directory = path.join(root, 'evals/review-metadata')
  const matrixFile = path.join(directory, 'matrix.json')
  const evidenceFolder = path.join(directory, 'evidence')
  const matrixValue = readJson(matrixFile)
  const matrix = parseMetadataMatrix(matrixValue)
  const evidenceFiles = fs.readdirSync(evidenceFolder)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const evidenceById = new Map<string, SanitizedEvidence>()
  for (const name of evidenceFiles) {
    const evidence = validateSanitizedEvidence(
      readJson(path.join(evidenceFolder, name)),
      matrixValue
    )
    if (name !== `${evidence.evidenceId}.json`) {
      throw new Error(`Evidence filename does not match ${evidence.evidenceId}.`)
    }
    if (evidenceById.has(evidence.evidenceId)) {
      throw new Error(`Duplicate evidence ID: ${evidence.evidenceId}.`)
    }
    evidenceById.set(evidence.evidenceId, evidence)
  }
  const referencedEvidence = new Set<string>()
  for (const entry of matrix.entries) {
    const exercisePath = path.join(directory, entry.exercise)
    if (!fs.existsSync(exercisePath)) {
      throw new Error(`${entry.id} exercise does not exist: ${entry.exercise}.`)
    }
    if (requireComplete && entry.evidence.length === 0) {
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
    const evidence = buildSanitizedEvidence(
      readJson(reviewPath),
      readJson(observationPath),
      readJson(matrixPath)
    )
    writeExclusiveJson(outputPath, evidence)
    process.stdout.write(`${JSON.stringify({
      evidenceId: evidence.evidenceId,
      ok: true,
      output: outputPath
    })}\n`)
    return
  }
  throw new Error(
    'Usage: review-metadata-conformance <validate [--require-complete] | record --review PATH --observation PATH --output PATH>'
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

import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'

export const decisionGardenerSchemaVersion = 1 as const
export const decisionCheckpointLabel = 'decision-gardener-checkpoint'

const fullCommitPattern = /^[0-9a-f]{40}$/
const allowedCodexItemTypes = new Set(['agent_message', 'reasoning'])
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

export interface CommandResult {
  status: number
  stderr: string
  stdout: Buffer
}

export type GitCommandRunner = (
  repository: string,
  args: readonly string[]
) => CommandResult

export interface EncodedGitContent {
  bytes: number
  encoding: 'base64' | 'utf8'
  sha256: string
  value: string
}

export interface ChangedPath {
  oldPath?: string
  path: string
  status: string
}

export interface AuditedCommit {
  author: { date: string; email: string; name: string }
  changedPaths: readonly ChangedPath[]
  committer: { date: string; email: string; name: string }
  message: string
  parents: readonly string[]
  patch: EncodedGitContent
  sha: string
  subject: string
}

export interface AuditedPathSnapshot {
  content: EncodedGitContent | null
  mode: string | null
  object: string | null
  path: string
  type: string | null
}

export interface DecisionAuditBundle {
  checkpoint: string
  commits: readonly AuditedCommit[]
  decisions: {
    content: string
    path: 'DECISIONS.md'
    sha256: string
  }
  generatedAt: string
  ownershipSnapshot: unknown
  paths: readonly AuditedPathSnapshot[]
  schemaVersion: typeof decisionGardenerSchemaVersion
  target: string
  targetRef: string
}

export interface ContextRequest {
  kind: 'git_object' | 'path'
  reason: string
  value: string
}

export interface LoadedContext {
  content: EncodedGitContent
  kind: ContextRequest['kind']
  object: string
  objectType: string
  request: ContextRequest
}

export interface AuditClassification {
  classification: 'Deferred' | 'Planned' | 'Retain' | 'Revise' | 'Superseded'
  entry: string
  evidence: readonly string[]
  reason: string
}

export interface AuditReport {
  ambiguities: readonly { evidence: readonly string[]; summary: string }[]
  classifications: readonly AuditClassification[]
  ownershipMatches: readonly { issue: number; reason: string; title: string }[]
  suggestedFollowups: readonly { ownerIssue: number | null; summary: string }[]
  summary: string
}

export interface AuditAgentResult {
  contextRequests: readonly ContextRequest[]
  proposedDecisions: string | null
  report: AuditReport
  schemaVersion: typeof decisionGardenerSchemaVersion
  status: 'ambiguous' | 'complete' | 'needs_context'
}

export interface AuditRoundInput {
  bundle: DecisionAuditBundle
  contexts: readonly LoadedContext[]
  round: number
}

export interface SingleFlightLease {
  release: () => Promise<void>
  token: string
}

export const runGitCommand: GitCommandRunner = (repository, args) => {
  const result = spawnSync('git', [...args], {
    cwd: repository,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024
  })
  if (result.error) throw result.error
  return {
    status: result.status ?? 1,
    stderr: result.stderr.toString('utf8'),
    stdout: result.stdout
  }
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function requireGit(
  runner: GitCommandRunner,
  repository: string,
  args: readonly string[],
  label: string
): Buffer {
  const result = runner(repository, args)
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim() || 'git exited non-zero'}`)
  }
  return result.stdout
}

function gitText(
  runner: GitCommandRunner,
  repository: string,
  args: readonly string[],
  label: string
): string {
  return requireGit(runner, repository, args, label).toString('utf8').trimEnd()
}

function encodeContent(content: Buffer): EncodedGitContent {
  try {
    return {
      bytes: content.byteLength,
      encoding: 'utf8',
      sha256: sha256(content),
      value: utf8Decoder.decode(content)
    }
  } catch {
    return {
      bytes: content.byteLength,
      encoding: 'base64',
      sha256: sha256(content),
      value: content.toString('base64')
    }
  }
}

export function parseDecisionCheckpoint(source: string): string {
  const mentions = source.match(new RegExp(`${decisionCheckpointLabel}:`, 'g')) ?? []
  const matches = [...source.matchAll(new RegExp(
    `<!--\\s*${decisionCheckpointLabel}:\\s*([0-9a-f]{40})\\s*-->`,
    'g'
  ))]
  if (mentions.length !== 1 || matches.length !== 1 || !matches[0]?.[1]) {
    throw new Error(
      `DECISIONS.md must contain exactly one ${decisionCheckpointLabel} marker with a full lowercase commit SHA.`
    )
  }
  return matches[0][1]
}

export function replaceDecisionCheckpoint(source: string, target: string): string {
  if (!fullCommitPattern.test(target)) {
    throw new Error('The decision checkpoint target must be a full lowercase commit SHA.')
  }
  parseDecisionCheckpoint(source)
  return source.replace(
    new RegExp(`(<!--\\s*${decisionCheckpointLabel}:\\s*)[0-9a-f]{40}(\\s*-->)`),
    `$1${target}$2`
  )
}

function assertCommit(
  repository: string,
  commit: string,
  runner: GitCommandRunner,
  label: string
): void {
  if (!fullCommitPattern.test(commit)) {
    throw new Error(`${label} must resolve to a full lowercase commit SHA.`)
  }
  requireGit(runner, repository, ['cat-file', '-e', `${commit}^{commit}`], label)
}

export function resolveCommit(
  repository: string,
  ref: string,
  runner: GitCommandRunner = runGitCommand
): string {
  const commit = gitText(
    runner,
    repository,
    ['rev-parse', '--verify', `${ref}^{commit}`],
    `Resolve ${ref}`
  )
  assertCommit(repository, commit, runner, `Resolved ${ref}`)
  return commit
}

export function discoverCommitRange({
  checkpoint,
  repository,
  runner = runGitCommand,
  targetRef = 'origin/main'
}: {
  checkpoint: string
  repository: string
  runner?: GitCommandRunner
  targetRef?: string
}): { commits: readonly string[]; target: string } {
  assertCommit(repository, checkpoint, runner, 'Decision checkpoint')
  const target = resolveCommit(repository, targetRef, runner)
  const ancestry = runner(repository, [
    'merge-base', '--is-ancestor', checkpoint, target
  ])
  if (ancestry.status !== 0) {
    throw new Error(
      `Decision checkpoint ${checkpoint} is not an ancestor of ${targetRef} (${target}).`
    )
  }
  const source = gitText(
    runner,
    repository,
    ['rev-list', '--reverse', `${checkpoint}..${target}`],
    'Discover unaudited commits'
  )
  const commits = source.length === 0 ? [] : source.split('\n')
  if (!commits.every((commit) => fullCommitPattern.test(commit))) {
    throw new Error('Git returned an invalid commit while discovering the audit range.')
  }
  return { commits, target }
}

function parseChangedPaths(source: Buffer): ChangedPath[] {
  const fields = source.toString('utf8').split('\0')
  if (fields.at(-1) === '') fields.pop()
  const paths: ChangedPath[] = []
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    if (!status) throw new Error('Git returned an incomplete changed-path record.')
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = fields[index++]
      const currentPath = fields[index++]
      if (!oldPath || !currentPath) {
        throw new Error('Git returned an incomplete rename/copy record.')
      }
      paths.push({ oldPath, path: currentPath, status })
      continue
    }
    const currentPath = fields[index++]
    if (!currentPath) throw new Error('Git returned an incomplete path record.')
    paths.push({ path: currentPath, status })
  }
  return paths
}

function readCommit(
  repository: string,
  commit: string,
  runner: GitCommandRunner
): AuditedCommit {
  const metadata = requireGit(runner, repository, [
    'show', '-s',
    '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b',
    commit
  ], `Read commit ${commit}`).toString('utf8')
  const fields = metadata.endsWith('\n')
    ? metadata.slice(0, -1).split('\0')
    : metadata.split('\0')
  if (fields.length !== 10 || fields[0] !== commit) {
    throw new Error(`Git returned malformed metadata for commit ${commit}.`)
  }
  const field = (index: number): string => {
    const value = fields[index]
    if (value === undefined) {
      throw new Error(`Git returned incomplete metadata for commit ${commit}.`)
    }
    return value
  }
  const sha = field(0)
  const parents = field(1)
  const authorName = field(2)
  const authorEmail = field(3)
  const authorDate = field(4)
  const committerName = field(5)
  const committerEmail = field(6)
  const committerDate = field(7)
  const subject = field(8)
  const message = field(9)

  const changedPaths = parseChangedPaths(requireGit(runner, repository, [
    'diff-tree', '--root', '--first-parent', '--no-commit-id', '--name-status',
    '-r', '-z', '--find-renames', commit
  ], `Read changed paths for ${commit}`))
  const patch = requireGit(runner, repository, [
    'show', '--first-parent', '--format=fuller', '--binary', '--find-renames',
    '--no-ext-diff', commit
  ], `Read patch for ${commit}`)
  return {
    author: { date: authorDate, email: authorEmail, name: authorName },
    changedPaths,
    committer: {
      date: committerDate,
      email: committerEmail,
      name: committerName
    },
    message,
    parents: parents.length === 0 ? [] : parents.split(' '),
    patch: encodeContent(patch),
    sha,
    subject
  }
}

function readPathSnapshot(
  repository: string,
  target: string,
  filePath: string,
  runner: GitCommandRunner
): AuditedPathSnapshot {
  const record = requireGit(runner, repository, [
    'ls-tree', '-z', target, '--', filePath
  ], `Inspect ${filePath} at ${target}`).toString('utf8')
  if (record.length === 0) {
    return { content: null, mode: null, object: null, path: filePath, type: null }
  }
  const match = record.match(/^([0-7]{6}) ([a-z]+) ([0-9a-f]{40})\t[^\0]+\0$/)
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(`Git returned malformed tree metadata for ${filePath}.`)
  }
  const [, mode, type, object] = match
  const content = requireGit(
    runner,
    repository,
    ['cat-file', '-p', object],
    `Read ${filePath} at ${target}`
  )
  return { content: encodeContent(content), mode, object, path: filePath, type }
}

export function assembleDecisionAuditBundle({
  generatedAt = new Date().toISOString(),
  ownershipSnapshot,
  repository,
  runner = runGitCommand,
  targetRef = 'origin/main'
}: {
  generatedAt?: string
  ownershipSnapshot: unknown
  repository: string
  runner?: GitCommandRunner
  targetRef?: string
}): DecisionAuditBundle {
  const target = resolveCommit(repository, targetRef, runner)
  const decisions = requireGit(
    runner,
    repository,
    ['show', `${target}:DECISIONS.md`],
    `Read DECISIONS.md from ${targetRef}`
  ).toString('utf8')
  const checkpoint = parseDecisionCheckpoint(decisions)
  const range = discoverCommitRange({
    checkpoint,
    repository,
    runner,
    targetRef: target
  })
  const commits = range.commits.map((commit) => readCommit(repository, commit, runner))
  const changedPaths = new Set<string>()
  for (const commit of commits) {
    for (const changed of commit.changedPaths) {
      changedPaths.add(changed.path)
      if (changed.oldPath !== undefined) changedPaths.add(changed.oldPath)
    }
  }
  const paths = [...changedPaths].sort().map((filePath) =>
    readPathSnapshot(repository, range.target, filePath, runner)
  )
  return {
    checkpoint,
    commits,
    decisions: {
      content: decisions,
      path: 'DECISIONS.md',
      sha256: sha256(decisions)
    },
    generatedAt,
    ownershipSnapshot: cloneJsonValue(ownershipSnapshot),
    paths,
    schemaVersion: decisionGardenerSchemaVersion,
    target: range.target,
    targetRef
  }
}

function cloneJsonValue(value: unknown): unknown {
  let source: string
  try {
    source = JSON.stringify({ value }, (_key, nested) => {
      if (
        nested === undefined || typeof nested === 'function' ||
        typeof nested === 'symbol'
      ) throw new Error('Unsupported JSON value.')
      return nested as unknown
    })
  } catch (error) {
    throw new Error('The ownership snapshot must be valid JSON.', { cause: error })
  }
  return (JSON.parse(source) as { value: unknown }).value
}

async function writeExclusive(filePath: string, source: string): Promise<void> {
  const handle = await fs.open(filePath, 'wx', 0o400)
  try {
    await handle.writeFile(source, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function writeImmutableAuditBundle({
  bundle,
  destination,
  prompt,
  schema
}: {
  bundle: DecisionAuditBundle
  destination: string
  prompt: string
  schema: unknown
}): Promise<{ bundleSha256: string; destination: string }> {
  const parent = path.dirname(destination)
  await fs.mkdir(parent, { recursive: true, mode: 0o700 })
  await fs.mkdir(destination, { mode: 0o700 })
  try {
    const bundleSource = `${JSON.stringify(bundle, null, 2)}\n`
    const schemaSource = `${JSON.stringify(schema, null, 2)}\n`
    const manifest = {
      bundle: { file: 'bundle.json', sha256: sha256(bundleSource) },
      prompt: { file: 'prompt.md', sha256: sha256(prompt) },
      schema: { file: 'output.schema.json', sha256: sha256(schemaSource) },
      schemaVersion: decisionGardenerSchemaVersion
    }
    await writeExclusive(path.join(destination, 'bundle.json'), bundleSource)
    await writeExclusive(path.join(destination, 'prompt.md'), prompt)
    await writeExclusive(path.join(destination, 'output.schema.json'), schemaSource)
    await writeExclusive(
      path.join(destination, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`
    )
    await fs.chmod(destination, 0o500)
    return { bundleSha256: manifest.bundle.sha256, destination }
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true })
    throw error
  }
}

export async function acquireSingleFlightLock(
  lockDirectory: string,
  detail: Record<string, unknown> = {}
): Promise<SingleFlightLease> {
  const token = crypto.randomUUID()
  try {
    await fs.mkdir(lockDirectory, { recursive: false, mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const ownerPath = path.join(lockDirectory, 'owner.json')
    const owner = await fs.readFile(ownerPath, 'utf8').catch(() => 'unreadable')
    throw new Error(
      `A decision-gardener run already owns ${lockDirectory}: ${owner.trim()}`,
      { cause: error }
    )
  }
  const owner = {
    ...detail,
    acquiredAt: new Date().toISOString(),
    pid: process.pid,
    token
  }
  try {
    await writeExclusive(
      path.join(lockDirectory, 'owner.json'),
      `${JSON.stringify(owner, null, 2)}\n`
    )
  } catch (error) {
    await fs.rm(lockDirectory, { recursive: true, force: true })
    throw error
  }
  let released = false
  return {
    token,
    release: async () => {
      if (released) return
      const current = JSON.parse(
        await fs.readFile(path.join(lockDirectory, 'owner.json'), 'utf8')
      ) as { token?: unknown }
      if (current.token !== token) {
        throw new Error('Refusing to release a single-flight lock owned by another run.')
      }
      await fs.rm(lockDirectory, { recursive: true })
      released = true
    }
  }
}

export function validateContextRequest(request: ContextRequest): void {
  if (request.reason.trim().length === 0) {
    throw new Error('Every context request must explain why it is needed.')
  }
  if (request.kind === 'git_object') {
    if (!fullCommitPattern.test(request.value)) {
      throw new Error('Git-object context requests must use a full lowercase object ID.')
    }
    return
  }
  const normalized = path.posix.normalize(request.value)
  const segments = request.value.split('/')
  if (
    request.value.length === 0 || request.value.startsWith('/') ||
    request.value.startsWith(':') || request.value.includes('\\') ||
    request.value.includes('\0') || request.value.length > 4096 ||
    normalized !== request.value ||
    segments.includes('.') || segments.includes('..') ||
    segments[0] === '.git'
  ) {
    throw new Error(`Unsafe repository-relative context path: ${request.value}`)
  }
}

function reachableObjects(
  repository: string,
  target: string,
  runner: GitCommandRunner
): Set<string> {
  const source = gitText(
    runner,
    repository,
    ['rev-list', '--objects', target],
    `List objects reachable from ${target}`
  )
  return new Set(source.split('\n').filter(Boolean).map((line) => line.split(' ')[0] ?? ''))
}

export function loadRequestedContext({
  maxBytes = 512 * 1024,
  maxRequests = 8,
  repository,
  requests,
  runner = runGitCommand,
  target
}: {
  maxBytes?: number
  maxRequests?: number
  repository: string
  requests: readonly ContextRequest[]
  runner?: GitCommandRunner
  target: string
}): LoadedContext[] {
  if (requests.length === 0 || requests.length > maxRequests) {
    throw new Error(`A context round must request between 1 and ${String(maxRequests)} items.`)
  }
  const seen = new Set<string>()
  const reachable = requests.some(({ kind }) => kind === 'git_object')
    ? reachableObjects(repository, target, runner)
    : new Set<string>()
  return requests.map((request) => {
    validateContextRequest(request)
    const key = `${request.kind}:${request.value}`
    if (seen.has(key)) throw new Error(`Duplicate context request: ${key}`)
    seen.add(key)
    let object: string
    if (request.kind === 'path') {
      const record = gitText(
        runner,
        repository,
        ['rev-parse', '--verify', `${target}:${request.value}`],
        `Resolve requested path ${request.value}`
      )
      if (!fullCommitPattern.test(record)) {
        throw new Error(`Requested path ${request.value} did not resolve to a Git object.`)
      }
      object = record
    } else {
      object = request.value
      if (!reachable.has(object)) {
        throw new Error(`Requested Git object ${object} is not reachable from ${target}.`)
      }
    }
    const objectType = gitText(
      runner,
      repository,
      ['cat-file', '-t', object],
      `Read type for requested object ${object}`
    )
    const sizeSource = gitText(
      runner,
      repository,
      ['cat-file', '-s', object],
      `Read size for requested object ${object}`
    )
    const size = Number(sizeSource)
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      throw new Error(
        `Requested object ${object} is ${sizeSource} bytes; the limit is ${String(maxBytes)}.`
      )
    }
    const content = requireGit(
      runner,
      repository,
      ['cat-file', '-p', object],
      `Read requested object ${object}`
    )
    return { content: encodeContent(content), kind: request.kind, object, objectType, request }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) throw new Error(`${label} contains missing or unknown fields.`)
}

function parseReport(value: Record<string, unknown>): AuditReport {
  exactKeys(value, [
    'ambiguities', 'classifications', 'ownershipMatches',
    'suggestedFollowups', 'summary'
  ], 'Audit report')
  if (
    typeof value.summary !== 'string' || !Array.isArray(value.ambiguities) ||
    !Array.isArray(value.classifications) ||
    !Array.isArray(value.ownershipMatches) ||
    !Array.isArray(value.suggestedFollowups)
  ) throw new Error('Codex returned an invalid audit report.')
  const classifications = value.classifications.map((item) => {
    if (!isRecord(item)) throw new Error('Codex returned an invalid classification.')
    exactKeys(item, ['classification', 'entry', 'evidence', 'reason'], 'Classification')
    const allowed = ['Deferred', 'Planned', 'Retain', 'Revise', 'Superseded']
    if (
      typeof item.classification !== 'string' ||
      !allowed.includes(item.classification) || typeof item.entry !== 'string' ||
      !stringArray(item.evidence) || typeof item.reason !== 'string'
    ) throw new Error('Codex returned an invalid classification.')
    return {
      classification: item.classification as AuditClassification['classification'],
      entry: item.entry,
      evidence: item.evidence,
      reason: item.reason
    }
  })
  const ambiguities = value.ambiguities.map((item) => {
    if (!isRecord(item)) throw new Error('Codex returned an invalid ambiguity.')
    exactKeys(item, ['evidence', 'summary'], 'Ambiguity')
    if (typeof item.summary !== 'string' || !stringArray(item.evidence)) {
      throw new Error('Codex returned an invalid ambiguity.')
    }
    return { evidence: item.evidence, summary: item.summary }
  })
  const ownershipMatches = value.ownershipMatches.map((item) => {
    if (!isRecord(item)) throw new Error('Codex returned an invalid ownership match.')
    exactKeys(item, ['issue', 'reason', 'title'], 'Ownership match')
    if (
      !Number.isSafeInteger(item.issue) || Number(item.issue) < 1 ||
      typeof item.reason !== 'string' || typeof item.title !== 'string'
    ) throw new Error('Codex returned an invalid ownership match.')
    return { issue: Number(item.issue), reason: item.reason, title: item.title }
  })
  const suggestedFollowups = value.suggestedFollowups.map((item) => {
    if (!isRecord(item)) throw new Error('Codex returned an invalid suggested follow-up.')
    exactKeys(item, ['ownerIssue', 'summary'], 'Suggested follow-up')
    if (
      typeof item.summary !== 'string' ||
      (item.ownerIssue !== null && (
        !Number.isSafeInteger(item.ownerIssue) || Number(item.ownerIssue) < 1
      ))
    ) throw new Error('Codex returned an invalid suggested follow-up.')
    return {
      ownerIssue: item.ownerIssue === null ? null : Number(item.ownerIssue),
      summary: item.summary
    }
  })
  return {
    ambiguities,
    classifications,
    ownershipMatches,
    suggestedFollowups,
    summary: value.summary
  }
}

export function validateAuditAgentResult(value: unknown): AuditAgentResult {
  if (!isRecord(value) || value.schemaVersion !== decisionGardenerSchemaVersion) {
    throw new Error('Codex returned an unsupported decision-gardener result.')
  }
  exactKeys(value, [
    'contextRequests', 'proposedDecisions', 'report', 'schemaVersion', 'status'
  ], 'Audit result')
  const statuses = ['ambiguous', 'complete', 'needs_context']
  if (typeof value.status !== 'string' || !statuses.includes(value.status)) {
    throw new Error('Codex returned an invalid audit status.')
  }
  if (!Array.isArray(value.contextRequests) || !isRecord(value.report)) {
    throw new Error('Codex returned an incomplete audit result.')
  }
  const requests = value.contextRequests.map((request) => {
    if (
      !isRecord(request) ||
      (request.kind !== 'git_object' && request.kind !== 'path') ||
      typeof request.reason !== 'string' || typeof request.value !== 'string'
    ) throw new Error('Codex returned an invalid context request.')
    const parsed: ContextRequest = {
      kind: request.kind,
      reason: request.reason,
      value: request.value
    }
    validateContextRequest(parsed)
    return parsed
  })
  const parsedReport = parseReport(value.report)
  if (value.status === 'needs_context') {
    if (requests.length === 0 || value.proposedDecisions !== null) {
      throw new Error('A needs_context result must request context and omit a proposal.')
    }
  } else if (requests.length !== 0) {
    throw new Error('Only needs_context results may carry context requests.')
  }
  if (value.status === 'complete' && typeof value.proposedDecisions !== 'string') {
    throw new Error('A complete result must contain the proposed DECISIONS.md.')
  }
  if (value.status === 'ambiguous' && value.proposedDecisions !== null) {
    throw new Error('An ambiguous result must not contain a DECISIONS.md proposal.')
  }
  if (value.status === 'ambiguous' && parsedReport.ambiguities.length === 0) {
    throw new Error('An ambiguous result must explain at least one ambiguity.')
  }
  if (
    value.proposedDecisions !== null && typeof value.proposedDecisions !== 'string'
  ) throw new Error('Codex returned an invalid DECISIONS.md proposal.')
  return {
    contextRequests: requests,
    proposedDecisions: value.proposedDecisions,
    report: parsedReport,
    schemaVersion: decisionGardenerSchemaVersion,
    status: value.status as AuditAgentResult['status']
  }
}

export function validateCompleteProposal(
  result: AuditAgentResult,
  target: string
): string {
  if (result.status !== 'complete' || result.proposedDecisions === null) {
    throw new Error('Only a complete audit result has a publishable proposal.')
  }
  if (!result.proposedDecisions.startsWith('# Decision register\n')) {
    throw new Error('The proposed DECISIONS.md has an invalid document heading.')
  }
  const checkpoint = parseDecisionCheckpoint(result.proposedDecisions)
  if (checkpoint !== target) {
    throw new Error(
      `The proposed DECISIONS.md checkpoint is ${checkpoint}; expected ${target}.`
    )
  }
  return result.proposedDecisions
}

function contextFailure(message: string): AuditAgentResult {
  return {
    contextRequests: [],
    proposedDecisions: null,
    report: {
      ambiguities: [{ evidence: [], summary: message }],
      classifications: [],
      ownershipMatches: [],
      suggestedFollowups: [],
      summary: 'The audit could not resolve all required context within its safety bounds.'
    },
    schemaVersion: decisionGardenerSchemaVersion,
    status: 'ambiguous'
  }
}

export async function runBoundedAudit({
  bundle,
  invoke,
  loadContext,
  maxContextRounds = 2
}: {
  bundle: DecisionAuditBundle
  invoke: (input: AuditRoundInput) => Promise<unknown>
  loadContext: (requests: readonly ContextRequest[]) => Promise<readonly LoadedContext[]>
  maxContextRounds?: number
}): Promise<AuditAgentResult> {
  if (!Number.isInteger(maxContextRounds) || maxContextRounds < 0) {
    throw new Error('maxContextRounds must be a non-negative integer.')
  }
  const contexts: LoadedContext[] = []
  const requested = new Set<string>()
  for (let round = 0; ; round += 1) {
    const result = validateAuditAgentResult(await invoke({ bundle, contexts, round }))
    if (result.status !== 'needs_context') {
      if (result.status === 'complete') validateCompleteProposal(result, bundle.target)
      return result
    }
    if (round >= maxContextRounds) {
      return contextFailure(
        `Codex still requested context after ${String(maxContextRounds)} context rounds.`
      )
    }
    const repeated = result.contextRequests.find((request) =>
      requested.has(`${request.kind}:${request.value}`)
    )
    if (repeated !== undefined) {
      return contextFailure(
        `Codex repeated the context request ${repeated.kind}:${repeated.value}.`
      )
    }
    for (const request of result.contextRequests) {
      requested.add(`${request.kind}:${request.value}`)
    }
    try {
      contexts.push(...await loadContext(result.contextRequests))
    } catch (error) {
      return contextFailure(error instanceof Error ? error.message : String(error))
    }
  }
}

const isolatedCodexConfig = Object.freeze([
  'approval_policy="never"',
  'agents.enabled=false',
  'apps._default.enabled=false',
  'web_search="disabled"',
  'tools.web_search=false',
  'features.shell_tool=false',
  'features.skill_mcp_dependency_install=false',
  'shell_environment_policy.inherit="none"',
  'project_doc_max_bytes=0'
])

export function buildDecisionGardenerCodexArgs({
  model,
  reasoningEffort,
  repository,
  schemaPath
}: {
  model: string
  reasoningEffort: 'high' | 'low' | 'medium' | 'xhigh'
  repository: string
  schemaPath: string
}): string[] {
  const args = [
    'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--strict-config', '--json', '--model', model, '--sandbox', 'read-only',
    '--config', `model_reasoning_effort="${reasoningEffort}"`
  ]
  for (const override of isolatedCodexConfig) args.push('--config', override)
  args.push('--output-schema', schemaPath, '--cd', repository, '-')
  return args
}

export function decisionGardenerChildEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const allowed = [
    'CODEX_HOME', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'PATH', 'TMPDIR'
  ]
  return Object.fromEntries(
    allowed.flatMap((name) => environment[name] === undefined
      ? []
      : [[name, environment[name]]]
    )
  )
}

export function buildDecisionGardenerInput(
  prompt: string,
  input: AuditRoundInput
): string {
  return [
    prompt.trimEnd(),
    '',
    '## Immutable audit input',
    '',
    '```json',
    JSON.stringify(input),
    '```',
    ''
  ].join('\n')
}

export function parseCodexAuditJsonl(source: string): AuditAgentResult {
  let finalMessage: string | undefined
  for (const [index, line] of source.split('\n').entries()) {
    if (line.trim().length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(line) as unknown
    } catch {
      throw new Error(`Codex JSONL line ${String(index + 1)} is invalid.`)
    }
    if (!isRecord(event)) throw new Error('Codex emitted a non-object event.')
    const item = isRecord(event.item) ? event.item : undefined
    if (item !== undefined && typeof item.type === 'string') {
      if (!allowedCodexItemTypes.has(item.type)) {
        throw new Error(`Codex attempted forbidden tool activity: ${item.type}.`)
      }
      if (
        event.type === 'item.completed' && item.type === 'agent_message' &&
        typeof item.text === 'string'
      ) finalMessage = item.text
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      throw new Error(`Codex reported a failed audit event: ${line}`)
    }
  }
  if (finalMessage === undefined) throw new Error('Codex did not emit a final agent message.')
  let parsed: unknown
  try {
    parsed = JSON.parse(finalMessage) as unknown
  } catch {
    throw new Error('Codex final agent message was not JSON.')
  }
  return validateAuditAgentResult(parsed)
}

export async function invokeDecisionGardenerCodex({
  codex = 'codex',
  environment = process.env,
  input,
  model,
  prompt,
  reasoningEffort = 'high',
  repository,
  schemaPath,
  timeoutMs = 30 * 60 * 1000
}: {
  codex?: string
  environment?: NodeJS.ProcessEnv
  input: AuditRoundInput
  model: string
  prompt: string
  reasoningEffort?: 'high' | 'low' | 'medium' | 'xhigh'
  repository: string
  schemaPath: string
  timeoutMs?: number
}): Promise<AuditAgentResult> {
  const args = buildDecisionGardenerCodexArgs({
    model, reasoningEffort, repository, schemaPath
  })
  return new Promise((resolve, reject) => {
    const child = spawn(codex, args, {
      cwd: repository,
      env: decisionGardenerChildEnvironment(environment),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(
          `codex exec exited ${String(code)}: ${Buffer.concat(stderr).toString('utf8').trim()}`
        ))
        return
      }
      try {
        resolve(parseCodexAuditJsonl(Buffer.concat(stdout).toString('utf8')))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.stdin.end(buildDecisionGardenerInput(prompt, input))
  })
}

export const decisionGardenerProjectRoot = path.resolve(__dirname, '../..')
export const decisionGardenerPromptPath = path.join(
  decisionGardenerProjectRoot,
  '.ai/prompts/decision-gardener.md'
)
export const decisionGardenerOutputSchemaPath = path.join(
  decisionGardenerProjectRoot,
  '.ai/schemas/decision-gardener-output.schema.json'
)

export function readDecisionGardenerPrompt(): string {
  return fsSync.readFileSync(decisionGardenerPromptPath, 'utf8')
}

export function readDecisionGardenerOutputSchema(): unknown {
  return JSON.parse(
    fsSync.readFileSync(decisionGardenerOutputSchemaPath, 'utf8')
  ) as unknown
}

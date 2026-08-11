import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
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

export type GitContentReader = (
  repository: string,
  args: readonly string[],
  label: string,
  budget: ContentBudget,
  maxItemBytes: number
) => EncodedGitContent

export interface MaterializedGitContent {
  bytes: number
  encoding: 'base64' | 'utf8'
  omitted: false
  sha256: string
  value: string
}

export interface OmittedGitContent {
  bytes: number
  encoding: null
  omitted: true
  reason: 'aggregate_limit' | 'item_limit'
  sha256: string
}

export type EncodedGitContent = MaterializedGitContent | OmittedGitContent

export interface AuditBundleLimits {
  maxEmbeddedContentBytes: number
  maxInputBytes: number
  maxItemBytes: number
}

export const defaultAuditBundleLimits: AuditBundleLimits = Object.freeze({
  maxEmbeddedContentBytes: 256 * 1024,
  maxInputBytes: 1536 * 1024,
  maxItemBytes: 128 * 1024
})

export type ChangedPath = readonly [
  status: string,
  pathIndex: number,
  oldPathIndex: number | null
]

interface RawChangedPath {
  oldPath: string | null
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

export type AuditedPathSnapshot = readonly [
  prefixIndex: number,
  suffix: string,
  mode: string | null,
  type: string | null,
  object: string | null,
  content: EncodedGitContent | null
]

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
  pathPrefixes: readonly string[]
  paths: readonly AuditedPathSnapshot[]
  schemaVersion: typeof decisionGardenerSchemaVersion
  target: string
  targetRef: string
}

export interface ContextRequest {
  kind: 'git_object' | 'path' | 'path_at_commit'
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

export interface SingleFlightOptions {
  processStartedAt?: (pid: number) => string | null
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

export interface ContentBudget {
  remaining: number
}

function encodeContent(
  content: Buffer,
  budget?: ContentBudget,
  maxItemBytes = Number.POSITIVE_INFINITY
): EncodedGitContent {
  const digest = sha256(content)
  if (content.byteLength > maxItemBytes) {
    return {
      bytes: content.byteLength,
      encoding: null,
      omitted: true,
      reason: 'item_limit',
      sha256: digest
    }
  }
  if (budget !== undefined && content.byteLength > budget.remaining) {
    return {
      bytes: content.byteLength,
      encoding: null,
      omitted: true,
      reason: 'aggregate_limit',
      sha256: digest
    }
  }
  if (budget !== undefined) budget.remaining -= content.byteLength
  try {
    return {
      bytes: content.byteLength,
      encoding: 'utf8',
      omitted: false,
      sha256: digest,
      value: utf8Decoder.decode(content)
    }
  } catch {
    return {
      bytes: content.byteLength,
      encoding: 'base64',
      omitted: false,
      sha256: digest,
      value: content.toString('base64')
    }
  }
}

function hashFile(filePath: string): string {
  const digest = crypto.createHash('sha256')
  const file = fsSync.openSync(filePath, 'r')
  const chunk = Buffer.allocUnsafe(64 * 1024)
  try {
    for (;;) {
      const bytesRead = fsSync.readSync(file, chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) break
      digest.update(chunk.subarray(0, bytesRead))
    }
  } finally {
    fsSync.closeSync(file)
  }
  return digest.digest('hex')
}

export const readGitContent: GitContentReader = (
  repository,
  args,
  label,
  budget,
  maxItemBytes
) => {
  const temporaryDirectory = fsSync.mkdtempSync(
    path.join(os.tmpdir(), 'markover-decision-git-')
  )
  const outputPath = path.join(temporaryDirectory, 'stdout')
  let output: number | undefined
  try {
    output = fsSync.openSync(outputPath, 'w', 0o600)
    const result = spawnSync('git', [...args], {
      cwd: repository,
      encoding: 'buffer',
      stdio: ['ignore', output, 'pipe']
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(
        `${label} failed: ${result.stderr.toString('utf8').trim() || 'git exited non-zero'}`
      )
    }
    fsSync.closeSync(output)
    output = undefined
    const bytes = fsSync.statSync(outputPath).size
    if (bytes <= maxItemBytes && bytes <= budget.remaining) {
      return encodeContent(fsSync.readFileSync(outputPath), budget, maxItemBytes)
    }
    return {
      bytes,
      encoding: null,
      omitted: true,
      reason: bytes > maxItemBytes ? 'item_limit' : 'aggregate_limit',
      sha256: hashFile(outputPath)
    }
  } finally {
    try {
      if (output !== undefined) fsSync.closeSync(output)
    } finally {
      fsSync.rmSync(temporaryDirectory, { force: true, recursive: true })
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
  const repositoryTarget = resolveCommit(repository, targetRef, runner)
  const ancestry = runner(repository, [
    'merge-base', '--is-ancestor', checkpoint, repositoryTarget
  ])
  if (ancestry.status !== 0) {
    throw new Error(
      `Decision checkpoint ${checkpoint} is not an ancestor of ${targetRef} (${repositoryTarget}).`
    )
  }
  const source = gitText(
    runner,
    repository,
    ['rev-list', '--reverse', `${checkpoint}..${repositoryTarget}`],
    'Discover unaudited commits'
  )
  const discovered = source.length === 0 ? [] : source.split('\n')
  if (!discovered.every((commit) => fullCommitPattern.test(commit))) {
    throw new Error('Git returned an invalid commit while discovering the audit range.')
  }
  const candidateSource = gitText(
    runner,
    repository,
    ['rev-list', '--full-history', `${checkpoint}..${repositoryTarget}`, '--',
      'DECISIONS.md'],
    'Discover decision-checkpoint publications'
  )
  const candidates = candidateSource.length === 0
    ? []
    : candidateSource.split('\n')
  if (!candidates.every((commit) => fullCommitPattern.test(commit))) {
    throw new Error('Git returned an invalid decision-checkpoint publication candidate.')
  }
  const publications = new Set(candidates.filter((commit) =>
    isDecisionCheckpointPublication(repository, commit, runner)
  ))
  const commits = discovered.filter((commit) => !publications.has(commit))
  const target = commits.at(-1) ?? checkpoint
  return { commits, target }
}

function isDecisionCheckpointPublication(
  repository: string,
  commit: string,
  runner: GitCommandRunner
): boolean {
  const ancestry = gitText(
    runner,
    repository,
    ['rev-list', '--parents', '-n', '1', commit],
    `Read publication ancestry for ${commit}`
  ).split(' ')
  const firstParent = ancestry[1]
  if (ancestry[0] !== commit || firstParent === undefined) return false
  const changedPaths = parseChangedPaths(requireGit(runner, repository, [
    'diff-tree', '--no-commit-id', '--name-status', '-r', '-z',
    '--find-renames', firstParent, commit
  ], `Read publication paths for ${commit}`))
  if (
    changedPaths.length !== 1 || changedPaths[0]?.oldPath !== null ||
    changedPaths[0].path !== 'DECISIONS.md' || changedPaths[0].status !== 'M'
  ) return false
  const decisions = runner(repository, ['show', `${commit}:DECISIONS.md`])
  if (decisions.status !== 0) return false
  try {
    return parseDecisionCheckpoint(decisions.stdout.toString('utf8')) === firstParent
  } catch {
    return false
  }
}

function parseChangedPaths(source: Buffer): RawChangedPath[] {
  const fields = source.toString('utf8').split('\0')
  if (fields.at(-1) === '') fields.pop()
  const paths: RawChangedPath[] = []
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
    paths.push({ oldPath: null, path: currentPath, status })
  }
  return paths
}

function readCommit(
  repository: string,
  commit: string,
  runner: GitCommandRunner,
  contentReader: GitContentReader,
  budget: ContentBudget,
  maxItemBytes: number
): Omit<AuditedCommit, 'changedPaths'> & {
  changedPaths: readonly RawChangedPath[]
} {
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
  const parentShas = parents.length === 0 ? [] : parents.split(' ')

  const changedPathArgs = parentShas[0] === undefined
    ? [
        'diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z',
        '--find-renames', commit
      ]
    : [
        'diff-tree', '--no-commit-id', '--name-status', '-r', '-z',
        '--find-renames', parentShas[0], commit
      ]
  const changedPaths = parseChangedPaths(requireGit(
    runner,
    repository,
    changedPathArgs,
    `Read changed paths for ${commit}`
  ))
  const patch = contentReader(repository, [
    'show', '--first-parent', '--format=fuller', '--binary', '--find-renames',
    '--no-ext-diff', commit
  ], `Read patch for ${commit}`, budget, maxItemBytes)
  return {
    author: { date: authorDate, email: authorEmail, name: authorName },
    changedPaths,
    committer: {
      date: committerDate,
      email: committerEmail,
      name: committerName
    },
    message,
    parents: parentShas,
    patch,
    sha,
    subject
  }
}

interface TreeEntry {
  mode: string
  object: string
  type: string
}

function readTargetTree(
  repository: string,
  target: string,
  runner: GitCommandRunner
): Map<string, TreeEntry> {
  const source = requireGit(
    runner,
    repository,
    ['ls-tree', '-r', '-z', target],
    `Read tree for ${target}`
  ).toString('utf8')
  const entries = new Map<string, TreeEntry>()
  for (const record of source.split('\0')) {
    if (record.length === 0) continue
    const match = record.match(/^([0-7]{6}) ([a-z]+) ([0-9a-f]{40})\t(.+)$/s)
    if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
      throw new Error(`Git returned malformed tree metadata for ${target}.`)
    }
    entries.set(match[4], { mode: match[1], object: match[3], type: match[2] })
  }
  return entries
}

function referencedRepositoryPaths(decisions: string): Set<string> {
  const paths = new Set<string>()
  for (const match of decisions.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const destination = match[1]
    if (
      destination !== undefined && !destination.includes('://') &&
      !destination.startsWith('#')
    ) {
      const withoutFragment = destination.split('#')[0]
      if (withoutFragment !== undefined && withoutFragment.length > 0) {
        paths.add(withoutFragment)
      }
    }
  }
  return paths
}

function readPathSnapshot(
  repository: string,
  filePath: string,
  prefixIndex: number,
  suffix: string,
  entry: TreeEntry | undefined,
  includeContent: boolean,
  contentReader: GitContentReader,
  budget: ContentBudget,
  maxItemBytes: number
): AuditedPathSnapshot {
  if (entry === undefined) {
    return [prefixIndex, suffix, null, null, null, null]
  }
  const content = includeContent
    ? contentReader(
        repository,
        ['cat-file', '-p', entry.object],
        `Read referenced evidence ${filePath}`,
        budget,
        maxItemBytes
      )
    : null
  return [prefixIndex, suffix, entry.mode, entry.type, entry.object, content]
}

function compactPathPrefixes(paths: readonly string[]): {
  pathPrefixes: readonly string[]
  suffixes: ReadonlyMap<string, readonly [prefixIndex: number, suffix: string]>
} {
  const prefixForPath = new Map<string, string>()
  const prefixes = new Set<string>()
  for (const filePath of paths) {
    const segments = filePath.split('/')
    const prefix = segments.length === 1
      ? ''
      : `${segments.slice(0, Math.min(4, segments.length - 1)).join('/')}/`
    prefixForPath.set(filePath, prefix)
    prefixes.add(prefix)
  }
  const pathPrefixes = [...prefixes].sort()
  const indexes = new Map(pathPrefixes.map((prefix, index) => [prefix, index]))
  const suffixes = new Map<string, readonly [number, string]>()
  for (const filePath of paths) {
    const prefix = prefixForPath.get(filePath)
    const prefixIndex = prefix === undefined ? undefined : indexes.get(prefix)
    if (prefix === undefined || prefixIndex === undefined) {
      throw new Error(`Could not compact audit path ${filePath}.`)
    }
    suffixes.set(filePath, [prefixIndex, filePath.slice(prefix.length)])
  }
  return { pathPrefixes, suffixes }
}

export function assembleDecisionAuditBundle({
  contentReader = readGitContent,
  generatedAt = new Date().toISOString(),
  limits: requestedLimits = {},
  ownershipSnapshot,
  repository,
  runner = runGitCommand,
  targetRef = 'origin/main'
}: {
  contentReader?: GitContentReader
  generatedAt?: string
  limits?: Partial<AuditBundleLimits>
  ownershipSnapshot: unknown
  repository: string
  runner?: GitCommandRunner
  targetRef?: string
}): DecisionAuditBundle {
  const limits = auditBundleLimits(requestedLimits)
  const contentBudget = { remaining: limits.maxEmbeddedContentBytes }
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
  const rawCommits = range.commits.map((commit) => readCommit(
    repository,
    commit,
    runner,
    contentReader,
    contentBudget,
    limits.maxItemBytes
  ))
  const changedPaths = new Set<string>()
  for (const commit of rawCommits) {
    for (const changed of commit.changedPaths) {
      changedPaths.add(changed.path)
      if (changed.oldPath !== null) changedPaths.add(changed.oldPath)
    }
  }
  const sortedPaths = [...changedPaths].sort()
  const pathIndexes = new Map(sortedPaths.map((filePath, index) => [filePath, index]))
  const commits: AuditedCommit[] = rawCommits.map((commit) => ({
    ...commit,
    changedPaths: commit.changedPaths.map((changed) => {
      const pathIndex = pathIndexes.get(changed.path)
      const oldPathIndex = changed.oldPath === null
        ? null
        : pathIndexes.get(changed.oldPath)
      if (pathIndex === undefined || oldPathIndex === undefined) {
        throw new Error('Could not index a changed path in the audit bundle.')
      }
      return [changed.status, pathIndex, oldPathIndex]
    })
  }))
  const tree = readTargetTree(repository, range.target, runner)
  const referencedPaths = referencedRepositoryPaths(decisions)
  const compacted = compactPathPrefixes(sortedPaths)
  const paths = sortedPaths.map((filePath) => {
    const compactPath = compacted.suffixes.get(filePath)
    if (compactPath === undefined) {
      throw new Error(`Could not find compact audit path ${filePath}.`)
    }
    return readPathSnapshot(
      repository,
      filePath,
      compactPath[0],
      compactPath[1],
      tree.get(filePath),
      referencedPaths.has(filePath),
      contentReader,
      contentBudget,
      limits.maxItemBytes
    )
  })
  const bundle: DecisionAuditBundle = {
    checkpoint,
    commits,
    decisions: {
      content: decisions,
      path: 'DECISIONS.md',
      sha256: sha256(decisions)
    },
    generatedAt,
    ownershipSnapshot: cloneJsonValue(ownershipSnapshot),
    pathPrefixes: compacted.pathPrefixes,
    paths,
    schemaVersion: decisionGardenerSchemaVersion,
    target: range.target,
    targetRef
  }
  return bundle
}

function auditBundleLimits(
  overrides: Partial<AuditBundleLimits>
): AuditBundleLimits {
  const limits = { ...defaultAuditBundleLimits, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive safe integer.`)
    }
  }
  if (limits.maxItemBytes > limits.maxEmbeddedContentBytes) {
    throw new Error('maxItemBytes cannot exceed maxEmbeddedContentBytes.')
  }
  return limits
}

function assertInputSize(
  prompt: string,
  input: AuditRoundInput,
  maxInputBytes: number
): void {
  const bytes = Buffer.byteLength(buildDecisionGardenerInput(prompt, input), 'utf8')
  if (bytes > maxInputBytes) {
    throw new Error(
      `Decision-gardener prompt is ${String(bytes)} bytes; the limit is ${String(maxInputBytes)}.`
    )
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

async function publishExclusiveFile(filePath: string, source: string): Promise<void> {
  const candidate = `${filePath}.candidate.${crypto.randomUUID()}`
  try {
    await writeExclusive(candidate, source)
    await fs.link(candidate, filePath)
  } finally {
    await fs.unlink(candidate).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
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
  detail: Record<string, unknown> = {},
  options: SingleFlightOptions = {}
): Promise<SingleFlightLease> {
  const token = crypto.randomUUID()
  const inspectProcessStart = options.processStartedAt ?? localProcessStartedAt
  const processStartedAt = inspectProcessStart(process.pid)
  if (processStartedAt === null) {
    throw new Error('Could not establish the decision-gardener process identity.')
  }
  const owner = {
    ...detail,
    acquiredAt: new Date().toISOString(),
    hostname: os.hostname(),
    pid: process.pid,
    processStartedAt,
    token
  }
  const candidate = `${lockDirectory}.candidate.${token}`
  await fs.mkdir(candidate, { recursive: false, mode: 0o700 })
  try {
    await writeExclusive(
      path.join(candidate, 'owner.json'),
      `${JSON.stringify(owner, null, 2)}\n`
    )
    let acquired = false
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await fs.rename(candidate, lockDirectory)
        acquired = true
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error
        const ownerPath = path.join(lockDirectory, 'owner.json')
        let existingSource: string
        try {
          existingSource = await fs.readFile(ownerPath, 'utf8')
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw readError
        }
        const existing = parseSingleFlightOwner(existingSource, lockDirectory)
        if (inspectProcessStart(existing.pid) === existing.processStartedAt) {
          throw new Error(
            `A decision-gardener run already owns ${lockDirectory}: ${existingSource.trim()}`,
            { cause: error }
          )
        }
        const claimed = await claimDeadSingleFlightLock(
          lockDirectory,
          existing.token,
          inspectProcessStart,
          processStartedAt
        )
        if (!claimed) continue
        const stale = `${lockDirectory}.stale.${crypto.randomUUID()}`
        try {
          await fs.rename(lockDirectory, stale)
        } catch (renameError) {
          if ((renameError as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw renameError
        }
        await fs.rm(stale, { recursive: true })
      }
    }
    if (!acquired) {
      throw new Error(`Could not acquire ${lockDirectory} after concurrent recovery.`)
    }
  } catch (error) {
    await fs.rm(candidate, { recursive: true, force: true })
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

function parseSingleFlightOwner(
  source: string,
  lockDirectory: string
): { pid: number; processStartedAt: string; token: string } {
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch (error) {
    throw new Error(`The owner of ${lockDirectory} is malformed.`, { cause: error })
  }
  if (
    !isRecord(value) || !Number.isSafeInteger(value.pid) ||
    Number(value.pid) < 1 || typeof value.token !== 'string' ||
    value.token.length === 0 || typeof value.processStartedAt !== 'string' ||
    value.processStartedAt.length === 0
  ) throw new Error(`The owner of ${lockDirectory} is malformed.`)
  return {
    pid: Number(value.pid),
    processStartedAt: value.processStartedAt,
    token: value.token
  }
}

async function claimDeadSingleFlightLock(
  lockDirectory: string,
  expectedOwnerToken: string,
  inspectProcessStart: (pid: number) => string | null,
  processStartedAt: string
): Promise<boolean> {
  const claimPath = path.join(lockDirectory, '.reaping.json')
  const claim = {
    claimedAt: new Date().toISOString(),
    pid: process.pid,
    processStartedAt,
    token: crypto.randomUUID()
  }
  try {
    await publishExclusiveFile(claimPath, `${JSON.stringify(claim, null, 2)}\n`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
    const existingClaimSource = await fs.readFile(claimPath, 'utf8').catch(
      (readError: unknown) => {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw readError
      }
    )
    if (existingClaimSource === null) return false
    const existingClaim = parseSingleFlightOwner(existingClaimSource, claimPath)
    if (
      inspectProcessStart(existingClaim.pid) === existingClaim.processStartedAt
    ) {
      throw new Error(`A live recovery already owns ${lockDirectory}.`, {
        cause: error
      })
    }
    await fs.unlink(claimPath).catch((unlinkError: unknown) => {
      if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError
    })
    return false
  }
  let currentOwner: { pid: number; processStartedAt: string; token: string }
  try {
    currentOwner = parseSingleFlightOwner(
      await fs.readFile(path.join(lockDirectory, 'owner.json'), 'utf8'),
      lockDirectory
    )
  } catch (error) {
    await fs.unlink(claimPath).catch(() => undefined)
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (currentOwner.token !== expectedOwnerToken) {
    await fs.unlink(claimPath)
    return false
  }
  return true
}

function localProcessStartedAt(pid: number): string | null {
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' }
  })
  if (result.error) throw result.error
  const startedAt = result.stdout.trim().replace(/\s+/g, ' ')
  if (result.status === 1 && startedAt.length === 0) return null
  if (result.status !== 0 || startedAt.length === 0) {
    throw new Error(
      `Could not inspect process ${String(pid)}: ${result.stderr.trim() || 'ps returned no start time'}`
    )
  }
  return startedAt
}

function validateRepositoryPath(value: string): void {
  const normalized = path.posix.normalize(value)
  const segments = value.split('/')
  if (
    value.length === 0 || value.startsWith('/') || value.startsWith(':') ||
    value.includes('\\') || value.includes('\0') || value.length > 4096 ||
    normalized !== value || segments.includes('.') || segments.includes('..') ||
    segments[0] === '.git'
  ) throw new Error(`Unsafe repository-relative context path: ${value}`)
}

function parsePathAtCommit(value: string): { commit: string; filePath: string } {
  const commit = value.slice(0, 40)
  const filePath = value.slice(41)
  if (value[40] !== ':' || !fullCommitPattern.test(commit)) {
    throw new Error(
      'Historical-path context requests must use <full-commit-sha>:<repository-path>.'
    )
  }
  validateRepositoryPath(filePath)
  return { commit, filePath }
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
  if (request.kind === 'path_at_commit') {
    parsePathAtCommit(request.value)
    return
  }
  validateRepositoryPath(request.value)
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
  const reachable = requests.some(({ kind }) =>
    kind === 'git_object' || kind === 'path_at_commit'
  )
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
    } else if (request.kind === 'path_at_commit') {
      const historical = parsePathAtCommit(request.value)
      if (!reachable.has(historical.commit)) {
        throw new Error(
          `Requested commit ${historical.commit} is not reachable from ${target}.`
        )
      }
      const record = gitText(
        runner,
        repository,
        ['rev-parse', '--verify', `${historical.commit}:${historical.filePath}`],
        `Resolve requested historical path ${request.value}`
      )
      if (!fullCommitPattern.test(record)) {
        throw new Error(
          `Requested historical path ${request.value} did not resolve to a Git object.`
        )
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
      (
        request.kind !== 'git_object' && request.kind !== 'path' &&
        request.kind !== 'path_at_commit'
      ) ||
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
  if (value.status === 'complete' && parsedReport.ambiguities.length !== 0) {
    throw new Error('A complete result must not contain unresolved ambiguities.')
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
  maxContextRounds = 2,
  maxInputBytes = defaultAuditBundleLimits.maxInputBytes,
  prompt
}: {
  bundle: DecisionAuditBundle
  invoke: (input: AuditRoundInput) => Promise<unknown>
  loadContext: (requests: readonly ContextRequest[]) => Promise<readonly LoadedContext[]>
  maxContextRounds?: number
  maxInputBytes?: number
  prompt: string
}): Promise<AuditAgentResult> {
  if (!Number.isInteger(maxContextRounds) || maxContextRounds < 0) {
    throw new Error('maxContextRounds must be a non-negative integer.')
  }
  const contexts: LoadedContext[] = []
  const requested = new Set<string>()
  for (let round = 0; ; round += 1) {
    const input = { bundle, contexts, round }
    try {
      assertInputSize(prompt, input, maxInputBytes)
    } catch (error) {
      return contextFailure(error instanceof Error ? error.message : String(error))
    }
    const result = validateAuditAgentResult(await invoke(input))
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
  maxInputBytes = defaultAuditBundleLimits.maxInputBytes,
  maxStderrBytes = 1024 * 1024,
  maxStdoutBytes = 4 * 1024 * 1024,
  model,
  prompt,
  reasoningEffort = 'high',
  repository,
  schemaPath,
  terminationGraceMs = 5_000,
  timeoutMs = 30 * 60 * 1000
}: {
  codex?: string
  environment?: NodeJS.ProcessEnv
  input: AuditRoundInput
  maxInputBytes?: number
  maxStderrBytes?: number
  maxStdoutBytes?: number
  model: string
  prompt: string
  reasoningEffort?: 'high' | 'low' | 'medium' | 'xhigh'
  repository: string
  schemaPath: string
  terminationGraceMs?: number
  timeoutMs?: number
}): Promise<AuditAgentResult> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('timeoutMs must be a positive safe integer.')
  }
  if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 1) {
    throw new Error('terminationGraceMs must be a positive safe integer.')
  }
  if (!Number.isSafeInteger(maxStdoutBytes) || maxStdoutBytes < 1) {
    throw new Error('maxStdoutBytes must be a positive safe integer.')
  }
  if (!Number.isSafeInteger(maxStderrBytes) || maxStderrBytes < 1) {
    throw new Error('maxStderrBytes must be a positive safe integer.')
  }
  const args = buildDecisionGardenerCodexArgs({
    model, reasoningEffort, repository, schemaPath
  })
  const stdin = buildDecisionGardenerInput(prompt, input)
  const inputBytes = Buffer.byteLength(stdin, 'utf8')
  if (inputBytes > maxInputBytes) {
    throw new Error(
      `Decision-gardener prompt is ${String(inputBytes)} bytes; the limit is ${String(maxInputBytes)}.`
    )
  }
  return new Promise((resolve, reject) => {
    const child = spawn(codex, args, {
      cwd: repository,
      env: decisionGardenerChildEnvironment(environment),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let terminationError: Error | undefined
    let forceTimer: NodeJS.Timeout | undefined
    const clearTimers = (): void => {
      clearTimeout(timeoutTimer)
      if (forceTimer !== undefined) clearTimeout(forceTimer)
    }
    const settleReject = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimers()
      reject(error)
    }
    const settleResolve = (result: AuditAgentResult): void => {
      if (settled) return
      settled = true
      clearTimers()
      resolve(result)
    }
    const timeoutError = (): Error => new Error(
      `codex exec timed out after ${String(timeoutMs)} ms.`
    )
    const terminate = (error: Error): void => {
      if (settled || terminationError !== undefined) return
      terminationError = error
      clearTimeout(timeoutTimer)
      child.kill('SIGTERM')
      forceTimer = setTimeout(() => {
        child.kill('SIGKILL')
        settleReject(error)
      }, terminationGraceMs)
    }
    const timeoutTimer = setTimeout(() => {
      terminate(timeoutError())
    }, timeoutMs)
    const captureOutput = (
      chunks: Buffer[],
      chunk: Buffer,
      stream: 'stderr' | 'stdout'
    ): void => {
      if (settled || terminationError !== undefined) return
      const bytes = stream === 'stdout'
        ? (stdoutBytes += chunk.byteLength)
        : (stderrBytes += chunk.byteLength)
      const limit = stream === 'stdout' ? maxStdoutBytes : maxStderrBytes
      if (bytes > limit) {
        terminate(new Error(
          `codex exec ${stream} exceeded the ${String(limit)} byte limit.`
        ))
        return
      }
      chunks.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => {
      captureOutput(stdout, chunk, 'stdout')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      captureOutput(stderr, chunk, 'stderr')
    })
    child.on('error', (error) => {
      settleReject(error)
    })
    child.stdin.on('error', (error) => {
      terminate(new Error('codex exec closed stdin before reading the audit input.', {
        cause: error
      }))
    })
    child.on('close', (code) => {
      if (terminationError !== undefined) {
        settleReject(terminationError)
        return
      }
      if (code !== 0) {
        settleReject(new Error(
          `codex exec exited ${String(code)}: ${Buffer.concat(stderr).toString('utf8').trim()}`
        ))
        return
      }
      try {
        settleResolve(parseCodexAuditJsonl(Buffer.concat(stdout).toString('utf8')))
      } catch (error) {
        settleReject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.stdin.end(stdin)
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

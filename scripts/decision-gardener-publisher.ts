import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  type AuditAgentResult,
  type GitCommandRunner,
  parseDecisionCheckpoint,
  resolveCommit,
  runGitCommand,
  validateAuditAgentResult,
  validateCompleteProposal
} from './decision-gardener'
import {
  type DecisionGardenerOwnershipSnapshot,
  type GitHubCommandRunner,
  decisionGardenerOwnershipSchemaVersion,
  decisionGardenerPublicationMarker,
  runGitHubCommand
} from './decision-gardener-github'

export const decisionGardenerPublicationSchemaVersion = 1 as const

const fullCommitPattern = /^[0-9a-f]{40}$/
const publicationBranchPattern =
  /^decision-gardener\/[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}-[0-9a-f]{8}$/

interface HashedArtifact {
  file: string
  sha256: string
}

export interface DecisionGardenerPublicationManifest {
  base: 'main'
  baseCommit: string
  branch: string
  ownership: HashedArtifact
  proposal: HashedArtifact
  pullRequestBody: HashedArtifact
  remote: 'origin'
  repository: string
  result: HashedArtifact
  schemaVersion: typeof decisionGardenerPublicationSchemaVersion
  target: string
  worktree: string
}

export interface DecisionGardenerPublication {
  branch: string
  commit: string
  draft: true
  number: number
  url: string
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) throw new Error(`${label} contains missing or unknown fields.`)
}

function safeRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) {
    throw new Error(`${label} is not a safe relative path.`)
  }
  const normalized = path.posix.normalize(value)
  if (
    path.isAbsolute(value) || normalized !== value || value === '.' ||
    value.split('/').some((segment) => segment === '..' || segment === '')
  ) throw new Error(`${label} is not a safe relative path.`)
  return value
}

function parseArtifact(value: unknown, label: string): HashedArtifact {
  if (!isRecord(value)) throw new Error(`${label} is invalid.`)
  exactKeys(value, ['file', 'sha256'], label)
  const file = safeRelativePath(value.file, `${label} file`)
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) {
    throw new Error(`${label} SHA-256 is invalid.`)
  }
  return { file, sha256: value.sha256 }
}

export function parsePublicationManifest(
  value: unknown
): DecisionGardenerPublicationManifest {
  if (!isRecord(value) || value.schemaVersion !== decisionGardenerPublicationSchemaVersion) {
    throw new Error('The decision-gardener publication manifest version is unsupported.')
  }
  exactKeys(value, [
    'base', 'baseCommit', 'branch', 'ownership', 'proposal', 'pullRequestBody', 'remote',
    'repository', 'result', 'schemaVersion', 'target', 'worktree'
  ], 'Publication manifest')
  if (value.base !== 'main' || value.remote !== 'origin') {
    throw new Error('The decision-gardener publisher may target only origin/main.')
  }
  if (typeof value.branch !== 'string' || !publicationBranchPattern.test(value.branch)) {
    throw new Error('The decision-gardener publication branch is invalid.')
  }
  if (typeof value.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)) {
    throw new Error('The publication repository is invalid.')
  }
  if (typeof value.target !== 'string' || !fullCommitPattern.test(value.target)) {
    throw new Error('The publication target must be a full lowercase commit SHA.')
  }
  if (typeof value.baseCommit !== 'string' || !fullCommitPattern.test(value.baseCommit)) {
    throw new Error('The publication base must be a full lowercase commit SHA.')
  }
  const ownership = parseArtifact(value.ownership, 'Ownership artifact')
  const proposal = parseArtifact(value.proposal, 'Proposal artifact')
  const pullRequestBody = parseArtifact(value.pullRequestBody, 'Pull-request body artifact')
  const result = parseArtifact(value.result, 'Result artifact')
  const worktree = safeRelativePath(value.worktree, 'Publication worktree')
  if (
    ownership.file !== 'ownership.json' || proposal.file !== 'proposal.md' ||
    pullRequestBody.file !== 'pull-request.md' || result.file !== 'result.json' ||
    worktree !== 'worktree'
  ) throw new Error('The publication manifest uses unexpected artifact paths.')
  return {
    base: 'main',
    baseCommit: value.baseCommit,
    branch: value.branch,
    ownership,
    proposal,
    pullRequestBody,
    remote: 'origin',
    repository: value.repository,
    result,
    schemaVersion: decisionGardenerPublicationSchemaVersion,
    target: value.target,
    worktree
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must not be empty.`)
}

function validateOwnershipSnapshot(value: unknown): DecisionGardenerOwnershipSnapshot {
  if (!isRecord(value) || value.schemaVersion !== decisionGardenerOwnershipSchemaVersion) {
    throw new Error('The publication ownership snapshot version is unsupported.')
  }
  if (
    typeof value.repository !== 'string' || typeof value.capturedAt !== 'string' ||
    value.source !== 'github-rest' || !Array.isArray(value.items)
  ) throw new Error('The publication ownership snapshot is invalid.')
  for (const item of value.items) {
    if (
      !isRecord(item) || !Number.isSafeInteger(item.number) ||
      Number(item.number) < 1 || typeof item.title !== 'string' ||
      (item.type !== 'issue' && item.type !== 'pull_request') ||
      item.state !== 'open' || typeof item.url !== 'string' ||
      !Array.isArray(item.workIntents)
    ) throw new Error('The publication ownership snapshot contains an invalid item.')
  }
  return value as unknown as DecisionGardenerOwnershipSnapshot
}

export function validatePublishableAuditResult({
  ownership,
  result,
  sourceDecisions,
  target
}: {
  ownership: DecisionGardenerOwnershipSnapshot
  result: AuditAgentResult
  sourceDecisions: string
  target: string
}): string {
  const proposal = validateCompleteProposal(result, sourceDecisions, target)
  assertNonEmpty(result.report.summary, 'Audit summary')
  const classified = new Set<string>()
  for (const classification of result.report.classifications) {
    assertNonEmpty(classification.entry, 'Classification entry')
    assertNonEmpty(classification.reason, `Classification ${classification.entry} reason`)
    if (classification.evidence.length === 0) {
      throw new Error(`Classification ${classification.entry} must cite evidence.`)
    }
    for (const evidence of classification.evidence) {
      assertNonEmpty(evidence, `Classification ${classification.entry} evidence`)
    }
    if (classified.has(classification.entry)) {
      throw new Error(`The audit classifies ${classification.entry} more than once.`)
    }
    classified.add(classification.entry)
  }
  const ownershipByNumber = new Map(ownership.items.map((item) => [item.number, item]))
  const matched = new Set<number>()
  for (const match of result.report.ownershipMatches) {
    assertNonEmpty(match.reason, `Ownership match #${String(match.issue)} reason`)
    const item = ownershipByNumber.get(match.issue)
    if (item === undefined || item.title !== match.title) {
      throw new Error(`Ownership match #${String(match.issue)} is absent or stale.`)
    }
    if (matched.has(match.issue)) {
      throw new Error(`The audit repeats ownership match #${String(match.issue)}.`)
    }
    matched.add(match.issue)
  }
  for (const followup of result.report.suggestedFollowups) {
    assertNonEmpty(followup.summary, 'Suggested follow-up summary')
    if (
      followup.ownerIssue !== null &&
      !ownershipByNumber.has(followup.ownerIssue)
    ) {
      throw new Error(
        `Suggested follow-up owner #${String(followup.ownerIssue)} is absent from the ownership snapshot.`
      )
    }
  }
  if (parseDecisionCheckpoint(proposal) !== target) {
    throw new Error('The publishable proposal does not advance to the audited target.')
  }
  return proposal
}

function markdownText(value: string): string {
  return value.replaceAll('\r', '').replaceAll('\n', ' ').trim()
}

function sectionLines(values: readonly string[]): readonly string[] {
  return values.length === 0 ? ['- None.'] : values
}

export function renderDecisionGardenerPullRequestBody(
  result: AuditAgentResult,
  target: string
): string {
  const classifications = result.report.classifications.flatMap((item) => [
    `- **${markdownText(item.classification)} — ${markdownText(item.entry)}**: ${markdownText(item.reason)}`,
    ...item.evidence.map((evidence) => `  - Evidence: ${markdownText(evidence)}`)
  ])
  const ownership = result.report.ownershipMatches.map((item) =>
    `- #${String(item.issue)} — ${markdownText(item.title)}: ${markdownText(item.reason)}`
  )
  const followups = result.report.suggestedFollowups.map((item) =>
    `- ${markdownText(item.summary)}${item.ownerIssue === null ? '' : ` (owner: #${String(item.ownerIssue)})`}`
  )
  const ambiguities = result.report.ambiguities.flatMap((item) => [
    `- ${markdownText(item.summary)}`,
    ...item.evidence.map((evidence) => `  - Evidence: ${markdownText(evidence)}`)
  ])
  return [
    decisionGardenerPublicationMarker,
    '',
    `Reconciles \`DECISIONS.md\` through \`${target}\`.`,
    '',
    markdownText(result.report.summary),
    '',
    '## Classifications',
    '',
    ...sectionLines(classifications),
    '',
    '## Existing ownership matches',
    '',
    ...sectionLines(ownership),
    '',
    '## Ambiguities',
    '',
    ...sectionLines(ambiguities),
    '',
    '## Suggested follow-ups',
    '',
    ...sectionLines(followups),
    '',
    'This draft was proposed by the local decision gardener. It changes only',
    '`DECISIONS.md`; a maintainer must review and merge it.',
    ''
  ].join('\n')
}

function requireGit(
  runner: GitCommandRunner,
  repository: string,
  args: readonly string[],
  label: string
): Buffer {
  const result = runner(repository, [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false',
    '-c', 'commit.gpgsign=false',
    '-c', 'push.gpgSign=false',
    ...args
  ])
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`)
  return result.stdout
}

function requireGitHub(
  runner: GitHubCommandRunner,
  repository: string,
  args: readonly string[],
  label: string
): string {
  const result = runner(repository, args)
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`)
  return result.stdout
}

function exactPathOutput(source: Buffer, expected: string, label: string): void {
  if (!source.equals(Buffer.from(`${expected}\0`, 'utf8'))) {
    throw new Error(`${label} must contain exactly ${expected}.`)
  }
}

function cleanStatus(
  runner: GitCommandRunner,
  repository: string,
  label: string
): void {
  const status = requireGit(runner, repository, [
    'status', '--porcelain=v1', '--untracked-files=all', '-z'
  ], label)
  if (status.byteLength !== 0) {
    throw new Error(`${label} requires a completely clean worktree.`)
  }
}

async function readVerifiedArtifact(
  manifestDirectory: string,
  artifact: HashedArtifact,
  label: string
): Promise<{ path: string; source: string }> {
  const artifactPath = path.join(manifestDirectory, artifact.file)
  const source = await fs.readFile(artifactPath, 'utf8')
  if (sha256(source) !== artifact.sha256) {
    throw new Error(`${label} does not match its publication manifest SHA-256.`)
  }
  return { path: artifactPath, source }
}

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error })
  }
}

function parseCreatedPullRequest(source: string, manifest: DecisionGardenerPublicationManifest): DecisionGardenerPublication {
  const value = parseJson(source, 'Created pull request')
  if (!isRecord(value)) throw new Error('Created pull request metadata is invalid.')
  if (
    !Number.isSafeInteger(value.number) || Number(value.number) < 1 ||
    typeof value.url !== 'string' || value.isDraft !== true ||
    value.headRefName !== manifest.branch || value.baseRefName !== manifest.base
  ) throw new Error('The created pull request does not match the publication manifest.')
  return {
    branch: manifest.branch,
    commit: '',
    draft: true,
    number: Number(value.number),
    url: value.url
  }
}

function assertNoOpenPublication(source: string): void {
  const value = parseJson(source, 'Open gardener pull requests')
  if (!Array.isArray(value)) throw new Error('Open gardener pull requests are invalid.')
  for (const candidate of value) {
    if (!isRecord(candidate)) throw new Error('Open gardener pull-request metadata is invalid.')
    if (
      typeof candidate.body === 'string' &&
      candidate.body.includes(decisionGardenerPublicationMarker)
    ) {
      const number = Number.isSafeInteger(candidate.number)
        ? `#${String(candidate.number)}`
        : 'an existing pull request'
      const url = typeof candidate.url === 'string' ? ` (${candidate.url})` : ''
      throw new Error(`Decision-gardener publication is blocked by ${number}${url}.`)
    }
  }
}

export async function publishDecisionGardenerProposal({
  gitRunner = runGitCommand,
  githubRunner = runGitHubCommand,
  manifestPath
}: {
  gitRunner?: GitCommandRunner
  githubRunner?: GitHubCommandRunner
  manifestPath: string
}): Promise<DecisionGardenerPublication> {
  const manifestDirectory = path.dirname(path.resolve(manifestPath))
  const manifest = parsePublicationManifest(parseJson(
    await fs.readFile(manifestPath, 'utf8'),
    'Publication manifest'
  ))
  const proposalArtifact = await readVerifiedArtifact(
    manifestDirectory, manifest.proposal, 'Proposal artifact'
  )
  const resultArtifact = await readVerifiedArtifact(
    manifestDirectory, manifest.result, 'Result artifact'
  )
  const ownershipArtifact = await readVerifiedArtifact(
    manifestDirectory, manifest.ownership, 'Ownership artifact'
  )
  const bodyArtifact = await readVerifiedArtifact(
    manifestDirectory, manifest.pullRequestBody, 'Pull-request body artifact'
  )
  const result = validateAuditAgentResult(parseJson(resultArtifact.source, 'Audit result'))
  const ownership = validateOwnershipSnapshot(parseJson(
    ownershipArtifact.source,
    'Ownership snapshot'
  ))
  if (ownership.repository !== manifest.repository) {
    throw new Error('The ownership snapshot repository does not match the publication manifest.')
  }
  if (!bodyArtifact.source.startsWith(`${decisionGardenerPublicationMarker}\n`)) {
    throw new Error('The pull-request body is missing the decision-gardener marker.')
  }
  if (bodyArtifact.source !== renderDecisionGardenerPullRequestBody(result, manifest.target)) {
    throw new Error('The pull-request body differs from the validated audit report.')
  }
  const worktree = path.join(manifestDirectory, manifest.worktree)
  const head = resolveCommit(worktree, 'HEAD', gitRunner)
  if (head !== manifest.baseCommit) {
    throw new Error(`The publication worktree is at ${head}; expected ${manifest.baseCommit}.`)
  }
  cleanStatus(gitRunner, worktree, 'Decision-gardener publication')
  const sourceDecisions = requireGit(
    gitRunner,
    worktree,
    ['show', `${manifest.baseCommit}:DECISIONS.md`],
    'Read audited DECISIONS.md'
  ).toString('utf8')
  const proposal = validatePublishableAuditResult({
    ownership,
    result,
    sourceDecisions,
    target: manifest.target
  })
  if (proposal !== proposalArtifact.source) {
    throw new Error('The proposal artifact differs from the validated audit result.')
  }
  assertNoOpenPublication(requireGitHub(
    githubRunner,
    worktree,
    ['pr', 'list', '--repo', manifest.repository, '--state', 'open', '--limit', '100',
      '--json', 'number,title,url,body,headRefName'],
    'Refresh open decision-gardener pull requests'
  ))
  const decisionsPath = path.join(worktree, 'DECISIONS.md')
  const decisionsStat = await fs.lstat(decisionsPath)
  if (!decisionsStat.isFile() || decisionsStat.isSymbolicLink()) {
    throw new Error('The publication DECISIONS.md must be a regular tracked file.')
  }
  requireGit(
    gitRunner,
    worktree,
    ['switch', '-c', manifest.branch, manifest.baseCommit],
    'Create the publication branch'
  )
  await fs.writeFile(decisionsPath, proposal, { encoding: 'utf8', flag: 'w' })
  exactPathOutput(requireGit(gitRunner, worktree, [
    'diff', '--no-ext-diff', '--name-only', '-z', '--'
  ], 'Inspect the proposal diff'), 'DECISIONS.md', 'The proposal diff')
  requireGit(gitRunner, worktree, [
    'diff', '--no-ext-diff', '--check', '--', 'DECISIONS.md'
  ], 'Validate the proposal diff')
  const status = requireGit(gitRunner, worktree, [
    'status', '--porcelain=v1', '--untracked-files=all', '-z'
  ], 'Inspect the proposal worktree')
  if (!status.equals(Buffer.from(' M DECISIONS.md\0', 'utf8'))) {
    throw new Error('The proposal worktree may modify only tracked DECISIONS.md.')
  }
  requireGit(gitRunner, worktree, ['add', '--', 'DECISIONS.md'], 'Stage the proposal')
  exactPathOutput(requireGit(gitRunner, worktree, [
    'diff', '--cached', '--no-ext-diff', '--name-only', '-z', '--'
  ], 'Inspect the staged proposal'), 'DECISIONS.md', 'The staged proposal')
  const message = `Reconcile decision register through ${manifest.target.slice(0, 12)}`
  requireGit(gitRunner, worktree, ['commit', '-m', message], 'Commit the proposal')
  const commit = resolveCommit(worktree, 'HEAD', gitRunner)
  exactPathOutput(requireGit(gitRunner, worktree, [
    'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', `${commit}^`, commit
  ], 'Inspect the publication commit'), 'DECISIONS.md', 'The publication commit')
  cleanStatus(gitRunner, worktree, 'Committed decision-gardener publication')
  requireGit(
    gitRunner,
    worktree,
    ['push', '--set-upstream', manifest.remote,
      `HEAD:refs/heads/${manifest.branch}`],
    'Push the publication branch'
  )
  const createdUrl = requireGitHub(githubRunner, worktree, [
    'pr', 'create', '--draft', '--repo', manifest.repository,
    '--base', manifest.base, '--head', manifest.branch,
    '--title', message, '--body-file', bodyArtifact.path
  ], 'Create the draft decision-gardener pull request').trim()
  if (!/^https:\/\/github\.com\/.+\/pull\/\d+$/.test(createdUrl)) {
    throw new Error('GitHub did not return a draft pull-request URL.')
  }
  const publication = parseCreatedPullRequest(requireGitHub(
    githubRunner,
    worktree,
    ['pr', 'view', manifest.branch, '--repo', manifest.repository,
      '--json', 'number,url,isDraft,headRefName,baseRefName'],
    'Verify the draft decision-gardener pull request'
  ), manifest)
  return { ...publication, commit }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length !== 1 || args[0] === undefined) {
    throw new Error('Usage: decision-gardener-publisher <publication-manifest.json>')
  }
  const publication = await publishDecisionGardenerProposal({ manifestPath: args[0] })
  process.stdout.write(`${JSON.stringify(publication)}\n`)
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

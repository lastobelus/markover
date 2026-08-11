import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  type AuditAgentResult,
  type GitCommandRunner,
  acquireSingleFlightLock,
  assembleDecisionAuditBundle,
  decisionGardenerOutputSchemaPath,
  decisionGardenerProjectRoot,
  invokeDecisionGardenerCodex,
  loadRequestedContext,
  readDecisionGardenerOutputSchema,
  readDecisionGardenerPrompt,
  resolveCommit,
  runBoundedAudit,
  runGitCommand,
  writeImmutableAuditBundle
} from './decision-gardener'
import {
  type DecisionGardenerOwnershipSnapshot,
  type GitHubCommandRunner,
  collectGitHubOwnershipSnapshot,
  findOpenGardenerPublication,
  runGitHubCommand
} from './decision-gardener-github'
import {
  type DecisionGardenerPublication,
  type DecisionGardenerPublicationManifest,
  decisionGardenerPublicationSchemaVersion,
  renderDecisionGardenerPullRequestBody,
  validatePublishableAuditResult
} from './decision-gardener-publisher'

const fullCommitPattern = /^[0-9a-f]{40}$/

export interface DecisionGardenerRunOptions {
  codex: string
  githubRunner?: GitHubCommandRunner
  gitRunner?: GitCommandRunner
  model: string
  reasoningEffort: 'high' | 'low' | 'medium' | 'xhigh'
  repository: string
  runStore: string
}

export type DecisionGardenerRunOutcome =
  | {
      runDirectory: string
      status: 'ambiguous'
      summary: string
    }
  | {
      pullRequest: DecisionGardenerPublication
      runDirectory: string
      status: 'published'
    }
  | {
      pullRequest: { number: number; title: string; url: string }
      runDirectory: string
      status: 'blocked'
    }
  | {
      runDirectory: string
      status: 'no_changes'
      target: string
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

function requireCleanWorktree(
  runner: GitCommandRunner,
  repository: string,
  label: string
): void {
  const status = requireGit(runner, repository, [
    'status', '--porcelain=v1', '--untracked-files=all', '-z'
  ], `Inspect ${label}`)
  if (status.byteLength !== 0) throw new Error(`${label} must be completely clean.`)
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

async function writeExclusiveJson(filePath: string, value: unknown): Promise<void> {
  await writeExclusive(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function runId(now = new Date()): string {
  const timestamp = now.toISOString().replaceAll('-', '').replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `${timestamp}-${crypto.randomBytes(4).toString('hex')}`
}

export function publicationBranch(
  generatedAt: string,
  target: string,
  entropy = crypto.randomBytes(4).toString('hex')
): string {
  if (!fullCommitPattern.test(target) || !/^[0-9a-f]{8}$/.test(entropy)) {
    throw new Error('Cannot construct a decision-gardener publication branch.')
  }
  const date = new Date(generatedAt)
  if (Number.isNaN(date.valueOf())) throw new Error('The gardener run time is invalid.')
  const timestamp = date.toISOString().replaceAll('-', '').replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `decision-gardener/${timestamp}-${target.slice(0, 12)}-${entropy}`
}

function artifact(file: string, source: string): { file: string; sha256: string } {
  return { file, sha256: sha256(source) }
}

export function buildPublicationManifest({
  baseCommit,
  branch,
  ownershipSource,
  proposalSource,
  pullRequestBodySource,
  repository,
  resultSource,
  target
}: {
  baseCommit: string
  branch: string
  ownershipSource: string
  proposalSource: string
  pullRequestBodySource: string
  repository: string
  resultSource: string
  target: string
}): DecisionGardenerPublicationManifest {
  return {
    base: 'main',
    baseCommit,
    branch,
    ownership: artifact('ownership.json', ownershipSource),
    proposal: artifact('proposal.md', proposalSource),
    pullRequestBody: artifact('pull-request.md', pullRequestBodySource),
    remote: 'origin',
    repository,
    result: artifact('result.json', resultSource),
    schemaVersion: decisionGardenerPublicationSchemaVersion,
    target,
    worktree: 'worktree'
  }
}

function parsePublisherOutput(source: string): DecisionGardenerPublication {
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch (error) {
    throw new Error('The decision-gardener publisher returned invalid JSON.', { cause: error })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The decision-gardener publisher returned invalid metadata.')
  }
  const publication = value as Partial<DecisionGardenerPublication>
  if (
    typeof publication.branch !== 'string' || typeof publication.commit !== 'string' ||
    publication.draft !== true || !Number.isSafeInteger(publication.number) ||
    Number(publication.number) < 1 || typeof publication.url !== 'string'
  ) throw new Error('The decision-gardener publisher returned incomplete metadata.')
  return publication as DecisionGardenerPublication
}

async function recordOutcome(runDirectory: string, outcome: DecisionGardenerRunOutcome): Promise<void> {
  await writeExclusiveJson(path.join(runDirectory, 'outcome.json'), outcome)
}

function sourceFor(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function sourceResult(result: AuditAgentResult): string {
  return sourceFor(result)
}

export async function runDecisionGardener({
  codex,
  githubRunner = runGitHubCommand,
  gitRunner = runGitCommand,
  model,
  reasoningEffort,
  repository,
  runStore
}: DecisionGardenerRunOptions): Promise<DecisionGardenerRunOutcome> {
  await fs.mkdir(path.join(runStore, 'runs'), { recursive: true, mode: 0o700 })
  const identifier = runId()
  const runDirectory = path.join(runStore, 'runs', identifier)
  const worktree = path.join(runDirectory, 'worktree')
  await fs.mkdir(runDirectory, { mode: 0o700 })
  const lease = await acquireSingleFlightLock(path.join(runStore, 'single-flight.lock'), {
    repository,
    runDirectory
  })
  try {
    requireCleanWorktree(gitRunner, repository, 'The decision-gardener source checkout')
    requireGit(
      gitRunner,
      repository,
      ['fetch', '--prune', 'origin', 'main'],
      'Fetch current origin/main'
    )
    const baseCommit = resolveCommit(repository, 'origin/main', gitRunner)
    const sourceHead = resolveCommit(repository, 'HEAD', gitRunner)
    if (sourceHead !== baseCommit) {
      throw new Error(
        `The decision-gardener source checkout is at ${sourceHead}; update it to current origin/main ${baseCommit}.`
      )
    }
    const ownership = collectGitHubOwnershipSnapshot({
      repository,
      runner: githubRunner
    })
    const ownershipSource = sourceFor(ownership)
    await writeExclusive(path.join(runDirectory, 'ownership.json'), ownershipSource)
    const openPublication = findOpenGardenerPublication(ownership)
    if (openPublication !== null) {
      const outcome: DecisionGardenerRunOutcome = {
        pullRequest: {
          number: openPublication.number,
          title: openPublication.title,
          url: openPublication.url
        },
        runDirectory,
        status: 'blocked'
      }
      await recordOutcome(runDirectory, outcome)
      return outcome
    }
    requireGit(
      gitRunner,
      repository,
      ['worktree', 'add', '--detach', worktree, baseCommit],
      'Create the isolated gardener worktree'
    )
    const prompt = readDecisionGardenerPrompt()
    const schema = readDecisionGardenerOutputSchema()
    const bundle = assembleDecisionAuditBundle({
      ownershipSnapshot: ownership,
      repository: worktree,
      runner: gitRunner,
      targetRef: baseCommit
    })
    await writeImmutableAuditBundle({
      bundle,
      destination: path.join(runDirectory, 'audit-input'),
      prompt,
      schema
    })
    if (bundle.commits.length === 0) {
      const outcome: DecisionGardenerRunOutcome = {
        runDirectory,
        status: 'no_changes',
        target: bundle.target
      }
      await recordOutcome(runDirectory, outcome)
      return outcome
    }
    let round = 0
    const result = await runBoundedAudit({
      bundle,
      invoke: async (input) => {
        const currentRound = round
        round += 1
        const agentResult = await invokeDecisionGardenerCodex({
          codex,
          input,
          model,
          prompt,
          reasoningEffort,
          repository: worktree,
          schemaPath: path.join(runDirectory, 'audit-input', 'output.schema.json')
        })
        await writeExclusiveJson(
          path.join(runDirectory, `round-${String(currentRound)}-result.json`),
          agentResult
        )
        return agentResult
      },
      loadContext: (requests) => Promise.resolve(loadRequestedContext({
        repository: worktree,
        requests,
        runner: gitRunner,
        target: bundle.target
      })),
      prompt
    })
    const resultSource = sourceResult(result)
    await writeExclusive(path.join(runDirectory, 'result.json'), resultSource)
    if (result.status !== 'complete') {
      const outcome: DecisionGardenerRunOutcome = {
        runDirectory,
        status: 'ambiguous',
        summary: result.report.summary
      }
      await recordOutcome(runDirectory, outcome)
      return outcome
    }
    const proposal = validatePublishableAuditResult({
      ownership,
      result,
      sourceDecisions: bundle.decisions.content,
      target: bundle.target
    })
    const pullRequestBody = renderDecisionGardenerPullRequestBody(result, bundle.target)
    await writeExclusive(path.join(runDirectory, 'proposal.md'), proposal)
    await writeExclusive(path.join(runDirectory, 'pull-request.md'), pullRequestBody)
    const branch = publicationBranch(bundle.generatedAt, bundle.target)
    const manifest = buildPublicationManifest({
      baseCommit,
      branch,
      ownershipSource,
      proposalSource: proposal,
      pullRequestBodySource: pullRequestBody,
      repository: ownership.repository,
      resultSource,
      target: bundle.target
    })
    const manifestPath = path.join(runDirectory, 'publication.json')
    await writeExclusiveJson(manifestPath, manifest)
    const publisherPath = path.join(__dirname, 'decision-gardener-publisher.js')
    const published = spawnSync(process.execPath, [publisherPath, manifestPath], {
      cwd: repository,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 4 * 1024 * 1024
    })
    if (published.error) throw published.error
    if (published.status !== 0) {
      throw new Error(`Decision-gardener publication failed: ${published.stderr.trim()}`)
    }
    const publication = parsePublisherOutput(published.stdout)
    const outcome: DecisionGardenerRunOutcome = {
      pullRequest: publication,
      runDirectory,
      status: 'published'
    }
    await recordOutcome(runDirectory, outcome)
    return outcome
  } catch (error) {
    await writeExclusiveJson(path.join(runDirectory, 'failure.json'), {
      message: error instanceof Error ? error.message : String(error),
      occurredAt: new Date().toISOString()
    }).catch(() => undefined)
    throw error
  } finally {
    await lease.release()
  }
}

interface CliOptions {
  codex: string
  model: string
  reasoningEffort: DecisionGardenerRunOptions['reasoningEffort']
  runStore: string
}

export function parseDecisionGardenerCli(args: readonly string[]): CliOptions {
  let codex = 'codex'
  let model: string | undefined
  let reasoningEffort: CliOptions['reasoningEffort'] = 'high'
  let runStore = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Markover',
    'Decision Gardener'
  )
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    const value = args[index + 1]
    if (value === undefined) throw new Error(`Missing value for ${option ?? 'option'}.`)
    if (option === '--codex') codex = value
    else if (option === '--model') model = value
    else if (option === '--reasoning-effort') {
      if (!['high', 'low', 'medium', 'xhigh'].includes(value)) {
        throw new Error(`Unsupported reasoning effort: ${value}`)
      }
      reasoningEffort = value as CliOptions['reasoningEffort']
    } else if (option === '--run-store') runStore = path.resolve(value)
    else throw new Error(`Unknown decision-gardener option: ${option ?? ''}`)
    index += 1
  }
  if (model === undefined || !/^[A-Za-z0-9._-]+$/.test(model)) {
    throw new Error('Pass one safe Codex model slug with --model <model>.')
  }
  if (codex.trim().length === 0) throw new Error('The Codex executable must not be empty.')
  return { codex, model, reasoningEffort, runStore }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseDecisionGardenerCli(args)
  const outcome = await runDecisionGardener({
    ...options,
    repository: decisionGardenerProjectRoot
  })
  process.stdout.write(`${JSON.stringify(outcome)}\n`)
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

export { decisionGardenerOutputSchemaPath }
export type { DecisionGardenerOwnershipSnapshot }

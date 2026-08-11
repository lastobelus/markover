import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  type AuditAgentResult,
  replaceDecisionCheckpoint
} from '../scripts/decision-gardener'
import {
  type DecisionGardenerOwnershipSnapshot,
  type GitHubCommandRunner,
  decisionGardenerPublicationMarker
} from '../scripts/decision-gardener-github'
import {
  publishDecisionGardenerProposal,
  renderDecisionGardenerPullRequestBody,
  validatePublishableAuditResult
} from '../scripts/decision-gardener-publisher'
import {
  buildPublicationManifest,
  parseDecisionGardenerCli,
  publicationBranch,
  runDecisionGardener
} from '../scripts/decision-gardener-run'

const checkpointPrefix = '<!-- decision-gardener-checkpoint: '

function git(repository: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: repository, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout.trimEnd()
}

function ownership(items: DecisionGardenerOwnershipSnapshot['items'] = []): DecisionGardenerOwnershipSnapshot {
  return {
    capturedAt: '2026-08-11T01:02:03.000Z',
    items,
    repository: 'lastobelus/markover',
    schemaVersion: 1,
    source: 'github-rest'
  }
}

function completeResult(source: string, target: string): AuditAgentResult {
  return {
    contextRequests: [],
    proposedDecisions: replaceDecisionCheckpoint(source, target),
    report: {
      ambiguities: [],
      classifications: [],
      ownershipMatches: [],
      suggestedFollowups: [],
      summary: 'No semantic decision entry changed.'
    },
    schemaVersion: 1,
    status: 'complete'
  }
}

async function publicationFixture(): Promise<{
  baseCommit: string
  manifestPath: string
  origin: string
  repository: string
  result: AuditAgentResult
  source: string
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-gardener-publish-'))
  const origin = path.join(root, 'origin.git')
  const repository = path.join(root, 'run', 'worktree')
  await fs.mkdir(path.dirname(repository), { recursive: true })
  git(root, ['init', '--bare', origin])
  git(root, ['init', '-b', 'main', repository])
  git(repository, ['config', 'user.name', 'Gardener Test'])
  git(repository, ['config', 'user.email', 'gardener@example.com'])
  const source = [
    '# Decision register',
    '',
    `${checkpointPrefix}${'a'.repeat(40)} -->`,
    ''
  ].join('\n')
  await fs.writeFile(path.join(repository, 'DECISIONS.md'), source)
  git(repository, ['add', 'DECISIONS.md'])
  git(repository, ['commit', '-m', 'Seed decision register'])
  const baseCommit = git(repository, ['rev-parse', 'HEAD'])
  git(repository, ['remote', 'add', 'origin', origin])
  git(repository, ['push', '-u', 'origin', 'main'])
  const result = completeResult(source, baseCommit)
  const ownershipSource = `${JSON.stringify(ownership(), null, 2)}\n`
  const resultSource = `${JSON.stringify(result, null, 2)}\n`
  const proposalSource = result.proposedDecisions ?? ''
  const bodySource = renderDecisionGardenerPullRequestBody(result, baseCommit)
  const branch = publicationBranch(
    '2026-08-11T01:02:03.000Z', baseCommit, '1234abcd'
  )
  const manifest = buildPublicationManifest({
    baseCommit,
    branch,
    ownershipSource,
    proposalSource,
    pullRequestBodySource: bodySource,
    repository: 'lastobelus/markover',
    resultSource,
    target: baseCommit
  })
  const runDirectory = path.dirname(repository)
  await fs.writeFile(path.join(runDirectory, 'ownership.json'), ownershipSource)
  await fs.writeFile(path.join(runDirectory, 'result.json'), resultSource)
  await fs.writeFile(path.join(runDirectory, 'proposal.md'), proposalSource)
  await fs.writeFile(path.join(runDirectory, 'pull-request.md'), bodySource)
  const manifestPath = path.join(runDirectory, 'publication.json')
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { baseCommit, manifestPath, origin, repository, result, source }
}

test('publisher revalidates one-file output, pushes a dedicated branch, and creates a draft PR', async (t) => {
  const fixture = await publicationFixture()
  t.after(() => fs.rm(path.dirname(fixture.origin), { recursive: true, force: true }))
  const calls: string[][] = []
  const githubRunner: GitHubCommandRunner = (_repository, args) => {
    calls.push([...args])
    if (args[0] === 'api') {
      return { status: 0, stderr: '', stdout: '[[]]' }
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      return {
        status: 0,
        stderr: '',
        stdout: 'https://github.com/lastobelus/markover/pull/151\n'
      }
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      const branch = args[2]
      return {
        status: 0,
        stderr: '',
        stdout: JSON.stringify({
          baseRefName: 'main',
          headRefName: branch,
          isDraft: true,
          number: 151,
          url: 'https://github.com/lastobelus/markover/pull/151'
        })
      }
    }
    return { status: 1, stderr: `Unexpected gh call: ${args.join(' ')}`, stdout: '' }
  }
  const publication = await publishDecisionGardenerProposal({
    githubRunner,
    manifestPath: fixture.manifestPath
  })
  assert.equal(publication.number, 151)
  assert.equal(publication.draft, true)
  assert.match(publication.branch, /^decision-gardener\//)
  assert.equal(git(fixture.repository, ['status', '--porcelain']), '')
  assert.equal(
    git(fixture.repository, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']),
    'DECISIONS.md'
  )
  assert.equal(
    git(fixture.origin, ['rev-parse', `refs/heads/${publication.branch}`]),
    publication.commit
  )
  const create = calls.find((args) => args[0] === 'pr' && args[1] === 'create')
  const openPullRequests = calls.find((args) => args[0] === 'api')
  assert.deepEqual(openPullRequests, [
    'api', '--paginate', '--slurp',
    'repos/lastobelus/markover/pulls?state=open&per_page=100'
  ])
  assert.ok(create?.includes('--draft'))
  assert.ok(create?.includes('--body-file'))
})

test('publisher refuses any pre-existing worktree change and any open gardener proposal', async (t) => {
  const dirty = await publicationFixture()
  t.after(() => fs.rm(path.dirname(dirty.origin), { recursive: true, force: true }))
  await fs.writeFile(path.join(dirty.repository, 'unexpected.txt'), 'dirty\n')
  await assert.rejects(publishDecisionGardenerProposal({
    githubRunner: () => ({ status: 0, stderr: '', stdout: '[]' }),
    manifestPath: dirty.manifestPath
  }), /completely clean worktree/)

  const blocked = await publicationFixture()
  t.after(() => fs.rm(path.dirname(blocked.origin), { recursive: true, force: true }))
  await assert.rejects(publishDecisionGardenerProposal({
    githubRunner: (_repository, args) => ({
      status: 0,
      stderr: '',
      stdout: args[0] === 'api'
        ? JSON.stringify([[], [{
            body: decisionGardenerPublicationMarker,
            html_url: 'https://github.com/lastobelus/markover/pull/149',
            number: 149,
          }]])
        : ''
    }),
    manifestPath: blocked.manifestPath
  }), /blocked by #149/)
})

test('publisher refuses publication when origin/main advances after the audit', async (t) => {
  const fixture = await publicationFixture()
  t.after(() => fs.rm(path.dirname(fixture.origin), { recursive: true, force: true }))
  const advancingRepository = path.join(path.dirname(fixture.origin), 'advance')
  git(path.dirname(fixture.origin), [
    'clone', '--branch', 'main', fixture.origin, advancingRepository
  ])
  git(advancingRepository, ['config', 'user.name', 'Gardener Test'])
  git(advancingRepository, ['config', 'user.email', 'gardener@example.com'])
  await fs.writeFile(path.join(advancingRepository, 'advanced.txt'), 'advanced\n')
  git(advancingRepository, ['add', 'advanced.txt'])
  git(advancingRepository, ['commit', '-m', 'Advance main'])
  git(advancingRepository, ['push', 'origin', 'main'])

  await assert.rejects(publishDecisionGardenerProposal({
    githubRunner: () => ({ status: 0, stderr: '', stdout: '[[]]' }),
    manifestPath: fixture.manifestPath
  }), /publication base advanced/)
})

test('publishable results cross-check ownership and render every report lane', () => {
  const source = `# Decision register\n\n${checkpointPrefix}${'a'.repeat(40)} -->\n`
  const target = 'b'.repeat(40)
  const snapshot = ownership([{
    assignees: [],
    body: 'Owner',
    labels: [],
    milestone: null,
    number: 101,
    state: 'open',
    title: 'Decision gardener',
    type: 'issue',
    url: 'https://github.com/lastobelus/markover/issues/101',
    workIntents: []
  }])
  const result = completeResult(source, target)
  result.report.ownershipMatches = [{
    issue: 101,
    reason: 'Owns the finding.',
    title: 'Decision gardener'
  }]
  result.report.suggestedFollowups = [{ ownerIssue: 101, summary: 'Keep ownership here.' }]
  assert.equal(validatePublishableAuditResult({
    ownership: snapshot,
    result,
    sourceDecisions: source,
    target
  }), result.proposedDecisions)
  const body = renderDecisionGardenerPullRequestBody(result, target)
  assert.match(body, /Existing ownership matches/)
  assert.match(body, /#101/)
  assert.match(body, /Suggested follow-ups/)
  assert.throws(() => validatePublishableAuditResult({
    ownership: snapshot,
    result: {
      ...result,
      report: {
        ...result.report,
        ownershipMatches: [{ issue: 101, reason: 'Stale.', title: 'Wrong title' }]
      }
    },
    sourceDecisions: source,
    target
  }), /absent or stale/)
})

test('manual CLI requires an explicit safe model and builds deterministic branch names', () => {
  assert.deepEqual(parseDecisionGardenerCli([
    '--model', 'gpt-5.6-sol', '--reasoning-effort', 'xhigh', '--run-store', '/tmp/gardener'
  ]), {
    codex: 'codex',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'xhigh',
    runStore: '/tmp/gardener'
  })
  assert.throws(() => parseDecisionGardenerCli([]), /--model/)
  assert.equal(
    publicationBranch('2026-08-11T01:02:03.000Z', 'b'.repeat(40), '1234abcd'),
    `decision-gardener/20260811T010203Z-${'b'.repeat(12)}-1234abcd`
  )
})

test('manual runner fetches into an isolated worktree and skips Codex when nothing is unaudited', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-gardener-run-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const origin = path.join(root, 'origin.git')
  const repository = path.join(root, 'source')
  const runStore = path.join(root, 'store')
  git(root, ['init', '--bare', origin])
  git(root, ['init', '-b', 'main', repository])
  git(repository, ['config', 'user.name', 'Gardener Test'])
  git(repository, ['config', 'user.email', 'gardener@example.com'])
  await fs.writeFile(path.join(repository, 'seed.txt'), 'seed\n')
  git(repository, ['add', 'seed.txt'])
  git(repository, ['commit', '-m', 'Seed'])
  const seed = git(repository, ['rev-parse', 'HEAD'])
  await fs.writeFile(
    path.join(repository, 'DECISIONS.md'),
    `# Decision register\n\n${checkpointPrefix}${seed} -->\n`
  )
  git(repository, ['add', 'DECISIONS.md'])
  git(repository, ['commit', '-m', 'Add register'])
  const checkpoint = git(repository, ['rev-parse', 'HEAD'])
  await fs.writeFile(
    path.join(repository, 'DECISIONS.md'),
    `# Decision register\n\n${checkpointPrefix}${checkpoint} -->\n`
  )
  git(repository, ['add', 'DECISIONS.md'])
  git(repository, ['commit', '-m', 'Publish checkpoint'])
  git(repository, ['remote', 'add', 'origin', origin])
  git(repository, ['push', '-u', 'origin', 'main'])
  const githubRunner: GitHubCommandRunner = (_cwd, args) => {
    if (args[0] === 'repo') {
      return {
        status: 0,
        stderr: '',
        stdout: JSON.stringify({ nameWithOwner: 'lastobelus/markover', url: 'url' })
      }
    }
    return { status: 0, stderr: '', stdout: '[[]]' }
  }
  const outcome = await runDecisionGardener({
    codex: path.join(root, 'codex-must-not-run'),
    githubRunner,
    model: 'test-model',
    reasoningEffort: 'high',
    repository,
    runStore
  })
  assert.equal(outcome.status, 'no_changes')
  assert.equal(outcome.target, checkpoint)
  assert.match(
    await fs.readFile(path.join(outcome.runDirectory, 'outcome.json'), 'utf8'),
    /"status": "no_changes"/
  )
  assert.match(
    await fs.readFile(
      path.join(outcome.runDirectory, 'audit-input', 'bundle.json'),
      'utf8'
    ),
    /"commits": \[\]/
  )
  await fs.chmod(path.join(outcome.runDirectory, 'audit-input'), 0o700)
})

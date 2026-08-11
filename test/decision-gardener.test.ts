import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  acquireSingleFlightLock,
  assembleDecisionAuditBundle,
  buildDecisionGardenerCodexArgs,
  buildDecisionGardenerInput,
  decisionGardenerChildEnvironment,
  defaultAuditBundleLimits,
  discoverCommitRange,
  invokeDecisionGardenerCodex,
  loadRequestedContext,
  parseCodexAuditJsonl,
  parseDecisionCheckpoint,
  replaceDecisionCheckpoint,
  readGitContent,
  runBoundedAudit,
  validateAuditAgentResult,
  validateCompleteProposal,
  writeImmutableAuditBundle,
  type AuditAgentResult,
  type AuditReport,
  type DecisionAuditBundle,
  type LoadedContext
} from '../scripts/decision-gardener'

const checkpointPrefix = '<!-- decision-gardener-checkpoint: '
const emptyReport: AuditReport = {
  ambiguities: [],
  classifications: [],
  ownershipMatches: [],
  suggestedFollowups: [],
  summary: 'No semantic changes.'
}

function git(repository: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: repository, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trimEnd()
}

async function commitFile(
  repository: string,
  relativePath: string,
  content: string,
  message: string
): Promise<string> {
  const filePath = path.join(repository, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content)
  git(repository, ['add', relativePath])
  git(repository, ['commit', '-m', message])
  return git(repository, ['rev-parse', 'HEAD'])
}

async function createAuditRepository(): Promise<{
  checkpoint: string
  repository: string
  target: string
}> {
  const repository = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-decision-gardener-')
  )
  git(repository, ['init', '-b', 'main'])
  git(repository, ['config', 'user.name', 'Gardener Test'])
  git(repository, ['config', 'user.email', 'gardener@example.com'])
  const checkpoint = await commitFile(
    repository,
    'seed.txt',
    'seed\n',
    'Seed history'
  )
  await commitFile(
    repository,
    'DECISIONS.md',
    `# Decision register\n\nEvidence: [feature](src/feature.ts).\n\n${checkpointPrefix}${checkpoint} -->\n`,
    'Record audit checkpoint'
  )
  await commitFile(
    repository,
    'src/feature.ts',
    'export const feature = true\n',
    'Land feature while gardener is offline'
  )
  await commitFile(
    repository,
    'test/feature.test.ts',
    'export const covered = true\n',
    'Land tests while gardener is still offline'
  )
  return { checkpoint, repository, target: git(repository, ['rev-parse', 'HEAD']) }
}

function completeResult(bundle: DecisionAuditBundle): AuditAgentResult {
  return {
    contextRequests: [],
    proposedDecisions: replaceDecisionCheckpoint(
      bundle.decisions.content,
      bundle.target
    ),
    report: emptyReport,
    schemaVersion: 1,
    status: 'complete'
  }
}

function invocationBundle(): DecisionAuditBundle {
  const checkpoint = 'a'.repeat(40)
  return {
    checkpoint,
    commits: [],
    decisions: {
      content: `# Decision register\n\n${checkpointPrefix}${checkpoint} -->\n`,
      path: 'DECISIONS.md',
      sha256: 'b'.repeat(64)
    },
    generatedAt: '2026-08-10T00:00:00.000Z',
    ownershipSnapshot: {},
    pathPrefixes: [],
    paths: [],
    schemaVersion: 1,
    target: checkpoint,
    targetRef: 'origin/main'
  }
}

test('checkpoint parsing requires one full durable main commit', () => {
  const commit = 'a'.repeat(40)
  const source = `# Decision register\n\n${checkpointPrefix}${commit} -->\n`
  assert.equal(parseDecisionCheckpoint(source), commit)
  assert.match(replaceDecisionCheckpoint(source, 'b'.repeat(40)), /b{40}/)
  assert.throws(() => parseDecisionCheckpoint('# Decision register\n'), /exactly one/)
  assert.throws(
    () => parseDecisionCheckpoint(`${source}${checkpointPrefix}${commit} -->\n`),
    /exactly one/
  )
  assert.throws(
    () => parseDecisionCheckpoint(`${checkpointPrefix}abc1234 -->\n`),
    /full lowercase/
  )
})

test('range discovery catches every commit landed during an offline interval', async (t) => {
  const fixture = await createAuditRepository()
  t.after(() => fs.rm(fixture.repository, { recursive: true, force: true }))
  const range = discoverCommitRange({
    checkpoint: fixture.checkpoint,
    repository: fixture.repository,
    targetRef: 'main'
  })
  assert.equal(range.target, fixture.target)
  assert.equal(range.commits.length, 3)
  assert.deepEqual(range.commits.map((commit) =>
    git(fixture.repository, ['show', '-s', '--format=%s', commit])
  ), [
    'Record audit checkpoint',
    'Land feature while gardener is offline',
    'Land tests while gardener is still offline'
  ])

  git(fixture.repository, ['checkout', '--orphan', 'unrelated'])
  await commitFile(fixture.repository, 'unrelated.txt', 'unrelated\n', 'Unrelated')
  assert.throws(() => discoverCommitRange({
    checkpoint: fixture.checkpoint,
    repository: fixture.repository,
    targetRef: 'unrelated'
  }), /not an ancestor/)
})

test('checkpoint publication commits cannot trigger another checkpoint-only audit', async (t) => {
  const fixture = await createAuditRepository()
  t.after(() => fs.rm(fixture.repository, { recursive: true, force: true }))
  const decisionsPath = path.join(fixture.repository, 'DECISIONS.md')
  const publishCheckpoint = async (target: string): Promise<string> => {
    const source = await fs.readFile(decisionsPath, 'utf8')
    return commitFile(
      fixture.repository,
      'DECISIONS.md',
      replaceDecisionCheckpoint(source, target),
      'Publish decision audit'
    )
  }

  await publishCheckpoint(fixture.target)
  const afterFirstPublication = discoverCommitRange({
    checkpoint: fixture.target,
    repository: fixture.repository,
    targetRef: 'main'
  })
  assert.deepEqual(afterFirstPublication, { commits: [], target: fixture.target })

  const productCommit = await commitFile(
    fixture.repository,
    'src/later.ts',
    'export const later = true\n',
    'Land later product work'
  )
  const afterProductWork = discoverCommitRange({
    checkpoint: fixture.target,
    repository: fixture.repository,
    targetRef: 'main'
  })
  assert.deepEqual(afterProductWork, {
    commits: [productCommit],
    target: productCommit
  })

  const secondPublication = await publishCheckpoint(productCommit)
  const afterSecondPublication = discoverCommitRange({
    checkpoint: productCommit,
    repository: fixture.repository,
    targetRef: 'main'
  })
  assert.deepEqual(afterSecondPublication, { commits: [], target: productCommit })
  const bundle = assembleDecisionAuditBundle({
    ownershipSnapshot: {},
    repository: fixture.repository,
    targetRef: 'main'
  })
  assert.equal(bundle.target, productCommit)
  assert.deepEqual(bundle.commits, [])
  assert.equal(replaceDecisionCheckpoint(bundle.decisions.content, bundle.target),
    bundle.decisions.content)

  const publicationSource = await fs.readFile(decisionsPath, 'utf8')
  await fs.writeFile(
    decisionsPath,
    replaceDecisionCheckpoint(publicationSource, secondPublication)
  )
  git(fixture.repository, ['add', 'DECISIONS.md'])
  const mixedCommit = await commitFile(
    fixture.repository,
    'src/mixed.ts',
    'export const mixed = true\n',
    'Publish checkpoint with product work'
  )
  assert.deepEqual(discoverCommitRange({
    checkpoint: productCommit,
    repository: fixture.repository,
    targetRef: 'main'
  }), {
    commits: [mixedCommit],
    target: mixedCommit
  })
})

test('merge-based checkpoint publications exclude both publication commits', async (t) => {
  const fixture = await createAuditRepository()
  t.after(() => fs.rm(fixture.repository, { recursive: true, force: true }))
  git(fixture.repository, ['checkout', '-b', 'decision-publication'])
  const decisionsPath = path.join(fixture.repository, 'DECISIONS.md')
  const source = await fs.readFile(decisionsPath, 'utf8')
  const publicationCommit = await commitFile(
    fixture.repository,
    'DECISIONS.md',
    replaceDecisionCheckpoint(source, fixture.target),
    'Publish decision audit'
  )
  git(fixture.repository, ['checkout', 'main'])
  git(fixture.repository, [
    'merge', '--no-ff', 'decision-publication', '-m', 'Merge decision audit'
  ])
  const mergeCommit = git(fixture.repository, ['rev-parse', 'HEAD'])
  assert.equal(git(fixture.repository, [
    'rev-list', '--parents', '-n', '1', mergeCommit
  ]).split(' ').length, 3)
  assert.deepEqual(git(fixture.repository, [
    'rev-list', '--reverse', `${fixture.target}..${mergeCommit}`
  ]).split('\n'), [publicationCommit, mergeCommit])

  assert.deepEqual(discoverCommitRange({
    checkpoint: fixture.target,
    repository: fixture.repository,
    targetRef: 'main'
  }), { commits: [], target: fixture.target })
  const bundle = assembleDecisionAuditBundle({
    ownershipSnapshot: {},
    repository: fixture.repository,
    targetRef: 'main'
  })
  assert.equal(bundle.target, fixture.target)
  assert.deepEqual(bundle.commits, [])
})

test('ordinary merge audits inventory paths against the first parent', async (t) => {
  const fixture = await createAuditRepository()
  t.after(() => fs.rm(fixture.repository, { recursive: true, force: true }))
  git(fixture.repository, ['checkout', '-b', 'ordinary-merge'])
  await commitFile(
    fixture.repository,
    'src/merge-only.ts',
    'export const merged = true\n',
    'Land merge-only product work'
  )
  git(fixture.repository, ['checkout', 'main'])
  git(fixture.repository, [
    'merge', '--no-ff', 'ordinary-merge', '-m', 'Merge ordinary product work'
  ])
  const mergeCommit = git(fixture.repository, ['rev-parse', 'HEAD'])

  const bundle = assembleDecisionAuditBundle({
    ownershipSnapshot: {},
    repository: fixture.repository,
    targetRef: 'main'
  })
  const auditedMerge = bundle.commits.find(({ sha }) => sha === mergeCommit)
  assert.ok(auditedMerge)
  assert.equal(auditedMerge.parents.length, 2)
  assert.deepEqual(auditedMerge.changedPaths.map(
    ([status, pathIndex, oldPathIndex]) => {
      const snapshot = bundle.paths[pathIndex]
      assert.ok(snapshot)
      const [prefixIndex, suffix] = snapshot
      return [
        status,
        `${bundle.pathPrefixes[prefixIndex] ?? ''}${suffix}`,
        oldPathIndex
      ]
    }
  ), [['A', 'src/merge-only.ts', null]])
})

test('audit bundles pin commit patches, changed paths, snapshots, and ownership', async (t) => {
  const fixture = await createAuditRepository()
  t.after(() => fs.rm(fixture.repository, { recursive: true, force: true }))
  const ownershipSnapshot = {
    capturedAt: '2026-08-10T00:00:00.000Z',
    issues: [{ number: 101, title: 'Decision gardener' }],
    schemaVersion: 1
  }
  await fs.writeFile(
    path.join(fixture.repository, 'DECISIONS.md'),
    '# untrusted dirty checkout content\n'
  )
  const bundle = assembleDecisionAuditBundle({
    generatedAt: '2026-08-10T00:00:00.000Z',
    ownershipSnapshot,
    repository: fixture.repository,
    targetRef: 'main'
  })
  assert.equal(bundle.checkpoint, fixture.checkpoint)
  assert.equal(bundle.target, fixture.target)
  assert.match(bundle.decisions.content, /^# Decision register/)
  assert.equal(bundle.commits.length, 3)
  assert.deepEqual(bundle.ownershipSnapshot, ownershipSnapshot)
  assert.ok(bundle.commits.every(({ patch }) => patch.bytes > 0))
  assert.deepEqual(
    bundle.paths.map(([prefixIndex, suffix]) =>
      `${bundle.pathPrefixes[prefixIndex] ?? ''}${suffix}`
    ),
    ['DECISIONS.md', 'src/feature.ts', 'test/feature.test.ts']
  )
  const featureContent = bundle.paths.find(
    ([prefixIndex, suffix]) =>
      `${bundle.pathPrefixes[prefixIndex] ?? ''}${suffix}` === 'src/feature.ts'
  )?.[5]
  assert.ok(featureContent !== null && featureContent !== undefined)
  assert.equal(featureContent.omitted, false)
  assert.equal(featureContent.value, 'export const feature = true\n')
})

test('large Git content is capped before it is buffered in memory', async (t) => {
  const fixture = await createAuditRepository()
  t.after(() => fs.rm(fixture.repository, { recursive: true, force: true }))
  const binaryPath = path.join(fixture.repository, 'large.bin')
  await fs.writeFile(binaryPath, Buffer.alloc(2 * 1024 * 1024, 0xa5))
  git(fixture.repository, ['add', 'large.bin'])
  git(fixture.repository, ['commit', '-m', 'Add large binary'])
  const commit = git(fixture.repository, ['rev-parse', 'HEAD'])
  const budget = { remaining: 4 * 1024 }
  const args = [
    'show', '--first-parent', '--format=fuller', '--binary', '--find-renames',
    '--no-ext-diff', commit
  ]
  const patch = readGitContent(
    fixture.repository,
    args,
    `Read patch for ${commit}`,
    budget,
    1024
  )
  assert.equal(patch.omitted, true)
  assert.equal(patch.reason, 'item_limit')
  assert.ok(patch.bytes > 1024)
  const expected = spawnSync('git', args, {
    cwd: fixture.repository,
    encoding: 'buffer',
    maxBuffer: 8 * 1024 * 1024
  }).stdout
  assert.equal(patch.bytes, expected.byteLength)
  assert.equal(patch.sha256, crypto.createHash('sha256').update(expected).digest('hex'))
  assert.equal(budget.remaining, 4 * 1024)
})

test('the initial Markover catch-up inventory stays below the model-input bound', () => {
  const repository = path.resolve(__dirname, '../..')
  const bundle = assembleDecisionAuditBundle({
    generatedAt: '2026-08-10T00:00:00.000Z',
    ownershipSnapshot: { issues: [], schemaVersion: 1 },
    repository,
    targetRef: 'HEAD'
  })
  const sourceBytes = Buffer.byteLength(JSON.stringify({
    bundle,
    contexts: [],
    round: 0
  }))
  assert.ok(sourceBytes <= defaultAuditBundleLimits.maxInputBytes)
  const largeCommit = bundle.commits.find(({ sha }) => sha.startsWith('c356d4c3'))
  assert.ok(largeCommit)
  assert.equal(largeCommit.patch.omitted, true)
  assert.ok(bundle.paths.length > 5_000)
})

test('bundle snapshots are write-once and carry verified prompt/schema hashes', async (t) => {
  const fixture = await createAuditRepository()
  const artifactRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-decision-artifact-')
  )
  t.after(async () => {
    await fs.chmod(path.join(artifactRoot, 'run-1'), 0o700).catch(() => undefined)
    await fs.rm(artifactRoot, { recursive: true, force: true })
    await fs.rm(fixture.repository, { recursive: true, force: true })
  })
  const bundle = assembleDecisionAuditBundle({
    ownershipSnapshot: { schemaVersion: 1 },
    repository: fixture.repository,
    targetRef: 'main'
  })
  const destination = path.join(artifactRoot, 'run-1')
  const written = await writeImmutableAuditBundle({
    bundle,
    destination,
    prompt: '# Audit\n',
    schema: { type: 'object' }
  })
  assert.match(written.bundleSha256, /^[0-9a-f]{64}$/)
  const manifest = JSON.parse(
    await fs.readFile(path.join(destination, 'manifest.json'), 'utf8')
  ) as { bundle: { sha256: string } }
  assert.equal(manifest.bundle.sha256, written.bundleSha256)
  assert.equal((await fs.stat(destination)).mode & 0o777, 0o500)
  assert.equal((await fs.stat(path.join(destination, 'bundle.json'))).mode & 0o777, 0o400)
  await assert.rejects(
    writeImmutableAuditBundle({
      bundle,
      destination,
      prompt: '# Replacement\n',
      schema: { type: 'object' }
    })
  )
})

test('single-flight ownership is atomic and cannot release another run', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-gardener-lock-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const lock = path.join(root, 'active.lock')
  const first = await acquireSingleFlightLock(lock, { target: 'main' })
  await assert.rejects(acquireSingleFlightLock(lock), /already owns/)
  const ownerPath = path.join(lock, 'owner.json')
  const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8')) as {
    token: string
  }
  await fs.chmod(ownerPath, 0o600)
  await fs.writeFile(ownerPath, JSON.stringify({ ...owner, token: 'other' }))
  await assert.rejects(first.release(), /another run/)
  await fs.writeFile(ownerPath, JSON.stringify(owner))
  await first.release()
  const second = await acquireSingleFlightLock(lock)
  await second.release()
})

test('single-flight acquisition atomically replaces a provably dead owner', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-stale-lock-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const lock = path.join(root, 'active.lock')
  await fs.mkdir(lock)
  await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({
    acquiredAt: '2026-08-10T00:00:00.000Z',
    hostname: 'test-host',
    pid: 4242,
    processStartedAt: 'dead-owner-start',
    token: 'dead-owner'
  }))
  await fs.writeFile(path.join(lock, '.reaping.json'), JSON.stringify({
    claimedAt: '2026-08-10T00:01:00.000Z',
    pid: 4343,
    processStartedAt: 'dead-reaper-start',
    token: 'dead-reaper'
  }))
  const inspectedPids: number[] = []
  const lease = await acquireSingleFlightLock(lock, {}, {
    processStartedAt: (pid) => {
      inspectedPids.push(pid)
      return pid === process.pid ? 'current-process-start' : null
    }
  })
  assert.deepEqual(new Set(inspectedPids), new Set([process.pid, 4242, 4343]))
  const owner = JSON.parse(
    await fs.readFile(path.join(lock, 'owner.json'), 'utf8')
  ) as { token: string }
  assert.equal(owner.token, lease.token)
  assert.equal(
    (await fs.readdir(root)).filter((name) => name.includes('.stale.')).length,
    0
  )
  await lease.release()
})

test('single-flight acquisition recovers a reused live PID', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-reused-pid-lock-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const lock = path.join(root, 'active.lock')
  await fs.mkdir(lock)
  await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({
    acquiredAt: '2026-08-10T00:00:00.000Z',
    hostname: 'test-host',
    pid: 4242,
    processStartedAt: 'former-process-start',
    token: 'dead-owner'
  }))

  const lease = await acquireSingleFlightLock(lock, {}, {
    processStartedAt: (pid) => pid === process.pid
      ? 'gardener-process-start'
      : 'reused-process-start'
  })
  const owner = JSON.parse(
    await fs.readFile(path.join(lock, 'owner.json'), 'utf8')
  ) as { processStartedAt: string; token: string }
  assert.equal(owner.token, lease.token)
  assert.equal(owner.processStartedAt, 'gardener-process-start')
  await lease.release()
})

test('single-flight process identity is stable across caller timezones', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-timezone-lock-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const originalTimezone = process.env.TZ
  t.after(() => {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  })
  const lock = path.join(root, 'active.lock')
  process.env.TZ = 'America/Vancouver'
  const lease = await acquireSingleFlightLock(lock)
  process.env.TZ = 'Asia/Tokyo'
  await assert.rejects(acquireSingleFlightLock(lock), /already owns/)
  await lease.release()
})

test('adaptive context accepts only reachable Git data within strict bounds', async (t) => {
  const fixture = await createAuditRepository()
  t.after(() => fs.rm(fixture.repository, { recursive: true, force: true }))
  const blob = git(fixture.repository, ['rev-parse', `${fixture.target}:src/feature.ts`])
  const contexts = loadRequestedContext({
    repository: fixture.repository,
    requests: [
      { kind: 'path', reason: 'Read implementation detail', value: 'src/feature.ts' },
      { kind: 'git_object', reason: 'Verify exact blob', value: blob }
    ],
    target: fixture.target
  })
  assert.equal(contexts.length, 2)
  assert.equal(contexts[0]?.content.omitted, false)
  assert.equal(contexts[0].content.value, 'export const feature = true\n')
  const featureCommit = git(fixture.repository, [
    'rev-list', '-n', '1', fixture.target, '--', 'src/feature.ts'
  ])
  const laterTarget = await commitFile(
    fixture.repository,
    'src/feature.ts',
    'export const feature = false\n',
    'Replace historical feature evidence'
  )
  const historical = loadRequestedContext({
    repository: fixture.repository,
    requests: [{
      kind: 'path_at_commit',
      reason: 'Read the exact historical implementation',
      value: `${featureCommit}:src/feature.ts`
    }],
    target: laterTarget
  })
  assert.equal(historical[0]?.kind, 'path_at_commit')
  assert.equal(historical[0].content.omitted, false)
  assert.equal(historical[0].content.value, 'export const feature = true\n')
  assert.throws(() => loadRequestedContext({
    repository: fixture.repository,
    requests: [{ kind: 'path', reason: 'Escape', value: '../secret' }],
    target: fixture.target
  }), /Unsafe/)
  assert.throws(() => loadRequestedContext({
    repository: fixture.repository,
    requests: [{ kind: 'path', reason: 'Revision trick', value: ':/feature.ts' }],
    target: fixture.target
  }), /Unsafe/)
  assert.throws(() => loadRequestedContext({
    repository: fixture.repository,
    requests: [{
      kind: 'path_at_commit',
      reason: 'Escape historical tree',
      value: `${featureCommit}:../secret`
    }],
    target: laterTarget
  }), /Unsafe/)
  assert.throws(() => loadRequestedContext({
    repository: fixture.repository,
    requests: [{
      kind: 'path_at_commit',
      reason: 'Read unreachable history',
      value: `${'f'.repeat(40)}:src/feature.ts`
    }],
    target: laterTarget
  }), /not reachable/)
  assert.throws(() => loadRequestedContext({
    maxBytes: 1,
    repository: fixture.repository,
    requests: [{ kind: 'git_object', reason: 'Too large', value: blob }],
    target: fixture.target
  }), /limit is 1/)
})

test('bounded audit resolves context or emits an explicit ambiguity', async () => {
  const target = 'b'.repeat(40)
  const checkpoint = 'a'.repeat(40)
  const bundle = {
    checkpoint,
    commits: [],
    decisions: {
      content: `# Decision register\n\n${checkpointPrefix}${checkpoint} -->\n`,
      path: 'DECISIONS.md' as const,
      sha256: 'c'.repeat(64)
    },
    generatedAt: '2026-08-10T00:00:00.000Z',
    ownershipSnapshot: {},
    pathPrefixes: [],
    paths: [],
    schemaVersion: 1 as const,
    target,
    targetRef: 'origin/main'
  }
  const loaded: LoadedContext = {
    content: {
      bytes: 4,
      encoding: 'utf8',
      omitted: false,
      sha256: 'd'.repeat(64),
      value: 'test'
    },
    kind: 'path',
    object: 'e'.repeat(40),
    objectType: 'blob',
    request: { kind: 'path', reason: 'Need it', value: 'src/file.ts' }
  }
  const rounds: number[] = []
  const complete = await runBoundedAudit({
    bundle,
    invoke: ({ contexts, round }) => {
      rounds.push(round)
      return Promise.resolve(contexts.length === 0
        ? {
            contextRequests: [{ kind: 'path', reason: 'Need it', value: 'src/file.ts' }],
            proposedDecisions: null,
            report: emptyReport,
            schemaVersion: 1,
            status: 'needs_context'
          }
        : completeResult(bundle))
    },
    loadContext: () => Promise.resolve([loaded]),
    prompt: '# Audit'
  })
  assert.equal(complete.status, 'complete')
  assert.deepEqual(rounds, [0, 1])

  let attempts = 0
  const ambiguous = await runBoundedAudit({
    bundle,
    invoke: () => {
      attempts += 1
      return Promise.resolve({
        contextRequests: [{
          kind: 'path',
          reason: 'Still need it',
          value: `src/file-${String(attempts)}.ts`
        }],
        proposedDecisions: null,
        report: emptyReport,
        schemaVersion: 1,
        status: 'needs_context'
      })
    },
    loadContext: () => Promise.resolve([loaded]),
    maxContextRounds: 2,
    prompt: '# Audit'
  })
  assert.equal(attempts, 3)
  assert.equal(ambiguous.status, 'ambiguous')
  assert.match(ambiguous.report.summary, /could not resolve/)

  let repeatedAttempts = 0
  const repeated = await runBoundedAudit({
    bundle,
    invoke: () => {
      repeatedAttempts += 1
      return Promise.resolve({
        contextRequests: [{ kind: 'path', reason: 'Again', value: 'src/file.ts' }],
        proposedDecisions: null,
        report: emptyReport,
        schemaVersion: 1,
        status: 'needs_context'
      })
    },
    loadContext: () => Promise.resolve([loaded]),
    prompt: '# Audit'
  })
  assert.equal(repeatedAttempts, 2)
  assert.equal(repeated.status, 'ambiguous')
  assert.match(repeated.report.ambiguities[0]?.summary ?? '', /repeated/)

  let oversizedInvocations = 0
  const oversizedBundle = {
    ...bundle,
    decisions: {
      ...bundle.decisions,
      content: `# Decision register\n${'x'.repeat(2_000)}`
    }
  }
  const oversizedInput = { bundle: oversizedBundle, contexts: [], round: 0 }
  const oversizedPrompt = `# Audit\n\n${'p'.repeat(256)}`
  const unframedBytes = Buffer.byteLength(JSON.stringify(oversizedInput), 'utf8')
  const maxInputBytes = unframedBytes + 16
  assert.ok(unframedBytes <= maxInputBytes)
  assert.ok(
    Buffer.byteLength(buildDecisionGardenerInput(oversizedPrompt, oversizedInput), 'utf8') >
      maxInputBytes
  )
  const oversized = await runBoundedAudit({
    bundle: oversizedBundle,
    invoke: () => {
      oversizedInvocations += 1
      return Promise.resolve(completeResult(bundle))
    },
    loadContext: () => Promise.resolve([]),
    maxInputBytes,
    prompt: oversizedPrompt
  })
  assert.equal(oversizedInvocations, 0)
  assert.equal(oversized.status, 'ambiguous')
  assert.match(
    oversized.report.ambiguities[0]?.summary ?? '',
    new RegExp(`limit is ${String(maxInputBytes)}`)
  )
})

test('complete proposals advance the checkpoint and preserve unclassified entries', () => {
  const checkpoint = 'a'.repeat(40)
  const target = 'b'.repeat(40)
  const source = [
    '# Decision register',
    '',
    'Stable register introduction.',
    '',
    `${checkpointPrefix}${checkpoint} -->`,
    '',
    '## Stable decisions',
    '',
    '1. **Keep this entry.** Its original decision.',
    '   Supporting evidence remains here.',
    '',
    '2. **Keep another entry.** Its decision remains stable.',
    ''
  ].join('\n')
  const proposed = replaceDecisionCheckpoint(source, target)
  const result: AuditAgentResult = {
    contextRequests: [],
    proposedDecisions: proposed,
    report: emptyReport,
    schemaVersion: 1,
    status: 'complete'
  }
  assert.equal(
    validateCompleteProposal(result, source, target),
    result.proposedDecisions
  )
  assert.throws(
    () => validateCompleteProposal(result, source, 'c'.repeat(40)),
    /expected/
  )
  assert.throws(() => validateCompleteProposal({
    ...result,
    proposedDecisions: `# Decision register\n\n${checkpointPrefix}${target} -->\n`
  }, source, target), /removes the entry|document structure/)
  const changedProposal = proposed.replace(
    'Its original decision.',
    'Its revised decision.'
  )
  assert.throws(() => validateCompleteProposal({
    ...result,
    proposedDecisions: changedProposal
  }, source, target), /unclassified entry/)
  const classifiedResult: AuditAgentResult = {
    ...result,
    proposedDecisions: changedProposal,
    report: {
      ...emptyReport,
      classifications: [{
        classification: 'Revise',
        entry: 'Keep this entry.',
        evidence: ['commit:b'],
        reason: 'Landed behavior changed.'
      }]
    }
  }
  assert.equal(
    validateCompleteProposal(classifiedResult, source, target),
    changedProposal
  )
  const firstBlock = [
    '1. **Keep this entry.** Its original decision.',
    '   Supporting evidence remains here.',
    ''
  ].join('\n')
  const secondBlock = '2. **Keep another entry.** Its decision remains stable.\n'
  const reorderedProposal = proposed.replace(
    `${firstBlock}\n${secondBlock}`,
    `${secondBlock}${firstBlock}\n`
  )
  assert.throws(
    () => validateCompleteProposal({
      ...result,
      proposedDecisions: reorderedProposal
    }, source, target),
    /entry order/
  )
  assert.throws(() => validateAuditAgentResult({
    ...result,
    report: {
      ...result.report,
      ambiguities: [{ evidence: ['commit:a'], summary: 'Still unresolved.' }]
    }
  }), /must not contain unresolved ambiguities/)
})

test('Codex invocation disables tools, local instructions, network, and credentials', () => {
  const args = buildDecisionGardenerCodexArgs({
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    repository: '/repo',
    schemaPath: '/repo/output.schema.json'
  })
  for (const expected of [
    '--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config',
    '--json', 'read-only', 'approval_policy="never"', 'agents.enabled=false',
    'apps._default.enabled=false', 'web_search="disabled"',
    'tools.web_search=false', 'features.shell_tool=false',
    'shell_environment_policy.inherit="none"', 'project_doc_max_bytes=0',
    '--output-schema'
  ]) assert.ok(args.includes(expected), `missing ${expected}`)

  const environment = decisionGardenerChildEnvironment({
    CODEX_HOME: '/codex',
    GH_TOKEN: 'github-secret',
    GITHUB_TOKEN: 'another-secret',
    HOME: '/home',
    OPENAI_API_KEY: 'api-secret',
    PATH: '/bin'
  })
  assert.deepEqual(environment, {
    CODEX_HOME: '/codex',
    HOME: '/home',
    PATH: '/bin'
  })
})

test('Codex invocation force-kills after stdin EPIPE without crashing the host', async (t) => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-codex-epipe-'))
  t.after(() => fs.rm(repository, { recursive: true, force: true }))
  const executable = path.join(repository, 'fake-codex')
  await fs.writeFile(executable, [
    '#!/usr/bin/env python3',
    'import os, signal, time',
    'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
    'os.close(0)',
    'while True: time.sleep(1)',
    ''
  ].join('\n'), { mode: 0o755 })
  const bundle = {
    ...invocationBundle(),
    ownershipSnapshot: { padding: 'x'.repeat(1024 * 1024) }
  }
  const startedAt = Date.now()
  await assert.rejects(invokeDecisionGardenerCodex({
    codex: executable,
    input: { bundle, contexts: [], round: 0 },
    model: 'test-model',
    prompt: '# Test',
    repository,
    schemaPath: path.join(repository, 'schema.json'),
    terminationGraceMs: 100,
    timeoutMs: 1_000
  }), /closed stdin/)
  const elapsed = Date.now() - startedAt
  assert.ok(elapsed >= 90)
  assert.ok(elapsed < 2_000)
})

test('Codex invocation force-kills a child that ignores its timeout', async (t) => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-codex-timeout-'))
  t.after(() => fs.rm(repository, { recursive: true, force: true }))
  const executable = path.join(repository, 'fake-codex')
  await fs.writeFile(executable, [
    '#!/usr/bin/env python3',
    'import signal, sys, time',
    'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
    'sys.stdin.buffer.read()',
    'while True: time.sleep(1)',
    ''
  ].join('\n'), { mode: 0o755 })
  const startedAt = Date.now()
  await assert.rejects(invokeDecisionGardenerCodex({
    codex: executable,
    input: { bundle: invocationBundle(), contexts: [], round: 0 },
    model: 'test-model',
    prompt: '# Test',
    repository,
    schemaPath: path.join(repository, 'schema.json'),
    terminationGraceMs: 100,
    timeoutMs: 500
  }), /timed out after 500 ms/)
  const elapsed = Date.now() - startedAt
  assert.ok(elapsed >= 590)
  assert.ok(elapsed < 2_000)
})

test('Codex invocation bounds stdout and stderr from a child that will not exit', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-codex-output-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  for (const stream of ['stdout', 'stderr'] as const) {
    const repository = path.join(root, stream)
    await fs.mkdir(repository)
    const executable = path.join(repository, 'fake-codex')
    await fs.writeFile(executable, [
      '#!/usr/bin/env python3',
      'import signal, sys, time',
      'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
      `sys.${stream}.write('x' * 2048)`,
      `sys.${stream}.flush()`,
      'while True: time.sleep(1)',
      ''
    ].join('\n'), { mode: 0o755 })
    const startedAt = Date.now()
    await assert.rejects(invokeDecisionGardenerCodex({
      codex: executable,
      input: { bundle: invocationBundle(), contexts: [], round: 0 },
      maxStderrBytes: 1024,
      maxStdoutBytes: 1024,
      model: 'test-model',
      prompt: '# Test',
      repository,
      schemaPath: path.join(repository, 'schema.json'),
      terminationGraceMs: 100,
      timeoutMs: 1_000
    }), new RegExp(`${stream} exceeded the 1024 byte limit`))
    const elapsed = Date.now() - startedAt
    assert.ok(elapsed >= 90)
    assert.ok(elapsed < 2_000)
  }
})

test('Codex JSONL parser rejects tool activity and accepts one schema result', () => {
  const result: AuditAgentResult = {
    contextRequests: [],
    proposedDecisions: null,
    report: {
      ...emptyReport,
      ambiguities: [{ evidence: ['commit:a'], summary: 'Direction is unclear.' }]
    },
    schemaVersion: 1,
    status: 'ambiguous'
  }
  const source = [
    JSON.stringify({ type: 'thread.started', thread_id: 'thread' }),
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: JSON.stringify(result) }
    }),
    JSON.stringify({ type: 'turn.completed' })
  ].join('\n')
  assert.deepEqual(parseCodexAuditJsonl(source), result)
  assert.throws(() => parseCodexAuditJsonl(JSON.stringify({
    type: 'item.completed',
    item: { type: 'command_execution', command: 'git status' }
  })), /forbidden tool activity/)
})

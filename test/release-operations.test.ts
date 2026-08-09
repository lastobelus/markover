import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  compareReleasePayloads,
  developerIdReadiness,
  generateReleaseNotes,
  githubReleaseReadiness,
  parseStableSemver,
  publicationTurnReadiness,
  primaryReleaseAssets,
  releaseAssets,
  verifyDraftRelease,
  verifyReleasePayloads,
  verifyRollbackTarget,
  verifyReleaseTag,
  type ReleaseCommandResult,
  type ReleaseCommandRunner
} from '../scripts/release-operations'

function success(stdout = ''): ReleaseCommandResult {
  return { status: 0, stdout, stderr: '' }
}

async function createRoot(version = '1.2.3'): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-release-root-'))
  await fs.mkdir(path.join(directory, 'packages/cli'), { recursive: true })
  await fs.writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ version })
  )
  await fs.writeFile(
    path.join(directory, 'packages/cli/package.json'),
    JSON.stringify({ version })
  )
  return directory
}

async function createPayloads(directory: string, suffix = ''): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  for (const name of primaryReleaseAssets) {
    const bytes = Buffer.from(`${name}${suffix}`)
    const digest = crypto.createHash('sha256').update(bytes).digest('hex')
    await fs.writeFile(path.join(directory, name), bytes)
    await fs.writeFile(
      path.join(directory, `${name}.sha256`),
      `${digest}  ${name}\n`
    )
  }
}

function releaseTagRunner({
  checkApp = 'github-actions',
  checks = ['Verify (Node 24)'],
  latestTag = 'v1.2.2',
  newestTag = latestTag,
  stableTags = [newestTag]
}: {
  checkApp?: string
  checks?: string[]
  latestTag?: string
  newestTag?: string
  stableTags?: string[]
} = {}): ReleaseCommandRunner {
  return (command, args) => {
    if (command === 'git') {
      return args[0] === 'tag'
        ? success(`${stableTags.join('\n')}\n`)
        : success()
    }
    const endpoint = args.at(-1) ?? ''
    if (endpoint.includes('/releases?')) {
      return success(JSON.stringify([[
        { draft: false, prerelease: false, tag_name: newestTag },
        { draft: false, prerelease: false, tag_name: latestTag },
        { draft: true, prerelease: false, tag_name: 'v9.0.0' },
        { draft: false, prerelease: true, tag_name: 'v8.0.0-beta.1' }
      ]]))
    }
    if (endpoint.endsWith('/releases/latest')) {
      return success(JSON.stringify({
        draft: false,
        prerelease: false,
        tag_name: latestTag
      }))
    }
    if (endpoint.includes('/check-runs?')) {
      return success(JSON.stringify({
        check_runs: checks.map((name) => ({
          app: { slug: checkApp },
          conclusion: 'success',
          name
        }))
      }))
    }
    return { status: 127, stdout: '', stderr: `unexpected ${command} ${args.join(' ')}` }
  }
}

test('stable release tags are monotonic, on main, and CI-qualified', async (t) => {
  const root = await createRoot()
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  assert.deepEqual(parseStableSemver('1.2.3'), {
    major: 1,
    minor: 2,
    patch: 3,
    version: '1.2.3'
  })
  assert.throws(() => parseStableSemver('1.2.3-beta.1'), /stable SemVer/)
  assert.throws(() => parseStableSemver('01.2.3'), /stable SemVer/)

  const report = verifyReleaseTag({
    commit: 'abc123',
    mainRef: 'origin/main',
    repository: 'example/markover',
    rootDirectory: root,
    runner: releaseTagRunner(),
    tag: 'v1.2.3'
  })
  assert.equal(report.previousTag, 'v1.2.2')
  assert.equal(report.version, '1.2.3')

  assert.throws(() => verifyReleaseTag({
    commit: 'abc123',
    mainRef: 'origin/main',
    repository: 'example/markover',
    rootDirectory: root,
    runner: releaseTagRunner({ newestTag: 'v1.2.3' }),
    tag: 'v1.2.3'
  }), /must be newer/)
  assert.throws(() => verifyReleaseTag({
    commit: 'abc123',
    mainRef: 'origin/main',
    repository: 'example/markover',
    rootDirectory: root,
    runner: releaseTagRunner({ checks: [] }),
    tag: 'v1.2.3'
  }), /Verify \(Node 24\)/)
  assert.throws(() => verifyReleaseTag({
    commit: 'abc123',
    mainRef: 'origin/main',
    repository: 'example/markover',
    rootDirectory: root,
    runner: releaseTagRunner({ checkApp: 'untrusted-check-app' }),
    tag: 'v1.2.3'
  }), /Verify \(Node 24\)/)

  const afterWithdrawal = verifyReleaseTag({
    commit: 'abc123',
    mainRef: 'origin/main',
    repository: 'example/markover',
    rootDirectory: root,
    runner: releaseTagRunner({ latestTag: 'v1.2.1', newestTag: 'v1.2.2' }),
    tag: 'v1.2.3'
  })
  assert.equal(afterWithdrawal.previousTag, 'v1.2.1')

  assert.throws(() => verifyReleaseTag({
    commit: 'abc123',
    mainRef: 'origin/main',
    repository: 'example/markover',
    rootDirectory: root,
    runner: releaseTagRunner({
      latestTag: 'v1.2.1',
      newestTag: 'v1.2.1',
      stableTags: ['v1.2.1', 'v2.0.0']
    }),
    tag: 'v1.2.3'
  }), /newest is v2\.0\.0/)
})

test('publication revalidates rollback and waits for every older release run', () => {
  assert.equal(verifyRollbackTarget({
    expectedTag: 'v1.2.2',
    repository: 'example/markover',
    runner: releaseTagRunner()
  }), 'v1.2.2')
  assert.throws(() => verifyRollbackTarget({
    expectedTag: 'v1.2.2',
    repository: 'example/markover',
    runner: releaseTagRunner({ latestTag: 'v1.2.1' })
  }), /changed from v1\.2\.2 to v1\.2\.1/)

  const queueRunner = (runs: unknown[]): ReleaseCommandRunner => (
    command,
    args
  ) => {
    const endpoint = args.at(-1) ?? ''
    if (
      command === 'gh' &&
      endpoint.includes('/actions/workflows/release.yml/runs?')
    ) {
      return success(JSON.stringify([{ workflow_runs: runs }]))
    }
    return {
      status: 127,
      stdout: '',
      stderr: `unexpected ${command} ${args.join(' ')}`
    }
  }
  const ready = publicationTurnReadiness({
    repository: 'example/markover',
    runId: '42',
    runner: queueRunner([
      { id: 41, status: 'completed', head_branch: 'v1.2.2' },
      { id: 43, status: 'in_progress', head_branch: 'v1.2.4' }
    ])
  })
  assert.equal(ready.state, 'ready')

  const blocked = publicationTurnReadiness({
    repository: 'example/markover',
    runId: '42',
    runner: queueRunner([
      { id: 40, status: 'in_progress', head_branch: 'v1.2.1' },
      { id: 41, status: 'queued', head_branch: 'v1.2.2' }
    ])
  })
  assert.equal(blocked.state, 'blocked')
  assert.match(blocked.checks[0]?.detail ?? '', /v1\.2\.1 \(#40\)/)
  assert.match(blocked.checks[0]?.detail ?? '', /v1\.2\.2 \(#41\)/)
})

test('release payload verification requires exact bytes and sidecars', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-payloads-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await createPayloads(directory)

  const report = await verifyReleasePayloads(directory)
  assert.deepEqual(
    report.payloads.map((payload) => payload.name),
    [...primaryReleaseAssets]
  )
  await fs.writeFile(
    path.join(directory, 'markover-cli.tgz.sha256'),
    `${'0'.repeat(64)}  markover-cli.tgz\n`
  )
  await assert.rejects(verifyReleasePayloads(directory), /does not exactly match/)
})

test('release payload verification rejects an added Intel archive', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-payloads-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await createPayloads(directory)
  await fs.writeFile(path.join(directory, 'Markover-darwin-x64.zip'), 'deferred')
  await fs.writeFile(
    path.join(directory, 'Markover-darwin-x64.zip.sha256'),
    `${'0'.repeat(64)}  Markover-darwin-x64.zip\n`
  )

  await assert.rejects(
    verifyReleasePayloads(directory),
    /Release payload set must contain exactly/
  )
})

test('publication comparison rejects changed draft assets', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-compare-'))
  const expected = path.join(root, 'expected')
  const actual = path.join(root, 'actual')
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await createPayloads(expected)
  await createPayloads(actual)

  await compareReleasePayloads(expected, actual)
  await createPayloads(actual, '-changed')
  await assert.rejects(
    compareReleasePayloads(expected, actual),
    /changed after staging/
  )
})

test('generated release notes disclose provenance, trust, and rollback', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-notes-'))
  const payloads = path.join(root, 'payloads')
  const verification = path.join(payloads, 'verification')
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await createPayloads(payloads)
  await fs.mkdir(verification)
  const common = [
    'electron=43.2.0',
    'node=v22.13.0',
    'npm=10.0.0',
    'os=macOS 15.6',
    'runner=GitHub Actions'
  ]
  await fs.writeFile(
    path.join(verification, 'macos-arm64.txt'),
    ['architecture=arm64', ...common, 'xcode=Xcode 16.4'].join('\n') + '\n'
  )
  await fs.writeFile(
    path.join(verification, 'cli.txt'),
    [
      'architecture=portable',
      'electron=43.2.0',
      'node=v22.13.0',
      'npm=10.0.0',
      'os=Linux',
      'runner=GitHub Actions'
    ].join('\n') + '\n'
  )

  const notes = await generateReleaseNotes({
    commit: 'abc123',
    directory: payloads,
    previousTag: 'v1.2.2',
    repository: 'example/markover',
    runId: '42',
    tag: 'v1.2.3',
    verificationDirectory: verification
  })
  assert.match(notes, /not Apple-verified/i)
  assert.match(notes, /Apple Silicon only/)
  assert.match(notes, /issue #80/)
  assert.doesNotMatch(notes, /Markover-darwin-x64/)
  assert.match(notes, /gh attestation verify/)
  assert.match(notes, /--source-digest abc123/)
  assert.match(notes, /--source-ref refs\/tags\/v1\.2\.3/)
  assert.match(notes, /--deny-self-hosted-runners/)
  assert.match(notes, /do not claim bit-for-bit reproducibility/)
  assert.match(notes, /releases\/download\/v1\.2\.2\/markover-cli\.tgz/)
  assert.match(notes, /Application Support\/Markover/)
  for (const name of primaryReleaseAssets) assert.match(notes, new RegExp(name))

  await assert.rejects(generateReleaseNotes({
    commit: 'abc123',
    directory: payloads,
    previousTag: 'v1.2.2',
    repository: 'example/markover',
    runId: '42',
    tag: '1.2.3',
    verificationDirectory: verification
  }), /v-prefixed/)
})

test('draft verification freezes metadata and the complete asset set', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-draft-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const notesPath = path.join(root, 'notes.md')
  const releasePath = path.join(root, 'release.json')
  await fs.writeFile(notesPath, '# notes\n')
  const release = {
    tag_name: 'v1.2.3',
    target_commitish: 'main',
    name: 'Markover v1.2.3',
    body: '# notes\n',
    draft: true,
    prerelease: false,
    assets: releaseAssets.map((name) => ({ name }))
  }
  await fs.writeFile(releasePath, JSON.stringify(release))
  await verifyDraftRelease({
    notesPath,
    releasePath,
    tag: 'v1.2.3'
  })

  await fs.writeFile(releasePath, JSON.stringify({ ...release, body: 'changed' }))
  await assert.rejects(verifyDraftRelease({
    notesPath,
    releasePath,
    tag: 'v1.2.3'
  }), /metadata changed/)
})

function readinessRunner(
  configured: boolean,
  tagExcludes: readonly string[] = []
): ReleaseCommandRunner {
  return (_command, args) => {
    const endpoint = args.at(-1) ?? ''
    if (endpoint.endsWith('/immutable-releases')) {
      return success(JSON.stringify({ enabled: configured }))
    }
    if (endpoint.endsWith('/environments/release')) {
      if (!configured) {
        return {
          status: 1,
          stdout: '',
          stderr: '{"message":"Not Found","status":"404"}'
        }
      }
      return success(JSON.stringify({
        deployment_branch_policy: {
          custom_branch_policies: true,
          protected_branches: false
        },
        protection_rules: [{
          type: 'required_reviewers',
          prevent_self_review: false,
          reviewers: [{ reviewer: { login: 'example' }, type: 'User' }]
        }]
      }))
    }
    if (endpoint.includes('/deployment-branch-policies?')) {
      return success(JSON.stringify({
        total_count: 1,
        branch_policies: [{ id: 9, name: 'v*', type: 'tag' }]
      }))
    }
    if (endpoint.includes('/rulesets?')) {
      return success(JSON.stringify([configured
        ? [
            { id: 7, target: 'tag', enforcement: 'active' },
            { id: 8, target: 'tag', enforcement: 'active' }
          ]
        : []]))
    }
    if (endpoint.endsWith('users/example')) {
      return success(JSON.stringify({ id: 123, login: 'example' }))
    }
    if (endpoint.endsWith('/rulesets/7')) {
      return success(JSON.stringify({
        conditions: {
          ref_name: { include: ['refs/tags/v*'], exclude: tagExcludes }
        },
        rules: [
          { type: 'creation' },
          { type: 'update' },
          { type: 'deletion' }
        ],
        bypass_actors: [{
          actor_type: 'User',
          actor_id: 123,
          bypass_mode: 'always'
        }]
      }))
    }
    if (endpoint.endsWith('/rulesets/8')) {
      return success(JSON.stringify({
        conditions: {
          ref_name: { include: ['refs/tags/v*'], exclude: tagExcludes }
        },
        rules: [{ type: 'update' }, { type: 'deletion' }],
        bypass_actors: []
      }))
    }
    return { status: 127, stdout: '', stderr: `unexpected ${endpoint}` }
  }
}

test('readiness distinguishes configured, blocked, and future signing states', () => {
  const ready = githubReleaseReadiness('example/markover', readinessRunner(true))
  assert.equal(ready.state, 'ready')
  assert.equal(ready.checks.every((check) => check.state === 'ready'), true)

  const blocked = githubReleaseReadiness('example/markover', readinessRunner(false))
  assert.equal(blocked.state, 'blocked')
  assert.equal(blocked.checks.some((check) => check.detail === 'missing'), true)

  const signing = developerIdReadiness()
  assert.equal(signing.state, 'blocked')
  assert.match(signing.checks[0]?.detail ?? '', /ad-hoc signing only/)
})

test('readiness fails when a matching ruleset cannot be inspected', () => {
  const runner = readinessRunner(true)
  const report = githubReleaseReadiness('example/markover', (command, args) => {
    if ((args.at(-1) ?? '').endsWith('/rulesets/7')) {
      return { status: 1, stdout: '', stderr: 'ruleset detail unavailable' }
    }
    return runner(command, args)
  })
  assert.equal(report.state, 'failed')
  assert.equal(
    report.checks.find((check) => check.name === 'Protected v* tags')?.state,
    'failed'
  )
})

test('readiness rejects release-tag rulesets with exclusions', () => {
  const report = githubReleaseReadiness(
    'example/markover',
    readinessRunner(true, ['refs/tags/v1.2.3'])
  )
  assert.equal(report.state, 'blocked')
  assert.equal(
    report.checks.find((check) => check.name === 'Protected v* tags')?.state,
    'blocked'
  )
})

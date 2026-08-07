import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  assertEquivalentAppBundle,
  parsePackagedSmokeOptions,
  runPackagedSmoke,
  type PackagedSmokeDependencies,
  type PackagedSmokeOptions
} from '../scripts/smoke-packaged'
import type { ReviewArtifact } from '../src/review-store'

const smokeSource = [
  '# Markover packaged smoke review',
  '',
  'This review proves the saved packaged happy path.',
  'It does not assert adversarial authorization or bounded-loss durability.',
  ''
].join('\n')

function reviewArtifact(reviewId: string): ReviewArtifact {
  return {
    format: 'markover-review',
    version: 1,
    sourceDocument: {
      name: 'markover-packaged-smoke.md',
      path: '/tmp/markover-packaged-smoke.md',
      content: smokeSource,
      checksum: 'sha256:smoke'
    },
    unsupported: [],
    root: {
      id: 'document',
      type: 'document',
      text: 'Document',
      raw: smokeSource,
      lineStart: 1,
      lineEnd: 4,
      feedback: '',
      collapsed: false,
      children: []
    },
    review: {
      id: reviewId,
      status: 'editing',
      createdAt: '2026-08-06T12:00:00.000Z',
      updatedAt: '2026-08-06T12:00:00.000Z',
      contextSummary: 'Packaged smoke',
      agentThread: null,
      git: null,
      pullRequest: null,
      agentGuidance: {
        fixedContract: 'fixture',
        interpretationPolicy: 'fixture'
      }
    }
  }
}

function options(
  evidencePath: string,
  architecture: 'arm64' | 'x64' = 'arm64'
): PackagedSmokeOptions {
  return {
    architecture,
    archivePath: `/artifact/Markover-darwin-${architecture}.zip`,
    checksumPath: `/artifact/Markover-darwin-${architecture}.zip.sha256`,
    evidenceKind: 'ci',
    evidencePath,
    trustMode: 'ad-hoc',
    version: '0.1.1'
  }
}

function dependencies(
  calls: string[],
  architecture: 'arm64' | 'x64'
): PackagedSmokeDependencies {
  let start = 0
  return {
    serviceRunning: () => Promise.resolve(false),
    verifyArtifact(input) {
      calls.push(`verify:${input.architecture}`)
      return Promise.resolve({
        architecture,
        gatekeeper: 'rejected-as-expected',
        sha256: architecture === 'arm64' ? 'a'.repeat(64) : 'b'.repeat(64),
        trustMode: 'ad-hoc',
        version: '0.1.1'
      })
    },
    prepareApp() {
      calls.push('extract')
      return Promise.resolve({
        appPath: '/artifact/Markover.app',
        provided: false,
        cleanup: () => {
          calls.push('cleanup')
          return Promise.resolve()
        }
      })
    },
    quarantinePresent: () => false,
    host: () => ({
      architecture: architecture === 'arm64' ? 'arm64' : 'x86_64',
      macosVersion: '15.6',
      model: 'GitHubActionsMac',
      runner: `macos-${architecture}`,
      translated: false
    }),
    startApp(_appPath, _endpointPath, previousPid) {
      start += 1
      calls.push(`start:${String(previousPid)}`)
      return Promise.resolve({
        version: 2,
        instanceId: start === 1
          ? '00000000-0000-4000-8000-000000000001'
          : '00000000-0000-4000-8000-000000000002',
        port: 9000 + start,
        pid: 100 + start
      })
    },
    stopApp(_endpointPath, _timeoutMilliseconds, expectedPid) {
      calls.push(`stop:${String(expectedPid)}`)
      return Promise.resolve()
    },
    openReview() {
      calls.push('open')
      return Promise.resolve('mko_smoke001')
    },
    loadReview(reviewId) {
      calls.push('load')
      return Promise.resolve(reviewArtifact(reviewId))
    },
    handoffAndReopen(_endpointPath, reviewId) {
      calls.push(`get-edit:${reviewId}`)
      return Promise.resolve()
    },
    now: () => new Date('2026-08-06T12:34:56.000Z'),
    revision: () => '1'.repeat(40)
  }
}

test('packaged smoke parses its explicit evidence contract', () => {
  assert.deepEqual(parsePackagedSmokeOptions([
    '--architecture=x64',
    '--archive=/tmp/Markover-darwin-x64.zip',
    '--checksum=/tmp/Markover-darwin-x64.zip.sha256',
    '--evidence=/tmp/evidence.json',
    '--evidence-kind=clean-intel-sonoma',
    '--app=/Applications/Markover.app',
    '--launch-timeout-ms=180000',
    '--trust-mode=ad-hoc',
    '--version=0.1.2'
  ]), {
    appPath: '/Applications/Markover.app',
    architecture: 'x64',
    archivePath: '/tmp/Markover-darwin-x64.zip',
    checksumPath: '/tmp/Markover-darwin-x64.zip.sha256',
    evidenceKind: 'clean-intel-sonoma',
    evidencePath: '/tmp/evidence.json',
    launchTimeoutMilliseconds: 180000,
    trustMode: 'ad-hoc',
    version: '0.1.2'
  })
  assert.throws(
    () => parsePackagedSmokeOptions(['--architecture=arm64']),
    /Missing argument: --archive/
  )
  assert.throws(
    () => parsePackagedSmokeOptions([
      '--architecture=arm64',
      '--archive=a',
      '--checksum=b',
      '--evidence=c',
      '--launch-timeout-ms=999',
      '--trust-mode=ad-hoc',
      '--version=0.1.1'
    ]),
    /1000 to 600000/
  )
})

test('provided app must be byte-equivalent to the verified archive app', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-app-equivalence-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const reference = path.join(directory, 'reference', 'Markover.app')
  const provided = path.join(directory, 'provided', 'Markover.app')
  for (const appPath of [reference, provided]) {
    await fs.mkdir(path.join(appPath, 'Contents', 'MacOS'), { recursive: true })
    await fs.writeFile(
      path.join(appPath, 'Contents', 'MacOS', 'Markover'),
      'exact executable bytes',
      { mode: 0o755 }
    )
    await fs.symlink(
      'Versions/Current/Electron Framework',
      path.join(appPath, 'Contents', 'Framework')
    )
  }

  await assertEquivalentAppBundle(reference, provided)
  await fs.writeFile(
    path.join(provided, 'Contents', 'MacOS', 'Markover'),
    'different executable bytes',
    { mode: 0o755 }
  )
  await assert.rejects(
    assertEquivalentAppBundle(reference, provided),
    /differs from the verified archive at Markover\.app\/Contents\/MacOS\/Markover/
  )
})

test('a launch that times out is still stopped and cleaned up', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-startup-cleanup-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const calls: string[] = []
  const deps = dependencies(calls, 'arm64')
  deps.startApp = (
    _appPath,
    _endpointPath,
    _previousPid,
    _timeoutMilliseconds,
    onLaunch
  ) => {
    calls.push('start-failed')
    onLaunch()
    return Promise.reject(new Error('readiness timed out'))
  }

  await assert.rejects(
    runPackagedSmoke(options(path.join(directory, 'evidence.json')), deps),
    /readiness timed out/
  )
  assert.deepEqual(calls, [
    'verify:arm64',
    'extract',
    'start-failed',
    'stop:null',
    'cleanup'
  ])
})

for (const architecture of ['arm64', 'x64'] as const) {
  test(`packaged ${architecture} smoke records only the saved happy path`, async (t) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), `markover-packaged-${architecture}-`)
    )
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const evidencePath = path.join(directory, 'evidence.json')
    const calls: string[] = []
    const report = await runPackagedSmoke(
      options(evidencePath, architecture),
      dependencies(calls, architecture)
    )

    assert.equal(report.artifact.architecture, architecture)
    assert.equal(report.artifact.appleVerified, false)
    assert.equal(report.artifact.notarized, false)
    assert.equal(report.cleanMachine, false)
    assert.deepEqual(report.exclusions, [
      'adversarial-authorization',
      'bounded-loss-durability'
    ])
    assert.deepEqual(calls, [
      `verify:${architecture}`,
      'extract',
      'start:null',
      'open',
      'load',
      'stop:101',
      'start:101',
      'load',
      'get-edit:mko_smoke001',
      'load',
      'stop:102',
      'cleanup'
    ])
    assert.deepEqual(
      JSON.parse(await fs.readFile(evidencePath, 'utf8')),
      report
    )
    assert.equal((await fs.stat(evidencePath)).mode & 0o777, 0o600)
  })
}

test('clean Intel evidence is admitted only on installed quarantined Sonoma x64', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-clean-intel-contract-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const evidencePath = path.join(directory, 'evidence.json')
  const calls: string[] = []
  const deps = dependencies(calls, 'x64')
  deps.prepareApp = () => Promise.resolve({
    appPath: '/Applications/Markover.app',
    provided: true,
    cleanup: () => Promise.resolve()
  })
  deps.quarantinePresent = () => true
  deps.host = () => ({
    architecture: 'x86_64',
    macosVersion: '14.7.7',
    model: 'MacBookPro16,1',
    runner: null,
    translated: false
  })

  const report = await runPackagedSmoke({
    ...options(evidencePath, 'x64'),
    appPath: '/Applications/Markover.app',
    evidenceKind: 'clean-intel-sonoma'
  }, deps)
  assert.equal(report.cleanMachine, true)
  assert.deepEqual(report.cleanIntel, {
    quarantinePresent: true,
    gatekeeperOverrideExercised: true,
    rollbackVerified: false
  })

  await assert.rejects(
    runPackagedSmoke({
      ...options(path.join(directory, 'bad.json'), 'x64'),
      appPath: '/Applications/Markover.app',
      evidenceKind: 'clean-intel-sonoma'
    }, {
      ...deps,
      host: () => ({
        architecture: 'x86_64',
        macosVersion: '15.0',
        model: 'MacBookPro16,1',
        runner: null,
        translated: false
      })
    }),
    /requires macOS 14 Sonoma/
  )

  await assert.rejects(
    runPackagedSmoke({
      ...options(path.join(directory, 'rosetta.json'), 'x64'),
      appPath: '/Applications/Markover.app',
      evidenceKind: 'clean-intel-sonoma'
    }, {
      ...deps,
      host: () => ({
        architecture: 'x86_64',
        macosVersion: '14.7.7',
        model: 'MacBookPro18,3',
        runner: null,
        translated: true
      })
    }),
    /cannot run under Rosetta translation/
  )
})

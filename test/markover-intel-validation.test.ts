import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  cleanupInterruptedPackagedSmoke,
  environmentFailure,
  formatIntelValidationSummary,
  intelValidationReport,
  isPackagedSmokeExecutable,
  INTEL_VALIDATION_COMMAND_VERSION,
  runningMarkoverFailure,
  validatePackagedSmokeEvidence,
  type IntelValidationHost
} from '../scripts/markover-intel-validation'

const HEAD = '1'.repeat(40)
const SHA256 = '2'.repeat(64)

function host(overrides: Partial<IntelValidationHost> = {}): IntelValidationHost {
  return {
    architecture: 'x86_64',
    translated: false,
    macosVersion: '14.8.9',
    model: 'MacBookPro15,3',
    node: 'v22.13.0',
    npm: '10.9.2',
    xcode: 'Xcode 16.2 Build version 16C5032a',
    ...overrides
  }
}

function serviceConnection(executablePath: string, startupReady = true) {
  return {
    credential: { version: 1 as const, instanceId: 'a', token: 'b' },
    endpoint: {
      version: 2 as const,
      instanceId: 'f1eeb5a7-c844-4b07-a19b-d5516d7a01e4',
      port: 58139,
      pid: 90371
    },
    executablePath,
    startupReady,
    windowVisible: false
  }
}

function smokeExecutable(temporaryDirectory: string): string {
  return path.join(
    temporaryDirectory,
    'markover-packaged-smoke-123',
    'Markover.app',
    'Contents',
    'MacOS',
    'Markover'
  )
}

test('requires a native Intel macOS environment and supported Node', () => {
  assert.equal(environmentFailure('darwin', 'x64', host()), null)
  assert.match(environmentFailure('linux', 'x64', host()) || '', /requires macOS/)
  assert.match(
    environmentFailure('darwin', 'arm64', host({ architecture: 'arm64' })) || '',
    /native x64 Node/
  )
  assert.match(
    environmentFailure('darwin', 'x64', host({ translated: true })) || '',
    /Rosetta/
  )
  assert.match(
    environmentFailure('darwin', 'x64', host({ node: 'v22.12.0' })) || '',
    /22\.13\.0 or newer/
  )
  assert.equal(environmentFailure('darwin', 'x64', host({ node: 'v26.8.1' })), null)
})

test('refuses to disturb an existing Markover process', () => {
  const endpoint = {
    version: 2,
    instanceId: 'f1eeb5a7-c844-4b07-a19b-d5516d7a01e4',
    port: 58139,
    pid: 90371
  }
  assert.match(
    runningMarkoverFailure(endpoint, () => true) || '',
    /PID 90371.*will not stop an existing app/
  )
  assert.equal(runningMarkoverFailure(endpoint, () => false), null)
  assert.equal(runningMarkoverFailure({ version: 1 }, () => true), null)
})

test('recognizes only the temporary packaged smoke executable', () => {
  const temporaryDirectory = '/private/var/folders/markover-test'
  assert.equal(isPackagedSmokeExecutable(
    smokeExecutable(temporaryDirectory),
    temporaryDirectory
  ), true)
  assert.equal(isPackagedSmokeExecutable(
    '/Applications/Markover.app/Contents/MacOS/Markover',
    temporaryDirectory
  ), false)
  assert.equal(isPackagedSmokeExecutable(
    path.join(temporaryDirectory, 'other', 'Markover.app', 'Contents', 'MacOS', 'Markover'),
    temporaryDirectory
  ), false)
})

test('gracefully stops only an interrupted packaged smoke process', async () => {
  const temporaryDirectory = '/private/var/folders/markover-test'
  let alive = true
  let quitCalls = 0
  const detail = await cleanupInterruptedPackagedSmoke({
    endpointPath: '/tmp/service.json',
    temporaryDirectory,
    probe: () => Promise.resolve(serviceConnection(
      smokeExecutable(temporaryDirectory)
    )),
    quit: () => {
      quitCalls += 1
      alive = false
      return Promise.resolve()
    },
    isProcessAlive: () => alive
  })
  assert.equal(detail, 'Stopped interrupted packaged smoke process 90371.')
  assert.equal(quitCalls, 1)
})

test('waits for an interrupted packaged smoke app to publish its endpoint', async () => {
  const temporaryDirectory = '/private/var/folders/markover-test'
  let probes = 0
  let currentTime = 0
  let alive = true
  const detail = await cleanupInterruptedPackagedSmoke({
    temporaryDirectory,
    now: () => currentTime,
    wait: (milliseconds) => {
      currentTime += milliseconds
      return Promise.resolve()
    },
    probe: () => {
      probes += 1
      if (probes === 1) return Promise.reject(new Error('not ready'))
      return Promise.resolve(serviceConnection(
        smokeExecutable(temporaryDirectory),
        false
      ))
    },
    quit: () => {
      alive = false
      return Promise.resolve()
    },
    isProcessAlive: () => alive
  })
  assert.equal(probes, 2)
  assert.equal(detail, 'Stopped interrupted packaged smoke process 90371.')
})

test('does not quit an unrelated running Markover app after interruption', async () => {
  let quitCalls = 0
  const detail = await cleanupInterruptedPackagedSmoke({
    temporaryDirectory: '/private/var/folders/markover-test',
    probe: () => Promise.resolve(serviceConnection(
      '/Applications/Markover.app/Contents/MacOS/Markover'
    )),
    quit: () => {
      quitCalls += 1
      return Promise.resolve()
    }
  })
  assert.equal(detail, null)
  assert.equal(quitCalls, 0)
})

test('accepts only exact local packaged smoke evidence', () => {
  const evidence = {
    format: 'markover-packaged-smoke-evidence',
    version: 1,
    status: 'passed',
    sourceCommit: HEAD,
    evidenceKind: 'local',
    cleanMachine: false,
    artifact: { architecture: 'x64', sha256: SHA256, trustMode: 'ad-hoc' },
    review: { id: 'mko_12345678', preserved: true }
  }
  assert.deepEqual(
    validatePackagedSmokeEvidence(evidence, { head: HEAD, sha256: SHA256 }),
    { reviewId: 'mko_12345678' }
  )
  assert.throws(
    () => validatePackagedSmokeEvidence(
      { ...evidence, cleanMachine: true },
      { head: HEAD, sha256: SHA256 }
    ),
    /does not match/
  )
  assert.throws(
    () => validatePackagedSmokeEvidence(
      { ...evidence, cleanMachine: null },
      { head: HEAD, sha256: SHA256 }
    ),
    /does not match/
  )
  assert.throws(
    () => validatePackagedSmokeEvidence(
      { ...evidence, sourceCommit: '3'.repeat(40) },
      { head: HEAD, sha256: SHA256 }
    ),
    /does not match/
  )
})

test('puts compact JSON on the final summary line', () => {
  const summary = formatIntelValidationSummary({
    outcome: 'target-drifted',
    repository: 'lastobelus/markover',
    head: HEAD,
    base: '3'.repeat(40),
    baseRef: 'origin/main',
    commandVersion: INTEL_VALIDATION_COMMAND_VERSION,
    durationMs: 12,
    stages: []
  })
  assert.match(summary, /^\[run-intel-validation\] Summary: \{"outcome":"target-drifted"/)
  assert.equal(summary.includes('\n'), false)
})

test('successful Intel report proves the native host state', () => {
  const report = intelValidationReport({
    outcome: 'passed',
    repository: 'lastobelus/markover',
    head: HEAD,
    base: '3'.repeat(40),
    baseRef: 'origin/main',
    commandVersion: INTEL_VALIDATION_COMMAND_VERSION,
    durationMs: 12,
    host: host(),
    stages: []
  })
  assert.ok(report)
  assert.ok(report.facts)
  assert.equal(report.facts.architecture, 'x86_64')
  assert.equal(report.facts.translated, 'false')
})

test('keeps the importable action and agent launch contract wired', () => {
  const root = path.resolve(__dirname, '../..')
  const definition: unknown = JSON.parse(
    fs.readFileSync(path.join(root, 't3.json'), 'utf8')
  )
  assert.ok(definition !== null && typeof definition === 'object')
  const scripts: unknown = Reflect.get(definition, 'scripts')
  assert.ok(Array.isArray(scripts))
  const action: unknown = (scripts as unknown[]).find((candidate: unknown) => (
    candidate !== null && typeof candidate === 'object' &&
    Reflect.get(candidate, 'name') === 'Run Intel Validation'
  ))
  assert.deepEqual(action, {
    id: 'markover-run-intel-validation',
    name: 'Run Intel Validation',
    command: 'node scripts/markover-intel-validation-bootstrap.js',
    icon: 'test'
  })
  const guidance = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
  assert.match(guidance, /single action named `Run Intel\s+Validation`/)
  assert.match(guidance, /run_project_action_and_resume/)
  assert.match(guidance, /clean-machine\s+Intel\/Sonoma acceptance/)
})

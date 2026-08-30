import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  environmentFailure,
  formatIntelValidationSummary,
  INTEL_VALIDATION_COMMAND_VERSION,
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

test('keeps the importable action and agent launch contract wired', () => {
  const root = path.resolve(__dirname, '../..')
  const action = JSON.parse(fs.readFileSync(path.join(root, 't3.json'), 'utf8'))
    .scripts.find((candidate: { name?: string }) => (
      candidate.name === 'Run Intel Validation'
    ))
  assert.deepEqual(action, {
    name: 'Run Intel Validation',
    command: 'node scripts/markover-intel-validation-bootstrap.js',
    icon: 'test'
  })
  const guidance = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
  assert.match(guidance, /single action named `Run Intel\s+Validation`/)
  assert.match(guidance, /run_project_action_and_resume/)
  assert.match(guidance, /clean-machine\s+Intel\/Sonoma acceptance/)
})

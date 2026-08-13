import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildEvidenceFixture,
  parseMetadataMatrix,
  validateEvidenceFixture,
  validateMetadataCorpus
} from '../scripts/review-metadata-conformance'

const root = path.resolve(__dirname, '../..')

function json(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as unknown
}

function fixture(): Record<string, unknown> {
  return structuredClone(
    json('test/fixtures/review-handoff-v1.json')
  ) as Record<string, unknown>
}

function observation(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    evidenceId: '2026-08-12__t3code-codex__1234abcd',
    matrixEntryId: 't3code-codex',
    exercisedAt: '2026-08-12T12:34:56.789Z',
    sourceCommit: '903a58abd2720bf82b95df3688dfb40995367e3c',
    runtime: {
      hostVersion: null,
      hostVersionSource: 'not-exposed',
      providerVersion: null,
      providerVersionSource: 'not-exposed',
      providerModel: 'gpt-5.6-sol',
      providerModelSource: 'runtime-context'
    },
    discovery: {
      providerThreadId: { status: 'observed', source: 'agent-runtime' },
      hostKind: { status: 'observed', source: 'thread-context' },
      hostProvider: { status: 'observed', source: 'thread-context' },
      hostThreadId: { status: 'observed', source: 'thread-host-runtime' },
      machine: { status: 'observed', source: 'hostname-command' }
    },
    truthfulnessAttested: true,
    limitations: ['T3 Code did not expose a product version.'],
    ...overrides
  }
}

function agentThread(value: Record<string, unknown>): void {
  const review = value.review as Record<string, unknown>
  review.agentThread = {
    id: 'session-from-live-exercise',
    threadHost: {
      kind: 't3code',
      provider: 'codex',
      threadId: 'host-thread-from-live-exercise',
      machine: 'exercise-machine.local'
    }
  }
}

test('initial live matrix contains only the three exercised combinations', () => {
  const matrix = parseMetadataMatrix(json('evals/review-metadata/matrix.json'))
  assert.deepEqual(matrix.entries.map(({ id }) => id), [
    't3code-codex',
    't3code-claude',
    'claude-code-claude'
  ])
  assert.deepEqual(matrix.classification, {
    authorityIssue: 134,
    status: 'observational-evidence'
  })
})

test('corpus validation requires and finds evidence for every initial row', () => {
  const expected = {
    evidenceCount: 3,
    matrixEntryCount: 3
  }
  assert.deepEqual(validateMetadataCorpus(root), expected)
  assert.deepEqual(validateMetadataCorpus(root, true), expected)
})

test('capture validates a live review and writes fixture placeholders', () => {
  const artifact = fixture()
  agentThread(artifact)
  const evidence = buildEvidenceFixture(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  )
  assert.deepEqual(evidence.agentThread, {
    id: '<thread-id>',
    threadHost: {
      kind: 't3code',
      provider: 'codex',
      threadId: '<thread-host-id>',
      machine: '<machine>'
    }
  })
  assert.deepEqual(evidence.relationships, {
    identity: 'identified',
    threadHostId: 'distinct'
  })
  assert.equal(Object.values(evidence.checks).every(Boolean), true)
  const source = JSON.stringify(evidence)
  for (const liveValue of [
    'session-from-live-exercise',
    'host-thread-from-live-exercise',
    'exercise-machine.local'
  ]) {
    assert.doesNotMatch(source, new RegExp(liveValue.replace('.', '\\.')))
  }
  assert.deepEqual(
    validateEvidenceFixture(
      evidence,
      json('evals/review-metadata/matrix.json')
    ),
    evidence
  )
})

test('capture rejects retained values whose discovery is unavailable', () => {
  const artifact = fixture()
  agentThread(artifact)
  const discovery = observation().discovery as Record<string, unknown>
  discovery.hostProvider = { status: 'unavailable', source: 'not-exposed' }
  assert.throws(
    () => buildEvidenceFixture(
      artifact,
      observation({ discovery }),
      json('evals/review-metadata/matrix.json')
    ),
    /threadHost.provider is present but was not observed/
  )
})

test('capture rejects incorrect null fallback for a required identity row', () => {
  const artifact = fixture()
  const review = artifact.review as Record<string, unknown>
  review.agentThread = null
  const discovery = observation().discovery as Record<string, unknown>
  discovery.providerThreadId = { status: 'unavailable', source: 'not-exposed' }
  discovery.hostKind = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostProvider = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostThreadId = { status: 'not-applicable', source: 'not-applicable' }
  assert.throws(
    () => buildEvidenceFixture(
      artifact,
      observation({ discovery }),
      json('evals/review-metadata/matrix.json')
    ),
    /t3code-codex requires reliable requesting-thread identity/
  )
})

test('capture accepts equal requesting-thread and host IDs', () => {
  const artifact = fixture()
  agentThread(artifact)
  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  const host = thread.threadHost as Record<string, unknown>
  host.threadId = thread.id
  const evidence = buildEvidenceFixture(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  )
  assert.equal(evidence.relationships.threadHostId, 'equal')
})

test('capture rejects missing required host fields through the v1 decoder', () => {
  const artifact = fixture()
  agentThread(artifact)
  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  const host = thread.threadHost as Record<string, unknown>
  delete host.provider
  assert.throws(
    () => buildEvidenceFixture(
      artifact,
      observation(),
      json('evals/review-metadata/matrix.json')
    ),
    /missing required fields: provider/
  )
})

test('committed fixtures require placeholders in run-specific fields', () => {
  const artifact = fixture()
  agentThread(artifact)
  const evidence = buildEvidenceFixture(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  ) as unknown as Record<string, unknown>
  const thread = evidence.agentThread as Record<string, unknown>
  thread.id = 'literal-session-id'
  assert.throws(
    () => validateEvidenceFixture(
      evidence,
      json('evals/review-metadata/matrix.json')
    ),
    /requesting-thread ID must use the fixture placeholder/
  )
})

test('documentation defines reruns, fixture placeholders, and schema-defect routing', () => {
  const readme = fs.readFileSync(
    path.join(root, 'evals/review-metadata/README.md'),
    'utf8'
  )
  const rubric = fs.readFileSync(
    path.join(root, 'evals/review-metadata/rubric.md'),
    'utf8'
  )
  assert.match(readme, /placeholders for the particular thread IDs and machine name/)
  assert.match(readme, /Rerun an affected row when Markover's metadata guidance/)
  assert.match(rubric, /contract defect descended from issue #99/)
  assert.match(rubric, /rather than by\nweakening this rubric/)
})

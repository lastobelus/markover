import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildSanitizedEvidence,
  parseMetadataMatrix,
  validateMetadataCorpus,
  validateSanitizedEvidence
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
    id: 'raw-provider-thread-secret',
    threadHost: {
      kind: 't3code',
      provider: 'codex',
      threadId: 'raw-host-thread-secret',
      machine: 'raw-machine-secret.local'
    }
  }
}

test('initial live matrix names three exact combinations without guessing expansion providers', () => {
  const matrix = parseMetadataMatrix(json('evals/review-metadata/matrix.json'))
  assert.deepEqual(matrix.entries.map(({ id }) => id), [
    't3code-codex',
    't3code-claude',
    'claude-code-claude'
  ])
  assert.deepEqual(
    matrix.expansionCandidates.map(({ hostProduct }) => hostProduct),
    ['LastCode', 'Codex', 'OpenCode', 'Cursor']
  )
  assert.deepEqual(
    matrix.expansionCandidates.map(({ providerSelection }) => providerSelection),
    Array.from({ length: 4 }, () => 'discover-at-exercise')
  )
})

test('corpus validation accepts pending rows but completeness requires evidence', () => {
  assert.deepEqual(validateMetadataCorpus(root), {
    evidenceCount: 0,
    matrixEntryCount: 3
  })
  assert.throws(
    () => validateMetadataCorpus(root, true),
    /t3code-codex has no committed live evidence/
  )
})

test('capture validates raw v1 identity and emits only typed redactions', () => {
  const artifact = fixture()
  agentThread(artifact)
  const evidence = buildSanitizedEvidence(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  )
  assert.deepEqual(evidence.sanitizedAgentThread, {
    id: '<redacted-provider-thread-id>',
    threadHost: {
      kind: 't3code',
      provider: 'codex',
      threadId: '<redacted-thread-host-thread-id>',
      machine: '<redacted-machine>'
    }
  })
  assert.deepEqual(evidence.relationships, {
    identity: 'identified',
    threadHostId: 'distinct'
  })
  assert.equal(Object.values(evidence.checks).every(Boolean), true)
  const source = JSON.stringify(evidence)
  for (const secret of [
    'raw-provider-thread-secret',
    'raw-host-thread-secret',
    'raw-machine-secret.local'
  ]) {
    assert.doesNotMatch(source, new RegExp(secret.replace('.', '\\.')))
  }
  assert.deepEqual(
    validateSanitizedEvidence(
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
    () => buildSanitizedEvidence(
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
    () => buildSanitizedEvidence(
      artifact,
      observation({ discovery }),
      json('evals/review-metadata/matrix.json')
    ),
    /t3code-codex requires reliable provider thread identity/
  )
})

test('capture rejects duplicated provider and host IDs through the v1 decoder', () => {
  const artifact = fixture()
  agentThread(artifact)
  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  const host = thread.threadHost as Record<string, unknown>
  host.threadId = thread.id
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation(),
      json('evals/review-metadata/matrix.json')
    ),
    /threadHost.threadId must be omitted when it duplicates agentThread.id/
  )
})

test('capture rejects missing required host fields through the v1 decoder', () => {
  const artifact = fixture()
  agentThread(artifact)
  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  const host = thread.threadHost as Record<string, unknown>
  delete host.provider
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation(),
      json('evals/review-metadata/matrix.json')
    ),
    /missing required fields: provider/
  )
})

test('committed evidence rejects raw identifiers in place of redaction markers', () => {
  const artifact = fixture()
  agentThread(artifact)
  const evidence = buildSanitizedEvidence(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  ) as unknown as Record<string, unknown>
  const thread = evidence.sanitizedAgentThread as Record<string, unknown>
  thread.id = 'raw-provider-thread-secret'
  assert.throws(
    () => validateSanitizedEvidence(
      evidence,
      json('evals/review-metadata/matrix.json')
    ),
    /provider thread ID must use the redaction marker/
  )
})

test('documentation fixes rerun and schema-defect handling without storing raw evidence', () => {
  const readme = fs.readFileSync(
    path.join(root, 'evals/review-metadata/README.md'),
    'utf8'
  )
  const rubric = fs.readFileSync(
    path.join(root, 'evals/review-metadata/rubric.md'),
    'utf8'
  )
  assert.match(readme, /Raw artifacts stay under `tmp\/review-metadata\/`/)
  assert.match(readme, /Rerun an affected row when Markover's metadata guidance/)
  assert.match(rubric, /contract defect descended from issue\n#99/)
  assert.match(rubric, /keep this rubric unchanged/)
})

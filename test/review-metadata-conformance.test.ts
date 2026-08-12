import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildSanitizedEvidence,
  parseCaptureObservation,
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

function metadataCorpusCopy(): string {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'markover-review-metadata-')
  )
  fs.cpSync(
    path.join(root, 'evals/review-metadata'),
    path.join(temporaryRoot, 'evals/review-metadata'),
    { recursive: true }
  )
  return temporaryRoot
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
  assert.deepEqual(matrix.classification, {
    authorityIssue: 134,
    status: 'provisional-evidence'
  })
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

test('corpus validation requires and finds evidence for every initial row', () => {
  const expected = {
    evidenceCount: 3,
    matrixEntryCount: 3
  }
  assert.deepEqual(validateMetadataCorpus(root), expected)
  assert.deepEqual(validateMetadataCorpus(root, true), expected)
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

test('capture rejects contradictory discovery source and status pairs', () => {
  const value = observation()
  const discovery = value.discovery as Record<string, unknown>
  discovery.providerThreadId = { status: 'observed', source: 'not-exposed' }
  assert.throws(
    () => parseCaptureObservation(value),
    /providerThreadId source not-exposed contradicts status observed/
  )
})

test('capture rejects the documented source commit placeholder', () => {
  assert.throws(
    () => parseCaptureObservation(observation({
      sourceCommit: '0000000000000000000000000000000000000000'
    })),
    /sourceCommit must be a non-placeholder full Git commit/
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

test('capture compares raw identities only with their sensitive output leaves', () => {
  const artifact = fixture()
  agentThread(artifact)
  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  const host = thread.threadHost as Record<string, unknown>
  host.machine = 'codex'
  assert.doesNotThrow(() => buildSanitizedEvidence(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  ))
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

test('committed evidence rejects unrecognized fields at every privacy boundary', () => {
  const artifact = fixture()
  agentThread(artifact)
  const evidence = buildSanitizedEvidence(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  ) as unknown as Record<string, unknown>
  evidence.rawProviderThreadId = 'raw-provider-thread-secret'
  assert.throws(
    () => validateSanitizedEvidence(
      evidence,
      json('evals/review-metadata/matrix.json')
    ),
    /Sanitized evidence contains unrecognized fields: rawProviderThreadId/
  )

  delete evidence.rawProviderThreadId
  const discovery = evidence.discovery as Record<string, unknown>
  discovery.rawHostThreadId = 'raw-host-thread-secret'
  assert.throws(
    () => validateSanitizedEvidence(
      evidence,
      json('evals/review-metadata/matrix.json')
    ),
    /discovery contains unrecognized fields: rawHostThreadId/
  )

  delete discovery.rawHostThreadId
  const thread = evidence.sanitizedAgentThread as Record<string, unknown>
  const host = thread.threadHost as Record<string, unknown>
  host.rawMachine = 'raw-machine-secret.local'
  assert.throws(
    () => validateSanitizedEvidence(
      evidence,
      json('evals/review-metadata/matrix.json')
    ),
    /threadHost contains unrecognized fields: rawMachine/
  )
})

test('committed evidence recomputes discovery and redaction relationships', () => {
  const artifact = fixture()
  agentThread(artifact)
  const evidence = buildSanitizedEvidence(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  )
  const missingMachine = structuredClone(evidence)
  delete missingMachine.sanitizedAgentThread?.threadHost.machine
  assert.throws(
    () => validateSanitizedEvidence(
      missingMachine,
      json('evals/review-metadata/matrix.json')
    ),
    /Observed machine value is absent from evidence/
  )

  const unavailableIdentity = structuredClone(evidence)
  unavailableIdentity.discovery.providerThreadId = {
    status: 'unavailable',
    source: 'not-exposed'
  }
  assert.throws(
    () => validateSanitizedEvidence(
      unavailableIdentity,
      json('evals/review-metadata/matrix.json')
    ),
    /agentThread.id is present but was not observed/
  )
})

test('metadata matrix rejects unrecognized fields at every privacy boundary', () => {
  const matrix = json('evals/review-metadata/matrix.json') as Record<string, unknown>
  matrix.rawProviderThreadId = 'raw-provider-thread-secret'
  assert.throws(
    () => parseMetadataMatrix(matrix),
    /Metadata matrix contains unrecognized fields: rawProviderThreadId/
  )

  delete matrix.rawProviderThreadId
  const entries = matrix.entries as Array<Record<string, unknown>>
  const firstEntry = entries[0]
  assert.ok(firstEntry)
  firstEntry.rawProviderThreadId = 'raw-provider-thread-secret'
  assert.throws(
    () => parseMetadataMatrix(matrix),
    /entries\[0\] contains unrecognized fields: rawProviderThreadId/
  )

  delete firstEntry.rawProviderThreadId
  const threadHost = firstEntry.threadHost as Record<string, unknown>
  threadHost.rawHostThreadId = 'raw-host-thread-secret'
  assert.throws(
    () => parseMetadataMatrix(matrix),
    /threadHost contains unrecognized fields: rawHostThreadId/
  )

  delete threadHost.rawHostThreadId
  const candidates = matrix.expansionCandidates as Array<Record<string, unknown>>
  const firstCandidate = candidates[0]
  assert.ok(firstCandidate)
  firstCandidate.rawMachine = 'raw-machine-secret.local'
  assert.throws(
    () => parseMetadataMatrix(matrix),
    /expansionCandidates\[0\] contains unrecognized fields: rawMachine/
  )
})

test('corpus validation rejects every unexpected evidence directory entry', (t) => {
  const temporaryRoot = metadataCorpusCopy()
  t.after(() => {
    fs.rmSync(temporaryRoot, { force: true, recursive: true })
  })
  const evidenceDirectory = path.join(
    temporaryRoot,
    'evals/review-metadata/evidence'
  )
  const backup = path.join(evidenceDirectory, 'raw-review.json.bak')
  fs.writeFileSync(backup, '{"private":"raw-provider-thread-secret"}\n')
  assert.throws(
    () => validateMetadataCorpus(temporaryRoot),
    /Evidence directory contains unexpected entry: raw-review.json.bak/
  )

  fs.unlinkSync(backup)
  fs.mkdirSync(path.join(evidenceDirectory, 'raw-review'))
  assert.throws(
    () => validateMetadataCorpus(temporaryRoot),
    /Evidence directory contains unexpected entry: raw-review/
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
  assert.match(readme, /Issue #134 owns normative product\nclassification and aliases/)
  assert.match(readme, /host-only `expansionCandidates`/)
  assert.match(readme, /Rerun an affected row when Markover's metadata guidance/)
  assert.match(rubric, /contract defect descended from issue\n#99/)
  assert.match(rubric, /keep this rubric unchanged/)
})

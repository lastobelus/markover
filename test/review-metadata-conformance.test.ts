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
import { reviewChecksum } from '../src/review-format'

const root = path.resolve(__dirname, '../..')

function json(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as unknown
}

function fixture(): Record<string, unknown> {
  const value = structuredClone(
    json('test/fixtures/review-handoff-v1.json')
  ) as Record<string, unknown>
  const sourceDocument = value.sourceDocument as Record<string, unknown>
  const content = fs.readFileSync(
    path.join(root, 'evals/review-metadata/exercise-source.md'),
    'utf8'
  )
  sourceDocument.content = content
  sourceDocument.checksum = reviewChecksum(content)
  return value
}

function observation(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    evidenceId: '2026-08-12__t3code-codex__1234abcd',
    matrixEntryId: 't3code-codex',
    identityRoute: 'explicit-runtime',
    exercisedAt: '2026-08-12T12:34:56.789Z',
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

test('live matrix names every required CLI, desktop, and T3 combination', () => {
  const matrix = parseMetadataMatrix(json('evals/review-metadata/matrix.json'))
  assert.deepEqual(matrix.entries.map(({ id }) => id), [
    't3code-codex',
    't3code-claude',
    'claude-code-claude',
    'codex-cli-codex',
    'chatgpt-desktop-codex',
    'claude-desktop-claude'
  ])
  assert.deepEqual(
    matrix.entries.map(({ id, requiredIdentityRoutes }) => ({
      id,
      requiredIdentityRoutes
    })),
    [
      {
        id: 't3code-codex',
        requiredIdentityRoutes: ['explicit-runtime', 'handoff-key']
      },
      {
        id: 't3code-claude',
        requiredIdentityRoutes: ['explicit-runtime', 'handoff-key']
      },
      {
        id: 'claude-code-claude',
        requiredIdentityRoutes: ['explicit-runtime', 'handoff-key']
      },
      {
        id: 'codex-cli-codex',
        requiredIdentityRoutes: ['explicit-runtime', 'handoff-key']
      },
      {
        id: 'chatgpt-desktop-codex',
        requiredIdentityRoutes: ['handoff-key']
      },
      {
        id: 'claude-desktop-claude',
        requiredIdentityRoutes: ['handoff-key']
      }
    ]
  )
  assert.deepEqual(matrix.classification, {
    authorityIssue: 134,
    status: 'observational-evidence'
  })
})

test('matrix exercise paths name maintained Markdown exercise files', () => {
  for (const exercise of ['.', '../../package.json']) {
    const matrix = structuredClone(
      json('evals/review-metadata/matrix.json')
    ) as Record<string, unknown>
    const entries = matrix.entries as Array<Record<string, unknown>>
    const entry = entries[0]
    assert.ok(entry)
    entry.exercise = exercise
    assert.throws(
      () => parseMetadataMatrix(matrix),
      /exercise must name a Markdown file under exercises/
    )
  }
})

test('matrix rows require a nonempty identity-route checklist', () => {
  const matrix = structuredClone(
    json('evals/review-metadata/matrix.json')
  ) as Record<string, unknown>
  const entries = matrix.entries as Array<Record<string, unknown>>
  const entry = entries[0]
  assert.ok(entry)
  entry.requiredIdentityRoutes = []
  assert.throws(
    () => parseMetadataMatrix(matrix),
    /requiredIdentityRoutes must not be empty/
  )
})

test('corpus validation tracks both identity routes for every initial row', () => {
  const expected = {
    evidenceCount: 7,
    matrixEntryCount: 6
  }
  assert.deepEqual(validateMetadataCorpus(root), expected)
  assert.throws(
    () => validateMetadataCorpus(root, true),
    /t3code-claude is missing live evidence for: handoff-key/
  )
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
  assert.equal(evidence.identityRoute, 'explicit-runtime')
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

test('capture distinguishes explicit runtime and handoff-key evidence', () => {
  const artifact = fixture()
  agentThread(artifact)
  const discovery = observation().discovery as Record<string, unknown>
  discovery.providerThreadId = {
    status: 'observed',
    source: 'local-session-handoff'
  }
  const evidence = buildEvidenceFixture(
    artifact,
    observation({ identityRoute: 'handoff-key', discovery }),
    json('evals/review-metadata/matrix.json')
  )
  assert.equal(evidence.identityRoute, 'handoff-key')

  assert.throws(
    () => buildEvidenceFixture(
      artifact,
      observation({ identityRoute: 'explicit-runtime', discovery }),
      json('evals/review-metadata/matrix.json')
    ),
    /identityRoute explicit-runtime contradicts providerThreadId source local-session-handoff/
  )
})

test('capture rejects evidence for a route its matrix row does not declare', () => {
  const artifact = fixture()
  agentThread(artifact)
  const matrix = structuredClone(
    json('evals/review-metadata/matrix.json')
  ) as Record<string, unknown>
  const entries = matrix.entries as Array<Record<string, unknown>>
  const entry = entries[0]
  assert.ok(entry)
  entry.requiredIdentityRoutes = ['handoff-key']

  assert.throws(
    () => buildEvidenceFixture(artifact, observation(), matrix),
    /t3code-codex does not declare the explicit-runtime identity route/
  )
})

test('capture requires the maintained metadata exercise source', () => {
  const artifact = fixture()
  agentThread(artifact)
  const sourceDocument = artifact.sourceDocument as Record<string, unknown>
  sourceDocument.content = '# Different review\n'
  sourceDocument.checksum = reviewChecksum(sourceDocument.content as string)
  assert.throws(
    () => buildEvidenceFixture(
      artifact,
      observation(),
      json('evals/review-metadata/matrix.json')
    ),
    /does not use the maintained metadata exercise source/
  )
})

test('capture rejects literal live values copied into observation text', async (t) => {
  const artifact = fixture()
  agentThread(artifact)

  await t.test('limitations', () => {
    assert.throws(
      () => buildEvidenceFixture(
        artifact,
        observation({
          limitations: ['Used session-from-live-exercise for this run.']
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /still contains a literal value from the live review/
    )
  })

  await t.test('runtime', () => {
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'session-from-live-exercise'
    assert.throws(
      () => buildEvidenceFixture(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /still contains a literal value from the live review/
    )
  })

  await t.test('JSON-escaped identifier character', () => {
    const review = artifact.review as Record<string, unknown>
    const thread = review.agentThread as Record<string, unknown>
    thread.id = 'session"secret'
    assert.throws(
      () => buildEvidenceFixture(
        artifact,
        observation({ limitations: ['Used session"secret for this run.'] }),
        json('evals/review-metadata/matrix.json')
      ),
      /still contains a literal value from the live review/
    )
  })
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

test('capture rejects contradictory discovery status and source pairs', () => {
  const artifact = fixture()
  agentThread(artifact)
  const discovery = observation().discovery as Record<string, unknown>
  discovery.hostProvider = { status: 'observed', source: 'not-exposed' }
  assert.throws(
    () => buildEvidenceFixture(
      artifact,
      observation({ discovery }),
      json('evals/review-metadata/matrix.json')
    ),
    /hostProvider status and source contradict each other/
  )
})

test('capture rejects hostname as a thread identity discovery source', () => {
  const artifact = fixture()
  agentThread(artifact)
  const discovery = observation().discovery as Record<string, unknown>
  discovery.providerThreadId = { status: 'observed', source: 'hostname-command' }
  assert.throws(
    () => buildEvidenceFixture(
      artifact,
      observation({ discovery }),
      json('evals/review-metadata/matrix.json')
    ),
    /hostname-command is not a valid discovery source for providerThreadId/
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

test('capture requires a hostname attempt for truthful-null evidence', () => {
  const artifact = fixture()
  const review = artifact.review as Record<string, unknown>
  review.agentThread = null
  const discovery = observation().discovery as Record<string, unknown>
  discovery.providerThreadId = { status: 'unavailable', source: 'not-exposed' }
  discovery.hostKind = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostProvider = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostThreadId = { status: 'not-applicable', source: 'not-applicable' }
  discovery.machine = { status: 'unavailable', source: 'not-exposed' }
  const matrix = structuredClone(
    json('evals/review-metadata/matrix.json')
  ) as Record<string, unknown>
  const entries = matrix.entries as Array<Record<string, unknown>>
  const entry = entries[0]
  assert.ok(entry)
  entry.identityExpectation = 'unavailable-allowed'
  assert.throws(
    () => buildEvidenceFixture(
      artifact,
      observation({ discovery }),
      matrix
    ),
    /Machine discovery must record an attempted hostname command/
  )
})

test('capture rejects local reviews as agent conformance evidence', () => {
  const artifact = fixture()
  const review = artifact.review as Record<string, unknown>
  review.origin = 'local'
  review.agentThread = null
  const discovery = observation().discovery as Record<string, unknown>
  discovery.providerThreadId = { status: 'unavailable', source: 'not-exposed' }
  discovery.hostKind = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostProvider = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostThreadId = { status: 'not-applicable', source: 'not-applicable' }
  const matrix = structuredClone(
    json('evals/review-metadata/matrix.json')
  ) as Record<string, unknown>
  const entries = matrix.entries as Array<Record<string, unknown>>
  const entry = entries[0]
  assert.ok(entry)
  entry.identityExpectation = 'unavailable-allowed'
  assert.throws(
    () => buildEvidenceFixture(artifact, observation({ discovery }), matrix),
    /must come from an agent-origin review/
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
  assert.equal(evidence.agentThread?.threadHost.threadId, '<thread-id>')
})

test('corpus validation recomputes the host thread ID relationship', () => {
  const artifact = fixture()
  agentThread(artifact)
  const evidence = buildEvidenceFixture(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  ) as unknown as Record<string, unknown>
  const relationships = evidence.relationships as Record<string, unknown>
  relationships.threadHostId = 'equal'
  assert.throws(
    () => validateEvidenceFixture(
      evidence,
      json('evals/review-metadata/matrix.json')
    ),
    /distinct host thread ID must use the host-thread placeholder/
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

test('committed fixtures reject fields outside the versioned shape', async (t) => {
  const artifact = fixture()
  agentThread(artifact)
  const evidence = buildEvidenceFixture(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  ) as unknown as Record<string, unknown>

  await t.test('top level', () => {
    const changed = structuredClone(evidence)
    changed.unexpected = 'value'
    assert.throws(
      () => validateEvidenceFixture(
        changed,
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence fixture has unexpected fields: unexpected/
    )
  })

  await t.test('runtime', () => {
    const changed = structuredClone(evidence)
    const runtime = changed.runtime as Record<string, unknown>
    runtime.unexpected = 'value'
    assert.throws(
      () => validateEvidenceFixture(
        changed,
        json('evals/review-metadata/matrix.json')
      ),
      /Capture observation runtime has unexpected fields: unexpected/
    )
  })
})

test('corpus validation recomputes discovery checks from fixture contents', () => {
  const artifact = fixture()
  agentThread(artifact)
  const evidence = buildEvidenceFixture(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  ) as unknown as Record<string, unknown>
  const discovery = evidence.discovery as Record<string, unknown>
  discovery.providerThreadId = { status: 'unavailable', source: 'not-exposed' }
  assert.throws(
    () => validateEvidenceFixture(
      evidence,
      json('evals/review-metadata/matrix.json')
    ),
    /agentThread.id is present but was not observed/
  )
})

test('corpus validation rechecks unavailable identity for null evidence', () => {
  const artifact = fixture()
  const review = artifact.review as Record<string, unknown>
  review.agentThread = null
  const discovery = observation().discovery as Record<string, unknown>
  discovery.providerThreadId = { status: 'unavailable', source: 'not-exposed' }
  discovery.hostKind = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostProvider = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostThreadId = { status: 'not-applicable', source: 'not-applicable' }
  const matrix = structuredClone(
    json('evals/review-metadata/matrix.json')
  ) as Record<string, unknown>
  const entries = matrix.entries as Array<Record<string, unknown>>
  const entry = entries[0]
  assert.ok(entry)
  entry.identityExpectation = 'unavailable-allowed'
  const evidence = buildEvidenceFixture(
    artifact,
    observation({ discovery }),
    matrix
  ) as unknown as Record<string, unknown>
  const committedDiscovery = evidence.discovery as Record<string, unknown>
  committedDiscovery.providerThreadId = {
    status: 'observed',
    source: 'agent-runtime'
  }
  assert.throws(
    () => validateEvidenceFixture(evidence, matrix),
    /A null agentThread requires provider identity to be unavailable/
  )
})

test('null fallback rejects an observed host thread identity', () => {
  const artifact = fixture()
  const review = artifact.review as Record<string, unknown>
  review.agentThread = null
  const discovery = observation().discovery as Record<string, unknown>
  discovery.providerThreadId = { status: 'unavailable', source: 'not-exposed' }
  discovery.hostKind = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostProvider = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostThreadId = { status: 'not-applicable', source: 'not-applicable' }
  const matrix = structuredClone(
    json('evals/review-metadata/matrix.json')
  ) as Record<string, unknown>
  const entries = matrix.entries as Array<Record<string, unknown>>
  const entry = entries[0]
  assert.ok(entry)
  entry.identityExpectation = 'unavailable-allowed'
  const evidence = buildEvidenceFixture(
    artifact,
    observation({ discovery }),
    matrix
  ) as unknown as Record<string, unknown>

  discovery.hostThreadId = { status: 'observed', source: 'thread-host-runtime' }
  assert.throws(
    () => buildEvidenceFixture(artifact, observation({ discovery }), matrix),
    /cannot omit an observed host thread identity/
  )

  const relationships = evidence.relationships as Record<string, unknown>
  relationships.threadHostId = 'equal'
  assert.throws(
    () => validateEvidenceFixture(evidence, matrix),
    /Null evidence must record an omitted host thread ID relationship/
  )
  relationships.threadHostId = 'omitted'

  const committedDiscovery = evidence.discovery as Record<string, unknown>
  committedDiscovery.hostThreadId = {
    status: 'observed',
    source: 'thread-host-runtime'
  }
  assert.throws(
    () => validateEvidenceFixture(evidence, matrix),
    /cannot omit an observed host thread identity/
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

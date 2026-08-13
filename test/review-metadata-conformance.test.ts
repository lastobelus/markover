import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { reviewChecksum } from '../src/review-format'

import {
  buildSanitizedEvidence,
  recordConformanceEvidence,
  parseCaptureObservation,
  parseMetadataMatrix,
  validateMetadataCorpus,
  validateSanitizedFailureEvidence,
  validateSanitizedEvidence,
  verifyContractDefectIssue,
  verifySourceCommitPullRequest
} from '../scripts/review-metadata-conformance'

const root = path.resolve(__dirname, '../..')

function json(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as unknown
}

function fixture(): Record<string, unknown> {
  const value = structuredClone(
    json('test/fixtures/review-handoff-v1.json')
  ) as Record<string, unknown>
  const rootNode = value.root as Record<string, unknown>
  delete rootNode.fixtureNodeExtension
  const sourceDocument = value.sourceDocument as Record<string, unknown>
  const content = fs.readFileSync(
    path.join(root, 'evals/review-metadata/exercise-source.md'),
    'utf8'
  )
  sourceDocument.content = content
  sourceDocument.checksum = reviewChecksum(content)
  return value
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
    evidenceId: '2026-08-12__t3code-codex__vqzwmjkh',
    matrixEntryId: 't3code-codex',
    exercisedAt: '2026-08-12T12:34:56.789Z',
    sourceCommit: '903a58abd2720bf82b95df3688dfb40995367e3c',
    sourcePullRequest: 'https://github.com/lastobelus/markover/pull/141',
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
    status: 'observational-evidence'
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
  assert.deepEqual(
    matrix.expansionCandidates.map(({ reasonCode }) => reasonCode),
    ['no-live-thread', 'no-live-thread', 'provider-not-observed',
      'provider-not-observed']
  )
})

test('corpus validation requires and finds evidence for every initial row', () => {
  const expected = {
    evidenceCount: 234,
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
    observation({ limitations: ['raw-provider-thread-secret'] }),
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
  assert.equal('limitations' in evidence, false)
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

test('capture requires the immutable maintained exercise source', () => {
  const artifact = fixture()
  agentThread(artifact)
  const sourceDocument = artifact.sourceDocument as Record<string, unknown>
  sourceDocument.content = '# Another valid review source\n'
  sourceDocument.checksum = reviewChecksum(sourceDocument.content as string)
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation(),
      json('evals/review-metadata/matrix.json')
    ),
    /must use the maintained exercise source/
  )
})

test('capture rejects an evidence ID suffix copied from a private identity', () => {
  const artifact = fixture()
  agentThread(artifact)
  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  thread.id = 'deadbeef'
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({
        evidenceId: '2026-08-12__t3code-codex__deadbeef'
      }),
      json('evals/review-metadata/matrix.json')
    ),
    /Evidence ID suffix must be independent of private artifact values/
  )
})

test('capture rejects an evidence ID suffix embedded in a private identity', () => {
  const artifact = fixture()
  agentThread(artifact)
  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  thread.id = 'prefixdeadbeefsuffix'
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({
        evidenceId: '2026-08-12__t3code-codex__deadbeef'
      }),
      json('evals/review-metadata/matrix.json')
    ),
    /Evidence ID suffix must be independent of private artifact values/
  )
})

test('capture compares private identifiers without case distinctions', async (t) => {
  await t.test('evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    const review = artifact.review as Record<string, unknown>
    const thread = review.agentThread as Record<string, unknown>
    thread.id = 'DEADBEEF'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__deadbeef'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const review = artifact.review as Record<string, unknown>
    const thread = review.agentThread as Record<string, unknown>
    thread.id = 'DEADBEEF'
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'deadbeef'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('identifier embedded in a runtime token', () => {
    const artifact = fixture()
    agentThread(artifact)
    const review = artifact.review as Record<string, unknown>
    const thread = review.agentThread as Record<string, unknown>
    thread.id = 'ACCT_12345'
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'model-acct_12345'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('identifier embedded without a runtime-token delimiter', () => {
    const artifact = fixture()
    agentThread(artifact)
    const review = artifact.review as Record<string, unknown>
    const thread = review.agentThread as Record<string, unknown>
    thread.id = 'ACCT12345'
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelacct12345'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('short identifier component embedded in a runtime token', () => {
    const artifact = fixture()
    agentThread(artifact)
    const review = artifact.review as Record<string, unknown>
    const thread = review.agentThread as Record<string, unknown>
    thread.id = 'acct-secret'
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelacct'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('runtime token copied from within a private identifier', () => {
    const artifact = fixture()
    agentThread(artifact)
    const review = artifact.review as Record<string, unknown>
    const thread = review.agentThread as Record<string, unknown>
    thread.id = 'prefixdeadbeefsuffix'
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'deadbeef'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('short identity used as a complete runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const review = artifact.review as Record<string, unknown>
    const thread = review.agentThread as Record<string, unknown>
    thread.id = 'ABC'
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'abc'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__7654edcf',
          runtime
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })
})

test('capture binds the evidence ID slug to the selected matrix entry', () => {
  assert.throws(
    () => parseCaptureObservation(observation({
      evidenceId: '2026-08-12__raw-provider-thread-secret__1234abcd'
    })),
    /evidenceId slug must equal matrixEntryId/
  )
})

test('capture binds the evidence ID date to the exercisedAt UTC date', () => {
  assert.throws(
    () => parseCaptureObservation(observation({
      evidenceId: '2030-01-01__t3code-codex__1234abcd'
    })),
    /evidenceId date must equal the exercisedAt UTC date/
  )
})

test('capture rejects a private identity used as a complete runtime segment', () => {
  const artifact = fixture()
  agentThread(artifact)
  const runtime = observation().runtime as Record<string, unknown>
  runtime.providerVersion = 'Agent raw-provider-thread-secret'
  runtime.providerVersionSource = 'command'
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({ runtime }),
      json('evals/review-metadata/matrix.json')
    ),
    /runtime still contains a private artifact value/
  )

  runtime.providerVersion = 'Agent raw-provider-thread-secret-suffix'
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({ runtime }),
      json('evals/review-metadata/matrix.json')
    ),
    /runtime still contains a private artifact value/
  )

  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  thread.id = 'raw provider secret'
  runtime.providerVersion = 'raw provider secret'
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({ runtime }),
      json('evals/review-metadata/matrix.json')
    ),
    /runtime still contains a private artifact value/
  )
})

test('capture rejects free-form raw artifact strings used as runtime evidence', async (t) => {
  for (const [label, providerModel] of [
    ['feedback', 'Clarify the heading.'],
    ['attachment label', 'Reference image']
  ] as const) {
    await t.test(label, () => {
      const artifact = fixture()
      agentThread(artifact)
      const runtime = observation().runtime as Record<string, unknown>
      runtime.providerModel = providerModel
      assert.throws(
        () => buildSanitizedEvidence(
          artifact,
          observation({ runtime }),
          json('evals/review-metadata/matrix.json')
        ),
        /runtime still contains a private artifact value/
      )
    })
  }

  await t.test('token embedded in feedback prose', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.feedback = 'Account acct_12345 needs review.'
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'acct_12345'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('UUID component embedded in feedback prose', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.feedback = 'Account deadbeef-1234-5678-90ab-cdef01234567 needs review.'
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'deadbeef'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('ordinary product words remain usable runtime segments', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    delete rootNode.fixtureNodeExtension
    const review = artifact.review as Record<string, unknown>
    review.contextSummary = 'Live T3 Code x Claude metadata conformance exercise.'
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = 'Claude Agent SDK 0.3.227'
    runtime.providerVersionSource = 'runtime-context'
    assert.doesNotThrow(() => buildSanitizedEvidence(
      artifact,
      observation({ runtime }),
      json('evals/review-metadata/matrix.json')
    ))
  })

  await t.test('public schema keys remain usable runtime segments', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    delete rootNode.fixtureNodeExtension
    const children = rootNode.children as Array<Record<string, unknown>>
    const reviewNode = children[1]
    assert.ok(reviewNode)
    const attachments = reviewNode.attachments as Array<Record<string, unknown>>
    const attachment = attachments[0]
    assert.ok(attachment)
    attachment.path = 'attachments/image.png'
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = 'Version 1.2.3'
    runtime.providerVersionSource = 'runtime-context'
    assert.doesNotThrow(() => buildSanitizedEvidence(
      artifact,
      observation({ limitations: [], runtime }),
      json('evals/review-metadata/matrix.json')
    ))
  })
})

test('capture treats additive extension keys as private artifact values', async (t) => {
  await t.test('runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { acct_12345: true }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'acct_12345'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { deadbeef: true }
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__deadbeef'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('short additive key embedded in a runtime token', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { acct: true }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelacct'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('short additive scalar embedded in a runtime token', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { account: 'abc123' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelabc123'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('type-inapplicable node field embedded in a runtime token', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    const children = rootNode.children as Array<Record<string, unknown>>
    const headingChildren = children[1]?.children as Array<Record<string, unknown>>
    const paragraph = headingChildren[0] as Record<string, unknown>
    assert.equal(paragraph.type, 'paragraph')
    paragraph.language = 'abc'
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelabc'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__7654edcf',
          runtime
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('three-character additive scalar embedded in a runtime token', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { account: 'abc' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelabc'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__7654edcf',
          runtime
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('short additive numeric scalar embedded in a runtime token', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { account: 123 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'model123'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__deadbeef',
          runtime
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('short additive key embedded in evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { acct: true }
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__xxxxacct'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('short additive numeric scalar in evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { account: 123 }
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__xxxxx123'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('short identifier embedded in evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'abc123' }
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__xxabc123'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('short machine embedded in evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    const review = artifact.review as Record<string, unknown>
    const thread = review.agentThread as Record<string, unknown>
    const host = thread.threadHost as Record<string, unknown>
    host.machine = 'abc'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__xxxxxabc'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('short extension value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'abc123' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'abc123'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('short extension identifier embedded in a runtime token', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'abc123' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelabc123'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('three-character identifier embedded in a runtime token', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'abc' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelabc'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__7654edcf',
          runtime
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('array identifier embedded in a runtime token', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: ['abc'] }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelabc'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__7654edcf',
          runtime
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('lowercase compound identifier embedded in a runtime token', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountid: 'abc123' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelabc123'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('extension value embedded without a runtime-token delimiter', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'acct12345' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelacct12345'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('extension value embedded across a runtime delimiter', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'acct12345' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelacct_12345'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('percent-encoded extension value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'acct%31%32%33%34%35' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'acct12345'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('deeply percent-encoded extension value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = {
      accountId:
        'acct%25252525252531%25252525252532%25252525252533' +
        '%25252525252534%25252525252535'
    }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelacct12345'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })
})

test('capture rejects delimiter-stripped private identifiers', async (t) => {
  await t.test('runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'dead-beef' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'deadbeef'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'dead-beef' }
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__deadbeef'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('short normalized value embedded in runtime', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { account: 'ab-c' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'modelabc'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__7654edcf',
          runtime
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('short normalized value embedded in evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { account: 'ab-c' }
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__xxxxxabc'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })
})

test('capture treats numeric extension leaves as private artifact values', async (t) => {
  await t.test('runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = '12345678'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__12345678'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('radix evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__0xbc614e'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('short runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 123456 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = '123456'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('scientific-notation runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = '1.2345678e7'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('scientific notation for a non-ID numeric extension', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { account: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = '1.2345678e7'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('scientific notation beyond the safe-integer range', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: '9007199254740993' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = '9.007199254740993e15'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('equivalent fractional numeric identity', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: '12.34' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = '1234e-2'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__vqzwmjkh',
          runtime
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('percent-decoded numeric identity', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = {
      accountId: '%31%32%33%34%35%36%37%38'
    }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = '0xBC614E'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__0xbc614e'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('embedded radix evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 123456 }
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__x0x1e240'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('unprefixed hexadecimal numeric identities', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 3735928559 }
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__deadbeef'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
    for (const providerVersion of [
      'deadbeef',
      'builddeadbeef',
      'ffdeadbeef'
    ]) {
      const runtime = observation().runtime as Record<string, unknown>
      runtime.providerVersion = providerVersion
      runtime.providerVersionSource = 'runtime-context'
      assert.throws(
        () => buildSanitizedEvidence(
          artifact,
          observation({ runtime }),
          json('evals/review-metadata/matrix.json')
        ),
        /runtime still contains a private artifact value/
      )
    }
  })

  await t.test('short unprefixed hexadecimal numeric identities', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 48879 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = 'beef'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__xxxxbeef'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('encoded numeric component of a private identifier', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'acct12345678' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = '0xBC614E'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__0xbc614e'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  await t.test('base64 encoded private identifiers', () => {
    const runtimeArtifact = fixture()
    agentThread(runtimeArtifact)
    const runtimeRoot = runtimeArtifact.root as Record<string, unknown>
    runtimeRoot.fixtureExtension = { accountId: 'acct12345' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'YWNjdDEyMzQ1'
    assert.throws(
      () => buildSanitizedEvidence(
        runtimeArtifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )

    const inverseArtifact = fixture()
    agentThread(inverseArtifact)
    const inverseRoot = inverseArtifact.root as Record<string, unknown>
    inverseRoot.fixtureExtension = { accountId: 'YWNjdDEyMzQ1' }
    const inverseRuntime = observation().runtime as Record<string, unknown>
    inverseRuntime.providerModel = 'acct12345'
    assert.throws(
      () => buildSanitizedEvidence(
        inverseArtifact,
        observation({ runtime: inverseRuntime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )

    const base32Artifact = fixture()
    agentThread(base32Artifact)
    const base32Root = base32Artifact.root as Record<string, unknown>
    base32Root.fixtureExtension = { accountId: 'acct12345' }
    const base32Runtime = observation().runtime as Record<string, unknown>
    base32Runtime.providerModel = 'MFRWG5BRGIZTINI'
    assert.throws(
      () => buildSanitizedEvidence(
        base32Artifact,
        observation({ runtime: base32Runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )

    const hexadecimalArtifact = fixture()
    agentThread(hexadecimalArtifact)
    const hexadecimalRoot = hexadecimalArtifact.root as Record<string, unknown>
    hexadecimalRoot.fixtureExtension = { accountId: 'acct12345' }
    const hexadecimalRuntime = observation().runtime as Record<string, unknown>
    hexadecimalRuntime.providerModel = '616363743132333435'
    assert.throws(
      () => buildSanitizedEvidence(
        hexadecimalArtifact,
        observation({ runtime: hexadecimalRuntime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )

    const suffixArtifact = fixture()
    agentThread(suffixArtifact)
    const suffixRoot = suffixArtifact.root as Record<string, unknown>
    suffixRoot.fixtureExtension = { accountId: '✠纬' }
    assert.throws(
      () => buildSanitizedEvidence(
        suffixArtifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__4pyg57qs'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )

    const nestedArtifact = fixture()
    agentThread(nestedArtifact)
    const nestedRoot = nestedArtifact.root as Record<string, unknown>
    nestedRoot.fixtureExtension = { account: '2ljm' }
    const nestedRuntime = observation().runtime as Record<string, unknown>
    nestedRuntime.providerModel = 'VmtaamVFNUhUbGhUYkVwUlZrUkJPUT09'
    assert.throws(
      () => buildSanitizedEvidence(
        nestedArtifact,
        observation({ runtime: nestedRuntime }),
        json('evals/review-metadata/matrix.json')
      ),
      /Base64 encoding beyond the safe decoding depth/
    )
  })

  await t.test('base-36 encoded private numeric identities', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = '7clzi'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('digit-only fixed-width hexadecimal identities', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 305419896 }
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__12345678'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = '12345678'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('unprefixed hexadecimal private numeric identity', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'deadbeef' }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = '3735928559'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('64-character hexadecimal private numeric identity', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 'f'.repeat(64) }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion =
      '1157920892373161954235709850086879078532 69984665640564039457584007913129639935'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('embedded 12-character hexadecimal runtime identity', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 20015998343868 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = 'sdk-123456789abc'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('private scientific prefix before trailing exponent digits', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 10000000 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = 'v1e70'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__xxxx1e70'
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })

  for (const radixValue of [
    '0xBC614E',
    '0o57060516',
    '0b101111000110000101001110'
  ]) {
    await t.test(`radix runtime value ${radixValue.slice(0, 2)}`, () => {
      const artifact = fixture()
      agentThread(artifact)
      const rootNode = artifact.root as Record<string, unknown>
      rootNode.fixtureExtension = { accountId: 12345678 }
      const runtime = observation().runtime as Record<string, unknown>
      runtime.providerModel = radixValue
      assert.throws(
        () => buildSanitizedEvidence(
          artifact,
          observation({ runtime }),
          json('evals/review-metadata/matrix.json')
        ),
        /runtime still contains a private artifact value/
      )
    })
  }

  await t.test('radix runtime value with separators', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = '0xBC_614E'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('radix segment in a multi-token runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = 'SDK 0xBC614E'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('version-prefixed radix runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = 'v0xBC614E'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('long-version-prefixed radix runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = 'version0xBC614E'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('arbitrary-prefixed radix runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = 'build0xBC614E'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('ambiguous radix runtime value before suffix text', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = '0xBC614Ebuild'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /ambiguous embedded radix value/
    )
  })

  await t.test('private radix prefix before valid radix suffix digits', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = '0xBC614Ebe'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('private radix suffix after valid leading radix digits', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = '0xffBC614E'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('overlapping embedded radix runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: 12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = '10xBC614E'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('signed version-prefixed radix runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const rootNode = artifact.root as Record<string, unknown>
    rootNode.fixtureExtension = { accountId: -12345678 }
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerVersion = 'v-0xBC614E'
    runtime.providerVersionSource = 'runtime-context'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({ runtime }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('delimiter-split radix runtime values', () => {
    for (const providerVersion of ['0xBC 614E', 'SDK 0xBC 614E']) {
      const artifact = fixture()
      agentThread(artifact)
      const rootNode = artifact.root as Record<string, unknown>
      rootNode.fixtureExtension = { accountId: 12345678 }
      const runtime = observation().runtime as Record<string, unknown>
      runtime.providerVersion = providerVersion
      runtime.providerVersionSource = 'runtime-context'
      assert.throws(
        () => buildSanitizedEvidence(
          artifact,
          observation({ runtime }),
          json('evals/review-metadata/matrix.json')
        ),
        /runtime still contains a private artifact value/
      )
    }
  })

  await t.test('punctuation-split radix runtime values', () => {
    for (const providerVersion of [
      '0xBC-614E',
      '0xBC+614E',
      '0xBC.614E',
      '0xBC_614E'
    ]) {
      const artifact = fixture()
      agentThread(artifact)
      const rootNode = artifact.root as Record<string, unknown>
      rootNode.fixtureExtension = { accountId: 12345678 }
      const runtime = observation().runtime as Record<string, unknown>
      runtime.providerVersion = providerVersion
      runtime.providerVersionSource = 'runtime-context'
      assert.throws(
        () => buildSanitizedEvidence(
          artifact,
          observation({ runtime }),
          json('evals/review-metadata/matrix.json')
        ),
        /runtime still contains a private artifact value/
      )
    }
  })
})

test('capture rejects non-safe numeric artifact leaves before sanitizing', () => {
  const artifact = fixture()
  agentThread(artifact)
  const rootNode = artifact.root as Record<string, unknown>
  rootNode.fixtureExtension = { accountId: Number('9007199254740993') }
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation(),
      json('evals/review-metadata/matrix.json')
    ),
    /non-safe numeric value that cannot be sanitized exactly/
  )
  assert.throws(
    () => recordConformanceEvidence(
      artifact,
      observation(),
      json('evals/review-metadata/matrix.json'),
      999
    ),
    /non-safe numeric value that cannot be sanitized exactly/
  )
})

test('capture treats ignored limitation strings as private inputs', async (t) => {
  await t.test('runtime value', () => {
    const artifact = fixture()
    agentThread(artifact)
    const runtime = observation().runtime as Record<string, unknown>
    runtime.providerModel = 'acct_12345'
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          limitations: ['acct_12345'],
          runtime
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /runtime still contains a private artifact value/
    )
  })

  await t.test('evidence ID suffix', () => {
    const artifact = fixture()
    agentThread(artifact)
    assert.throws(
      () => buildSanitizedEvidence(
        artifact,
        observation({
          evidenceId: '2026-08-12__t3code-codex__deadbeef',
          limitations: ['Account deadbeef needs review.']
        }),
        json('evals/review-metadata/matrix.json')
      ),
      /Evidence ID suffix must be independent of private artifact values/
    )
  })
})

test('failed automatic checks can produce only closed sanitized evidence', () => {
  const artifact = fixture()
  agentThread(artifact)
  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  const host = thread.threadHost as Record<string, unknown>
  delete host.provider

  assert.throws(
    () => recordConformanceEvidence(
      artifact,
      observation(),
      json('evals/review-metadata/matrix.json')
    ),
    /--defect-issue NUMBER/
  )

  const failure = recordConformanceEvidence(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json'),
    999
  )
  assert.deepEqual(failure, {
    evidenceId: '2026-08-12__t3code-codex__vqzwmjkh',
    exercisedAt: '2026-08-12T12:34:56.789Z',
    failure: {
      defectIssue: 999,
      kind: 'automatic-check-failed'
    },
    matrixEntryId: 't3code-codex',
    outcome: 'failed',
    schemaVersion: 1,
    sourceCommit: '903a58abd2720bf82b95df3688dfb40995367e3c',
    sourcePullRequest: 'https://github.com/lastobelus/markover/pull/141'
  })
  assert.deepEqual(
    validateSanitizedFailureEvidence(
      failure,
      json('evals/review-metadata/matrix.json')
    ),
    failure
  )
  assert.doesNotMatch(JSON.stringify(failure), /raw-provider-thread-secret/)

  assert.throws(
    () => validateSanitizedFailureEvidence(
      { ...failure, evidenceId: '2030-01-01__t3code-codex__1234abcd' },
      json('evals/review-metadata/matrix.json')
    ),
    /Failure evidence ID date must equal the exercisedAt UTC date/
  )
})

test('failure evidence rejects a suffix copied from an extension key', () => {
  const artifact = fixture()
  agentThread(artifact)
  const rootNode = artifact.root as Record<string, unknown>
  rootNode.fixtureExtension = { DEADBEEF: true }
  assert.throws(
    () => recordConformanceEvidence(
      artifact,
      observation({
        evidenceId: '2026-08-12__t3code-codex__deadbeef'
      }),
      json('evals/review-metadata/matrix.json'),
      999
    ),
    /Failure evidence ID suffix must be independent of every raw artifact string and key/
  )
})

test('failure evidence rejects a substring copied from a private identity', () => {
  const artifact = fixture()
  agentThread(artifact)
  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  thread.id = 'prefixdeadbeefsuffix'
  assert.throws(
    () => recordConformanceEvidence(
      artifact,
      observation({
        evidenceId: '2026-08-12__t3code-codex__deadbeef'
      }),
      json('evals/review-metadata/matrix.json'),
      999
    ),
    /Failure evidence ID suffix must be independent of every raw artifact string and key/
  )
})

test('failure evidence rejects a normalized explicitly private path suffix', () => {
  const artifact = fixture()
  agentThread(artifact)
  const sourceDocument = artifact.sourceDocument as Record<string, unknown>
  sourceDocument.path = '/Users/dead-beef/source.md'
  assert.throws(
    () => recordConformanceEvidence(
      artifact,
      observation({
        evidenceId: '2026-08-12__t3code-codex__deadbeef'
      }),
      json('evals/review-metadata/matrix.json'),
      999
    ),
    /Failure evidence ID suffix must be independent of every raw artifact string and key/
  )
})

test('failure evidence rejects a short complete extension value suffix', () => {
  const artifact = fixture()
  agentThread(artifact)
  const rootNode = artifact.root as Record<string, unknown>
  rootNode.fixtureExtension = { accountId: 'abc12345' }
  assert.throws(
    () => recordConformanceEvidence(
      artifact,
      observation({
        evidenceId: '2026-08-12__t3code-codex__abc12345'
      }),
      json('evals/review-metadata/matrix.json'),
      999
    ),
    /Failure evidence ID suffix must be independent of every raw artifact string and key/
  )
})

test('failure evidence rejects a suffix copied from a numeric extension leaf', () => {
  const artifact = fixture()
  agentThread(artifact)
  const rootNode = artifact.root as Record<string, unknown>
  rootNode.fixtureExtension = { accountId: 12345678 }
  assert.throws(
    () => recordConformanceEvidence(
      artifact,
      observation({
        evidenceId: '2026-08-12__t3code-codex__12345678'
      }),
      json('evals/review-metadata/matrix.json'),
      999
    ),
    /Failure evidence ID suffix must be independent of every raw artifact string and key/
  )
})

test('failure evidence rejects a suffix copied from an ignored limitation', () => {
  const artifact = fixture()
  agentThread(artifact)
  assert.throws(
    () => recordConformanceEvidence(
      artifact,
      observation({
        evidenceId: '2026-08-12__t3code-codex__deadbeef',
        limitations: ['Account deadbeef needs review.']
      }),
      json('evals/review-metadata/matrix.json'),
      999
    ),
    /Failure evidence ID suffix must be independent of every raw artifact string and key/
  )
})

test('corpus retains failures without letting them satisfy completeness', (t) => {
  const artifact = fixture()
  agentThread(artifact)
  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  const host = thread.threadHost as Record<string, unknown>
  delete host.provider
  const observationValue = observation({
    evidenceId: '2026-08-12__t3code-codex__cafebabe'
  })
  const matrixValue = json('evals/review-metadata/matrix.json') as Record<string, unknown>
  const failure = recordConformanceEvidence(
    artifact,
    observationValue,
    matrixValue,
    999
  )
  const temporaryRoot = metadataCorpusCopy()
  t.after(() => {
    fs.rmSync(temporaryRoot, { force: true, recursive: true })
  })
  const matrixPath = path.join(temporaryRoot, 'evals/review-metadata/matrix.json')
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as Record<string, unknown>
  const entries = matrix.entries as Array<Record<string, unknown>>
  const firstEntry = entries[0]
  assert.ok(firstEntry)
  const evidenceIds = firstEntry.evidence as string[]
  evidenceIds.push(failure.evidenceId)
  fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`)
  fs.writeFileSync(
    path.join(
      temporaryRoot,
      `evals/review-metadata/evidence/${failure.evidenceId}.json`
    ),
    `${JSON.stringify(failure, null, 2)}\n`
  )
  const verifyDefect = (): void => {}
  assert.deepEqual(validateMetadataCorpus(temporaryRoot, true, verifyDefect), {
    evidenceCount: 235,
    matrixEntryCount: 3
  })

  firstEntry.evidence = [failure.evidenceId]
  fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`)
  assert.throws(
    () => validateMetadataCorpus(temporaryRoot, true, verifyDefect),
    /t3code-codex has no committed live evidence/
  )
})

test('failure links must follow the same-repository parent tree to issue 99', async (t) => {
  await t.test('accepts a bounded descendant chain', () => {
    const calls: number[] = []
    verifyContractDefectIssue(
      'https://github.com/lastobelus/markover/pull/141',
      200,
      root,
      (args) => {
        const current = Number(args[2])
        calls.push(current)
        const parent = current === 200 ? 150 : 99
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify({
            number: current,
            parent: {
              number: parent,
              repository: { nameWithOwner: 'lastobelus/markover' }
            }
          })
        }
      }
    )
    assert.deepEqual(calls, [200, 150])
  })

  await t.test('rejects an issue outside the contract tree', () => {
    assert.throws(
      () => {
        verifyContractDefectIssue(
          'https://github.com/lastobelus/markover/pull/141',
          200,
          root,
          () => ({
            status: 0,
            stderr: '',
            stdout: JSON.stringify({ number: 200, parent: null })
          })
        )
      },
      /must descend from issue #99/
    )
  })

  await t.test('rejects a nonexistent issue', () => {
    assert.throws(
      () => {
        verifyContractDefectIssue(
          'https://github.com/lastobelus/markover/pull/141',
          404,
          root,
          () => ({ status: 1, stderr: 'issue not found', stdout: '' })
        )
      },
      /Cannot verify contract defect #404: issue not found/
    )
  })
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
    /hostProvider source not-exposed contradicts status unavailable/
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

test('capture enforces field-specific discovery sources', async (t) => {
  const cases = [
    ['providerThreadId', 'hostname-command'],
    ['hostKind', 'agent-runtime'],
    ['hostProvider', 'thread-host-runtime'],
    ['hostThreadId', 'thread-context'],
    ['machine', 'agent-runtime']
  ] as const

  for (const [field, source] of cases) {
    await t.test(field, () => {
      const value = observation()
      const discovery = value.discovery as Record<string, unknown>
      discovery[field] = { status: 'observed', source }
      assert.throws(
        () => parseCaptureObservation(value),
        new RegExp(`${field} source ${source} contradicts status observed`)
      )
    })
  }
})

test('capture rejects the documented source commit placeholder', () => {
  assert.throws(
    () => parseCaptureObservation(observation({
      sourceCommit: '0000000000000000000000000000000000000000'
    })),
    /sourceCommit must be a non-placeholder full Git commit/
  )
})

test('capture requires canonical pull request provenance for runner commits', () => {
  assert.throws(
    () => parseCaptureObservation(observation({
      sourcePullRequest: 'https://github.com/lastobelus/markover/pull/141/files'
    })),
    /sourcePullRequest must be a canonical GitHub URL/
  )
})

test('recording verifies runner commit ancestry in the declared pull request', async (t) => {
  const parsed = parseCaptureObservation(observation())

  await t.test('accepts a commit in the matching pull request head', () => {
    const calls: string[][] = []
    verifySourceCommitPullRequest(parsed, root, (args) => {
      calls.push(args)
      if (args[0] === 'remote') {
        return {
          status: 0,
          stderr: '',
          stdout: 'git@github.com:lastobelus/markover.git\n'
        }
      }
      return { status: 0, stderr: '', stdout: '' }
    })
    const ignoredCall = calls.pop()
    const untrackedCall = calls.pop()
    const diffCall = calls[3]
    assert.ok(diffCall)
    assert.deepEqual(untrackedCall, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '--',
      ...diffCall.slice(4)
    ])
    assert.deepEqual(ignoredCall, [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      ...diffCall.slice(4)
    ])
    assert.deepEqual(calls, [
      ['remote', 'get-url', 'origin'],
      ['fetch', '--quiet', '--no-tags', 'origin', 'refs/pull/141/head'],
      ['merge-base', '--is-ancestor', parsed.sourceCommit, 'FETCH_HEAD'],
      [
        'diff',
        '--quiet',
        parsed.sourceCommit,
        '--',
        'AGENTS.md',
        'evals/review-metadata/README.md',
        'evals/review-metadata/exercise-source.md',
        'evals/review-metadata/exercises',
        'evals/review-metadata/matrix.json',
        'evals/review-metadata/rubric.md',
        'package-lock.json',
        'package.json',
        'scripts',
        'src',
        'tsconfig.build.json',
        'tsconfig.json'
      ]
    ])
  })

  await t.test('rejects untracked recorder inputs', () => {
    assert.throws(
      () => {
        verifySourceCommitPullRequest(parsed, root, (args) => ({
          status: 0,
          stderr: '',
          stdout: args[0] === 'remote'
            ? 'git@github.com:lastobelus/markover.git\n'
            : args[0] === 'ls-files'
              ? 'evals/review-metadata/exercises/opencode-codex.md\n'
              : ''
        }))
      },
      /must not contain untracked inputs/
    )
  })

  await t.test('rejects ignored recorder inputs', () => {
    assert.throws(
      () => {
        verifySourceCommitPullRequest(parsed, root, (args) => ({
          status: 0,
          stderr: '',
          stdout: args[0] === 'remote'
            ? 'git@github.com:lastobelus/markover.git\n'
            : args.includes('--ignored')
              ? 'evals/review-metadata/exercises/tmp/foo.md\n'
              : ''
        }))
      },
      /must not contain ignored inputs/
    )
  })

  await t.test('rejects a pull request in another repository', () => {
    assert.throws(
      () => {
        verifySourceCommitPullRequest(
          parseCaptureObservation(observation({
            sourcePullRequest: 'https://github.com/another/markover/pull/141'
          })),
          root,
          () => ({
            status: 0,
            stderr: '',
            stdout: 'git@github.com:lastobelus/markover.git\n'
          })
        )
      },
      /repository must match the origin repository/
    )
  })

  await t.test('rejects a commit outside the fetched pull request history', () => {
    assert.throws(
      () => {
        verifySourceCommitPullRequest(parsed, root, (args) => ({
          status: args[0] === 'merge-base' ? 1 : 0,
          stderr: '',
          stdout: args[0] === 'remote'
            ? 'https://github.com/lastobelus/markover.git\n'
            : ''
        }))
      },
      /sourceCommit must belong to the sourcePullRequest head history/
    )
  })

  await t.test('rejects a commit whose recorder sources differ', () => {
    assert.throws(
      () => {
        verifySourceCommitPullRequest(parsed, root, (args) => ({
          status: args[0] === 'diff' ? 1 : 0,
          stderr: '',
          stdout: args[0] === 'remote'
            ? 'https://github.com/lastobelus/markover.git\n'
            : ''
        }))
      },
      /recorder sources must match the declared sourceCommit/
    )
  })
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
    /t3code-codex requires reliable requesting-thread identity/
  )
})

test('truthful-null capture fails closed without verifiable combination metadata', () => {
  const artifact = fixture()
  const review = artifact.review as Record<string, unknown>
  review.agentThread = null
  const matrixValue = json(
    'evals/review-metadata/matrix.json'
  ) as Record<string, unknown>
  const entries = matrixValue.entries as Array<Record<string, unknown>>
  const firstEntry = entries[0]
  assert.ok(firstEntry)
  firstEntry.identityExpectation = 'unavailable-allowed'
  const discovery = observation().discovery as Record<string, unknown>
  discovery.providerThreadId = { status: 'unavailable', source: 'not-exposed' }
  discovery.hostKind = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostProvider = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostThreadId = { status: 'not-applicable', source: 'not-applicable' }
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({ discovery }),
      matrixValue
    ),
    /cannot verify the selected host\/provider combination/
  )
})

test('capture accepts equal requesting and host IDs while recording the relationship', () => {
  const artifact = fixture()
  agentThread(artifact)
  const review = artifact.review as Record<string, unknown>
  const thread = review.agentThread as Record<string, unknown>
  const host = thread.threadHost as Record<string, unknown>
  host.threadId = thread.id
  const evidence = buildSanitizedEvidence(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  )
  assert.equal(evidence.relationships.threadHostId, 'equal')
  assert.equal(
    evidence.sanitizedAgentThread?.threadHost.threadId,
    '<redacted-thread-host-thread-id>'
  )
  assert.deepEqual(
    validateSanitizedEvidence(
      evidence,
      json('evals/review-metadata/matrix.json')
    ),
    evidence
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

test('capture rejects raw identities copied into persisted runtime values', async (t) => {
  const cases = [
    {
      field: 'hostVersion',
      raw: 'raw-provider-thread-secret',
      sourceField: 'hostVersionSource'
    },
    {
      field: 'providerVersion',
      raw: 'raw-host-thread-secret',
      sourceField: 'providerVersionSource'
    },
    {
      field: 'providerModel',
      raw: 'raw-machine-secret.local',
      sourceField: 'providerModelSource'
    }
  ] as const

  for (const { field, raw, sourceField } of cases) {
    await t.test(field, () => {
      const artifact = fixture()
      agentThread(artifact)
      const value = observation()
      const runtime = value.runtime as Record<string, unknown>
      runtime[field] = raw
      runtime[sourceField] = 'runtime-context'
      assert.throws(
        () => buildSanitizedEvidence(
          artifact,
          value,
          json('evals/review-metadata/matrix.json')
        ),
        /runtime still contains a private artifact value/
      )
    })
  }
})

test('capture rejects path-shaped runtime values', async (t) => {
  const paths = [
    '/Users/alice/bin/tool 2.1',
    'tool /opt/local/bin 2.1',
    String.raw`C:\Users\alice\tool.exe 2.1`,
    'file:///Users/alice/bin/tool'
  ]

  for (const pathValue of paths) {
    await t.test(pathValue, () => {
      const value = observation()
      const runtime = value.runtime as Record<string, unknown>
      runtime.providerVersion = pathValue
      runtime.providerVersionSource = 'command'
      assert.throws(
        () => parseCaptureObservation(value),
        /must be a normalized version\/model token without paths or command output/
      )
    })
  }
})

test('capture rejects omitted private artifact values in runtime tokens', async (t) => {
  const cases = [
    { field: 'hostVersion', value: 'fixture.md' },
    { field: 'providerVersion', value: 'mko_fixture1' },
    {
      field: 'providerModel',
      value: '47a951b000000000000000000000000000000000'
    }
  ] as const

  for (const { field, value: privateValue } of cases) {
    await t.test(field, () => {
      const artifact = fixture()
      agentThread(artifact)
      const observationValue = observation()
      const runtime = observationValue.runtime as Record<string, unknown>
      runtime[field] = privateValue
      runtime[`${field}Source`] = 'runtime-context'
      assert.throws(
        () => buildSanitizedEvidence(
          artifact,
          observationValue,
          json('evals/review-metadata/matrix.json')
        ),
        /runtime still contains a private artifact value/
      )
    })
  }
})

test('capture rejects short components copied from explicitly private paths', () => {
  const artifact = fixture()
  agentThread(artifact)
  const sourceDocument = artifact.sourceDocument as Record<string, unknown>
  sourceDocument.path = '/Users/jsmith/source.md'
  const runtime = observation().runtime as Record<string, unknown>
  runtime.providerModel = 'jsmith'
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({ runtime }),
      json('evals/review-metadata/matrix.json')
    ),
    /runtime still contains a private artifact value/
  )

  runtime.providerModel = 'modeljsmith'
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({ runtime }),
      json('evals/review-metadata/matrix.json')
    ),
    /runtime still contains a private artifact value/
  )

  sourceDocument.path = '/Users/dead-beef/source.md'
  runtime.providerModel = 'deadbeef'
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({ runtime }),
      json('evals/review-metadata/matrix.json')
    ),
    /runtime still contains a private artifact value/
  )
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({
        evidenceId: '2026-08-12__t3code-codex__deadbeef'
      }),
      json('evals/review-metadata/matrix.json')
    ),
    /Evidence ID suffix must be independent of private artifact values/
  )
})

test('capture normalizes nested attachment paths as explicitly private', () => {
  const artifact = fixture()
  agentThread(artifact)
  const rootNode = artifact.root as Record<string, unknown>
  const children = rootNode.children as Array<Record<string, unknown>>
  const attachments = children[1]?.attachments as Array<Record<string, unknown>>
  assert.ok(attachments[0])
  attachments[0].path = '/Users/jsmith/image.png'
  attachments[0].url = 'file:///Users/dead%252Dbeef/image.png'

  const runtime = observation().runtime as Record<string, unknown>
  runtime.providerModel = 'jsmith'
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({ runtime }),
      json('evals/review-metadata/matrix.json')
    ),
    /runtime still contains a private artifact value/
  )

  runtime.providerModel = 'deadbeef'
  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({ runtime }),
      json('evals/review-metadata/matrix.json')
    ),
    /runtime still contains a private artifact value/
  )

  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({
        evidenceId: '2026-08-12__t3code-codex__deadbeef'
      }),
      json('evals/review-metadata/matrix.json')
    ),
    /Evidence ID suffix must be independent of private artifact values/
  )
})

test('committed evidence rejects path-shaped runtime values', () => {
  const artifact = fixture()
  agentThread(artifact)
  const evidence = buildSanitizedEvidence(
    artifact,
    observation(),
    json('evals/review-metadata/matrix.json')
  )
  evidence.runtime.providerVersion = '/Users/alice/bin/tool 2.1'
  evidence.runtime.providerVersionSource = 'command'
  assert.throws(
    () => validateSanitizedEvidence(
      evidence,
      json('evals/review-metadata/matrix.json')
    ),
    /must be a normalized version\/model token without paths or command output/
  )
})

test('capture rejects observed host fields when recording null evidence', () => {
  const artifact = fixture()
  const review = artifact.review as Record<string, unknown>
  review.agentThread = null
  const matrixValue = json(
    'evals/review-metadata/matrix.json'
  ) as Record<string, unknown>
  const entries = matrixValue.entries as Array<Record<string, unknown>>
  const firstEntry = entries[0]
  assert.ok(firstEntry)
  firstEntry.identityExpectation = 'unavailable-allowed'
  const discovery = observation().discovery as Record<string, unknown>
  discovery.providerThreadId = { status: 'unavailable', source: 'not-exposed' }
  discovery.hostProvider = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostThreadId = { status: 'not-applicable', source: 'not-applicable' }

  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({ discovery }),
      matrixValue
    ),
    /threadHost.kind was observed but is absent from null evidence/
  )
})

test('capture rejects local reviews as live agent evidence', () => {
  const artifact = fixture()
  const review = artifact.review as Record<string, unknown>
  review.origin = 'local'
  review.agentThread = null
  const matrixValue = json(
    'evals/review-metadata/matrix.json'
  ) as Record<string, unknown>
  const entries = matrixValue.entries as Array<Record<string, unknown>>
  const firstEntry = entries[0]
  assert.ok(firstEntry)
  firstEntry.identityExpectation = 'unavailable-allowed'
  const discovery = observation().discovery as Record<string, unknown>
  discovery.providerThreadId = { status: 'unavailable', source: 'not-exposed' }
  discovery.hostKind = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostProvider = { status: 'not-applicable', source: 'not-applicable' }
  discovery.hostThreadId = { status: 'not-applicable', source: 'not-applicable' }

  assert.throws(
    () => buildSanitizedEvidence(
      artifact,
      observation({ discovery }),
      matrixValue
    ),
    /requires an agent-origin review/
  )
})

test('committed null evidence cannot claim a supported combination', () => {
  const artifact = fixture()
  agentThread(artifact)
  const matrixValue = json(
    'evals/review-metadata/matrix.json'
  ) as Record<string, unknown>
  const entries = matrixValue.entries as Array<Record<string, unknown>>
  const firstEntry = entries[0]
  assert.ok(firstEntry)
  firstEntry.identityExpectation = 'unavailable-allowed'
  const evidence = buildSanitizedEvidence(
    artifact,
    observation(),
    matrixValue
  )
  evidence.sanitizedAgentThread = null
  evidence.relationships = {
    identity: 'truthful-null',
    threadHostId: 'omitted'
  }
  evidence.discovery.providerThreadId = {
    status: 'unavailable',
    source: 'not-exposed'
  }
  evidence.discovery.hostKind = {
    status: 'not-applicable',
    source: 'not-applicable'
  }
  evidence.discovery.hostProvider = {
    status: 'not-applicable',
    source: 'not-applicable'
  }
  evidence.discovery.hostThreadId = {
    status: 'not-applicable',
    source: 'not-applicable'
  }
  assert.throws(
    () => validateSanitizedEvidence(evidence, matrixValue),
    /cannot verify a host\/provider combination with null agentThread metadata/
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
    /requesting-thread ID must use the redaction marker/
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
  evidence.limitations = ['raw-provider-thread-secret']
  assert.throws(
    () => validateSanitizedEvidence(
      evidence,
      json('evals/review-metadata/matrix.json')
    ),
    /Sanitized evidence contains unrecognized fields: limitations/
  )

  delete evidence.limitations
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

  delete firstCandidate.rawMachine
  firstCandidate.reason = 'raw-machine-secret.local /Users/alice/review.json'
  assert.throws(
    () => parseMetadataMatrix(matrix),
    /expansionCandidates\[0\] contains unrecognized fields: reason/
  )
})

test('metadata matrix accepts only normalized exercise Markdown paths', async (t) => {
  for (const invalid of [
    'README.md',
    '.',
    'exercises',
    'exercises/../README.md',
    'exercises\\t3code-codex.md',
    'exercises/t3code-codex.txt'
  ]) {
    await t.test(invalid, () => {
      const matrix = json('evals/review-metadata/matrix.json') as Record<string, unknown>
      const entries = matrix.entries as Array<Record<string, unknown>>
      const firstEntry = entries[0]
      assert.ok(firstEntry)
      firstEntry.exercise = invalid
      assert.throws(
        () => parseMetadataMatrix(matrix),
        /normalized relative Markdown path beneath exercises/
      )
    })
  }
})

test('corpus validation requires an exercise path to resolve to a regular file', (t) => {
  const temporaryRoot = metadataCorpusCopy()
  t.after(() => {
    fs.rmSync(temporaryRoot, { force: true, recursive: true })
  })
  const matrixPath = path.join(temporaryRoot, 'evals/review-metadata/matrix.json')
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as Record<string, unknown>
  const entries = matrix.entries as Array<Record<string, unknown>>
  const firstEntry = entries[0]
  assert.ok(firstEntry)
  firstEntry.exercise = 'exercises/not-a-file.md'
  fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`)
  fs.mkdirSync(path.join(
    temporaryRoot,
    'evals/review-metadata/exercises/not-a-file.md'
  ))
  assert.throws(
    () => validateMetadataCorpus(temporaryRoot),
    /exercise must be a regular file/
  )
})

test('corpus validation rejects exercise paths escaping through a parent symlink', (t) => {
  const temporaryRoot = metadataCorpusCopy()
  t.after(() => {
    fs.rmSync(temporaryRoot, { force: true, recursive: true })
  })
  const directory = path.join(temporaryRoot, 'evals/review-metadata')
  const matrixPath = path.join(directory, 'matrix.json')
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as Record<string, unknown>
  const entries = matrix.entries as Array<Record<string, unknown>>
  const firstEntry = entries[0]
  assert.ok(firstEntry)
  firstEntry.exercise = 'exercises/link/case.md'
  fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`)
  const outside = path.join(directory, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'case.md'), '# Outside\n')
  fs.symlinkSync(outside, path.join(directory, 'exercises/link'), 'dir')
  assert.throws(
    () => validateMetadataCorpus(temporaryRoot),
    /exercise must resolve beneath exercises/
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

test('corpus validation rejects duplicate JSON keys before decoding', async (t) => {
  await t.test('matrix', (t) => {
    const temporaryRoot = metadataCorpusCopy()
    t.after(() => {
      fs.rmSync(temporaryRoot, { force: true, recursive: true })
    })
    const matrixPath = path.join(temporaryRoot, 'evals/review-metadata/matrix.json')
    const source = fs.readFileSync(matrixPath, 'utf8')
    fs.writeFileSync(
      matrixPath,
      source.replace(
        '"schemaVersion": 1,',
        '"schemaVersion": 1,\n  "schemaVersion": 1,'
      )
    )
    assert.throws(
      () => validateMetadataCorpus(temporaryRoot),
      /matrix\.json contains duplicate key: schemaVersion/
    )
  })

  await t.test('evidence with shadowed private value', (t) => {
    const temporaryRoot = metadataCorpusCopy()
    t.after(() => {
      fs.rmSync(temporaryRoot, { force: true, recursive: true })
    })
    const evidencePath = path.join(
      temporaryRoot,
      'evals/review-metadata/evidence/2026-08-12__t3code-codex__63d3f9fc.json'
    )
    const source = fs.readFileSync(evidencePath, 'utf8')
    fs.writeFileSync(
      evidencePath,
      source.replace(
        '"matrixEntryId": "t3code-codex",',
        '"matrixEntryId": "raw-provider-thread-secret",\n  ' +
        '"matrixEntryId": "t3code-codex",'
      )
    )
    assert.throws(
      () => validateMetadataCorpus(temporaryRoot),
      /contains duplicate key: matrixEntryId/
    )
  })
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
  assert.match(readme, /Issue #134 defines `threadHost.kind`/)
  assert.match(readme, /equal `threadHost.threadId` is valid/)
  assert.match(readme, /host-only `expansionCandidates`/)
  assert.match(readme, /Rerun an affected row when Markover's metadata guidance/)
  assert.match(rubric, /contract defect descended from issue\n#99/)
  assert.match(rubric, /keep this rubric unchanged/)
})

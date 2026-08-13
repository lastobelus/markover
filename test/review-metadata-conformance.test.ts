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
    evidenceId: '2026-08-12__t3code-codex__1234abcd',
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
  assert.deepEqual(
    matrix.expansionCandidates.map(({ reasonCode }) => reasonCode),
    ['no-live-thread', 'no-live-thread', 'provider-not-observed',
      'provider-not-observed']
  )
})

test('corpus validation requires and finds evidence for every initial row', () => {
  const expected = {
    evidenceCount: 42,
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
  assert.doesNotThrow(() => buildSanitizedEvidence(
    artifact,
    observation({ runtime }),
    json('evals/review-metadata/matrix.json')
  ))

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

  await t.test('ordinary product words remain usable runtime segments', () => {
    const artifact = fixture()
    agentThread(artifact)
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
    evidenceId: '2026-08-12__t3code-codex__1234abcd',
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
})

test('failure evidence rejects a suffix copied from an extension key', () => {
  const artifact = fixture()
  agentThread(artifact)
  const rootNode = artifact.root as Record<string, unknown>
  rootNode.fixtureExtension = { deadbeef: true }
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
    evidenceCount: 43,
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
        'evals/review-metadata/exercises/claude-code-claude.md',
        'evals/review-metadata/exercises/t3code-claude.md',
        'evals/review-metadata/exercises/t3code-codex.md',
        'evals/review-metadata/matrix.json',
        'evals/review-metadata/rubric.md',
        'package-lock.json',
        'package.json',
        'scripts/markover.ts',
        'scripts/review-metadata-conformance.ts',
        'src/agent-guidance.ts',
        'src/metadata-discovery.ts',
        'src/pull-request.ts',
        'src/review-format.ts',
        'tsconfig.build.json',
        'tsconfig.json'
      ]
    ])
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
    /t3code-codex requires reliable provider thread identity/
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
  assert.match(readme, /Issue #134 owns normative product\nclassification and aliases/)
  assert.match(readme, /host-only `expansionCandidates`/)
  assert.match(readme, /Rerun an affected row when Markover's metadata guidance/)
  assert.match(rubric, /contract defect descended from issue\n#99/)
  assert.match(rubric, /keep this rubric unchanged/)
})

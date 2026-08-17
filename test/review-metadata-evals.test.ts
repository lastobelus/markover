import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { helpPayload } from '../scripts/markover'
import {
  decodeReviewArtifact,
  ReviewFormatError
} from '../src/review-format'

interface MetadataCase {
  id: string
  expectedValid: boolean
  agentThread: unknown
}

const root = path.resolve(__dirname, '../..')

function json(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

test('bounded metadata cases cover direct, delegated, unavailable, and invalid packets', () => {
  const cases = json('evals/review-metadata/cases.json') as MetadataCase[]
  const fixture = json('test/fixtures/review-handoff-v1.json') as Record<string, unknown>
  assert.deepEqual(cases.map(({ id }) => id), [
    'direct-codex-requesting-id',
    't3code-distinct-thread-host-id',
    'mixed-thread-host-model-provider',
    'truthful-unavailable-fallback',
    'equal-agent-host-thread-id',
    'missing-provider',
    'private-discovery-evidence'
  ])

  for (const item of cases) {
    const artifact = structuredClone(fixture)
    const envelope = artifact.review as Record<string, unknown>
    envelope.agentThread = item.agentThread
    if (item.expectedValid) {
      assert.doesNotThrow(() => decodeReviewArtifact(artifact), item.id)
    } else {
      assert.throws(
        () => decodeReviewArtifact(artifact),
        (error: unknown) => error instanceof ReviewFormatError,
        item.id
      )
    }
  }
})

test('agent guidance requires an explicit runtime ID or fresh handoff key', () => {
  const help = JSON.stringify(helpPayload())
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
  for (const field of [
    '--thread-id',
    '--thread-host-kind',
    '--thread-host-provider',
    '--thread-host-thread-id',
    '--thread-host-machine'
  ]) {
    assert.match(help, new RegExp(field))
  }
  assert.match(help, /read only CODEX_THREAD_ID/)
  assert.match(help, /read only CLAUDE_CODE_SESSION_ID/)
  assert.match(help, /If that applicable value is nonblank, pass it as --thread-id/)
  assert.match(help, /fresh mko_handoff_ value with 16–64 random letters or digits/)
  assert.match(help, /pass it as --handoff-key in the same command/)
  assert.match(help, /LLM provider or model family/)
  assert.match(help, /not an intermediate harness/)
  assert.match(help, /only for a distinct host-owned ID you actually observe/)
  assert.match(help, /local hostname result/)
  assert.match(help, /never guess a T3 thread ID/)
  assert.match(agents, /nonblank `CODEX_THREAD_ID`/)
  assert.match(agents, /nonblank `CLAUDE_CODE_SESSION_ID`/)
  assert.match(agents, /fresh high-entropy/)
  assert.match(agents, /Use the same decision for `get-for-review`/)
})

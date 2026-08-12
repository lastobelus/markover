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
    'direct-codex-one-provider-id',
    't3code-distinct-thread-host-id',
    'mixed-thread-host-provider',
    'truthful-unavailable-fallback',
    'duplicated-provider-thread-id',
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

test('machine-readable guidance requests truthful thread-host metadata', () => {
  const help = JSON.stringify(helpPayload())
  for (const field of [
    '--thread-id',
    '--thread-host-kind',
    '--thread-host-provider',
    '--thread-host-thread-id',
    '--thread-host-machine'
  ]) {
    assert.match(help, new RegExp(field))
  }
  assert.match(help, /provider thread ID/)
  assert.match(help, /only a distinct host-owned ID/)
  assert.match(help, /local hostname result/)
  assert.match(help, /Omit unavailable values rather than guessing/)
})

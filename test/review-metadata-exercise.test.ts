import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  captureMetadataExercise,
  prepareMetadataExercise
} from '../scripts/review-metadata-exercise'
import { reviewChecksum } from '../src/review-format'

const root = path.resolve(__dirname, '../..')

function json(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as unknown
}

function temporaryRoot(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-metadata-exercise-'))
  const evalDirectory = path.join(directory, 'evals/review-metadata')
  fs.mkdirSync(evalDirectory, { recursive: true })
  fs.copyFileSync(
    path.join(root, 'evals/review-metadata/matrix.json'),
    path.join(evalDirectory, 'matrix.json')
  )
  return directory
}

function capturedArtifact(): Record<string, unknown> {
  const artifact = structuredClone(
    json('test/fixtures/review-handoff-v1.json')
  ) as Record<string, unknown>
  const content = fs.readFileSync(
    path.join(root, 'evals/review-metadata/exercise-source.md'),
    'utf8'
  )
  const source = artifact.sourceDocument as Record<string, unknown>
  source.content = content
  source.checksum = reviewChecksum(content)
  const review = artifact.review as Record<string, unknown>
  review.agentThread = {
    id: 'private-provider-session',
    threadHost: {
      kind: 't3code',
      machine: 'private-machine.local',
      provider: 'claude',
      threadId: 'private-host-thread'
    }
  }
  return artifact
}

test('prepare creates a private two-stage run with one persisted handoff marker', () => {
  const temporary = temporaryRoot()
  const prepared = prepareMetadataExercise([
    '--entry', 't3code-claude',
    '--thread-host-thread-id', 'private-host-thread'
  ], {
    randomBytes: (size) => Buffer.alloc(size, 0xab),
    root: temporary
  })

  assert.equal(prepared.ok, true)
  assert.match(prepared.runId, /^t3code-claude-[a-f0-9]{12}$/)
  assert.match(prepared.handoffMarker ?? '', /^mko_handoff_[a-f0-9]{48}$/)
  assert.match(prepared.captureCommand, /review-metadata-exercise\.js' capture --run/)
  assert.doesNotMatch(prepared.captureCommand, /mko_handoff_|private-host-thread/)

  const runDirectory = path.join(
    temporary,
    'tmp/review-metadata/runs',
    prepared.runId
  )
  const statePath = path.join(runDirectory, 'state.json')
  assert.equal(fs.statSync(runDirectory).mode & 0o777, 0o700)
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600)
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>
  assert.deepEqual(state.routes, ['explicit-runtime', 'handoff-key'])
  assert.equal(state.threadHostThreadId, 'private-host-thread')
})

test('prepare rejects an optional route before the matrix declares it', () => {
  assert.throws(
    () => prepareMetadataExercise([
      '--entry', 'chatgpt-codex',
      '--routes', 'explicit-runtime'
    ], { root: temporaryRoot() }),
    /update the matrix before preparing it/
  )
})

test('capture reads one allowlisted runtime ID and emits private sanitized bundles', () => {
  const temporary = temporaryRoot()
  const prepared = prepareMetadataExercise([
    '--entry', 't3code-claude',
    '--thread-host-thread-id', 'private-host-thread'
  ], {
    randomBytes: (size) => Buffer.alloc(size, 0xcd),
    root: temporary
  })
  const openArguments: string[][] = []
  const result = captureMetadataExercise(prepared.runId, {
    root: temporary,
    dependencies: {
      environment: {
        CLAUDE_CODE_SESSION_ID: 'private-provider-session',
        SECRET_SENTINEL: 'must-never-be-captured'
      },
      hostname: () => 'private-machine.local',
      now: () => new Date('2026-08-17T23:45:00.000Z'),
      openReview: (args) => {
        openArguments.push(args)
        return { reviewId: `private-review-${openArguments.length}` }
      },
      randomBytes: (size) => Buffer.alloc(size, 0xef),
      retrieveReview: () => capturedArtifact()
    }
  })

  assert.deepEqual(result.captures.map(({ route }) => route), [
    'explicit-runtime',
    'handoff-key'
  ])
  assert.ok(openArguments[0]?.includes('private-provider-session'))
  assert.ok(openArguments[1]?.includes(prepared.handoffMarker ?? 'missing'))
  const publicResult = JSON.stringify(result)
  for (const privateValue of [
    'private-provider-session',
    'private-host-thread',
    'private-machine.local',
    prepared.handoffMarker ?? '',
    'private-review-1',
    'must-never-be-captured'
  ]) {
    assert.doesNotMatch(publicResult, new RegExp(privateValue.replaceAll('.', '\\.')))
  }

  const runDirectory = path.join(
    temporary,
    'tmp/review-metadata/runs',
    prepared.runId
  )
  const files = fs.readdirSync(runDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
  assert.ok(files.length >= 7)
  for (const file of files) {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /must-never-be-captured/)
  }
  for (const capture of result.captures) {
    const fixture = fs.readFileSync(path.join(temporary, capture.paths.fixture), 'utf8')
    assert.match(fixture, /<thread-id>/)
    assert.match(fixture, /<thread-host-id>/)
    assert.match(fixture, /<machine>/)
    assert.doesNotMatch(fixture, /private-provider-session|private-host-thread|private-machine/)
  }
})

test('capture resumes a partially retrieved second route without opening duplicates', () => {
  const temporary = temporaryRoot()
  const prepared = prepareMetadataExercise([
    '--entry', 't3code-claude',
    '--thread-host-thread-id', 'private-host-thread'
  ], { root: temporary })
  let openCount = 0
  let retrieveCount = 0
  let failSecondRetrieve = true
  const dependencies = {
    environment: { CLAUDE_CODE_SESSION_ID: 'private-provider-session' },
    hostname: () => 'private-machine.local',
    now: () => new Date('2026-08-17T23:45:00.000Z'),
    openReview: () => {
      openCount += 1
      return { reviewId: `private-review-${openCount}` }
    },
    randomBytes: (size: number) => Buffer.alloc(size, 0xef),
    retrieveReview: () => {
      retrieveCount += 1
      if (retrieveCount === 2 && failSecondRetrieve) {
        throw new Error('simulated retrieval failure')
      }
      return capturedArtifact()
    }
  }

  assert.throws(
    () => captureMetadataExercise(prepared.runId, {
      dependencies,
      root: temporary
    }),
    /simulated retrieval failure/
  )
  assert.equal(openCount, 2)
  failSecondRetrieve = false
  const resumed = captureMetadataExercise(prepared.runId, {
    dependencies,
    root: temporary
  })
  assert.equal(openCount, 2)
  assert.equal(retrieveCount, 3)
  assert.deepEqual(resumed.captures.map(({ route }) => route), [
    'explicit-runtime',
    'handoff-key'
  ])
})

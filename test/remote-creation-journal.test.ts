import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  RemoteCreationJournal,
  remoteCreationFingerprint,
  type RemoteCreationFingerprintInput
} from '../src/remote-creation-journal'

const digestA = `sha256:${'a'.repeat(64)}`
const digestB = `sha256:${'b'.repeat(64)}`

function fingerprintInput(sourcePath: string): RemoteCreationFingerprintInput {
  return {
    profileId: `sha256:${'1'.repeat(64)}`,
    sourcePath,
    contextSummary: 'Review the remote document.',
    branch: 'feature/remote',
    handoffKey: 'mko_handoff_0123456789abcdef',
    pullRequestNumber: 187,
    pullRequestUrl: 'https://github.com/lastobelus/markover/pull/187',
    threadHostKind: 't3code',
    threadHostProvider: 'codex'
  }
}

test('remote creation fingerprints stable command inputs', () => {
  const input = fingerprintInput('/tmp/plan.md')
  assert.equal(remoteCreationFingerprint(input), remoteCreationFingerprint({
    ...input
  }))
  assert.notEqual(remoteCreationFingerprint(input), remoteCreationFingerprint({
    ...input,
    contextSummary: 'A different intentional review.'
  }))
  assert.notEqual(remoteCreationFingerprint(input), remoteCreationFingerprint({
    ...input,
    profileId: `sha256:${'2'.repeat(64)}`
  }))
})

test('concurrent identical invocations share one restricted active entry', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-journal-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  let keys = 0
  const journal = new RemoteCreationJournal(directory, {
    idempotencyKey: () => String(++keys).padStart(43, 'A')
  })
  const input = fingerprintInput('/tmp/shared.md')
  const claims = await Promise.all([
    journal.acquire(input),
    journal.acquire(input)
  ])
  assert.equal(claims.filter((claim) => !claim.resumed).length, 1)
  assert.equal(claims.filter((claim) => claim.resumed).length, 1)
  assert.equal(claims.filter((claim) => claim.inProgress).length, 1)
  assert.equal(claims[0].entry.idempotencyKey, claims[1].entry.idempotencyKey)

  const fingerprint = remoteCreationFingerprint(input).slice('sha256:'.length)
  const rootMode = (await fs.stat(directory)).mode & 0o777
  const entryDirectory = path.join(directory, fingerprint)
  const entryMode = (await fs.stat(entryDirectory)).mode & 0o777
  const activeMode = (await fs.stat(path.join(entryDirectory, 'active.json')))
    .mode & 0o777
  assert.equal(rootMode, 0o700)
  assert.equal(entryMode, 0o700)
  assert.equal(activeMode, 0o600)
})

test('restart resumes digest history and completed entries do not suppress a later open', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-journal-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const keys = ['A'.repeat(43), 'B'.repeat(43)]
  const input = fingerprintInput('/tmp/restart.md')
  const firstJournal = new RemoteCreationJournal(directory, {
    idempotencyKey: () => keys.shift() as string
  })
  const first = (await firstJournal.acquire(input)).entry
  const withFirstDigest = await firstJournal.appendRequestDigest(first, digestA)
  await firstJournal.appendRequestDigest(withFirstDigest, digestB)

  const restarted = new RemoteCreationJournal(directory, {
    idempotencyKey: () => keys.shift() as string
  })
  const resumed = await restarted.acquire(input)
  assert.equal(resumed.resumed, true)
  assert.equal(resumed.entry.idempotencyKey, 'A'.repeat(43))
  assert.deepEqual(resumed.entry.requestDigests, [digestA, digestB])

  const receipt = {
    reviewId: 'mko_aaa11111',
    reviewUrl: 'markover://review/mko_aaa11111',
    status: 'editing',
    requestDigest: digestB
  }
  await Promise.all([
    restarted.complete(resumed.entry, receipt),
    restarted.complete(resumed.entry, receipt)
  ])
  const next = await restarted.acquire(input)
  assert.equal(next.resumed, false)
  assert.equal(next.entry.idempotencyKey, 'B'.repeat(43))

  const completedDirectory = path.join(
    directory,
    remoteCreationFingerprint(input).slice('sha256:'.length),
    'completed'
  )
  const completedFiles = await fs.readdir(completedDirectory)
  assert.equal(completedFiles.length, 1)
  const completedFile = completedFiles[0]
  assert.ok(completedFile)
  const serialized = await fs.readFile(
    path.join(completedDirectory, completedFile),
    'utf8'
  )
  assert.doesNotMatch(serialized, /remote document|feature\/remote|mko_handoff/)
  assert.match(serialized, /mko_aaa11111/)
  const completed: unknown = JSON.parse(serialized)
  assert.ok(completed && typeof completed === 'object')
  assert.deepEqual(Reflect.get(completed, 'requestDigests'), [digestA, digestB])
})

test('concurrent digest appends preserve the complete history', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-journal-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const input = fingerprintInput('/tmp/concurrent-digests.md')
  const firstJournal = new RemoteCreationJournal(directory, {
    idempotencyKey: () => 'A'.repeat(43)
  })
  const entry = (await firstJournal.acquire(input)).entry
  const secondJournal = new RemoteCreationJournal(directory)
  await Promise.all([
    firstJournal.appendRequestDigest(entry, digestA),
    secondJournal.appendRequestDigest(entry, digestB)
  ])

  const resumed = await firstJournal.acquire(input)
  assert.deepEqual([...resumed.entry.requestDigests].sort(), [digestA, digestB])
})

test('a dead process lock is reclaimed before appending a digest', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-journal-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const input = fingerprintInput('/tmp/stale-lock.md')
  const journal = new RemoteCreationJournal(directory, {
    idempotencyKey: () => 'A'.repeat(43),
    processId: 222,
    processIsAlive: (pid) => pid === 222
  })
  const entry = (await journal.acquire(input)).entry
  const entryDirectory = path.join(
    directory,
    remoteCreationFingerprint(input).slice('sha256:'.length)
  )
  await fs.writeFile(path.join(entryDirectory, 'active.lock'), JSON.stringify({
    ownerPid: 111,
    token: 'b'.repeat(32)
  }), { encoding: 'utf8', mode: 0o600 })

  const appended = await journal.appendRequestDigest(entry, digestA)
  assert.deepEqual(appended.requestDigests, [digestA])
  await assert.rejects(fs.access(path.join(entryDirectory, 'active.lock')))
})

test('journal fails closed for damaged active state', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-journal-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const input = fingerprintInput('/tmp/damaged.md')
  const journal = new RemoteCreationJournal(directory, {
    idempotencyKey: () => 'A'.repeat(43)
  })
  await journal.acquire(input)
  const activePath = path.join(
    directory,
    remoteCreationFingerprint(input).slice('sha256:'.length),
    'active.json'
  )
  await fs.writeFile(activePath, '{broken', 'utf8')
  await assert.rejects(
    journal.acquire(input),
    (error: unknown) => (
      error instanceof Error &&
      Reflect.get(error, 'code') === 'REMOTE_JOURNAL_INVALID'
    )
  )
})

test('a restarted process can resume an entry that never sent a body', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-journal-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const input = fingerprintInput('/tmp/restart-before-body.md')
  const first = new RemoteCreationJournal(directory, {
    idempotencyKey: () => 'A'.repeat(43),
    processId: 111,
    processIsAlive: () => true
  })
  await first.acquire(input)
  const restarted = new RemoteCreationJournal(directory, {
    idempotencyKey: () => 'B'.repeat(43),
    processId: 222,
    processIsAlive: () => false
  })
  const resumed = await restarted.acquire(input)
  assert.equal(resumed.resumed, true)
  assert.equal(resumed.inProgress, false)
  assert.equal(resumed.entry.idempotencyKey, 'A'.repeat(43))
  assert.deepEqual(resumed.entry.requestDigests, [])
})

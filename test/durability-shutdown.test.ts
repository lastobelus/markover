import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DurabilityShutdownDeadlineError,
  persistReviewSnapshots,
  runDurabilityShutdown
} from '../src/durability-shutdown'

async function waitForEvent(events: string[], expected: string): Promise<void> {
  for (let attempt = 0; attempt < 10 && !events.includes(expected); attempt += 1) {
    await Promise.resolve()
  }
  assert.ok(events.includes(expected), `Missing event: ${expected}`)
}

test('editable review snapshots capture and persist independently in parallel', async () => {
  const captured: string[] = []
  const persisted: string[] = []
  let releaseFirst!: () => void
  const first = new Promise<void>((resolve) => { releaseFirst = resolve })
  const snapshots = persistReviewSnapshots(
    ['mko_aaa11111', 'mko_bbb22222', 'mko_ccc33333'],
    async (reviewId) => {
      captured.push(reviewId)
      if (reviewId === 'mko_aaa11111') await first
      return reviewId === 'mko_ccc33333'
        ? null
        : { sourceDocument: { content: reviewId } } as ReviewTree
    },
    (reviewId) => {
      persisted.push(reviewId)
      return Promise.resolve()
    }
  )

  await waitForEvent(captured, 'mko_ccc33333')
  assert.deepEqual(captured, [
    'mko_aaa11111',
    'mko_bbb22222',
    'mko_ccc33333'
  ])
  assert.deepEqual(persisted, ['mko_bbb22222'])
  releaseFirst()
  await snapshots
  assert.deepEqual(persisted, ['mko_bbb22222', 'mko_aaa11111'])
})

test('shutdown drains attachments before its final snapshot and autosave flush', async () => {
  const events: string[] = []
  let releaseAttachments!: () => void
  const attachments = new Promise<void>((resolve) => {
    releaseAttachments = resolve
  })

  const shutdown = runDurabilityShutdown({
    pauseMutations() {
      events.push('pause')
      return Promise.resolve()
    },
    captureSnapshots() {
      events.push('snapshots')
      return Promise.resolve()
    },
    async waitForAttachments() {
      events.push('attachments:start')
      await attachments
      events.push('attachments:done')
    },
    flushAutosaves() {
      events.push('autosaves:start')
      events.push('autosaves:done')
      return Promise.resolve()
    },
    closeService() {
      events.push('close')
      return Promise.resolve()
    },
    resumeMutations() { events.push('resume') }
  })

  await waitForEvent(events, 'attachments:start')
  assert.deepEqual(events, [
    'pause',
    'attachments:start'
  ])
  releaseAttachments()
  await shutdown
  assert.deepEqual(events, [
    'pause',
    'attachments:start',
    'attachments:done',
    'snapshots',
    'autosaves:start',
    'autosaves:done',
    'close'
  ])
  assert.equal(events.includes('resume'), false)
})

test('shutdown resumes mutations and leaves the service open after failure', async () => {
  const events: string[] = []
  await assert.rejects(runDurabilityShutdown({
    pauseMutations() {
      events.push('pause')
      return Promise.resolve()
    },
    captureSnapshots() {
      events.push('snapshots')
      return Promise.resolve()
    },
    waitForAttachments() {
      return Promise.reject(new Error('attachment drain failed'))
    },
    flushAutosaves() {
      events.push('autosaves')
      return Promise.resolve()
    },
    closeService() {
      events.push('close')
      return Promise.resolve()
    },
    resumeMutations() { events.push('resume') }
  }), /attachment drain failed/)

  assert.deepEqual(events, ['pause', 'resume'])
})

test('shutdown resumes mutations when pausing fails partway through', async () => {
  const events: string[] = []
  await assert.rejects(runDurabilityShutdown({
    pauseMutations() {
      events.push('pause')
      return Promise.reject(new Error('renderer did not pause'))
    },
    captureSnapshots() {
      events.push('snapshots')
      return Promise.resolve()
    },
    waitForAttachments() {
      events.push('attachments')
      return Promise.resolve()
    },
    flushAutosaves() {
      events.push('autosaves')
      return Promise.resolve()
    },
    closeService() {
      events.push('close')
      return Promise.resolve()
    },
    resumeMutations() { events.push('resume') }
  }), /renderer did not pause/)

  assert.deepEqual(events, ['pause', 'resume'])
})

test('shutdown cancels at five seconds without advancing after late work', async () => {
  const events: string[] = []
  let fireDeadline!: () => void
  let releaseAttachments!: () => void
  const attachments = new Promise<void>((resolve) => {
    releaseAttachments = resolve
  })
  const shutdown = runDurabilityShutdown({
    pauseMutations() {
      events.push('pause')
      return Promise.resolve()
    },
    async waitForAttachments() {
      events.push('attachments')
      await attachments
    },
    captureSnapshots() {
      events.push('snapshots')
      return Promise.resolve()
    },
    flushAutosaves() {
      events.push('autosaves')
      return Promise.resolve()
    },
    closeService() {
      events.push('close')
      return Promise.resolve()
    },
    resumeMutations() { events.push('resume') }
  }, {
    schedule(operation, delayMs) {
      assert.equal(delayMs, 5000)
      fireDeadline = operation
      return () => { events.push('deadline:cancel') }
    }
  })

  await waitForEvent(events, 'attachments')
  fireDeadline()
  await assert.rejects(
    shutdown,
    (error: unknown) => error instanceof DurabilityShutdownDeadlineError
  )
  assert.deepEqual(events, [
    'pause',
    'attachments',
    'deadline:cancel',
    'resume'
  ])
  releaseAttachments()
  await Promise.resolve()
  assert.equal(events.includes('snapshots'), false)
})

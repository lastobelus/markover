import assert from 'node:assert/strict'
import test from 'node:test'

import { runDurabilityShutdown } from '../src/durability-shutdown'

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

  await Promise.resolve()
  await Promise.resolve()
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

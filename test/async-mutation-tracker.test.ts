import assert from 'node:assert/strict'
import test from 'node:test'

import { AsyncMutationTracker } from '../src/async-mutation-tracker'

test('wait includes overlapping operations and ignores completed failures', async () => {
  const tracker = new AsyncMutationTracker()
  let releaseFirst!: () => void
  let releaseSecond!: () => void
  const firstBarrier = new Promise<void>((resolve) => { releaseFirst = resolve })
  const secondBarrier = new Promise<void>((resolve) => { releaseSecond = resolve })

  const first = tracker.track(async () => {
    await firstBarrier
    tracker.track(async () => {
      await secondBarrier
      throw new Error('reported to the original caller')
    }).catch(() => {})
    return 'saved'
  })
  let drained = false
  const drain = tracker.wait().then(() => { drained = true })

  assert.equal(tracker.size, 1)
  releaseFirst()
  assert.equal(await first, 'saved')
  await Promise.resolve()
  assert.equal(tracker.size, 1)
  assert.equal(drained, false)
  releaseSecond()
  await drain
  assert.equal(tracker.size, 0)
  assert.equal(drained, true)
})

test('track preserves operation rejection for its caller', async () => {
  const tracker = new AsyncMutationTracker()
  await assert.rejects(
    tracker.track(() => Promise.reject(new Error('attachment failed'))),
    /attachment failed/
  )
  await tracker.wait()
  assert.equal(tracker.size, 0)
})

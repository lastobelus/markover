import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAXIMUM_AUTOSAVE_RETRY_DELAY_MS,
  ReviewAutosave
} from '../src/review-autosave'
import type { ReviewArtifact } from '../src/review-store'

const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi

interface ScheduledTask {
  cancelled: boolean
  due: number
  operation: () => void
}

class FakeClock {
  current = 0
  tasks: ScheduledTask[] = []

  readonly now = (): number => this.current

  readonly schedule = (operation: () => void, delayMs: number): (() => void) => {
    const task = {
      cancelled: false,
      due: this.current + delayMs,
      operation
    }
    this.tasks.push(task)
    return () => { task.cancelled = true }
  }

  tick(milliseconds: number): void {
    const target = this.current + milliseconds
    const nextTask = (): ScheduledTask | undefined => this.tasks
        .filter((candidate) => !candidate.cancelled && candidate.due <= target)
        .sort((left, right) => left.due - right.due)[0]
    let task = nextTask()
    while (task) {
      task.cancelled = true
      this.current = task.due
      task.operation()
      task = nextTask()
    }
    this.current = target
  }

  nextDelay(): number | null {
    const task = this.tasks
      .filter((candidate) => !candidate.cancelled)
      .sort((left, right) => left.due - right.due)[0]
    return task ? task.due - this.current : null
  }
}

interface Deferred<T> {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let reject!: (error: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function tree(source: string): ReviewTree {
  return parseMarkdown(source, 'sha256:test', {
    name: 'review.md',
    path: '/tmp/review.md'
  })
}

function artifact(reviewId: string, snapshot: ReviewTree): ReviewArtifact {
  return {
    ...snapshot,
    review: {
      id: reviewId,
      status: 'editing',
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
      contextSummary: 'Autosave test.',
      agentThread: null,
      git: null,
      pullRequest: null,
      agentGuidance: {
        fixedContract: 'Test contract.',
        interpretationPolicy: 'Test policy.'
      }
    }
  }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

test('writes immediately after idle and coalesces sustained edits by deadline', async () => {
  const clock = new FakeClock()
  const writes: Array<{ reviewId: string; tree: ReviewTree; done: Deferred<ReviewArtifact> }> = []
  const autosave = new ReviewAutosave({
    updateTree(reviewId, candidate) {
      const snapshot = candidate as ReviewTree
      const done = deferred<ReviewArtifact>()
      writes.push({ reviewId, tree: snapshot, done })
      return done.promise
    }
  }, {
    maximumDelayMs: 2000,
    now: clock.now,
    schedule: clock.schedule
  })

  const first = tree('# First\n')
  autosave.queue('mko_aaa11111', first)
  first.sourceDocument.content = '# Mutated outside coordinator\n'
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.tree.sourceDocument.content, '# First\n')

  clock.tick(250)
  autosave.queue('mko_aaa11111', tree('# Second\n'))
  clock.tick(500)
  autosave.queue('mko_aaa11111', tree('# Latest\n'))
  assert.equal(writes.length, 1)

  writes[0].done.resolve(artifact('mko_aaa11111', writes[0].tree))
  await settle()
  clock.tick(1249)
  assert.equal(writes.length, 1)
  clock.tick(1)
  assert.equal(writes.length, 2)
  assert.equal(writes[1]?.tree.sourceDocument.content, '# Latest\n')

  writes[1].done.resolve(artifact('mko_aaa11111', writes[1].tree))
  await settle()
  clock.tick(2000)
  autosave.queue('mko_aaa11111', tree('# After idle\n'))
  assert.equal(writes.length, 3)
})

test('fast writes retain the throttle window instead of writing each edit', async () => {
  const clock = new FakeClock()
  const writes: ReviewTree[] = []
  const autosave = new ReviewAutosave({
    updateTree(reviewId, candidate) {
      const snapshot = candidate as ReviewTree
      writes.push(snapshot)
      return Promise.resolve(artifact(reviewId, snapshot))
    }
  }, { maximumDelayMs: 2000, now: clock.now, schedule: clock.schedule })

  autosave.queue('mko_aaa11111', tree('# First\n'))
  await settle()
  clock.tick(100)
  autosave.queue('mko_aaa11111', tree('# Second\n'))
  clock.tick(100)
  autosave.queue('mko_aaa11111', tree('# Latest\n'))
  await settle()
  assert.equal(writes.length, 1)
  clock.tick(1799)
  assert.equal(writes.length, 1)
  clock.tick(1)
  assert.equal(writes.length, 2)
  assert.equal(writes[1]?.sourceDocument.content, '# Latest\n')
})

test('keeps reviews independent while limiting each to one in-flight write', () => {
  const writes: string[] = []
  const never = new Promise<ReviewArtifact>(() => {})
  const autosave = new ReviewAutosave({
    updateTree(reviewId) {
      writes.push(reviewId)
      return never
    }
  })

  autosave.queue('mko_aaa11111', tree('# A1\n'))
  autosave.queue('mko_aaa11111', tree('# A2\n'))
  autosave.queue('mko_bbb22222', tree('# B1\n'))
  autosave.queue('mko_bbb22222', tree('# B2\n'))
  assert.deepEqual(writes, ['mko_aaa11111', 'mko_bbb22222'])
})

test('saveNow bypasses the trailing delay and resolves after its snapshot persists', async () => {
  const clock = new FakeClock()
  const writes: Array<{ tree: ReviewTree; done: Deferred<ReviewArtifact> }> = []
  const autosave = new ReviewAutosave({
    updateTree(_reviewId, candidate) {
      const snapshot = candidate as ReviewTree
      const done = deferred<ReviewArtifact>()
      writes.push({ tree: snapshot, done })
      return done.promise
    }
  }, { maximumDelayMs: 2000, now: clock.now, schedule: clock.schedule })

  autosave.queue('mko_aaa11111', tree('# First\n'))
  autosave.queue('mko_aaa11111', tree('# Waiting\n'))
  let barrierFinished = false
  const barrier = autosave.saveNow('mko_aaa11111', tree('# Handoff\n')).then(() => {
    barrierFinished = true
  })

  assert.equal(writes.length, 1)
  const firstWrite = writes[0]
  assert.ok(firstWrite)
  firstWrite.done.resolve(artifact('mko_aaa11111', firstWrite.tree))
  await settle()
  assert.equal(clock.nextDelay(), 0)
  clock.tick(0)
  assert.equal(writes.length, 2)
  assert.equal(writes[1]?.tree.sourceDocument.content, '# Handoff\n')
  assert.equal(barrierFinished, false)
  writes[1].done.resolve(artifact('mko_aaa11111', writes[1].tree))
  await barrier
  assert.equal(barrierFinished, true)
})

test('a superseded saveNow barrier never resolves for a different snapshot', async () => {
  const clock = new FakeClock()
  const writes: Array<{ tree: ReviewTree; done: Deferred<ReviewArtifact> }> = []
  const autosave = new ReviewAutosave({
    updateTree(_reviewId, candidate) {
      const snapshot = candidate as ReviewTree
      const done = deferred<ReviewArtifact>()
      writes.push({ tree: snapshot, done })
      return done.promise
    }
  }, { maximumDelayMs: 2000, now: clock.now, schedule: clock.schedule })

  autosave.queue('mko_aaa11111', tree('# In flight\n'))
  const barrier = autosave.saveNow('mko_aaa11111', tree('# Exact\n'))
  autosave.queue('mko_aaa11111', tree('# Later\n'))
  await assert.rejects(barrier, /superseded before persistence/)

  const firstWrite = writes[0]
  assert.ok(firstWrite)
  firstWrite.done.resolve(artifact('mko_aaa11111', firstWrite.tree))
  await settle()
  clock.tick(2000)
  assert.equal(writes.length, 2)
  assert.equal(writes[1]?.tree.sourceDocument.content, '# Later\n')
})

test('retains the latest snapshot behind backoff and reports recovery', async () => {
  const clock = new FakeClock()
  const attempts: ReviewTree[] = []
  const failures: unknown[] = []
  const recoveries: string[] = []
  let shouldFail = true
  const autosave = new ReviewAutosave({
    updateTree(reviewId, candidate) {
      const snapshot = candidate as ReviewTree
      attempts.push(snapshot)
      return shouldFail
        ? Promise.reject(new Error('disk unavailable'))
        : Promise.resolve(artifact(reviewId, snapshot))
    }
  }, {
    now: clock.now,
    schedule: clock.schedule,
    onFailure(_reviewId, error) { failures.push(error) },
    onRecovered(reviewId) { recoveries.push(reviewId) }
  })

  autosave.queue('mko_aaa11111', tree('# Failed\n'))
  await settle()
  assert.equal(failures.length, 1)
  assert.equal(clock.nextDelay(), 100)

  clock.tick(50)
  shouldFail = false
  autosave.queue('mko_aaa11111', tree('# Newest\n'))
  await settle()
  assert.equal(attempts.length, 1)
  clock.tick(50)
  await settle()
  assert.equal(attempts.length, 2)
  assert.equal(attempts[1]?.sourceDocument.content, '# Newest\n')
  assert.deepEqual(recoveries, ['mko_aaa11111'])
  clock.tick(100)
  assert.equal(attempts.length, 2)
})

test('saveNow reports a failed attempt while retaining it for retry', async () => {
  const clock = new FakeClock()
  let shouldFail = true
  const attempts: ReviewTree[] = []
  const autosave = new ReviewAutosave({
    updateTree(reviewId, candidate) {
      const snapshot = candidate as ReviewTree
      attempts.push(snapshot)
      return shouldFail
        ? Promise.reject(new Error('disk unavailable'))
        : Promise.resolve(artifact(reviewId, snapshot))
    }
  }, { now: clock.now, schedule: clock.schedule })

  await assert.rejects(
    autosave.saveNow('mko_aaa11111', tree('# Barrier\n')),
    /disk unavailable/
  )
  assert.equal(clock.nextDelay(), 100)
  shouldFail = false
  clock.tick(100)
  await settle()
  assert.equal(attempts.length, 2)
  assert.equal(attempts[1]?.sourceDocument.content, '# Barrier\n')
})

test('retry backoff is bounded at thirty seconds', async () => {
  const clock = new FakeClock()
  const autosave = new ReviewAutosave({
    updateTree() { return Promise.reject(new Error('still unavailable')) }
  }, { now: clock.now, schedule: clock.schedule })

  autosave.queue('mko_aaa11111', tree('# Retry\n'))
  await settle()
  for (let attempt = 1; attempt < 12; attempt += 1) {
    const delay = clock.nextDelay()
    assert.ok(delay !== null)
    assert.ok(delay <= MAXIMUM_AUTOSAVE_RETRY_DELAY_MS)
    clock.tick(delay)
    await settle()
  }
  assert.equal(clock.nextDelay(), MAXIMUM_AUTOSAVE_RETRY_DELAY_MS)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { ReviewUrlDispatcher } from '../src/review-url-dispatcher'

test('keeps only the last startup link and delivers warm links in order', async () => {
  const delivered: string[] = []
  const dispatcher = new ReviewUrlDispatcher<string>(async (value) => {
    await Promise.resolve()
    delivered.push(value)
  })
  dispatcher.receive('startup-one')
  dispatcher.receive('startup-two')
  dispatcher.markReady()
  dispatcher.receive('warm-one')
  dispatcher.receive('warm-two')
  await dispatcher.whenIdle()
  assert.deepEqual(delivered, ['startup-two', 'warm-one', 'warm-two'])
})

test('continues ordered delivery after one activation fails', async () => {
  const delivered: string[] = []
  const errors: string[] = []
  const dispatcher = new ReviewUrlDispatcher<string>((value) => {
    delivered.push(value)
    if (value === 'bad') throw new Error('failed')
  }, (error) => {
    errors.push(error instanceof Error ? error.message : String(error))
  })
  dispatcher.markReady()
  dispatcher.receive('bad')
  dispatcher.receive('good')
  await dispatcher.whenIdle()
  assert.deepEqual(delivered, ['bad', 'good'])
  assert.deepEqual(errors, ['failed'])
})

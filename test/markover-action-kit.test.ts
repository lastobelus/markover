import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACTION_EVENT_TOKEN_ENV,
  ACTION_RUN_ID_ENV,
  createMarkoverActionReporter
} from '../scripts/lib/markover-action-kit.js'

function decodeFrame(value: string): unknown {
  assert.equal(value.startsWith('\u001b]777;T3ActionEvent;'), true)
  assert.equal(value.endsWith('\u0007'), true)
  const payload = value.slice(0, -1).split(';').at(-1)
  assert.ok(payload)
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
}

test('Action reporter emits compatible progress and exactly one terminal result', () => {
  const writes: string[] = []
  const reporter = createMarkoverActionReporter({
    label: 'test-action',
    env: {
      [ACTION_RUN_ID_ENV]: 'run-1',
      [ACTION_EVENT_TOKEN_ENV]: 'token-1'
    },
    stdout: (data) => { writes.push(data) }
  })
  reporter.progress({ state: 'working', phase: 'tests', summary: 'Running tests' })
  reporter.progress({ state: 'waiting', phase: 'review', summary: 'Waiting for review' })
  reporter.terminal({
    fallback: '[test-action] Summary: passed',
    report: { outcome: 'success', summary: 'All checks passed' }
  })

  assert.deepEqual(writes.map(decodeFrame), [
    {
      kind: 'progress',
      progress: { version: 1, state: 'working', phase: 'tests', summary: 'Running tests' }
    },
    {
      kind: 'progress',
      progress: { version: 1, state: 'waiting', phase: 'review', summary: 'Waiting for review' }
    },
    {
      kind: 'result',
      report: { version: 1, outcome: 'success', summary: 'All checks passed' }
    }
  ])
  assert.throws(() => { reporter.terminal({ fallback: 'again' }) }, /already reported/)
})

test('Action reporter keeps direct runs readable', () => {
  const stdout: string[] = []
  const reporter = createMarkoverActionReporter({
    label: 'test-action',
    env: {},
    stdout: (data) => stdout.push(data)
  })
  reporter.progress({ state: 'working', summary: 'Running checks' })
  reporter.terminal({
    fallback: '[test-action] Summary: {"outcome":"passed"}',
    report: { outcome: 'success', summary: 'Checks passed' }
  })

  assert.deepEqual(stdout, [
    '[test-action] Working: Running checks\n',
    '[test-action] Summary: {"outcome":"passed"}\n'
  ])
})

test('host failures stay ordinary output during resumable runs', () => {
  const stderr: string[] = []
  const reporter = createMarkoverActionReporter({
    label: 'test-action',
    env: {
      [ACTION_RUN_ID_ENV]: 'run-1',
      [ACTION_EVENT_TOKEN_ENV]: 'token-1'
    },
    stdout: () => { assert.fail('host failure must not emit an Action result frame') },
    stderr: (data) => stderr.push(data)
  })
  reporter.terminal({
    fallback: '[test-action] Summary: failed: command exited 1',
    stream: 'stderr'
  })
  assert.deepEqual(stderr, ['[test-action] Summary: failed: command exited 1\n'])
})

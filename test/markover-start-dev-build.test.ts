import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

interface ActionModule {
  boundedTail: (contents: string) => string[]
  outcomeFromState: (
    state: Record<string, unknown>,
    awaitHuman: boolean,
    tail: string[]
  ) => Record<string, unknown> | null
  parseArguments: (args: string[]) => {
    awaitHuman: boolean
    selector: string
    timeoutMilliseconds: number
  }
  pathsFor: (checkout: string, identityKey: string) => {
    endpoint: string | null
    log: string
    root: string
    state: string
  }
  stateMatches: (
    state: Record<string, unknown>,
    expected: Record<string, unknown>
  ) => boolean
  summary: (
    context: Record<string, unknown>,
    terminal: Record<string, unknown>
  ) => Record<string, unknown>
}

const action = require(path.resolve(
  __dirname,
  '../../scripts/markover-start-dev-build.js'
)) as ActionModule
const checkout = path.resolve('/checkouts/markover')
const head = { commit: '1'.repeat(40), dirty: false }
const target = { identityKey: 'pr-216', scheme: 'markover-216' }

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    checkout,
    head: head.commit,
    dirty: head.dirty,
    identityKey: target.identityKey,
    scheme: target.scheme,
    watcherPid: process.pid,
    phase: 'ready',
    stage: 'readiness',
    outcome: 'launched',
    error: null,
    service: {
      instanceId: '123e4567-e89b-42d3-a456-426614174000',
      pid: process.pid,
      port: 43123,
      startupReady: true
    },
    ...overrides
  }
}

test('parses the importable QA launch contract', () => {
  assert.deepEqual(
    action.parseArguments([
      '--instance',
      'dev',
      '--await-human',
      '--timeout-seconds',
      '12'
    ]),
    { awaitHuman: true, selector: 'dev', timeoutMilliseconds: 12_000 }
  )
  assert.throws(
    () => action.parseArguments(['--instance', 'other']),
    /requires dev or canonical/
  )
  assert.throws(
    () => action.parseArguments(['--timeout-seconds', '0']),
    /positive number/
  )
})

test('matches only a live watcher for the exact checkout, head, and instance', () => {
  const expected = { checkout, head, target }
  assert.equal(action.stateMatches(state(), expected), true)
  assert.equal(action.stateMatches(state({ head: '2'.repeat(40) }), expected), false)
  assert.equal(action.stateMatches(state({ identityKey: 'pr-217' }), expected), false)
  assert.equal(action.stateMatches(state({ watcherPid: 999_999_999 }), expected), false)
})

test('healthy QA readiness remains explicitly awaiting human', () => {
  const outcome = action.outcomeFromState(state(), true, ['ignored'])
  assert.deepEqual(outcome, {
    outcome: 'awaiting-human',
    stage: 'readiness',
    process: {
      watcherPid: process.pid,
      appPid: process.pid,
      watcherState: 'watching'
    },
    route: {
      healthUrl: 'http://127.0.0.1:43123/health',
      scheme: 'markover-216:'
    },
    readiness: {
      health: 'ok',
      serviceInstanceId: '123e4567-e89b-42d3-a456-426614174000',
      startup: 'ready'
    },
    visualAcceptance: 'awaiting-human',
    tail: []
  })
  assert.equal(action.outcomeFromState(state(), false, [])?.outcome, 'ready')
  assert.equal(
    action.outcomeFromState(
      state({ service: { pid: process.pid, startupReady: false } }),
      true,
      []
    ),
    null
  )
})

test('classifies build, startup, and port failures with their bounded tail', () => {
  assert.deepEqual(
    action.outcomeFromState(state({
      phase: 'build-failed',
      stage: 'build',
      error: { code: null, message: 'compile failed' }
    }), true, ['compiler tail']),
    {
      outcome: 'build-failed',
      stage: 'build',
      detail: 'compile failed',
      tail: ['compiler tail']
    }
  )
  assert.equal(
    action.outcomeFromState(state({
      phase: 'startup-failed',
      stage: 'startup',
      error: { code: 'EADDRINUSE', message: 'address in use' }
    }), true, [])?.outcome,
    'port-conflict'
  )
  assert.equal(
    action.outcomeFromState(state({
      phase: 'startup-failed',
      stage: 'startup',
      error: { code: null, message: 'launch failed' }
    }), true, [])?.outcome,
    'startup-failed'
  )
})

test('tails and paths stay bounded and instance-local', () => {
  const lines = Array.from({ length: 60 }, (_value, index) => `line-${String(index)}`)
  const tail = action.boundedTail(lines.join('\n'))
  assert.equal(tail.length, 40)
  assert.equal(tail[0], 'line-20')
  assert.equal(tail.at(-1), 'line-59')

  assert.deepEqual(action.pathsFor(checkout, 'pr-216'), {
    root: path.join(checkout, '.markover/generated/pr-216'),
    log: path.join(checkout, '.markover/generated/pr-216/start-dev-build.log'),
    state: path.join(checkout, '.markover/generated/pr-216/development-watch.json'),
    endpoint: path.join(checkout, '.markover/instance/service.json')
  })
})

test('summary carries the exact mechanical identity without visual approval', () => {
  const result = action.summary(
    { head, target },
    {
      outcome: 'awaiting-human',
      stage: 'readiness',
      visualAcceptance: 'awaiting-human'
    }
  )
  assert.deepEqual(result, {
    format: 'markover-start-dev-build',
    version: 1,
    outcome: 'awaiting-human',
    stage: 'readiness',
    head,
    instance: target,
    visualAcceptance: 'awaiting-human'
  })
})

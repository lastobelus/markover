import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'

import {
  boundedLogTail,
  decideLocalCiSummary,
  formatLocalCiSummary,
  inferFailingGate,
  LOCAL_CI_COMMAND_VERSION,
  normalizeRepository,
  parseSmokeResult,
  parseTestCounts,
  terminateProcessGroup,
  type LocalCiIdentity
} from '../scripts/markover-local-ci'

const HEAD = '1'.repeat(40)
const BASE = '2'.repeat(40)

function identity(input: Partial<LocalCiIdentity> = {}): LocalCiIdentity {
  return {
    repository: 'lastobelus/markover',
    head: HEAD,
    base: BASE,
    baseRef: 'origin/main',
    clean: true,
    commandVersion: LOCAL_CI_COMMAND_VERSION,
    ...input
  }
}

const passedLog = [
  '# tests 924',
  '# pass 920',
  '# fail 0',
  '# cancelled 0',
  '# skipped 3',
  '# todo 1',
  '{"format":"markover-smoke","version":1,"ok":true,"checks":{"a":true,"b":true}}'
].join('\n')

const specReporterCounts = [
  'ℹ tests 931',
  'ℹ suites 0',
  'ℹ pass 931',
  'ℹ fail 0',
  'ℹ cancelled 0',
  'ℹ skipped 0',
  'ℹ todo 0',
  'ℹ duration_ms 28191.453584'
].join('\n')

test('normalizes common GitHub remote URLs', () => {
  assert.equal(
    normalizeRepository('git@github.com:lastobelus/markover.git'),
    'lastobelus/markover'
  )
  assert.equal(
    normalizeRepository('https://github.com/lastobelus/markover.git'),
    'lastobelus/markover'
  )
})

test('parses exact Node test counts and Markover smoke evidence', () => {
  assert.deepEqual(parseTestCounts(passedLog), {
    tests: 924,
    passed: 920,
    failed: 0,
    skipped: 3,
    cancelled: 0,
    todo: 1
  })
  assert.deepEqual(parseSmokeResult(passedLog), { ok: true, checks: 2 })
  assert.deepEqual(parseTestCounts(specReporterCounts), {
    tests: 931,
    passed: 931,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    todo: 0
  })
  assert.equal(parseTestCounts('no TAP footer'), null)
  assert.equal(parseSmokeResult('{"format":"markover-smoke","version":1}'), null)
})

test('classifies passing exact-head evidence', () => {
  assert.deepEqual(decideLocalCiSummary({
    baseline: identity(),
    final: identity(),
    code: 0,
    log: passedLog,
    durationMs: 12_345,
    cancelled: false,
    timedOut: false
  }), {
    outcome: 'passed',
    repository: 'lastobelus/markover',
    head: HEAD,
    base: BASE,
    baseRef: 'origin/main',
    commandVersion: 1,
    durationMs: 12_345,
    tests: {
      tests: 924,
      passed: 920,
      failed: 0,
      skipped: 3,
      cancelled: 0,
      todo: 1
    },
    smoke: { ok: true, checks: 2 }
  })
})

test('makes head, base, and dirty drift stale instead of accepting CI', () => {
  const common = {
    baseline: identity(),
    code: 0,
    log: passedLog,
    durationMs: 1,
    cancelled: false,
    timedOut: false
  }
  assert.equal(decideLocalCiSummary({
    ...common,
    final: identity({ head: '3'.repeat(40) })
  }).outcome, 'head-changed')
  assert.equal(decideLocalCiSummary({
    ...common,
    final: identity({ base: '4'.repeat(40) })
  }).outcome, 'base-changed')
  assert.equal(decideLocalCiSummary({
    ...common,
    final: identity({ clean: false })
  }).outcome, 'dirty-worktree')
  assert.equal(decideLocalCiSummary({
    ...common,
    baseline: identity({ clean: false }),
    final: identity({ clean: false })
  }).outcome, 'dirty-worktree')
})

test('reports failed gates, timeouts, cancellation, and incomplete evidence', () => {
  const common = {
    baseline: identity(),
    final: identity(),
    log: '> markover@0.1.6 lint\n> eslint .\nboom',
    durationMs: 1,
    cancelled: false,
    timedOut: false
  }
  assert.deepEqual(decideLocalCiSummary({ ...common, code: 2 }), {
    outcome: 'failed',
    repository: 'lastobelus/markover',
    head: HEAD,
    base: BASE,
    baseRef: 'origin/main',
    commandVersion: 1,
    durationMs: 1,
    failingGate: 'lint'
  })
  assert.equal(decideLocalCiSummary({
    ...common,
    code: null,
    timedOut: true
  }).outcome, 'timed-out')
  assert.equal(decideLocalCiSummary({
    ...common,
    code: null,
    cancelled: true
  }).outcome, 'cancelled')
  assert.equal(decideLocalCiSummary({
    ...common,
    code: 0
  }).failingGate, 'test-summary')
})

test('infers nested gate names and bounds the diagnostic tail', () => {
  assert.equal(inferFailingGate([
    '> markover@0.1.6 ci:local',
    '> markover@0.1.6 build',
    '> markover@0.1.6 clean',
    '> markover@0.1.6 build-app'
  ].join('\n')), 'build')
  assert.equal(
    boundedLogTail(Array.from({ length: 50 }, (_, index) => `line-${index}`).join('\n'), 3),
    'line-47\nline-48\nline-49'
  )
})

test('puts compact JSON on the final summary line', () => {
  const summary = formatLocalCiSummary({
    outcome: 'head-changed',
    repository: 'lastobelus/markover',
    head: HEAD,
    base: BASE,
    baseRef: 'origin/main',
    commandVersion: 1,
    durationMs: 10,
    finalHead: '3'.repeat(40)
  })
  assert.match(summary, /^\[run-local-ci\] Summary: \{"outcome":"head-changed"/)
  assert.equal(summary.includes('\n'), false)
})

test('terminates the detached CI process group with a direct-child fallback', () => {
  const groupSignals: Array<[number, NodeJS.Signals]> = []
  const directSignals: Array<NodeJS.Signals | number | undefined> = []
  const child: {
    pid: number
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    kill: (signal?: NodeJS.Signals | number) => boolean
  } = {
    pid: 1234,
    exitCode: null,
    signalCode: null,
    kill: (signal?: NodeJS.Signals | number): boolean => {
      directSignals.push(signal)
      return true
    }
  }

  terminateProcessGroup(child, 'SIGTERM', (pid, signal) => {
    groupSignals.push([pid, signal])
    return true
  })
  assert.deepEqual(groupSignals, [[-1234, 'SIGTERM']])
  assert.deepEqual(directSignals, [])

  terminateProcessGroup(child, 'SIGKILL', () => {
    throw new Error('group already exited')
  })
  assert.deepEqual(directSignals, ['SIGKILL'])

  child.exitCode = 0
  terminateProcessGroup(child, 'SIGKILL', (pid, signal) => {
    groupSignals.push([pid, signal])
    return true
  })
  assert.deepEqual(groupSignals, [[-1234, 'SIGTERM'], [-1234, 'SIGKILL']])
  assert.deepEqual(directSignals, ['SIGKILL'])
})

test('kills a signal-resistant descendant after the direct child exits', {
  timeout: 5_000
}, async (context) => {
  const descendantScript = [
    "process.on('SIGTERM', () => {})",
    "process.stdout.write('descendant-ready\\n')",
    'setInterval(() => {}, 1_000)'
  ].join(';')
  const parentScript = [
    "const { spawn } = require('node:child_process')",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: ['ignore', 'inherit', 'inherit'] })`,
    "process.stdout.write(`descendant-pid:${child.pid}\\n`)",
    'setInterval(() => {}, 1_000)'
  ].join(';')
  const parent = spawn(process.execPath, ['-e', parentScript], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  context.after(() => {
    if (parent.pid === undefined) return
    try {
      process.kill(-parent.pid, 'SIGKILL')
    } catch {
      // The process group is already gone.
    }
  })

  let output = ''
  const ready = new Promise<number>((resolve, reject) => {
    const deadline = setTimeout(() => { reject(new Error('descendant did not start')) }, 2_000)
    parent.stdout.setEncoding('utf8')
    parent.stdout.on('data', (chunk: string) => {
      output += chunk
      const match = /descendant-pid:(\d+)\ndescendant-ready\n/.exec(output)
      if (match?.[1] === undefined) return
      clearTimeout(deadline)
      resolve(Number.parseInt(match[1], 10))
    })
  })
  const descendantPid = await ready

  terminateProcessGroup(parent, 'SIGTERM')
  await once(parent, 'exit')
  assert.notEqual(parent.signalCode, null)

  terminateProcessGroup(parent, 'SIGKILL')
  await once(parent, 'close')
  assert.throws(() => { process.kill(descendantPid, 0) }, { code: 'ESRCH' })
})

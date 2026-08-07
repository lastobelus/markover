import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  developmentStartupControls,
  STARTUP_PHASES
} from '../src/startup-contract'
import {
  sanitizeDiagnosticText,
  StartupDiagnostic
} from '../src/startup-diagnostic'

const build = {
  version: '1.2.3',
  commit: 'abc123',
  dirty: false,
  rendererSha256: 'f'.repeat(64)
}

test('development startup controls accept only fixed phases', () => {
  assert.deepEqual(
    developmentStartupControls([
      '--dev-hold-startup=restoring-reviews',
      '--dev-fail-startup=loading-brand'
    ], false, false),
    { holdPhase: 'restoring-reviews', failPhase: 'loading-brand' }
  )
  assert.deepEqual(
    developmentStartupControls([
      '--dev-hold-startup=restoring-reviews'
    ], true, false),
    { holdPhase: null, failPhase: null }
  )
  assert.deepEqual(
    developmentStartupControls([
      '--dev-hold-startup=restoring-reviews'
    ], false, true),
    { holdPhase: null, failPhase: null }
  )
  assert.throws(
    () => developmentStartupControls([
      '--dev-hold-startup=custom-phase'
    ], false, false),
    /known startup phase/
  )
  assert.deepEqual(STARTUP_PHASES.at(-1), 'ready')
})

test('startup diagnostic is atomic, private, and clears stale failure', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-startup-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'private', 'startup-diagnostic.json')
  const instants = [
    '2026-08-06T01:00:00.000Z',
    '2026-08-06T01:00:01.000Z',
    '2026-08-06T01:00:03.000Z',
    '2026-08-06T01:00:04.000Z'
  ].map((value) => new Date(value))
  const diagnostic = new StartupDiagnostic({
    appDirectory: '/Applications/Markover.app',
    build,
    filePath,
    now: () => instants.shift() || new Date('2026-08-06T01:00:05.000Z')
  })
  await diagnostic.start()
  await diagnostic.begin('loading-settings')
  await diagnostic.complete('loading-settings')
  await diagnostic.ready()

  const document = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
    failure: unknown
    phases: Record<string, { durationMs: number }>
    status: string
  }
  assert.equal(document.status, 'ready')
  assert.equal(document.failure, null)
  assert.equal(document.phases['loading-settings']?.durationMs, 2000)
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600)
  }
  assert.deepEqual(
    (await fs.readdir(path.dirname(filePath))).sort(),
    ['startup-diagnostic.json']
  )
})

test('diagnostic sanitization retains useful frames without secrets or paths', () => {
  const token = 'a'.repeat(43)
  const source = [
    `Error at /Applications/Markover.app/Contents/app.js:10:2`,
    `from /Users/example/project/file.ts:20:4`,
    `temp /private/tmp/cache.js:3:1`,
    `https://person:secret@example.test ${token}`
  ].join('\n')
  const sanitized = sanitizeDiagnosticText(source, {
    appDirectory: '/Applications/Markover.app',
    homeDirectory: '/Users/example',
    temporaryDirectory: '/private/tmp'
  })
  assert.match(sanitized, /<app>\/Contents\/app\.js:10:2/)
  assert.match(sanitized, /~\/project\/file\.ts:20:4/)
  assert.match(sanitized, /<temp>\/cache\.js:3:1/)
  assert.doesNotMatch(sanitized, /person:secret|a{43}/)
})

test('startup diagnostic preserves the first classified failure', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-startup-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const diagnostic = new StartupDiagnostic({
    appDirectory: '/Applications/Markover.app',
    build,
    filePath: path.join(directory, 'startup-diagnostic.json')
  })

  await diagnostic.start()
  await diagnostic.fail('review-storage-access', new Error('storage failed'))
  await diagnostic.fail(
    'renderer-initialization',
    new Error('renderer observed the rejection')
  )

  const failure = diagnostic.snapshot().failure
  assert.ok(failure)
  assert.equal(failure.category, 'review-storage-access')
  assert.equal(failure.message, 'storage failed')
})

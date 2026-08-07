import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  cleanupDevelopmentInstance,
  InstanceCleanupError,
  macosSchemeHandlers,
  moveDirectoryToTrash
} from '../src/instance-cleanup'
import {
  developmentStateRoot,
  resolveInstance,
  type ResolvedInstance
} from '../src/instance'

async function fixture(t: TestContext): Promise<{
  instance: ResolvedInstance
  stateFile: string
  trash: string
}> {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-cleanup-'))
  t.after(() => fs.rm(checkout, { recursive: true, force: true }))
  const stateRoot = developmentStateRoot(checkout)
  const stateFile = path.join(stateRoot, 'reviews', 'mko_test', 'review.json')
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, '{"preserved":true}\n')
  const instance = await resolveInstance('development', {
    checkoutDirectory: checkout,
    inspectPullRequest: () => Promise.resolve({ number: 61, state: 'closed' }),
    probe: () => Promise.resolve(false)
  })
  return { instance, stateFile, trash: path.join(checkout, 'Trash') }
}

function errorCode(code: InstanceCleanupError['code']) {
  return (error: unknown): boolean => error instanceof InstanceCleanupError &&
    error.code === code
}

test('macOS handler lookup passes valid multiline Swift and parses paths', async () => {
  const invocations: Array<{ command: string; args: string[] }> = []
  const handlers = await macosSchemeHandlers('markover-61', (command, args) => {
    invocations.push({ command, args })
    return {
      status: 0,
      stderr: '',
      stdout: '/Applications/Markover-61 Bridge.app\n/Other.app\n\n'
    }
  })

  assert.deepEqual(handlers, [
    '/Applications/Markover-61 Bridge.app',
    '/Other.app'
  ])
  assert.equal(invocations.length, 1)
  const [invocation] = invocations
  assert.ok(invocation)
  assert.equal(invocation.command, '/usr/bin/swift')
  assert.equal(invocation.args[2], 'markover-61')
  assert.match(invocation.args[1] || '', /\{\n {2}print\(app\.path\)\n\}/)
  assert.doesNotMatch(invocation.args[1] || '', /\{;/)
})

test('cleanup moves one exact stopped PR root to a recoverable Trash path', async (t) => {
  const { instance, stateFile, trash } = await fixture(t)
  const result = await cleanupDevelopmentInstance(instance, 'pr-61', {
    handlersForScheme: () => Promise.resolve([]),
    now: () => new Date('2026-08-07T12:34:56.000Z'),
    platform: 'darwin',
    randomSuffix: () => 'abc123',
    trashDirectory: trash
  })
  assert.deepEqual(result, {
    status: 'trashed',
    identity: 'pr-61',
    recoveryPath: path.join(
      trash,
      'Markover-pr-61-instance-20260807T123456000Z-abc123'
    )
  })
  await assert.rejects(fs.access(stateFile))
  assert.equal(
    await fs.readFile(path.join(
      result.recoveryPath,
      'reviews',
      'mko_test',
      'review.json'
    ), 'utf8'),
    '{"preserved":true}\n'
  )
})

test('cleanup falls back to a recoverable cross-device move', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-exdev-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'instance')
  const destination = path.join(directory, 'Trash', 'Markover-pr-61')
  await fs.mkdir(path.join(source, 'reviews'), { recursive: true })
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(path.join(source, 'reviews', 'review.json'), 'preserved')
  let renameCalls = 0

  await moveDirectoryToTrash(source, destination, {
    randomSuffix: () => 'cross-device',
    rename(from, to) {
      renameCalls += 1
      if (renameCalls === 1) {
        return Promise.reject(Object.assign(
          new Error('cross-device link not permitted'),
          { code: 'EXDEV' }
        ))
      }
      return fs.rename(from, to)
    }
  })

  assert.equal(renameCalls, 3)
  await assert.rejects(fs.access(source))
  assert.equal(
    await fs.readFile(path.join(destination, 'reviews', 'review.json'), 'utf8'),
    'preserved'
  )
  assert.deepEqual(
    (await fs.readdir(path.dirname(destination))).sort(),
    ['Markover-pr-61']
  )
})

test('cleanup refuses installed handlers and preserves state', async (t) => {
  const { instance, stateFile, trash } = await fixture(t)
  await assert.rejects(
    cleanupDevelopmentInstance(instance, 'pr-61', {
      handlersForScheme: () => Promise.resolve(['/Applications/Markover-61 Bridge.app']),
      platform: 'darwin',
      trashDirectory: trash
    }),
    errorCode('HANDLER_STILL_INSTALLED')
  )
  await fs.access(stateFile)
})

test('cleanup refuses running, canonical, mismatched, and missing targets', async (t) => {
  const { instance, trash } = await fixture(t)
  await assert.rejects(
    cleanupDevelopmentInstance({
      ...instance,
      process: { status: 'running' }
    }, 'pr-61', {
      handlersForScheme: () => Promise.resolve([]),
      platform: 'darwin',
      trashDirectory: trash
    }),
    errorCode('INSTANCE_RUNNING')
  )
  await assert.rejects(
    cleanupDevelopmentInstance({
      ...instance,
      identity: { kind: 'canonical', key: 'canonical' },
      scheme: 'markover',
      pullRequest: null
    }, 'canonical', {
      handlersForScheme: () => Promise.resolve([]),
      platform: 'darwin',
      trashDirectory: trash
    }),
    errorCode('CANONICAL_CLEANUP_REFUSED')
  )
  await assert.rejects(
    cleanupDevelopmentInstance(instance, 'pr-62', {
      handlersForScheme: () => Promise.resolve([]),
      platform: 'darwin',
      trashDirectory: trash
    }),
    errorCode('TARGET_IDENTITY_MISMATCH')
  )
  await fs.rename(instance.stateRoot, `${instance.stateRoot}-gone`)
  await assert.rejects(
    cleanupDevelopmentInstance(instance, 'pr-61', {
      handlersForScheme: () => Promise.resolve([]),
      platform: 'darwin',
      trashDirectory: trash
    }),
    errorCode('INSTANCE_STATE_MISSING')
  )
})

test('cleanup refuses a symlinked or out-of-scope state root', async (t) => {
  const { instance, trash } = await fixture(t)
  const outside = path.join(path.dirname(instance.stateRoot), 'outside')
  await fs.mkdir(outside)
  const symlink = path.join(path.dirname(instance.stateRoot), 'linked-instance')
  await fs.symlink(outside, symlink)
  await assert.rejects(
    cleanupDevelopmentInstance({ ...instance, stateRoot: symlink }, 'pr-61', {
      handlersForScheme: () => Promise.resolve([]),
      platform: 'darwin',
      trashDirectory: trash
    }),
    errorCode('OUT_OF_SCOPE_STATE_ROOT')
  )
})

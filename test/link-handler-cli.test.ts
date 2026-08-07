import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeLinkHandlerCommand,
  linkHandlerHelp,
  parseLinkHandlerArguments
} from '../scripts/link-handler'
import type { ResolvedInstance } from '../src/instance'

test('parses targeted lifecycle and stale-removal commands', () => {
  assert.deepEqual(parseLinkHandlerArguments([]), { command: 'help' })
  assert.deepEqual(
    parseLinkHandlerArguments(['--instance', 'dev', 'install']),
    { command: 'install', target: 'development' }
  )
  assert.deepEqual(
    parseLinkHandlerArguments(['status', 'markover-76']),
    { command: 'status', target: 'canonical', scheme: 'markover-76' }
  )
  assert.deepEqual(
    parseLinkHandlerArguments(['remove', 'markover-76', '--force']),
    { command: 'remove', scheme: 'markover-76', force: true }
  )
  assert.throws(
    () => parseLinkHandlerArguments(['remove', 'markover-dev']),
    /one exact markover/
  )
})

test('help is service-free and target resolution is deferred to lifecycle work', async () => {
  let resolves = 0
  assert.deepEqual(
    await executeLinkHandlerCommand({ command: 'help' }, {
      resolve() {
        resolves += 1
        return Promise.reject(new Error('must not resolve'))
      }
    }),
    linkHandlerHelp()
  )
  assert.equal(resolves, 0)

  const parsed = parseLinkHandlerArguments(['--instance', 'dev', 'status'])
  await assert.rejects(
    executeLinkHandlerCommand(parsed, {
      resolve(target) {
        resolves += 1
        assert.equal(target, 'development')
        return Promise.reject(new Error('resolved-current-worktree'))
      }
    }),
    /resolved-current-worktree/
  )
  assert.equal(resolves, 1)
})

test('explicit-scheme status does not resolve a worktree instance', async () => {
  const parsed = parseLinkHandlerArguments(['status', 'markover-999999'])
  let resolved = false
  const result = await executeLinkHandlerCommand(parsed, {
    resolve() {
      resolved = true
      return Promise.resolve({} as ResolvedInstance)
    }
  })
  assert.equal(resolved, false)
  assert.equal(
    (result as { scheme: string }).scheme,
    'markover-999999'
  )
})

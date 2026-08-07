import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerProtocolOnFirstLaunch } from '../src/protocol-registration'

test('registers once, records the result, and does not reclaim later drift', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-protocol-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const recordPath = path.join(directory, 'protocol-registration.json')
  let isDefault = false
  let registrations = 0
  const client = {
    isDefaultProtocolClient() { return isDefault },
    setAsDefaultProtocolClient() {
      registrations += 1
      isDefault = true
      return true
    }
  }

  const first = await registerProtocolOnFirstLaunch({
    client,
    recordPath,
    scheme: 'markover',
    now: () => new Date('2026-08-07T12:00:00.000Z')
  })
  assert.deepEqual(first, {
    status: 'attempted',
    record: {
      version: 1,
      scheme: 'markover',
      attemptedAt: '2026-08-07T12:00:00.000Z',
      outcome: 'registered'
    }
  })
  assert.equal(registrations, 1)

  isDefault = false
  const second = await registerProtocolOnFirstLaunch({
    client,
    recordPath,
    scheme: 'markover'
  })
  assert.equal(second.status, 'recorded')
  assert.equal(registrations, 1)
})

test('QA suppression neither registers nor consumes the first-launch attempt', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-protocol-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const recordPath = path.join(directory, 'protocol-registration.json')
  let calls = 0
  const client = {
    isDefaultProtocolClient() { calls += 1; return false },
    setAsDefaultProtocolClient() { calls += 1; return true }
  }
  assert.deepEqual(
    await registerProtocolOnFirstLaunch({
      client,
      recordPath,
      scheme: 'markover',
      suppressed: true
    }),
    { status: 'suppressed' }
  )
  assert.equal(calls, 0)
  await assert.rejects(fs.access(recordPath))
})

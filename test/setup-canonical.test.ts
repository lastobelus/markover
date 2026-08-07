import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setupCanonicalInstance } from '../scripts/setup-canonical'
test('canonical setup blesses exactly the currently checked-out root and branch', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-canonical-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  assert.equal(spawnSync('git', ['init', '-b', 'blessed'], {
    cwd: directory,
    encoding: 'utf8'
  }).status, 0)
  const nested = path.join(directory, 'nested')
  await fs.mkdir(nested)
  const descriptor = path.join(directory, 'support', 'canonical.json')

  const result = await setupCanonicalInstance(nested, undefined, descriptor)
  assert.equal(result.checkout, await fs.realpath(directory))
  assert.equal(result.blessedBranch, 'blessed')
  assert.equal(result.identity, 'canonical')
  assert.equal(result.status, 'configured')
  assert.equal(result.descriptorPath, descriptor)
  assert.deepEqual(JSON.parse(await fs.readFile(result.descriptorPath, 'utf8')), {
    version: 1,
    checkout: await fs.realpath(directory),
    blessedBranch: 'blessed'
  })
  await assert.rejects(
    setupCanonicalInstance(directory, 'main', descriptor),
    /currently has blessed checked out/
  )
})

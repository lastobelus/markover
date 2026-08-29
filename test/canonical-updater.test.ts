import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  CanonicalUpdateError,
  inspectCanonicalUpdate,
  runCanonicalUpdateHelper,
  startCanonicalUpdate
} from '../src/canonical-updater'

interface FakeResult {
  status: number
  stdout: string
  stderr: string
}

interface FakeRepositoryOptions {
  branch?: string
  dirty?: boolean
  origin?: string
  divergent?: boolean
  behind?: number
  mergeFails?: boolean
  refreshFails?: boolean
}

async function fixture(
  t: test.TestContext,
  options: FakeRepositoryOptions = {}
): Promise<{
  checkout: string
  descriptorPath: string
  commands: Array<{ command: string; args: readonly string[] }>
  runCommand: (
    command: string,
    args: readonly string[],
    options: { cwd: string; encoding: 'utf8' }
  ) => FakeResult
}> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-updater-'))
  const checkout = path.join(directory, 'checkout')
  const descriptorPath = path.join(directory, 'state', 'canonical-instance.json')
  await fs.mkdir(checkout)
  await fs.mkdir(path.dirname(descriptorPath))
  await fs.writeFile(descriptorPath, JSON.stringify({
    version: 1,
    checkout,
    blessedBranch: 'main'
  }))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const commands: Array<{ command: string; args: readonly string[] }> = []
  const ok = (stdout = ''): FakeResult => ({ status: 0, stdout, stderr: '' })
  const fail = (): FakeResult => ({ status: 1, stdout: '', stderr: 'private detail' })
  return {
    checkout,
    descriptorPath,
    commands,
    runCommand(command, args) {
      commands.push({ command, args: [...args] })
      if (command === 'npm') return options.refreshFails ? fail() : ok()
      const joined = args.join(' ')
      if (joined === 'rev-parse --show-toplevel') return ok(checkout)
      if (joined === 'check-ref-format --branch main') return ok('main')
      if (joined === 'branch --show-current') return ok(options.branch || 'main')
      if (joined === 'status --porcelain --untracked-files=all') {
        return ok(options.dirty ? '?? private.txt' : '')
      }
      if (joined === 'remote get-url origin') {
        return ok(options.origin || 'https://github.com/lastobelus/markover.git')
      }
      if (joined === 'fetch --no-tags origin refs/heads/main') return ok()
      if (joined === 'rev-parse HEAD') return ok('1111111')
      if (joined === 'rev-parse FETCH_HEAD') return ok('2222222')
      if (joined === 'merge-base --is-ancestor 1111111 2222222') {
        return options.divergent ? fail() : ok()
      }
      if (joined === 'rev-list --count 1111111..2222222') {
        return ok(String(options.behind ?? 2))
      }
      if (joined === 'merge --ff-only 2222222') {
        return options.mergeFails ? fail() : ok()
      }
      return fail()
    }
  }
}

test('inspection fetches only the blessed branch and reports a redacted count', async (t) => {
  for (const origin of [
    'https://github.com/lastobelus/markover',
    'https://github.com/lastobelus/markover.git',
    'git@github.com:lastobelus/markover',
    'git@github.com:lastobelus/markover.git',
    'ssh://git@github.com/lastobelus/markover',
    'ssh://git@github.com/lastobelus/markover.git'
  ]) {
    const repo = await fixture(t, { origin })
    assert.deepEqual(await inspectCanonicalUpdate(repo), {
      format: 'markover-canonical-update-inspection',
      version: 1,
      status: 'available',
      commitsBehind: 2
    })
    assert(repo.commands.some(({ command, args }) =>
      command === 'git' &&
      args.join(' ') === 'fetch --no-tags origin refs/heads/main'
    ))
  }
})

test('inspection refuses wrong branch, untracked files, wrong origin, and divergence', async (t) => {
  const cases: Array<{
    options: FakeRepositoryOptions
    code: CanonicalUpdateError['code']
  }> = [
    { options: { branch: 'feature' }, code: 'WRONG_BRANCH' },
    { options: { dirty: true }, code: 'DIRTY_CHECKOUT' },
    { options: { origin: 'https://example.test/markover.git' }, code: 'UNTRUSTED_ORIGIN' },
    { options: { divergent: true }, code: 'DIVERGED' }
  ]
  for (const candidate of cases) {
    const repo = await fixture(t, candidate.options)
    await assert.rejects(
      inspectCanonicalUpdate(repo),
      (error: unknown) => error instanceof CanonicalUpdateError &&
        error.code === candidate.code &&
        !error.message.includes(repo.checkout) &&
        !error.message.includes('private detail')
    )
  }
})

test('detached start is single-flight while the app remains alive', async (t) => {
  const repo = await fixture(t)
  const spawns: Array<{ command: string; args: readonly string[] }> = []
  const spawnDetached = (command: string, args: readonly string[]) => {
    spawns.push({ command, args })
    return {
      pid: 123,
      once() { return this },
      unref() {}
    }
  }
  const options = {
    ...repo,
    helperPath: '/app/canonical-updater.js',
    nodeExecutable: '/node',
    spawnDetached
  }
  assert.equal((await startCanonicalUpdate(options)).status, 'updating')
  await assert.rejects(
    startCanonicalUpdate(options),
    (error: unknown) => error instanceof CanonicalUpdateError &&
      error.code === 'UPDATE_IN_PROGRESS'
  )
  assert.equal(spawns.length, 1)
  assert.equal(spawns[0]?.command, '/node')
  assert.equal(spawns[0].args[0], '/app/canonical-updater.js')
})

test('helper revalidates, fast-forwards exactly, and invokes managed refresh', async (t) => {
  const repo = await fixture(t)
  let token = ''
  await startCanonicalUpdate({
    ...repo,
    spawnDetached(_command, args) {
      token = args[3] || ''
      return {
        once() { return this },
        unref() {}
      }
    }
  })
  assert(token)
  const result = await runCanonicalUpdateHelper(
    repo.descriptorPath,
    token,
    repo.runCommand
  )
  assert.equal(result.status, 'completed')
  assert(repo.commands.some(({ command, args }) =>
    command === 'git' && args.join(' ') === 'merge --ff-only 2222222'
  ))
  assert(repo.commands.some(({ command, args }) =>
    command === 'npm' &&
    args.join(' ') === '--silent run markover -- canonical refresh'
  ))
})

test('helper persists only a strict error code when refresh fails', async (t) => {
  const repo = await fixture(t, { refreshFails: true })
  let token = ''
  await startCanonicalUpdate({
    ...repo,
    spawnDetached(_command, args) {
      token = args[3] || ''
      return {
        once() { return this },
        unref() {}
      }
    }
  })
  const result = await runCanonicalUpdateHelper(
    repo.descriptorPath,
    token,
    repo.runCommand
  )
  assert.deepEqual(result, {
    format: 'markover-canonical-update-attempt',
    version: 1,
    status: 'failed',
    error: 'REFRESH_FAILED'
  })
})

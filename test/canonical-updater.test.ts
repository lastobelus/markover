import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  CanonicalUpdateError,
  canonicalUpdateFailureDetail,
  inspectCanonicalUpdate,
  readCanonicalUpdateAttempt,
  runCanonicalUpdateHelper,
  startCanonicalUpdate
} from '../src/canonical-updater'

class FakeDetachedChild {
  readonly pid = 123

  constructor(private readonly spawnError: Error | null = null) {}

  once(event: 'spawn', listener: () => void): this
  once(event: 'error', listener: (error: Error) => void): this
  once(
    event: 'spawn' | 'error',
    listener: (() => void) | ((error: Error) => void)
  ): this {
    if (event === 'spawn' && !this.spawnError) {
      queueMicrotask(listener as () => void)
    }
    const spawnError = this.spawnError
    if (event === 'error' && spawnError) {
      queueMicrotask(() => {
        listener(spawnError)
      })
    }
    return this
  }

  unref(): void {}
}

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
  dependencyInstallFails?: boolean
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
      if (args.at(-1) === 'ci') {
        return options.dependencyInstallFails ? fail() : ok()
      }
      if (args.includes('refresh')) return options.refreshFails ? fail() : ok()
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
    return new FakeDetachedChild()
  }
  const options = {
    ...repo,
    helperPath: '/app/canonical-updater.js',
    nodeExecutable: '/node',
    npmCliPath: '/npm-cli.js',
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
  assert.equal(spawns[0]?.args[0], '/app/canonical-updater.js')
  assert.equal(spawns[0]?.args[1], '--canonical-update-helper')
  assert.equal(spawns[0]?.args[2], repo.descriptorPath)
  assert.match(spawns[0]?.args[3] || '', /^[a-f0-9]{48}$/)
  assert.equal(spawns[0]?.args[4], '/npm-cli.js')
})

test('helper revalidates, fast-forwards exactly, and invokes managed refresh', async (t) => {
  const repo = await fixture(t)
  let token = ''
  await startCanonicalUpdate({
    ...repo,
    spawnDetached(_command, args) {
      token = args[3] || ''
      return new FakeDetachedChild()
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
    command === process.execPath && args.at(-1) === 'ci'
  ))
  assert(repo.commands.some(({ command, args }) =>
    command === process.execPath &&
    args.slice(1).join(' ') === '--silent run markover -- canonical refresh'
  ))
})

test('helper persists only a strict error code when refresh fails', async (t) => {
  const repo = await fixture(t, { refreshFails: true })
  let token = ''
  await startCanonicalUpdate({
    ...repo,
    spawnDetached(_command, args) {
      token = args[3] || ''
      return new FakeDetachedChild()
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

test('helper installs locked dependencies before managed refresh', async (t) => {
  const repo = await fixture(t, { dependencyInstallFails: true })
  let token = ''
  await startCanonicalUpdate({
    ...repo,
    spawnDetached(_command, args) {
      token = args[3] || ''
      return new FakeDetachedChild()
    }
  })
  assert.deepEqual(await runCanonicalUpdateHelper(
    repo.descriptorPath,
    token,
    repo.runCommand
  ), {
    format: 'markover-canonical-update-attempt',
    version: 1,
    status: 'failed',
    error: 'DEPENDENCY_INSTALL_FAILED'
  })
  assert.equal(repo.commands.some(({ command, args }) => (
    command === process.execPath && args.includes('refresh')
  )), false)
})

test('start accepts after local preflight without fetching remote state', async (t) => {
  const repo = await fixture(t)
  await startCanonicalUpdate({
    ...repo,
    spawnDetached() { return new FakeDetachedChild() }
  })
  assert.equal(repo.commands.some(({ args }) => args[0] === 'fetch'), false)
  assert.equal(repo.commands.some(({ args }) => args.includes('FETCH_HEAD')), false)
})

test('a refresh-failure retry still launches helper after fast-forward', async (t) => {
  const mutable: FakeRepositoryOptions = { behind: 2, refreshFails: true }
  const repo = await fixture(t, mutable)
  let token = ''
  const spawnDetached = (_command: string, args: readonly string[]) => {
    token = args[3] || ''
    return new FakeDetachedChild()
  }
  await startCanonicalUpdate({ ...repo, spawnDetached })
  assert.equal((await runCanonicalUpdateHelper(
    repo.descriptorPath,
    token,
    repo.runCommand
  )).status, 'failed')

  mutable.behind = 0
  mutable.refreshFails = false
  token = ''
  await startCanonicalUpdate({ ...repo, spawnDetached })
  assert(token)
  assert.equal((await runCanonicalUpdateHelper(
    repo.descriptorPath,
    token,
    repo.runCommand
  )).status, 'completed')
  assert.equal(repo.commands.filter(({ command }) => command === process.execPath).length, 4)
})

test('persisted helper failures map to concise retry guidance', () => {
  assert.match(canonicalUpdateFailureDetail('FETCH_FAILED'), /network.*retry/i)
  assert.match(canonicalUpdateFailureDetail('DEPENDENCY_INSTALL_FAILED'), /dependencies.*retry/i)
  assert.match(canonicalUpdateFailureDetail('REFRESH_FAILED'), /refreshed.*retry/i)
})

test('start recovers a private lock and result owned by a dead process', async (t) => {
  const repo = await fixture(t)
  const stateRoot = path.dirname(repo.descriptorPath)
  await fs.writeFile(
    path.join(stateRoot, 'canonical-update.lock'),
    JSON.stringify({ version: 1, token: 'orphan', pid: 999 })
  )
  await fs.writeFile(
    path.join(stateRoot, 'canonical-update.json'),
    JSON.stringify({
      format: 'markover-canonical-update-attempt',
      version: 1,
      status: 'updating'
    })
  )
  assert.equal(await readCanonicalUpdateAttempt(
    repo.descriptorPath,
    () => false
  ), null)
  await fs.writeFile(
    path.join(stateRoot, 'canonical-update.lock'),
    JSON.stringify({ version: 1, token: 'orphan', pid: 999 })
  )
  await fs.writeFile(
    path.join(stateRoot, 'canonical-update.json'),
    JSON.stringify({
      format: 'markover-canonical-update-attempt',
      version: 1,
      status: 'updating'
    })
  )
  assert.equal((await startCanonicalUpdate({
    ...repo,
    processIsAlive: () => false,
    spawnDetached() { return new FakeDetachedChild() }
  })).status, 'updating')
})

test('start rejects an asynchronous helper spawn failure before acceptance', async (t) => {
  const repo = await fixture(t)
  await assert.rejects(
    startCanonicalUpdate({
      ...repo,
      spawnDetached() {
        return new FakeDetachedChild(new Error('private spawn detail'))
      }
    }),
    (error: unknown) => error instanceof CanonicalUpdateError &&
      error.code === 'HELPER_START_FAILED' &&
      !error.message.includes('private spawn detail')
  )
  assert.deepEqual(await readCanonicalUpdateAttempt(repo.descriptorPath), {
    format: 'markover-canonical-update-attempt',
    version: 1,
    status: 'failed',
    error: 'HELPER_START_FAILED'
  })
  await fs.access(path.join(
    path.dirname(repo.descriptorPath),
    'canonical-update.lock'
  )).then(
    () => assert.fail('spawn failure retained its lock'),
    () => {}
  )
})

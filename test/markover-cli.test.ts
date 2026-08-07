import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  ensureService,
  executeCommand,
  helpPayload,
  parseCommandArguments,
  readSessionDiscoverySetting,
  resolveMarkoverApp,
  type ExecuteCommandOptions
} from '../scripts/markover'
import { guidance } from '../src/agent-guidance'
import { LocalServiceError } from '../src/local-client'
import { startLocalService, type LocalService } from '../src/local-service'
import {
  assertReviewArtifact,
  ReviewStore
} from '../src/review-store'
import {
  createServiceIdentity,
  publishServiceConnection
} from '../src/service-endpoint'

function commandUsage(error: unknown): string | undefined {
  return error instanceof Error && 'usage' in error
    ? String(error.usage)
    : undefined
}

test('parses open, get, and edit commands', () => {
  assert.deepEqual(
    parseCommandArguments([
      'open',
      'plan.md',
      '--summary',
      'Review the plan.'
    ]),
    {
      command: 'open',
      sourcePath: 'plan.md',
      contextSummary: 'Review the plan.',
      branch: null,
      handoffKey: null,
      pullRequestNumber: null,
      threadId: null
    }
  )
  assert.deepEqual(
    parseCommandArguments(['get', 'mko_aaa11111']),
    { command: 'get', reviewId: 'mko_aaa11111' }
  )
  assert.deepEqual(
    parseCommandArguments(['edit', 'mko_aaa11111']),
    { command: 'edit', reviewId: 'mko_aaa11111' }
  )
})

test('help and info aliases return service-free machine-readable guidance', async () => {
  for (const args of [[], ['help'], ['info'], ['--help'], ['-h']]) {
    const parsed = parseCommandArguments(args)
    assert.deepEqual(parsed, { command: 'help' })
    let ensured = false
    const result = await executeCommand(parsed, {
      ensure() {
        ensured = true
        return Promise.resolve()
      }
    })
    assert.deepEqual(result, helpPayload())
    assert.equal(ensured, false)
  }
})

test('CLI help is strict JSON and misuse gives an exact recovery path', () => {
  const cliPath = path.resolve(__dirname, '../scripts/markover.js')
  const help = spawnSync(process.execPath, [cliPath, 'help'], {
    encoding: 'utf8'
  })
  assert.equal(help.status, 0)
  assert.equal(help.stderr, '')
  assert.deepEqual(JSON.parse(help.stdout), helpPayload())
  assert.equal(helpPayload().repository, 'https://github.com/lastobelus/markover')
  assert.match(helpPayload().requirements.platform, /Apple Silicon or Intel/)
  assert.equal(helpPayload().requirements.node, '22.13.0 or newer')
  assert.match(helpPayload().requirements.installation, /needs no installation/)
  assert.deepEqual(
    helpPayload().defaultAgentGuidance,
    guidance()
  )
  assert.match(
    helpPayload().workflow.join(' '),
    /review\.agentGuidance\.fixedContract/
  )

  const misuse = spawnSync(process.execPath, [cliPath, 'wat'], {
    encoding: 'utf8'
  })
  assert.equal(misuse.status, 1)
  assert.equal(misuse.stdout, '')
  assert.match(misuse.stderr, /Unknown command: wat/)
  assert.match(misuse.stderr, /Usage: markover <open\|get\|edit\|help>/)
  assert.match(
    misuse.stderr,
    /Run "npm --silent run markover -- help" for complete usage\./
  )
})

test('common agent mistakes point directly to the intended command', () => {
  assert.throws(
    () => parseCommandArguments(['/tmp/review.md']),
    (error: unknown) => (
      error instanceof Error &&
      /use the open command/.test(error.message) &&
      commandUsage(error) === "markover open '/tmp/review.md' --summary <text>"
    )
  )
  assert.throws(
    () => parseCommandArguments(['/tmp/my review.md']),
    (error: unknown) => commandUsage(error) ===
      "markover open '/tmp/my review.md' --summary <text>"
  )
  assert.throws(
    () => parseCommandArguments(['check']),
    (error: unknown) => (
      error instanceof Error &&
      /run get with the retained review ID/.test(error.message) &&
      commandUsage(error) === 'markover get <review-id>'
    )
  )
})

test('parses explicit review metadata', () => {
  assert.deepEqual(
    parseCommandArguments([
      'open',
      'plan.md',
      '--summary',
      'Review the plan.',
      '--branch',
      'feature/review-inbox',
      '--handoff-key',
      'mko_handoff_0123456789abcdef',
      '--pr',
      '42',
      '--thread-id',
      'thread-123'
    ]),
    {
      command: 'open',
      sourcePath: 'plan.md',
      contextSummary: 'Review the plan.',
      branch: 'feature/review-inbox',
      handoffKey: 'mko_handoff_0123456789abcdef',
      pullRequestNumber: 42,
      threadId: 'thread-123'
    }
  )
  assert.throws(
    () => parseCommandArguments([
      'open',
      'plan.md',
      '--summary',
      'Review.',
      '--pr',
      'not-a-number'
    ]),
    /positive integer/
  )
  assert.throws(
    () => parseCommandArguments([
      'open',
      'plan.md',
      '--summary',
      'Review.',
      '--branch',
      '   '
    ]),
    /branch requires a non-empty value/
  )
  assert.throws(
    () => parseCommandArguments([
      'open',
      'plan.md',
      '--summary',
      'Review.',
      '--thread-id',
      '   '
    ]),
    /thread-id requires a non-empty value/
  )
  assert.throws(
    () => parseCommandArguments([
      'open',
      'plan.md',
      '--summary',
      'Review.',
      '--handoff-key',
      '   '
    ]),
    /handoff-key must match/
  )
})

test('local session discovery defaults on and fails closed for damaged settings', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-cli-settings-test-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const settingsPath = path.join(directory, 'settings.json')

  assert.equal(await readSessionDiscoverySetting(settingsPath), true)
  await fs.writeFile(settingsPath, JSON.stringify({
    discoverAgentThreadFromLocalSessions: false
  }))
  assert.equal(await readSessionDiscoverySetting(settingsPath), false)
  await fs.writeFile(settingsPath, '{not json')
  assert.equal(await readSessionDiscoverySetting(settingsPath), false)
  assert.equal(await readSessionDiscoverySetting(directory), false)
})

test('requires one path and a context summary for open', () => {
  assert.throws(
    () => parseCommandArguments(['open', 'plan.md']),
    /requires --summary/
  )
  assert.throws(
    () => parseCommandArguments([
      'open',
      'one.md',
      'two.md',
      '--summary',
      'Review.'
    ]),
    /exactly one/
  )
})

test('executes CLI commands against the local service', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-cli-test-')
  )
  const reviewsDirectory = path.join(directory, 'reviews')
  const endpointPath = path.join(directory, 'service.json')
  const sourcePath = path.join(directory, 'plan.md')
  await fs.writeFile(sourcePath, '# Plan\r\n\r\nKeep this exact.\r\n', 'utf8')

  const reviewIds = ['mko_aaa11111', 'mko_bbb22222']
  const store = new ReviewStore(reviewsDirectory, {
    idFactory: () => reviewIds.shift() || 'mko_unexpected'
  })
  const identity = createServiceIdentity()
  const service = await startLocalService({
    identity,
    store
  })
  await publishServiceConnection({
    endpointPath,
    identity,
    port: service.port,
    pid: 1234
  })
  t.after(async () => {
    await service.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const discoveredHandoffKeys: Array<string | null | undefined> = []
  let discoverySettingReads = 0
  const options: ExecuteCommandOptions = {
    endpointPath,
    ensure: () => Promise.resolve(),
    readSessionDiscoverySetting() {
      discoverySettingReads += 1
      return Promise.resolve(false)
    },
    discoverMetadata(parsed) {
      assert.equal(parsed.sourcePath, sourcePath)
      discoveredHandoffKeys.push(parsed.handoffKey)
      return Promise.resolve({
        git: parsed.branch ? {
          branch: parsed.branch,
          sources: { branch: 'explicit' as const }
        } : null,
        pullRequest: parsed.pullRequestNumber ? {
          number: parsed.pullRequestNumber,
          discovery: 'explicit' as const
        } : null,
        agentThread: parsed.threadId ? {
          provider: 'codex',
          id: parsed.threadId,
          discovery: 'explicit' as const
        } : null
      })
    }
  }
  assert.deepEqual(
    await executeCommand({
      command: 'open',
      sourcePath,
      contextSummary: 'Review exact source.',
      branch: 'feature/review-inbox',
      handoffKey: 'mko_handoff_0123456789abcdef',
      pullRequestNumber: 42,
      threadId: 'thread-123'
    }, options),
    { reviewId: 'mko_aaa11111', status: 'editing' }
  )

  const handedOff = await executeCommand({
    command: 'get',
    reviewId: 'mko_aaa11111'
  }, options)
  assertReviewArtifact(handedOff, 'mko_aaa11111')
  assert.equal(
    handedOff.sourceDocument.content,
    '# Plan\r\n\r\nKeep this exact.\r\n'
  )
  assert.equal(handedOff.review.contextSummary, 'Review exact source.')
  assert.deepEqual(handedOff.review.git, {
    branch: 'feature/review-inbox',
    sources: { branch: 'explicit' }
  })
  assert.deepEqual(handedOff.review.pullRequest, {
    number: 42,
    discovery: 'explicit'
  })
  assert.deepEqual(handedOff.review.agentThread, {
    provider: 'codex',
    id: 'thread-123',
    discovery: 'explicit'
  })

  assert.deepEqual(
    await executeCommand({
      command: 'edit',
      reviewId: 'mko_aaa11111'
    }, options),
    { reviewId: 'mko_aaa11111', status: 'editing' }
  )

  assert.deepEqual(
    await executeCommand({
      command: 'open',
      sourcePath,
      contextSummary: 'Review without local session discovery.',
      handoffKey: 'mko_handoff_fedcba9876543210',
      threadId: null
    }, options),
    { reviewId: 'mko_bbb22222', status: 'editing' }
  )
  assert.deepEqual(discoveredHandoffKeys, [
    'mko_handoff_0123456789abcdef',
    null
  ])
  assert.equal(discoverySettingReads, 1)
})

test('waits for internally started service without external polling', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-start-test-')
  )
  const endpointPath = path.join(directory, 'service.json')
  let service: LocalService | null = null
  let startCalls = 0
  t.after(async () => {
    if (service) await service.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  await ensureService({
    endpointPath,
    timeoutMilliseconds: 2000,
    startApp() {
      startCalls += 1
      setTimeout(() => {
        void (async () => {
          const identity = createServiceIdentity()
          service = await startLocalService({
            identity,
            store: new ReviewStore(path.join(directory, 'reviews'))
          })
          await publishServiceConnection({
            endpointPath,
            identity,
            port: service.port,
            pid: 1234
          })
        })()
      }, 50)
    }
  })

  assert.ok(service)
  assert.equal(startCalls, 1)
})

test('bounded recovery never attempts forced process replacement', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-restart-required-test-')
  )
  const endpointPath = path.join(directory, 'service.json')
  let startCalls = 0
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  await assert.rejects(
    ensureService({
      endpointPath,
      timeoutMilliseconds: 1,
      startApp() {
        startCalls += 1
      }
    }),
    (error: unknown) => (
      error instanceof LocalServiceError &&
      error.code === 'SERVICE_RESTART_REQUIRED' &&
      /Quit and reopen Markover/.test(error.message)
    )
  )
  assert.equal(startCalls, 1)
})

test('cold startup prefers a packaged Markover app and supports an override', () => {
  const seen: string[] = []
  const exists = (candidate: string): boolean => {
    seen.push(candidate)
    return candidate === '/Users/reviewer/Applications/Markover.app'
  }
  assert.equal(
    resolveMarkoverApp({
      architecture: 'arm64',
      environment: {},
      exists,
      homeDirectory: '/Users/reviewer'
    }),
    '/Users/reviewer/Applications/Markover.app'
  )
  assert.ok(seen.some((candidate) => candidate.includes('Markover-darwin-arm64')))

  assert.equal(
    resolveMarkoverApp({
      environment: { MARKOVER_APP_PATH: '/Custom/Markover.app' },
      exists: (candidate: string) => candidate === '/Custom/Markover.app'
    }),
    '/Custom/Markover.app'
  )
})

test('open validates and reads the source before starting Markover', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-missing-source-test-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  let ensured = false
  await assert.rejects(
    executeCommand({
      command: 'open',
      sourcePath: path.join(directory, 'missing.md'),
      contextSummary: 'Review the missing source.',
      branch: null,
      handoffKey: null,
      pullRequestNumber: null,
      threadId: null
    }, {
      ensure() {
        ensured = true
        return Promise.resolve()
      }
    }),
    /Markdown file does not exist/
  )
  assert.equal(ensured, false)
})

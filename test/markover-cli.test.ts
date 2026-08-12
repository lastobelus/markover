import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
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
import type { ResolvedInstance } from '../src/instance'
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

test('parses lifecycle commands and PR observations', () => {
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
      pullRequestUrl: null,
      pullRequestStatus: null,
      threadId: null,
      threadHostKind: null,
      threadHostProvider: null,
      threadHostThreadId: null,
      threadHostMachine: null
    }
  )
  assert.deepEqual(
    parseCommandArguments(['get', 'mko_aaa11111']),
    {
      command: 'get',
      reviewId: 'mko_aaa11111',
      pullRequestStatus: null
    }
  )
  assert.deepEqual(
    parseCommandArguments([
      'revise',
      'mko_aaa11111',
      '--pr-status',
      'open'
    ]),
    {
      command: 'revise',
      reviewId: 'mko_aaa11111',
      pullRequestStatus: 'open'
    }
  )
  assert.deepEqual(
    parseCommandArguments([
      'done',
      'https://github.com/lastobelus/markover/pull/123',
      '--pr-status',
      'merged'
    ]),
    {
      command: 'done',
      pullRequestUrl: 'https://github.com/lastobelus/markover/pull/123',
      pullRequestStatus: 'merged'
    }
  )
  assert.deepEqual(
    parseCommandArguments(['edit', 'mko_aaa11111']),
    { command: 'edit', reviewId: 'mko_aaa11111' }
  )
})

test('development targeting is worktree-local and cleanup requires an exact identity', () => {
  assert.deepEqual(
    parseCommandArguments(['--instance', 'dev', 'get', 'mko_aaa11111']),
    {
      command: 'get',
      instance: 'development',
      reviewId: 'mko_aaa11111',
      pullRequestStatus: null
    }
  )
  assert.deepEqual(
    parseCommandArguments(['--instance', 'dev', 'cleanup', 'pr-61']),
    {
      command: 'cleanup',
      expectedIdentity: 'pr-61',
      instance: 'development'
    }
  )
  assert.throws(
    () => parseCommandArguments(['cleanup', 'pr-61']),
    /only for the current development worktree/
  )
  assert.throws(
    () => parseCommandArguments(['--instance', 'dev', 'cleanup', 'pr-0']),
    /requires one exact pr-N identity|cleanup/,
  )
  assert.throws(
    () => parseCommandArguments(['get', 'mko_aaa11111', '--instance', 'dev']),
    /global option/
  )
})

test('cleanup resolves the current PR exactly without starting a service', async () => {
  const instance = {
    identity: { kind: 'development', key: 'pr-61', pullRequestNumber: 61 }
  } as unknown as ResolvedInstance
  let resolved: readonly [string, number | undefined] | null = null
  let cleaned: readonly [ResolvedInstance, string] | null = null
  const result = await executeCommand({
    command: 'cleanup',
    expectedIdentity: 'pr-61',
    instance: 'development'
  }, {
    resolveTarget(selector, expectedPullRequestNumber) {
      resolved = [selector, expectedPullRequestNumber]
      return Promise.resolve(instance)
    },
    cleanup(target, expectedIdentity) {
      cleaned = [target, expectedIdentity]
      return Promise.resolve({
        status: 'trashed',
        identity: 'pr-61',
        recoveryPath: '/Users/reviewer/.Trash/Markover-pr-61-instance'
      })
    },
    ensure() {
      throw new Error('cleanup must not start Markover')
    }
  })
  assert.deepEqual(resolved, ['development', 61])
  assert.deepEqual(cleaned, [instance, 'pr-61'])
  assert.deepEqual(result, {
    status: 'trashed',
    identity: 'pr-61',
    recoveryPath: '/Users/reviewer/.Trash/Markover-pr-61-instance'
  })
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
  assert.match(helpPayload().requirements.platform, /Apple Silicon only/)
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
  assert.equal(
    helpPayload().pullRequestStatus.lookup,
    'gh pr view <pull-request-url-or-number> --json state,isDraft,url'
  )
  assert.match(helpPayload().pullRequestStatus.failure, /does not block/)
  assert.match(helpPayload().workflow.join(' '), /run revise once/)
  assert.match(
    helpPayload().workflow.join(' '),
    /On open, pass its canonical url with --pr-url/
  )
  assert.match(
    helpPayload().pullRequestStatus.failure,
    /retain --pr and a known canonical --pr-url.*omit the PR association/
  )
  assert.match(
    helpPayload().workflow.join(' '),
    /add feedback before revise, run edit.*After revise, open a new review/
  )
  assert.match(helpPayload().workflow.join(' '), /--pr-status merged/)

  const misuse = spawnSync(process.execPath, [cliPath, 'wat'], {
    encoding: 'utf8'
  })
  assert.equal(misuse.status, 1)
  assert.equal(misuse.stdout, '')
  assert.match(misuse.stderr, /Unknown command: wat/)
  assert.match(
    misuse.stderr,
    /Usage: markover <open\|get\|revise\|done\|edit\|cleanup\|help>/
  )
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
      '--pr',
      '42',
      '--pr-url',
      'https://github.com/upstream/markover/pull/42',
      '--pr-status',
      'draft',
      '--thread-id',
      'thread-123',
      '--thread-host-kind',
      't3code',
      '--thread-host-provider',
      'codex',
      '--thread-host-thread-id',
      't3-thread-456',
      '--thread-host-machine',
      'Airy.local'
    ]),
    {
      command: 'open',
      sourcePath: 'plan.md',
      contextSummary: 'Review the plan.',
      branch: 'feature/review-inbox',
      handoffKey: null,
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/upstream/markover/pull/42',
      pullRequestStatus: 'draft',
      threadId: 'thread-123',
      threadHostKind: 't3code',
      threadHostProvider: 'codex',
      threadHostThreadId: 't3-thread-456',
      threadHostMachine: 'Airy.local'
    }
  )
  assert.throws(
    () => parseCommandArguments([
      'open',
      'plan.md',
      '--summary',
      'Review.',
      '--thread-id',
      'provider-thread',
      '--handoff-key',
      'mko_handoff_0123456789abcdef',
      '--thread-host-kind',
      't3code',
      '--thread-host-provider',
      'codex'
    ]),
    /thread-id and --handoff-key are alternatives/
  )
  assert.throws(
    () => parseCommandArguments([
      'open',
      'plan.md',
      '--summary',
      'Review.',
      '--thread-id',
      'provider-thread'
    ]),
    /requires --thread-host-kind and --thread-host-provider/
  )
  assert.throws(
    () => parseCommandArguments([
      'open',
      'plan.md',
      '--summary',
      'Review.',
      '--thread-id',
      'same-thread',
      '--thread-host-kind',
      'codex',
      '--thread-host-provider',
      'codex',
      '--thread-host-thread-id',
      'same-thread'
    ]),
    /must be omitted when it duplicates/
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
      '--pr',
      '42',
      '--pr-url',
      'https://github.com/upstream/markover/pull/43'
    ]),
    /must identify the pull request number/
  )
  assert.throws(
    () => parseCommandArguments([
      'open',
      'plan.md',
      '--summary',
      'Review.',
      '--pr',
      '42',
      '--pr-status',
      'open'
    ]),
    /requires --pr and --pr-url/
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

  const reviewIds = ['mko_aaa11111', 'mko_bbb22222', 'mko_ccc33333']
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
          repositoryUrl: 'git@github.com:fork-owner/markover.git'
        } : null,
        pullRequest: parsed.pullRequestNumber ? {
          number: parsed.pullRequestNumber,
          ...(parsed.pullRequestUrl ? { url: parsed.pullRequestUrl } : {})
        } : null,
        agentThread: parsed.threadId &&
          parsed.threadHostKind &&
          parsed.threadHostProvider ? {
          id: parsed.threadId,
          threadHost: {
            kind: parsed.threadHostKind,
            provider: parsed.threadHostProvider,
            ...(parsed.threadHostThreadId
              ? { threadId: parsed.threadHostThreadId }
              : {}),
            ...(parsed.threadHostMachine
              ? { machine: parsed.threadHostMachine }
              : {})
          }
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
      pullRequestUrl: 'https://github.com/lastobelus/markover/pull/42',
      threadId: 'thread-123',
      threadHostKind: 't3code',
      threadHostProvider: 'codex',
      threadHostThreadId: 't3-thread-456',
      threadHostMachine: 'Airy.local'
    }, options),
    {
      reviewId: 'mko_aaa11111',
      status: 'editing',
      reviewUrl: 'markover://review/mko_aaa11111'
    }
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
    repositoryUrl: 'git@github.com:fork-owner/markover.git'
  })
  assert.deepEqual(handedOff.review.pullRequest, {
    number: 42,
    url: 'https://github.com/lastobelus/markover/pull/42'
  })
  assert.deepEqual(handedOff.review.agentThread, {
    id: 'thread-123',
    threadHost: {
      kind: 't3code',
      provider: 'codex',
      threadId: 't3-thread-456',
      machine: 'Airy.local'
    }
  })

  assert.deepEqual(
    await executeCommand({
      command: 'edit',
      reviewId: 'mko_aaa11111'
    }, options),
    { reviewId: 'mko_aaa11111', status: 'editing' }
  )

  const observedHandoff = await executeCommand({
    command: 'get',
    reviewId: 'mko_aaa11111',
    pullRequestStatus: 'open'
  }, options)
  assertReviewArtifact(observedHandoff, 'mko_aaa11111')
  assert.equal(
    (observedHandoff.review.pullRequest as Record<string, unknown>).status,
    'open'
  )
  assert.deepEqual(
    await executeCommand({
      command: 'revise',
      reviewId: 'mko_aaa11111',
      pullRequestStatus: 'open'
    }, options),
    { reviewId: 'mko_aaa11111', status: 'revised' }
  )
  assert.deepEqual(
    await executeCommand({
      command: 'done',
      pullRequestUrl: 'https://github.com/lastobelus/markover/pull/42',
      pullRequestStatus: 'merged'
    }, options),
    {
      pullRequestUrl: 'https://github.com/lastobelus/markover/pull/42',
      reviewIds: ['mko_aaa11111'],
      status: 'done'
    }
  )

  assert.deepEqual(
    await executeCommand({
      command: 'open',
      sourcePath,
      contextSummary: 'Review without local session discovery.',
      handoffKey: 'mko_handoff_fedcba9876543210',
      threadId: null
    }, options),
    {
      reviewId: 'mko_bbb22222',
      status: 'editing',
      reviewUrl: 'markover://review/mko_bbb22222'
    }
  )
  assert.deepEqual(
    await executeCommand({
      command: 'open',
      instance: 'development',
      sourcePath,
      contextSummary: 'Review in this PR instance.'
    }, {
      ensure: () => Promise.resolve(),
      resolveTarget(selector) {
        assert.equal(selector, 'development')
        return Promise.resolve({
          checkout: null,
          scheme: 'markover-76',
          service: { endpointPath }
        } as unknown as ResolvedInstance)
      },
      discoverMetadata() {
        return Promise.resolve({
          agentThread: null,
          git: null,
          pullRequest: null
        })
      }
    }),
    {
      reviewId: 'mko_ccc33333',
      status: 'editing',
      reviewUrl: 'markover-76://review/mko_ccc33333'
    }
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

test('bounded startup reports the diagnostic without relaunching', async (t) => {
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
      error.code === 'SERVICE_STARTUP_TIMEOUT' &&
      /startup-diagnostic\.json/.test(error.message) &&
      /remains available/.test(error.message)
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

test('get independently rejects a successful unknown-version service response', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-cli-future-version-test-')
  )
  const endpointPath = path.join(directory, 'service.json')
  const identity = createServiceIdentity()
  const service = http.createServer((request, response) => {
    const body = request.url === '/health'
      ? { status: 'ok', version: 2, instanceId: identity.instanceId }
      : { format: 'markover-review', version: 2 }
    const contents = `${JSON.stringify(body)}\n`
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(contents)
    })
    response.end(contents)
  })
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve))
  const address = service.address()
  assert.ok(address && typeof address === 'object')
  await publishServiceConnection({
    endpointPath,
    identity,
    port: address.port,
    pid: 1234
  })
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      service.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    await fs.rm(directory, { recursive: true, force: true })
  })

  await assert.rejects(
    executeCommand({ command: 'get', reviewId: 'mko_aaa11111' }, {
      endpointPath,
      ensure: () => Promise.resolve()
    }),
    (error: unknown) => (
      error instanceof LocalServiceError &&
      error.code === 'UNSUPPORTED_REVIEW_VERSION'
    )
  )
})

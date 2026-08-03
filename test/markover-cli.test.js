const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  ensureService,
  executeCommand,
  helpPayload,
  parseCommandArguments,
  resolveMarkoverApp
} = require('../scripts/markover')
const { startLocalService } = require('../src/local-service')
const { ReviewStore } = require('../src/review-store')

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
      ensure: async () => { ensured = true }
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
  assert.match(helpPayload().requirements.installation, /needs no installation/)

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
    (error) => (
      /use the open command/.test(error.message) &&
      error.usage === "markover open '/tmp/review.md' --summary <text>"
    )
  )
  assert.throws(
    () => parseCommandArguments(['/tmp/my review.md']),
    (error) => error.usage ===
      "markover open '/tmp/my review.md' --summary <text>"
  )
  assert.throws(
    () => parseCommandArguments(['check']),
    (error) => (
      /run get with the retained review ID/.test(error.message) &&
      error.usage === 'markover get <review-id>'
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

  const store = new ReviewStore(reviewsDirectory, {
    idFactory: () => 'mko_aaa11111'
  })
  const service = await startLocalService({ store })
  await fs.writeFile(endpointPath, JSON.stringify({
    version: 1,
    port: service.port
  }))
  t.after(async () => {
    await service.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const options = {
    endpointPath,
    ensure: async () => {},
    async discoverMetadata(parsed) {
      assert.equal(parsed.sourcePath, sourcePath)
      return {
        git: {
          branch: parsed.branch,
          sources: { branch: 'explicit' }
        },
        pullRequest: {
          number: parsed.pullRequestNumber,
          discovery: 'explicit'
        },
        agentThread: {
          provider: 'codex',
          id: parsed.threadId,
          discovery: 'explicit'
        }
      }
    }
  }
  assert.deepEqual(
    await executeCommand({
      command: 'open',
      sourcePath,
      contextSummary: 'Review exact source.',
      branch: 'feature/review-inbox',
      pullRequestNumber: 42,
      threadId: 'thread-123'
    }, options),
    { reviewId: 'mko_aaa11111', status: 'editing' }
  )

  const handedOff = await executeCommand({
    command: 'get',
    reviewId: 'mko_aaa11111'
  }, options)
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
})

test('waits for internally started service without external polling', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-start-test-')
  )
  const endpointPath = path.join(directory, 'service.json')
  let service = null
  t.after(async () => {
    if (service) await service.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  await ensureService({
    endpointPath,
    timeoutMilliseconds: 2000,
    startApp() {
      setTimeout(async () => {
        service = await startLocalService({
          store: new ReviewStore(path.join(directory, 'reviews'))
        })
        await fs.writeFile(endpointPath, JSON.stringify({
          version: 1,
          port: service.port
        }))
      }, 50)
    }
  })

  assert.ok(service)
})

test('cold startup prefers a packaged Markover app and supports an override', () => {
  const seen = []
  const exists = (candidate) => {
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
      exists: (candidate) => candidate === '/Custom/Markover.app'
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
      ensure: async () => { ensured = true }
    }),
    /Markdown file does not exist/
  )
  assert.equal(ensured, false)
})

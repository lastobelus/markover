const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  applicationLabel,
  ensureService,
  executeCommand,
  parseCommandArguments
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
      '--thread-id',
      'thread-123'
    ]),
    {
      command: 'open',
      sourcePath: 'plan.md',
      contextSummary: 'Review the plan.',
      branch: 'feature/review-inbox',
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
})

test('uses a checkout-specific launch service label', () => {
  assert.equal(
    applicationLabel('/tmp/one'),
    applicationLabel('/tmp/one')
  )
  assert.notEqual(
    applicationLabel('/tmp/one'),
    applicationLabel('/tmp/two')
  )
  assert.match(applicationLabel('/tmp/one'), /^com\.markover\.app\.[a-f0-9]{12}$/)
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

  const options = { endpointPath, ensure: async () => {} }
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
    branch: 'feature/review-inbox'
  })
  assert.deepEqual(handedOff.review.pullRequest, { number: 42 })
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

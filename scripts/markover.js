#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const electronPath = require('electron')
const { requestJson } = require('../src/local-client')
const {
  discoverReviewMetadata,
  HANDOFF_KEY_PATTERN
} = require('../src/metadata-discovery')
const { parseMarkdown } = require('../src/tree')

const projectDirectory = path.resolve(__dirname, '..')
const defaultEndpointPath = path.join(
  projectDirectory,
  '.markover',
  'service.json'
)

function parseCommandArguments(args) {
  const [command, ...rest] = args
  if (!['open', 'get', 'edit'].includes(command)) {
    throw new Error('Expected: markover <open|get|edit> ...')
  }

  if (command === 'get' || command === 'edit') {
    if (rest.length !== 1 || rest[0].startsWith('--')) {
      throw new Error(`${command} requires exactly one review ID.`)
    }
    return { command, reviewId: rest[0] }
  }

  let sourcePath = null
  let contextSummary = null
  let branch = null
  let handoffKey = null
  let pullRequestNumber = null
  let threadId = null
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (
      argument === '--summary' ||
      argument === '--branch' ||
      argument === '--handoff-key' ||
      argument === '--pr' ||
      argument === '--thread-id'
    ) {
      const value = rest[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`)
      }
      if (argument === '--summary') contextSummary = value
      if (argument === '--branch') branch = value
      if (argument === '--handoff-key') handoffKey = value
      if (argument === '--thread-id') threadId = value
      if (argument === '--pr') {
        pullRequestNumber = Number(value)
        if (
          !Number.isSafeInteger(pullRequestNumber) ||
          pullRequestNumber < 1
        ) {
          throw new Error('--pr requires a positive integer.')
        }
      }
      index += 1
      continue
    }
    if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`)
    }
    if (sourcePath) throw new Error('open requires exactly one Markdown path.')
    sourcePath = argument
  }

  if (!sourcePath) throw new Error('open requires a Markdown path.')
  if (!contextSummary?.trim()) {
    throw new Error('open requires --summary <text>.')
  }
  if (branch !== null) {
    branch = branch.trim()
    if (!branch) throw new Error('--branch requires a non-empty value.')
  }
  if (threadId !== null) {
    threadId = threadId.trim()
    if (!threadId) throw new Error('--thread-id requires a non-empty value.')
  }
  if (handoffKey !== null) {
    handoffKey = handoffKey.trim()
    if (!HANDOFF_KEY_PATTERN.test(handoffKey)) {
      throw new Error(
        '--handoff-key must match mko_handoff_ followed by 16–64 letters or digits.'
      )
    }
  }
  return {
    command,
    sourcePath,
    contextSummary,
    branch,
    handoffKey,
    pullRequestNumber,
    threadId
  }
}

function checksum(source) {
  return `sha256:${crypto.createHash('sha256').update(source, 'utf8').digest('hex')}`
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function applicationLabel(directory = projectDirectory) {
  const suffix = crypto
    .createHash('sha256')
    .update(path.resolve(directory))
    .digest('hex')
    .slice(0, 12)
  return `com.markover.app.${suffix}`
}

function launchdJobExists(label) {
  const domain = `gui/${process.getuid()}/${label}`
  return spawnSync(
    '/bin/launchctl',
    ['print', domain],
    { stdio: 'ignore' }
  ).status === 0
}

function startDetachedApp({ replaceStale = false } = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('Automatic Markover startup currently requires macOS.')
  }

  const label = applicationLabel()
  if (replaceStale) {
    spawnSync('/bin/launchctl', ['remove', label], { stdio: 'ignore' })
  }
  const cleanEnvironment = [
    '/usr/bin/env',
    '-i',
    `HOME=${os.homedir()}`,
    `TMPDIR=${os.tmpdir()}`,
    `USER=${os.userInfo().username}`,
    'PATH=/usr/bin:/bin:/usr/sbin:/sbin',
    electronPath,
    projectDirectory,
    '--markover-server'
  ]
  const result = spawnSync(
    '/bin/launchctl',
    ['submit', '-l', label, '--', ...cleanEnvironment],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    if (launchdJobExists(label)) return label
    throw new Error(result.stderr.trim() || `launchctl exited ${result.status}`)
  }
  return label
}

async function waitForService(endpointPath, deadline) {
  let lastError = null
  while (Date.now() < deadline) {
    try {
      await requestJson(endpointPath, 'GET', '/health')
      return
    } catch (error) {
      lastError = error
      await delay(100)
    }
  }
  throw lastError || new Error('Markover service startup timed out.')
}

async function ensureService({
  endpointPath = defaultEndpointPath,
  startApp = startDetachedApp,
  timeoutMilliseconds = 10000
} = {}) {
  try {
    await requestJson(endpointPath, 'GET', '/health')
    return
  } catch {
    startApp({ replaceStale: false })
  }

  const startedAt = Date.now()
  const recoveryAt = startedAt + Math.max(
    500,
    Math.floor(timeoutMilliseconds * 0.7)
  )
  try {
    await waitForService(endpointPath, recoveryAt)
    return
  } catch {
    startApp({ replaceStale: true })
  }

  try {
    await waitForService(endpointPath, startedAt + timeoutMilliseconds)
  } catch (error) {
    throw new Error(`Markover did not start: ${error.message}`)
  }
}

async function executeCommand(
  parsed,
  {
    endpointPath = defaultEndpointPath,
    ensure = () => ensureService({ endpointPath }),
    discoverMetadata = discoverReviewMetadata
  } = {}
) {
  await ensure()

  if (parsed.command === 'open') {
    const sourcePath = path.resolve(parsed.sourcePath)
    const stats = await fs.stat(sourcePath)
    if (!stats.isFile()) throw new Error(`Not a file: ${sourcePath}`)
    const source = await fs.readFile(sourcePath, 'utf8')
    const tree = parseMarkdown(source, checksum(source), {
      name: path.basename(sourcePath),
      path: sourcePath
    })
    const metadata = await discoverMetadata({
      sourcePath,
      branch: parsed.branch,
      pullRequestNumber: parsed.pullRequestNumber,
      threadId: parsed.threadId,
      handoffKey: parsed.handoffKey
    })
    return requestJson(endpointPath, 'POST', '/reviews', {
      tree,
      metadata: {
        contextSummary: parsed.contextSummary,
        ...metadata
      }
    })
  }

  const reviewId = encodeURIComponent(parsed.reviewId)
  if (parsed.command === 'get') {
    return requestJson(
      endpointPath,
      'POST',
      `/reviews/${reviewId}/handoff`
    )
  }
  return requestJson(endpointPath, 'POST', `/reviews/${reviewId}/edit`)
}

async function main() {
  try {
    const parsed = parseCommandArguments(process.argv.slice(2))
    const result = await executeCommand(parsed)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`markover: ${error.message}\n`)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {
  applicationLabel,
  checksum,
  defaultEndpointPath,
  ensureService,
  executeCommand,
  parseCommandArguments,
  startDetachedApp
}

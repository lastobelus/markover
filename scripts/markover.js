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

const helpAliases = new Set(['help', 'info', '--help', '-h'])
const recoveryHint =
  'Run "npm --silent run markover -- help" for complete usage.'

function commandError(message, usage) {
  const error = new Error(message)
  error.usage = usage
  return error
}

function helpPayload() {
  return {
    format: 'markover-help',
    version: 1,
    purpose: 'Review Markdown as a block tree and return structured feedback to an agent.',
    invocation: 'npm --silent run markover -- <command>',
    workflow: [
      'Create the Markdown file before opening it.',
      'Run open once, then retain the returned reviewId in the agent thread.',
      'Give the user the review ID and wait for them to say "Check Markover."',
      'Run get once after that instruction; it returns the frozen markover-review JSON.',
      'If the user wants to add feedback afterward, run edit before asking them to continue.'
    ],
    commands: [
      {
        name: 'open',
        usage: 'open <markdown-path> --summary <text> [--branch <name>] [--pr <number>] [--thread-id <id>] [--handoff-key <key>]',
        purpose: 'Open a durable, non-blocking review and print {reviewId,status} as JSON.'
      },
      {
        name: 'get',
        usage: 'get <review-id>',
        purpose: 'Freeze one review and print its complete markover-review JSON.'
      },
      {
        name: 'edit',
        usage: 'edit <review-id>',
        purpose: 'Return a frozen review to editing so the user can add or change feedback.'
      },
      {
        name: 'help',
        aliases: ['info', '--help', '-h'],
        usage: 'help',
        purpose: 'Print this machine-readable help without starting Markover.'
      }
    ],
    stdout: 'Success writes exactly one JSON value to stdout. Diagnostics use stderr and a non-zero exit status.',
    persistence: '.markover/reviews/<review-id>/review.json'
  }
}

function formatCommandError(error) {
  const lines = [`markover: ${error.message}`]
  if (error.usage) lines.push(`Usage: ${error.usage}`)
  lines.push(recoveryHint)
  return `${lines.join('\n')}\n`
}

function parseCommandArguments(args) {
  const [command, ...rest] = args
  if (!command || helpAliases.has(command)) {
    if (rest.length) {
      throw commandError(
        `${command} does not accept arguments.`,
        'markover help'
      )
    }
    return { command: 'help' }
  }
  if (!['open', 'get', 'edit'].includes(command)) {
    throw commandError(
      `Unknown command: ${command}`,
      'markover <open|get|edit|help> ...'
    )
  }

  if (command === 'get' || command === 'edit') {
    if (rest.length !== 1 || rest[0].startsWith('--')) {
      throw commandError(
        `${command} requires exactly one review ID.`,
        `markover ${command} <review-id>`
      )
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
        throw commandError(
          `${argument} requires a value.`,
          'markover open <markdown-path> --summary <text>'
        )
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
          throw commandError(
            '--pr requires a positive integer.',
            'markover open <markdown-path> --summary <text> --pr <number>'
          )
        }
      }
      index += 1
      continue
    }
    if (argument.startsWith('--')) {
      throw commandError(
        `Unknown option for open: ${argument}`,
        'markover open <markdown-path> --summary <text>'
      )
    }
    if (sourcePath) {
      throw commandError(
        'open requires exactly one Markdown path.',
        'markover open <markdown-path> --summary <text>'
      )
    }
    sourcePath = argument
  }

  if (!sourcePath) {
    throw commandError(
      'open requires a Markdown path.',
      'markover open <markdown-path> --summary <text>'
    )
  }
  if (!contextSummary?.trim()) {
    throw commandError(
      'open requires --summary <text>.',
      'markover open <markdown-path> --summary <text>'
    )
  }
  if (branch !== null) {
    branch = branch.trim()
    if (!branch) {
      throw commandError(
        '--branch requires a non-empty value.',
        'markover open <markdown-path> --summary <text> --branch <name>'
      )
    }
  }
  if (threadId !== null) {
    threadId = threadId.trim()
    if (!threadId) {
      throw commandError(
        '--thread-id requires a non-empty value.',
        'markover open <markdown-path> --summary <text> --thread-id <id>'
      )
    }
  }
  if (handoffKey !== null) {
    handoffKey = handoffKey.trim()
    if (!HANDOFF_KEY_PATTERN.test(handoffKey)) {
      throw commandError(
        '--handoff-key must match mko_handoff_ followed by 16–64 letters or digits.',
        'markover open <markdown-path> --summary <text> --handoff-key <key>'
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
  if (parsed.command === 'help') return helpPayload()

  if (parsed.command === 'open') {
    const sourcePath = path.resolve(parsed.sourcePath)
    let stats
    try {
      stats = await fs.stat(sourcePath)
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw commandError(
          `Markdown file does not exist: ${sourcePath}`,
          'markover open <markdown-path> --summary <text>'
        )
      }
      throw error
    }
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
    await ensure()
    return requestJson(endpointPath, 'POST', '/reviews', {
      tree,
      metadata: {
        contextSummary: parsed.contextSummary,
        ...metadata
      }
    })
  }

  await ensure()
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
    process.stderr.write(formatCommandError(error))
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
  formatCommandError,
  helpPayload,
  parseCommandArguments,
  startDetachedApp
}

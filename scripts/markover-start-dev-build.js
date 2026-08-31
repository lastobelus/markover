/* global __dirname, module, process, require, setTimeout */

const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { createMarkoverActionReporter } = require('./lib/markover-action-kit.js')

const projectDirectory = path.resolve(__dirname, '..')
const FORMAT = 'markover-start-dev-build'
const VERSION = 1
const DEFAULT_TIMEOUT_MILLISECONDS = 3 * 60_000
const POLL_MILLISECONDS = 100
const MAX_TAIL_LINES = 40
const MAX_TAIL_CHARACTERS = 8_000
const actionReporter = createMarkoverActionReporter({ label: 'start-dev-build' })

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function boundedTail(contents) {
  const lines = String(contents).split(/\r?\n/).filter(Boolean)
  let tail = lines.slice(-MAX_TAIL_LINES)
  while (tail.join('\n').length > MAX_TAIL_CHARACTERS && tail.length > 1) {
    tail = tail.slice(1)
  }
  if (tail.join('\n').length > MAX_TAIL_CHARACTERS) {
    tail = [tail[0].slice(-MAX_TAIL_CHARACTERS)]
  }
  return tail
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error && typeof error === 'object' && error.code !== 'ESRCH'
  }
}

function command(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectDirectory,
    encoding: 'utf8'
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message || result.stderr.trim() ||
      `${command} exited ${String(result.status)}`
    )
  }
  return result.stdout.trim()
}

function gitIdentity() {
  return {
    commit: command('git', ['rev-parse', 'HEAD']),
    dirty: Boolean(command('git', [
      'status',
      '--porcelain',
      '--untracked-files=all'
    ]))
  }
}

function parseArguments(args) {
  let selector = 'dev'
  let awaitHuman = false
  let timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--await-human') {
      awaitHuman = true
      continue
    }
    if (argument === '--instance') {
      const value = args[index + 1]
      if (value !== 'dev' && value !== 'canonical') {
        throw new Error('--instance requires dev or canonical.')
      }
      selector = value
      index += 1
      continue
    }
    if (argument === '--timeout-seconds') {
      const value = Number(args[index + 1])
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--timeout-seconds requires a positive number.')
      }
      timeoutMilliseconds = value * 1_000
      index += 1
      continue
    }
    throw new Error(`Unknown Start Dev Build argument: ${String(argument)}`)
  }
  return { awaitHuman, selector, timeoutMilliseconds }
}

function resolveTarget(selector) {
  if (selector === 'canonical') {
    return { identityKey: 'canonical', scheme: 'markover' }
  }
  const branch = command('git', ['branch', '--show-current'])
  if (!branch) throw new Error('Start Dev Build requires a checked-out branch.')
  const pullRequest = JSON.parse(command('gh', [
    'pr',
    'view',
    branch,
    '--repo',
    'lastobelus/markover',
    '--json',
    'number,state'
  ]))
  if (
    !pullRequest ||
    pullRequest.state !== 'OPEN' ||
    !Number.isInteger(pullRequest.number) ||
    pullRequest.number < 1
  ) throw new Error('Start Dev Build requires an open pull request.')
  return {
    identityKey: `pr-${String(pullRequest.number)}`,
    scheme: `markover-${String(pullRequest.number)}`
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null
    return null
  }
}

function pathsFor(checkout, identityKey) {
  const root = path.join(
    checkout,
    '.markover',
    'generated',
    identityKey
  )
  return {
    root,
    log: path.join(root, 'start-dev-build.log'),
    state: path.join(root, 'development-watch.json'),
    endpoint: identityKey === 'canonical'
      ? null
      : path.join(checkout, '.markover', 'instance', 'service.json')
  }
}

function stateMatches(state, expected) {
  return state &&
    state.version === 1 &&
    path.resolve(state.checkout || '') === expected.checkout &&
    state.head === expected.head.commit &&
    state.dirty === expected.head.dirty &&
    state.identityKey === expected.target.identityKey &&
    state.scheme === expected.target.scheme &&
    processIsAlive(state.watcherPid)
}

async function readReadyHealth(state) {
  const response = await globalThis.fetch(
    `http://127.0.0.1:${String(state.service.port)}/health`,
    { signal: globalThis.AbortSignal.timeout(1_000) }
  )
  if (!response.ok) {
    throw new Error(`Health route returned HTTP ${String(response.status)}.`)
  }
  return response.json()
}

async function outcomeFromState(
  state,
  awaitHuman,
  tail,
  probe = readReadyHealth
) {
  if (state.phase === 'build-failed') {
    return {
      outcome: 'build-failed',
      stage: 'build',
      detail: state.error?.message || 'The development build failed.',
      tail
    }
  }
  if (state.phase === 'startup-failed') {
    return {
      outcome: state.error?.code === 'EADDRINUSE'
        ? 'port-conflict'
        : 'startup-failed',
      stage: state.stage || 'startup',
      detail: state.error?.message || 'Development startup failed.',
      tail
    }
  }
  if (state.phase === 'restart-required') {
    return {
      outcome: 'startup-failed',
      stage: 'startup',
      detail: state.error?.message ||
        'The running app must restart before this source identity is ready.',
      tail
    }
  }
  if (
    state.phase === 'ready' &&
    state.service?.startupReady === true &&
    processIsAlive(state.service.pid)
  ) {
    try {
      const health = await probe(state)
      if (
        !health ||
        health.status !== 'ok' ||
        health.version !== 2 ||
        health.instanceId !== state.service.instanceId ||
        health.startupReady !== true
      ) {
        throw new Error('The live health response did not match the ready receipt.')
      }
    } catch (error) {
      return {
        outcome: 'startup-failed',
        stage: 'readiness',
        detail: error instanceof Error
          ? error.message
          : 'The live readiness probe failed.',
        tail
      }
    }
    return {
      outcome: awaitHuman ? 'awaiting-human' : 'ready',
      stage: 'readiness',
      process: {
        watcherPid: state.watcherPid,
        appPid: state.service.pid,
        watcherState: 'watching'
      },
      route: {
        healthUrl: `http://127.0.0.1:${String(state.service.port)}/health`,
        scheme: `${state.scheme}:`
      },
      readiness: {
        health: 'ok',
        serviceInstanceId: state.service.instanceId,
        startup: 'ready'
      },
      visualAcceptance: awaitHuman ? 'awaiting-human' : 'not-evaluated',
      tail: []
    }
  }
  return null
}

function summary(context, terminal) {
  return {
    format: FORMAT,
    version: VERSION,
    outcome: terminal.outcome,
    stage: terminal.stage,
    head: context.head,
    instance: context.target,
    ...terminal
  }
}

function dirtyAdoptionFailure(state, context, tail) {
  if (!stateMatches(state, context) || context.head.dirty !== true) return null
  return {
    outcome: 'startup-failed',
    stage: 'readiness',
    detail: `Cannot adopt watcher PID ${String(state.watcherPid)} for a dirty checkout because its receipt does not identify the exact source contents.`,
    tail
  }
}

function printSummary(value) {
  const succeeded = value.outcome === 'ready' || value.outcome === 'awaiting-human'
  const instance = value.instance
  const healthUrl = value.route?.healthUrl
  actionReporter.terminal({
    fallback: `[start-dev-build] Summary: ${JSON.stringify(value)}`,
    ...(succeeded
      ? {
          report: {
            outcome: 'success',
            reason: value.outcome,
            summary: value.outcome === 'awaiting-human'
              ? `Development instance ${instance?.identityKey || 'dev'} is ready for human QA.`
              : `Development instance ${instance?.identityKey || 'dev'} is ready.`,
            subject: {
              type: 'development-instance',
              id: instance?.identityKey || 'dev',
              ...(value.head?.commit ? { revision: value.head.commit } : {})
            },
            facts: {
              dirty: String(value.head?.dirty ?? false),
              visualAcceptance: value.visualAcceptance || 'not-evaluated',
              ...(value.process?.watcherPid
                ? { watcherPid: String(value.process.watcherPid) }
                : {}),
              ...(value.process?.appPid ? { appPid: String(value.process.appPid) } : {}),
              ...(value.readiness?.serviceInstanceId
                ? { serviceInstanceId: value.readiness.serviceInstanceId }
                : {})
            },
            ...(healthUrl
              ? { artifacts: [{ label: 'Health endpoint', url: healthUrl }] }
              : {})
          }
        }
      : {})
  })
}

async function runCaptured(executable, args) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: projectDirectory,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { output += chunk.toString('utf8') })
    child.once('error', (error) => {
      resolve({ code: null, signal: null, output, error })
    })
    child.once('exit', (code, signal) => {
      resolve({ code, signal, output, error: null })
    })
  })
}

async function prepareCheckout(run = runCaptured) {
  const steps = [
    {
      executable: './scripts/setup-worktree.sh',
      args: [],
      failure: 'Worktree setup'
    },
    {
      executable: './node_modules/.bin/install-electron',
      args: ['--no'],
      failure: 'Electron setup'
    }
  ]
  let output = ''
  for (const step of steps) {
    const result = await run(step.executable, step.args)
    output += result.output
    if (result.error || result.code !== 0) {
      return {
        ...result,
        output,
        detail: result.error?.message ||
          `${step.failure} exited with ${result.signal || String(result.code)}.`
      }
    }
  }
  return { code: 0, signal: null, output, error: null, detail: null }
}

async function readLog(filePath) {
  try {
    return await fsp.readFile(filePath, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return ''
    throw error
  }
}

async function waitForWatcher(
  context,
  child,
  timeoutMilliseconds,
  adoptedWatcherPid = null
) {
  const startedAt = Date.now()
  let exit = null
  if (child !== null) {
    child.once('error', (error) => { exit = { error, code: null, signal: null } })
    child.once('exit', (code, signal) => { exit = { error: null, code, signal } })
  }
  while (Date.now() - startedAt < timeoutMilliseconds) {
    const [state, log] = await Promise.all([
      readJson(context.paths.state),
      readLog(context.paths.log)
    ])
    const tail = boundedTail(log)
    if (stateMatches(state, context)) {
      const terminal = await outcomeFromState(
        state,
        context.awaitHuman,
        tail
      )
      if (terminal) return terminal
    }
    if (
      adoptedWatcherPid !== null &&
      !processIsAlive(adoptedWatcherPid)
    ) {
      return {
        outcome: 'process-exited',
        stage: 'startup',
        detail: `Adopted watcher PID ${String(adoptedWatcherPid)} exited while waiting for readiness.`,
        exitCode: null,
        signal: null,
        tail
      }
    }
    if (
      log.includes('markover dev bootstrap:') &&
      log.includes('Keeping the bootstrap watcher active.')
    ) {
      return {
        outcome: 'build-failed',
        stage: 'build',
        detail: 'The development watcher did not compile.',
        tail
      }
    }
    if (exit !== null) {
      return {
        outcome: 'process-exited',
        stage: 'startup',
        detail: exit.error?.message ||
          `The watcher exited with ${exit.signal || String(exit.code)}.`,
        exitCode: exit.code,
        signal: exit.signal,
        tail
      }
    }
    await delay(POLL_MILLISECONDS)
  }
  return {
    outcome: 'timed-out',
    stage: 'readiness',
    detail: 'Timed out waiting for the development watcher and app to become ready.',
    elapsedMilliseconds: Date.now() - startedAt,
    tail: boundedTail(await readLog(context.paths.log))
  }
}

async function main(args = process.argv.slice(2)) {
  let parsed
  let checkout
  let head
  let target
  try {
    parsed = parseArguments(args)
    checkout = await fsp.realpath(projectDirectory)
    head = gitIdentity()
    target = resolveTarget(parsed.selector)
  } catch (error) {
    printSummary({
      format: FORMAT,
      version: VERSION,
      outcome: 'startup-failed',
      stage: 'setup',
      detail: error instanceof Error ? error.message : String(error),
      tail: []
    })
    return 1
  }
  const context = {
    awaitHuman: parsed.awaitHuman,
    checkout,
    head,
    target,
    paths: pathsFor(checkout, target.identityKey)
  }
  actionReporter.progress({
    state: 'working',
    phase: 'setup',
    summary: `Preparing development instance ${target.identityKey}`
  })
  await fsp.mkdir(context.paths.root, { recursive: true })

  const existing = await readJson(context.paths.state)
  if (stateMatches(existing, context)) {
    const tail = boundedTail(await readLog(context.paths.log))
    const adoptionFailure = dirtyAdoptionFailure(existing, context, tail)
    if (adoptionFailure) {
      printSummary(summary(context, adoptionFailure))
      return 1
    }
    const terminal = await outcomeFromState(
      existing,
      parsed.awaitHuman,
      tail
    )
    if (terminal) {
      printSummary(summary(context, terminal))
      return terminal.outcome === 'ready' || terminal.outcome === 'awaiting-human'
        ? 0
        : 1
    }
    actionReporter.progress({
      state: 'waiting',
      phase: 'readiness',
      summary: `Waiting for development instance ${target.identityKey}`
    })
    const terminalAfterWait = await waitForWatcher(
      context,
      null,
      parsed.timeoutMilliseconds,
      existing.watcherPid
    )
    printSummary(summary(context, terminalAfterWait))
    return terminalAfterWait.outcome === 'ready' ||
      terminalAfterWait.outcome === 'awaiting-human' ? 0 : 1
  }
  if (existing && processIsAlive(existing.watcherPid)) {
    printSummary(summary(context, {
      outcome: 'port-conflict',
      stage: 'startup',
      detail: `Watcher PID ${String(existing.watcherPid)} already owns ${target.identityKey} for a different source identity.`,
      tail: boundedTail(await readLog(context.paths.log))
    }))
    return 1
  }
  if (context.paths.endpoint) {
    const endpoint = await readJson(context.paths.endpoint)
    if (endpoint && processIsAlive(endpoint.pid)) {
      printSummary(summary(context, {
        outcome: 'port-conflict',
        stage: 'startup',
        detail: `App PID ${String(endpoint.pid)} already owns the ${target.identityKey} service route without this watcher.`,
        port: endpoint.port ?? null,
        tail: []
      }))
      return 1
    }
  }

  const setup = await prepareCheckout()
  if (setup.error || setup.code !== 0) {
    printSummary(summary(context, {
      outcome: 'startup-failed',
      stage: 'setup',
      detail: setup.detail,
      tail: boundedTail(setup.output)
    }))
    return 1
  }
  const currentHead = gitIdentity()
  if (currentHead.commit !== head.commit) {
    printSummary(summary(context, {
      outcome: 'startup-failed',
      stage: 'setup',
      detail: `HEAD changed from ${head.commit} to ${currentHead.commit} during setup.`,
      tail: boundedTail(setup.output)
    }))
    return 1
  }

  const logDescriptor = fs.openSync(context.paths.log, 'w', 0o600)
  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--instance', parsed.selector],
    {
      cwd: checkout,
      detached: process.platform !== 'win32',
      env: process.env,
      stdio: ['ignore', logDescriptor, logDescriptor]
    }
  )
  fs.closeSync(logDescriptor)
  child.unref()
  actionReporter.progress({
    state: 'waiting',
    phase: 'readiness',
    summary: `Waiting for development instance ${target.identityKey}`
  })
  const terminal = await waitForWatcher(
    context,
    child,
    parsed.timeoutMilliseconds
  )
  printSummary(summary(context, terminal))
  return terminal.outcome === 'ready' || terminal.outcome === 'awaiting-human'
    ? 0
    : 1
}

module.exports = {
  boundedTail,
  dirtyAdoptionFailure,
  outcomeFromState,
  parseArguments,
  pathsFor,
  prepareCheckout,
  stateMatches,
  summary,
  waitForWatcher
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code
  }, (error) => {
    printSummary({
      format: FORMAT,
      version: VERSION,
      outcome: 'startup-failed',
      stage: 'startup',
      detail: error instanceof Error ? error.message : String(error),
      tail: []
    })
    process.exitCode = 1
  })
}

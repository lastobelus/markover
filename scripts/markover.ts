#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  LocalServiceError,
  probeService,
  requestJson
} from '../src/local-client'
import {
  discoverReviewMetadata,
  HANDOFF_KEY_PATTERN,
  type ReviewMetadata,
  type ReviewMetadataInput
} from '../src/metadata-discovery'
import { serviceEndpointPath } from '../src/service-endpoint'
import { guidance } from '../src/agent-guidance'
import { normalizeSettings } from '../src/settings'
import { parseMarkdown } from '../src/tree'
import {
  cleanupDevelopmentInstance,
  type CleanupDevelopmentInstanceResult
} from '../src/instance-cleanup'
import {
  CANONICAL_INSTANCE_SCHEME,
  resolveInstance,
  type ResolvedInstance
} from '../src/instance'
import { reviewUrl } from '../src/review-url'
import {
  isPullRequestStatus,
  parseGitHubPullRequestUrl,
  type PullRequestStatus
} from '../src/pull-request'
import {
  decodeReviewArtifact,
  ReviewFormatError
} from '../src/review-format'

const projectDirectory = path.resolve(__dirname, '../..')
const defaultEndpointPath = serviceEndpointPath()

const helpAliases = new Set(['help', 'info', '--help', '-h'])

function invocation(): string {
  return process.env.MARKOVER_INVOCATION || 'npm --silent run markover --'
}

function recoveryHint(): string {
  return `Run "${invocation()} help" for complete usage.`
}

export type InstanceSelector = 'canonical' | 'development'

interface ParsedInstanceTarget {
  instance?: InstanceSelector
}

export type ParsedCommand = ParsedInstanceTarget & (
  | { command: 'help' }
  | { command: 'cleanup'; expectedIdentity: `pr-${number}` }
  | { command: 'edit'; reviewId: string }
  | {
      command: 'get' | 'revise'
      reviewId: string
      pullRequestStatus?: PullRequestStatus | null
    }
  | {
      command: 'done'
      pullRequestUrl: string
      pullRequestStatus: 'merged'
    }
  | {
      command: 'open'
      sourcePath: string
      contextSummary: string
      branch?: string | null
      handoffKey?: string | null
      pullRequestNumber?: number | null
      pullRequestUrl?: string | null
      pullRequestStatus?: PullRequestStatus | null
      threadId?: string | null
      threadHostKind?: string | null
      threadHostProvider?: string | null
      threadHostThreadId?: string | null
      threadHostMachine?: string | null
    }
)

export class CommandError extends Error {
  readonly usage: string | undefined

  constructor(message: string, usage?: string) {
    super(message)
    this.name = 'CommandError'
    this.usage = usage
  }
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object'
    ? Reflect.get(error, 'code')
    : null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function commandError(message: string, usage?: string): CommandError {
  return new CommandError(message, usage)
}

export function helpPayload() {
  const defaultAgentGuidance = guidance()
  return {
    format: 'markover-help',
    version: 1,
    purpose: 'Review Markdown as a block tree and return structured feedback to an agent.',
    repository: 'https://github.com/lastobelus/markover',
    invocation: `${invocation()} [--instance <canonical|dev>] <command>`,
    requirements: {
      platform: 'macOS 14 Sonoma or newer (Apple Silicon only)',
      node: '22.13.0 or newer',
      installation: 'The install-free release launcher needs no installation; it downloads and caches the matching app on first use.'
    },
    workflow: [
      'Create the Markdown file before opening it.',
      'Run open once, then retain the returned reviewId in the agent thread.',
      'Give the user a best-effort Markdown link using reviewUrl, include the raw reviewId, put open \'<reviewUrl>\' alone on its own line as the reliable Terminal handoff, and wait for them to say "Check Markover."',
      'Run get once after that instruction; it returns the frozen markover-review JSON.',
      'Before interpreting a returned review, require format markover-review and version 1. For any other header, preserve the artifact, consult the official compatibility catalog named by the diagnostic, recommend the compatible Markover release when listed, and never guess at the body.',
      'Before acting, follow review.agentGuidance.fixedContract and review.agentGuidance.interpretationPolicy from that JSON.',
      'For agent-originated reviews, provide truthful thread metadata when observable: --thread-id is the best observable requesting-thread or session ID; --thread-host-kind is the user-facing product or lookup namespace where the user would look for the thread; --thread-host-provider is the LLM provider or model family in use, not an intermediate harness; --thread-host-thread-id is only a distinct host-owned ID; and --thread-host-machine should use the local hostname result when available. Use recommended product values when they match observable facts, preserve truthful unknown values, and omit unavailable values rather than guessing.',
      'After acting on every part of the review, run revise once so Markover records the completed handoff.',
      'For a pull-request-associated review, attempt the pullRequestStatus lookup immediately before open, get, revise, and done. On open, pass its canonical url with --pr-url and its mapped status with --pr-status; on get or revise, pass --pr-status. After a failed lookup, omit --pr-status and report the failure. On open, retain --pr and a known canonical --pr-url; when no canonical identity is known, omit the PR association. On get or revise, preserving the review ID also preserves the last successful observation.',
      'After verifying a pull request merged, run done with its canonical URL and --pr-status merged; Markover marks every matching local review Done.',
      'If the user wants to add feedback before revise, run edit before asking them to continue. After revise, open a new review for a later feedback round.'
    ],
    pullRequestStatus: {
      lookup: 'gh pr view <pull-request-url-or-number> --json state,isDraft,url',
      mapping: {
        draft: 'isDraft is true',
        open: 'isDraft is false and state is OPEN',
        merged: 'state is MERGED',
        closed: 'state is CLOSED'
      },
      values: ['draft', 'open', 'merged', 'closed'],
      persistence: 'A successful observation is stored with its receipt time and source agent. A missing --pr-status preserves the last successful observation.',
      failure: 'A failed lookup does not block open, get, or revise. Continue without --pr-status and report the failure. On open, retain --pr and a known canonical --pr-url; when no canonical identity is known, omit the PR association. done requires a verified merged observation.'
    },
    defaultAgentGuidance,
    commands: [
      {
        name: 'open',
        usage: 'open <markdown-path> --summary <text> [--branch <name>] [--pr <number> --pr-url <url> --pr-status <draft|open|merged|closed>] [--thread-id <thread-or-session-id> | --handoff-key <key>] [--thread-host-kind <kind> --thread-host-provider <llm-provider-or-model-family> [--thread-host-thread-id <distinct-host-id>] [--thread-host-machine <hostname>]]',
        purpose: 'Open a durable, non-blocking review and print {reviewId,status,reviewUrl} as JSON.'
      },
      {
        name: 'get',
        usage: 'get <review-id> [--pr-status <draft|open|merged|closed>]',
        purpose: 'Freeze one review and print its complete markover-review JSON.'
      },
      {
        name: 'revise',
        usage: 'revise <review-id> [--pr-status <draft|open|merged|closed>]',
        purpose: 'Record that the agent acted on every part of a frozen review.'
      },
      {
        name: 'done',
        usage: 'done <pull-request-url> --pr-status merged',
        purpose: 'Mark every local review associated with a verified merged pull request Done.'
      },
      {
        name: 'edit',
        usage: 'edit <review-id>',
        purpose: 'Return a frozen review to editing so the user can add or change feedback.'
      },
      {
        name: 'cleanup',
        usage: '--instance dev cleanup <pr-N>',
        purpose: 'Move one stopped worktree-local instance to macOS Trash after its development URL handler has been removed.'
      },
      {
        name: 'help',
        aliases: ['info', '--help', '-h'],
        usage: 'help',
        purpose: 'Print this machine-readable help without starting Markover.'
      }
    ],
    stdout: 'Success writes exactly one JSON value to stdout. Diagnostics use stderr and a non-zero exit status.',
    persistence: 'Canonical reviews use Markover user data; development reviews use the current worktree .markover/instance/reviews directory.'
  }
}

export function formatCommandError(error: unknown): string {
  const lines = [`markover: ${errorMessage(error)}`]
  const usage = error instanceof CommandError ? error.usage : undefined
  if (usage) lines.push(`Usage: ${usage}`)
  lines.push(recoveryHint())
  return `${lines.join('\n')}\n`
}

export function parseCommandArguments(args: string[]): ParsedCommand {
  let instance: InstanceSelector | undefined
  let commandArguments = args
  if (args[0] === '--instance') {
    const value = args[1]
    if (value !== 'canonical' && value !== 'dev') {
      throw commandError(
        '--instance requires canonical or dev.',
        'markover [--instance <canonical|dev>] <command>'
      )
    }
    instance = value === 'dev' ? 'development' : 'canonical'
    commandArguments = args.slice(2)
  }
  if (commandArguments.includes('--instance')) {
    throw commandError(
      '--instance is a global option and must appear before the command.',
      'markover [--instance <canonical|dev>] <command>'
    )
  }

  const targeted = <T extends object>(command: T): T & ParsedInstanceTarget => (
    instance ? { ...command, instance } : command
  )
  const [command, ...rest] = commandArguments
  if (!command || helpAliases.has(command)) {
    if (rest.length) {
      throw commandError(
        `${String(command)} does not accept arguments.`,
        'markover help'
      )
    }
    return targeted({ command: 'help' as const })
  }
  if (
    command !== 'open' &&
    command !== 'get' &&
    command !== 'revise' &&
    command !== 'done' &&
    command !== 'edit' &&
    command !== 'cleanup'
  ) {
    if (command === 'check') {
      throw commandError(
        'There is no check command. After the user says “Check Markover,” run get with the retained review ID.',
        'markover get <review-id>'
      )
    }
    if (!command.startsWith('-') && /(?:^|[/\\])[^/\\]+\.(?:md|markdown|mdown|mkd)$/i.test(command)) {
      throw commandError(
        `To review ${command}, use the open command and explain the review context.`,
        `markover open ${shellQuote(command)} --summary <text>`
      )
    }
    throw commandError(
      `Unknown command: ${command}`,
      'markover <open|get|revise|done|edit|cleanup|help> ...'
    )
  }

  if (command === 'cleanup') {
    const expectedIdentity = rest[0]
    if (instance !== 'development') {
      throw commandError(
        'cleanup is available only for the current development worktree.',
        'markover --instance dev cleanup <pr-N>'
      )
    }
    if (
      rest.length !== 1 ||
      expectedIdentity === undefined ||
      !/^pr-[1-9]\d*$/.test(expectedIdentity)
    ) {
      throw commandError(
        'cleanup requires one exact pr-N identity.',
        'markover --instance dev cleanup <pr-N>'
      )
    }
    return targeted({
      command: 'cleanup' as const,
      expectedIdentity: expectedIdentity as `pr-${number}`
    })
  }

  if (command === 'done') {
    const pullRequestUrl = rest[0]
    const option = rest[1]
    const status = rest[2]
    if (
      rest.length !== 3 ||
      !pullRequestUrl ||
      !parseGitHubPullRequestUrl(pullRequestUrl) ||
      option !== '--pr-status' ||
      status !== 'merged'
    ) {
      throw commandError(
        'done requires one canonical GitHub pull request URL and a verified merged status.',
        'markover done <pull-request-url> --pr-status merged'
      )
    }
    return targeted({
      command,
      pullRequestUrl,
      pullRequestStatus: 'merged' as const
    })
  }

  if (command === 'get' || command === 'revise' || command === 'edit') {
    const reviewId = rest[0]
    if (reviewId === undefined || reviewId.startsWith('--')) {
      throw commandError(
        `${command} requires one review ID.`,
        `markover ${command} <review-id>`
      )
    }
    if (command === 'edit') {
      if (rest.length !== 1) {
        throw commandError(
          'edit requires exactly one review ID.',
          'markover edit <review-id>'
        )
      }
      return targeted({ command, reviewId })
    }
    let pullRequestStatus: PullRequestStatus | null = null
    if (rest.length !== 1) {
      if (
        rest.length !== 3 ||
        rest[1] !== '--pr-status' ||
        !isPullRequestStatus(rest[2])
      ) {
        throw commandError(
          `${command} accepts only an optional pull request status.`,
          `markover ${command} <review-id> [--pr-status <draft|open|merged|closed>]`
        )
      }
      pullRequestStatus = rest[2]
    }
    return targeted({ command, reviewId, pullRequestStatus })
  }

  let sourcePath = null
  let contextSummary = null
  let branch = null
  let handoffKey = null
  let pullRequestNumber = null
  let pullRequestUrl = null
  let pullRequestStatus: PullRequestStatus | null = null
  let threadId = null
  let threadHostKind = null
  let threadHostProvider = null
  let threadHostThreadId = null
  let threadHostMachine = null
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === undefined) break
    if (
      argument === '--summary' ||
      argument === '--branch' ||
      argument === '--handoff-key' ||
      argument === '--pr' ||
      argument === '--pr-url' ||
      argument === '--pr-status' ||
      argument === '--thread-id' ||
      argument === '--thread-host-kind' ||
      argument === '--thread-host-provider' ||
      argument === '--thread-host-thread-id' ||
      argument === '--thread-host-machine'
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
      if (argument === '--thread-host-kind') threadHostKind = value
      if (argument === '--thread-host-provider') threadHostProvider = value
      if (argument === '--thread-host-thread-id') threadHostThreadId = value
      if (argument === '--thread-host-machine') threadHostMachine = value
      if (argument === '--pr-url') {
        const identity = parseGitHubPullRequestUrl(value)
        if (!identity) {
          throw commandError(
            '--pr-url requires a canonical GitHub pull request URL.',
            'markover open <markdown-path> --summary <text> --pr <number> --pr-url <url> --pr-status <status>'
          )
        }
        pullRequestUrl = identity.url
      }
      if (argument === '--pr-status') {
        if (!isPullRequestStatus(value)) {
          throw commandError(
            '--pr-status requires draft, open, merged, or closed.',
            'markover open <markdown-path> --summary <text> --pr <number> --pr-status <status>'
          )
        }
        pullRequestStatus = value
      }
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
  for (const [option, value] of [
    ['--thread-host-kind', threadHostKind],
    ['--thread-host-provider', threadHostProvider],
    ['--thread-host-thread-id', threadHostThreadId],
    ['--thread-host-machine', threadHostMachine]
  ] as const) {
    if (value !== null && !value.trim()) {
      throw commandError(
        `${option} requires a non-empty value.`,
        'markover open <markdown-path> --summary <text>'
      )
    }
  }
  threadHostKind = threadHostKind?.trim() || null
  threadHostProvider = threadHostProvider?.trim() || null
  threadHostThreadId = threadHostThreadId?.trim() || null
  threadHostMachine = threadHostMachine?.trim() || null
  if (handoffKey !== null) {
    handoffKey = handoffKey.trim()
    if (!HANDOFF_KEY_PATTERN.test(handoffKey)) {
      throw commandError(
        '--handoff-key must match mko_handoff_ followed by 16–64 letters or digits.',
        'markover open <markdown-path> --summary <text> --handoff-key <key>'
      )
    }
  }
  if (threadId && handoffKey) {
    throw commandError(
      '--thread-id and --handoff-key are alternatives; provide only one.',
      'markover open <markdown-path> --summary <text> [--thread-id <thread-or-session-id> | --handoff-key <key>] --thread-host-kind <kind> --thread-host-provider <llm-provider-or-model-family>'
    )
  }
  const hasThreadIdentity = Boolean(threadId || handoffKey)
  const hasThreadHostMetadata = Boolean(
    threadHostKind ||
    threadHostProvider ||
    threadHostThreadId ||
    threadHostMachine
  )
  if (hasThreadIdentity && (!threadHostKind || !threadHostProvider)) {
    throw commandError(
      '--thread-id or --handoff-key requires --thread-host-kind and --thread-host-provider.',
      'markover open <markdown-path> --summary <text> [--thread-id <thread-or-session-id> | --handoff-key <key>] --thread-host-kind <kind> --thread-host-provider <llm-provider-or-model-family>'
    )
  }
  if (hasThreadHostMetadata && !hasThreadIdentity) {
    throw commandError(
      'Thread-host metadata requires --thread-id or --handoff-key.',
      'markover open <markdown-path> --summary <text> [--thread-id <thread-or-session-id> | --handoff-key <key>] --thread-host-kind <kind> --thread-host-provider <llm-provider-or-model-family>'
    )
  }
  if (pullRequestUrl && !pullRequestNumber) {
    throw commandError(
      '--pr-url requires --pr when opening a review.',
      'markover open <markdown-path> --summary <text> --pr <number> --pr-url <url>'
    )
  }
  if (
    pullRequestUrl &&
    parseGitHubPullRequestUrl(pullRequestUrl)?.number !== pullRequestNumber
  ) {
    throw commandError(
      '--pr-url must identify the pull request number passed with --pr.',
      'markover open <markdown-path> --summary <text> --pr <number> --pr-url <url>'
    )
  }
  if (pullRequestStatus && (!pullRequestNumber || !pullRequestUrl)) {
    throw commandError(
      '--pr-status requires --pr and --pr-url when opening a review.',
      'markover open <markdown-path> --summary <text> --pr <number> --pr-url <url> --pr-status <status>'
    )
  }
  return targeted({
    command,
    sourcePath,
    contextSummary,
    branch,
    handoffKey,
    pullRequestNumber,
    pullRequestUrl,
    pullRequestStatus,
    threadId,
    threadHostKind,
    threadHostProvider,
    threadHostThreadId,
    threadHostMachine
  })
}

export function checksum(source: string): string {
  return `sha256:${crypto.createHash('sha256').update(source, 'utf8').digest('hex')}`
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export interface ResolveMarkoverAppOptions {
  architecture?: string
  environment?: NodeJS.ProcessEnv
  exists?: (candidate: string) => boolean
  homeDirectory?: string
}

export function resolveMarkoverApp({
  architecture = process.arch,
  environment = process.env,
  exists = fsSync.existsSync,
  homeDirectory = os.homedir()
}: ResolveMarkoverAppOptions = {}): string | null {
  const candidates = [
    environment.MARKOVER_APP_PATH,
    path.join(
      projectDirectory,
      'dist',
      `Markover-darwin-${architecture}`,
      'Markover.app'
    ),
    path.join(homeDirectory, 'Applications', 'Markover.app'),
    '/Applications/Markover.app'
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => exists(candidate)) || null
}

export function startDetachedApp(
  options: ResolveMarkoverAppOptions = {}
): void {
  if (process.platform !== 'darwin') {
    throw new Error('Automatic Markover startup currently requires macOS.')
  }

  const packagedApp = resolveMarkoverApp(options)
  if (!packagedApp) {
    throw new Error('The canonical Markover application is not installed.')
  }
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const result = spawnSync(
    '/usr/bin/open',
    [
      '-g',
      '-j',
      '-n',
      packagedApp,
      '--args',
      '--markover-server'
    ],
    { encoding: 'utf8', env: environment }
  )
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `open exited ${String(result.status)}`)
  }
}

export interface StartDetachedInstanceOptions extends ResolveMarkoverAppOptions {
  platform?: NodeJS.Platform
  spawnProcess?: typeof spawn
}

export function startDetachedInstance(
  instance: ResolvedInstance,
  {
    platform = process.platform,
    spawnProcess = spawn,
    ...appOptions
  }: StartDetachedInstanceOptions = {}
): void {
  if (platform !== 'darwin') {
    throw new Error('Automatic Markover startup currently requires macOS.')
  }
  if (instance.identity.kind === 'canonical') {
    const packagedApp = resolveMarkoverApp(appOptions)
    if (packagedApp) {
      startDetachedApp({
        ...appOptions,
        exists: (candidate) => candidate === packagedApp
      })
      return
    }
  }
  if (
    instance.process.status !== 'stopped' ||
    !instance.coldStart.eligible ||
    !instance.checkout
  ) {
    throw new Error(
      `Cannot cold-start ${instance.identity.key}: ${instance.coldStart.blockedBy || 'checkout unavailable'}.`
    )
  }
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const selector = instance.identity.kind === 'development'
    ? 'dev'
    : 'canonical'
  const child = spawnProcess(
    'npm',
    ['start', '--', '--instance', selector, '--markover-server'],
    {
      cwd: instance.checkout,
      detached: true,
      env: environment,
      stdio: 'ignore'
    }
  )
  child.unref()
}

async function waitForService(
  endpointPath: string,
  deadline: number
): Promise<void> {
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      await probeService(endpointPath)
      return
    } catch (error) {
      lastError = error
      await delay(100)
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('Markover service startup timed out.')
}

export interface EnsureServiceOptions {
  endpointPath?: string
  startApp?: () => void
  timeoutMilliseconds?: number
}

export async function ensureService({
  endpointPath = defaultEndpointPath,
  startApp = startDetachedApp,
  timeoutMilliseconds = 30_000
}: EnsureServiceOptions = {}): Promise<void> {
  try {
    await probeService(endpointPath)
    return
  } catch {
    startApp()
  }

  const startedAt = Date.now()
  try {
    await waitForService(endpointPath, startedAt + timeoutMilliseconds)
  } catch (error) {
    const diagnosticPath = path.join(
      path.dirname(endpointPath),
      'startup-diagnostic.json'
    )
    throw new LocalServiceError(
      'SERVICE_STARTUP_TIMEOUT',
      `Markover did not become ready: ${errorMessage(error)} Inspect ${diagnosticPath}; the app remains available to inspect or quit.`
    )
  }
}

export interface ExecuteCommandOptions {
  endpointPath?: string
  ensure?: () => Promise<void>
  resolveTarget?: (
    selector: InstanceSelector,
    expectedPullRequestNumber?: number
  ) => Promise<ResolvedInstance>
  cleanup?: (
    instance: ResolvedInstance,
    expectedIdentity: string
  ) => Promise<CleanupDevelopmentInstanceResult>
  discoverMetadata?: (
    input: ReviewMetadataInput
  ) => Promise<ReviewMetadata>
  readSessionDiscoverySetting?: (settingsPath: string) => Promise<boolean>
  settingsPath?: string
}

export async function readSessionDiscoverySetting(
  settingsPath: string
): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
    return normalizeSettings(value)
      .discoverAgentThreadFromLocalSessions
  } catch (error) {
    return errorCode(error) === 'ENOENT'
  }
}

export async function executeCommand(
  parsed: ParsedCommand,
  options: ExecuteCommandOptions = {}
): Promise<unknown> {
  if (parsed.command === 'help') return helpPayload()

  const selector = parsed.instance || 'canonical'
  const resolveTarget = options.resolveTarget || (
    (target, expectedPullRequestNumber) => resolveInstance(target, {
      ...(expectedPullRequestNumber === undefined
        ? {}
        : { expectedPullRequestNumber })
    })
  )
  if (parsed.command === 'cleanup') {
    const pullRequestNumber = Number(parsed.expectedIdentity.slice(3))
    const instance = options.resolveTarget
      ? await resolveTarget('development', pullRequestNumber)
      : await resolveInstance('development', {
          expectedPullRequestNumber: pullRequestNumber,
          operation: 'cleanup'
        })
    const cleanup = options.cleanup || cleanupDevelopmentInstance
    return cleanup(instance, parsed.expectedIdentity)
  }

  const instance = options.endpointPath
    ? null
    : await resolveTarget(selector)
  const endpointPath = options.endpointPath || instance?.service.endpointPath ||
    defaultEndpointPath
  const ensure = options.ensure || (() => ensureService({
    endpointPath,
    startApp: instance
      ? () => {
          startDetachedInstance(instance)
        }
      : startDetachedApp
  }))
  const {
    discoverMetadata = discoverReviewMetadata,
    readSessionDiscoverySetting: readDiscoverySetting = readSessionDiscoverySetting,
    settingsPath = path.join(path.dirname(endpointPath), 'settings.json')
  } = options
  if (parsed.command === 'open') {
    const sourcePath = path.resolve(parsed.sourcePath)
    let stats
    try {
      stats = await fs.stat(sourcePath)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
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
    const handoffKey = parsed.handoffKey && !parsed.threadId &&
      !await readDiscoverySetting(settingsPath)
      ? null
      : parsed.handoffKey ?? null
    const metadata = await discoverMetadata({
      sourcePath,
      branch: parsed.branch ?? null,
      pullRequestNumber: parsed.pullRequestNumber ?? null,
      pullRequestUrl: parsed.pullRequestUrl ?? null,
      threadId: parsed.threadId ?? null,
      threadHostKind: parsed.threadHostKind ?? null,
      threadHostProvider: parsed.threadHostProvider ?? null,
      threadHostThreadId: parsed.threadHostThreadId ?? null,
      threadHostMachine: parsed.threadHostMachine ?? null,
      handoffKey
    })
    await ensure()
    const opened = await requestJson(endpointPath, 'POST', '/reviews', {
      tree,
      pullRequestStatus: parsed.pullRequestStatus,
      metadata: {
        contextSummary: parsed.contextSummary,
        ...metadata
      }
    })
    if (
      !opened ||
      typeof opened !== 'object' ||
      Array.isArray(opened) ||
      typeof Reflect.get(opened, 'reviewId') !== 'string' ||
      Reflect.get(opened, 'status') !== 'editing'
    ) {
      throw new LocalServiceError(
        'INCOMPATIBLE_SERVICE',
        'Markover returned an invalid review creation response.'
      )
    }
    const reviewId = Reflect.get(opened, 'reviewId') as string
    const status = Reflect.get(opened, 'status') as 'editing'
    return {
      reviewId,
      status,
      reviewUrl: reviewUrl(
        instance?.scheme || CANONICAL_INSTANCE_SCHEME,
        reviewId
      )
    }
  }

  await ensure()
  if (parsed.command === 'done') {
    return requestJson(endpointPath, 'POST', '/reviews/done', {
      pullRequestUrl: parsed.pullRequestUrl,
      pullRequestStatus: parsed.pullRequestStatus
    })
  }
  const reviewId = encodeURIComponent(parsed.reviewId)
  if (parsed.command === 'get') {
    const response = await requestJson(
      endpointPath,
      'POST',
      `/reviews/${reviewId}/handoff`,
      parsed.pullRequestStatus
        ? { pullRequestStatus: parsed.pullRequestStatus }
        : undefined
    )
    try {
      return decodeReviewArtifact(response, parsed.reviewId)
    } catch (error) {
      if (error instanceof ReviewFormatError) {
        throw new LocalServiceError(error.code, error.message)
      }
      throw error
    }
  }
  if (parsed.command === 'revise') {
    return requestJson(
      endpointPath,
      'POST',
      `/reviews/${reviewId}/revise`,
      parsed.pullRequestStatus
        ? { pullRequestStatus: parsed.pullRequestStatus }
        : undefined
    )
  }
  return requestJson(endpointPath, 'POST', `/reviews/${reviewId}/edit`)
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const parsed = parseCommandArguments(args)
    const result = await executeCommand(parsed)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(formatCommandError(error))
    process.exitCode = 1
  }
}

if (require.main === module) void main()

export { defaultEndpointPath }

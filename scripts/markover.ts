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
  | { command: 'get' | 'edit'; reviewId: string }
  | {
      command: 'open'
      sourcePath: string
      contextSummary: string
      branch?: string | null
      handoffKey?: string | null
      pullRequestNumber?: number | null
      threadId?: string | null
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
      'Before acting, follow review.agentGuidance.fixedContract and review.agentGuidance.interpretationPolicy from that JSON.',
      'If the user wants to add feedback afterward, run edit before asking them to continue.'
    ],
    defaultAgentGuidance,
    commands: [
      {
        name: 'open',
        usage: 'open <markdown-path> --summary <text> [--branch <name>] [--pr <number>] [--thread-id <id>] [--handoff-key <key>]',
        purpose: 'Open a durable, non-blocking review and print {reviewId,status,reviewUrl} as JSON.'
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
      'markover <open|get|edit|cleanup|help> ...'
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

  if (command === 'get' || command === 'edit') {
    const reviewId = rest[0]
    if (rest.length !== 1 || reviewId === undefined || reviewId.startsWith('--')) {
      throw commandError(
        `${command} requires exactly one review ID.`,
        `markover ${command} <review-id>`
      )
    }
    return targeted({ command, reviewId })
  }

  let sourcePath = null
  let contextSummary = null
  let branch = null
  let handoffKey = null
  let pullRequestNumber = null
  let threadId = null
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === undefined) break
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
  return targeted({
    command,
    sourcePath,
    contextSummary,
    branch,
    handoffKey,
    pullRequestNumber,
    threadId
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
      threadId: parsed.threadId ?? null,
      handoffKey
    })
    await ensure()
    const opened = await requestJson(endpointPath, 'POST', '/reviews', {
      tree,
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
      (Reflect.get(opened, 'status') !== 'editing' &&
        Reflect.get(opened, 'status') !== 'pending-agent')
    ) {
      throw new LocalServiceError(
        'INCOMPATIBLE_SERVICE',
        'Markover returned an invalid review creation response.'
      )
    }
    const reviewId = Reflect.get(opened, 'reviewId') as string
    const status = Reflect.get(opened, 'status') as 'editing' | 'pending-agent'
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

import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  type DecisionGardenerRunOptions,
  type DecisionGardenerRunOutcome,
  runDecisionGardener
} from './decision-gardener-run'
import { acquireSingleFlightLock } from './decision-gardener'

export const decisionGardenerHostSchemaVersion = 1 as const
export const decisionGardenerHostLabel = 'com.lastobelus.markover.decision-gardener'
export const decisionGardenerHeartbeatSeconds = 5 * 60

const safeModelPattern = /^[A-Za-z0-9._-]+$/
const healthValues = new Set(['failed', 'healthy'])

export interface CommandResult {
  status: number
  stderr: string
  stdout: string
}

export type CommandRunner = (
  executable: string,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
) => CommandResult

export interface CommandNotifier {
  command: readonly [string, ...string[]]
  kind: 'command'
}

export interface NotificationCenterNotifier {
  kind: 'notification-center'
}

export type DecisionGardenerNotifier = CommandNotifier | NotificationCenterNotifier

export interface DecisionGardenerHostConfig {
  auditIntervalMinutes: number
  codex: string
  environmentPath: readonly string[]
  model: string
  notifier: DecisionGardenerNotifier
  reasoningEffort: DecisionGardenerRunOptions['reasoningEffort']
  repository: string
  runStore: string
  schemaVersion: typeof decisionGardenerHostSchemaVersion
}

export interface DecisionGardenerHostState {
  health: 'failed' | 'healthy' | null
  lastAuditAt: string | null
  lastError: string | null
  lastNotifiedHealth: 'failed' | 'healthy' | null
  schemaVersion: typeof decisionGardenerHostSchemaVersion
  updatedAt: string
}

export type DecisionGardenerHostOutcome =
  | {
      audit: DecisionGardenerRunOutcome
      record: string
      status: 'completed'
      trigger: 'heartbeat' | 'run-now'
    }
  | {
      nextAuditAt: string
      record: string
      status: 'not_due'
      trigger: 'heartbeat'
    }
  | {
      record: string
      status: 'busy'
      trigger: 'heartbeat' | 'run-now'
    }

interface HostAttemptRecord {
  audit?: DecisionGardenerRunOutcome
  error?: string
  finishedAt?: string
  nextAuditAt?: string
  schemaVersion: typeof decisionGardenerHostSchemaVersion
  startedAt: string
  status: 'busy' | 'completed' | 'failed' | 'not_due' | 'running'
  trigger: 'heartbeat' | 'run-now'
}

interface HostCycleDependencies {
  acquireLock?: typeof acquireSingleFlightLock
  now?: () => Date
  runAudit?: (options: DecisionGardenerRunOptions) => Promise<DecisionGardenerRunOutcome>
  runCommand?: CommandRunner
}

interface LaunchAgentDependencies {
  homeDirectory?: string
  nodeExecutable?: string
  platform?: NodeJS.Platform
  runCommand?: CommandRunner
  scriptPath?: string
  uid?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) throw new Error(`${label} contains missing or unknown fields.`)
}

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`)
  }
  return path.normalize(value)
}

function parseNotifier(value: unknown): DecisionGardenerNotifier {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('The decision-gardener notifier is invalid.')
  }
  if (value.kind === 'notification-center') {
    exactKeys(value, ['kind'], 'Notification Center notifier')
    return { kind: 'notification-center' }
  }
  if (value.kind !== 'command') throw new Error('The decision-gardener notifier kind is unsupported.')
  exactKeys(value, ['command', 'kind'], 'Command notifier')
  if (
    !Array.isArray(value.command) || value.command.length === 0 ||
    !value.command.every((argument) => typeof argument === 'string')
  ) throw new Error('The notifier command must be a non-empty string array.')
  const command = [...value.command] as [string, ...string[]]
  command[0] = absolutePath(command[0], 'The notifier executable')
  if (command.some((argument) => argument.includes('\0'))) {
    throw new Error('The notifier command contains a null byte.')
  }
  return { command, kind: 'command' }
}

export function parseDecisionGardenerHostConfig(value: unknown): DecisionGardenerHostConfig {
  if (!isRecord(value) || value.schemaVersion !== decisionGardenerHostSchemaVersion) {
    throw new Error('The decision-gardener host config version is unsupported.')
  }
  exactKeys(value, [
    'auditIntervalMinutes', 'codex', 'environmentPath', 'model', 'notifier',
    'reasoningEffort', 'repository', 'runStore', 'schemaVersion'
  ], 'Decision-gardener host config')
  if (!Number.isSafeInteger(value.auditIntervalMinutes) || Number(value.auditIntervalMinutes) < 5) {
    throw new Error('The audit interval must be an integer of at least five minutes.')
  }
  if (typeof value.model !== 'string' || !safeModelPattern.test(value.model)) {
    throw new Error('The host config model is invalid.')
  }
  if (!['high', 'low', 'medium', 'xhigh'].includes(String(value.reasoningEffort))) {
    throw new Error('The host config reasoning effort is invalid.')
  }
  if (
    !Array.isArray(value.environmentPath) || value.environmentPath.length === 0 ||
    !value.environmentPath.every((entry) => typeof entry === 'string' && path.isAbsolute(entry))
  ) throw new Error('The host environment path must contain absolute directories.')
  const environmentEntries = value.environmentPath as string[]
  const environmentPath = [...new Set(environmentEntries.map((entry) => path.normalize(entry)))]
  return {
    auditIntervalMinutes: Number(value.auditIntervalMinutes),
    codex: absolutePath(value.codex, 'The Codex executable'),
    environmentPath,
    model: value.model,
    notifier: parseNotifier(value.notifier),
    reasoningEffort: value.reasoningEffort as DecisionGardenerRunOptions['reasoningEffort'],
    repository: absolutePath(value.repository, 'The gardener repository'),
    runStore: absolutePath(value.runStore, 'The gardener run store'),
    schemaVersion: decisionGardenerHostSchemaVersion
  }
}

export function defaultDecisionGardenerRunStore(homeDirectory = os.homedir()): string {
  return path.join(
    homeDirectory,
    'Library',
    'Application Support',
    'Markover',
    'Decision Gardener'
  )
}

export function defaultDecisionGardenerHostConfigPath(homeDirectory = os.homedir()): string {
  return path.join(defaultDecisionGardenerRunStore(homeDirectory), 'host-config.json')
}

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error })
  }
}

export async function loadDecisionGardenerHostConfig(
  configPath: string
): Promise<DecisionGardenerHostConfig> {
  const resolved = path.resolve(configPath)
  const stats = await fs.lstat(resolved)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('The decision-gardener host config must be a regular file.')
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error('The decision-gardener host config must not be accessible by group or others.')
  }
  return parseDecisionGardenerHostConfig(parseJson(
    await fs.readFile(resolved, 'utf8'),
    'Decision-gardener host config'
  ))
}

function defaultState(now: Date): DecisionGardenerHostState {
  return {
    health: null,
    lastAuditAt: null,
    lastError: null,
    lastNotifiedHealth: null,
    schemaVersion: decisionGardenerHostSchemaVersion,
    updatedAt: now.toISOString()
  }
}

function parseHostState(value: unknown): DecisionGardenerHostState {
  if (!isRecord(value) || value.schemaVersion !== decisionGardenerHostSchemaVersion) {
    throw new Error('The decision-gardener host state version is unsupported.')
  }
  exactKeys(value, [
    'health', 'lastAuditAt', 'lastError', 'lastNotifiedHealth',
    'schemaVersion', 'updatedAt'
  ], 'Decision-gardener host state')
  for (const key of ['lastAuditAt', 'updatedAt'] as const) {
    const item = value[key]
    if (
      item !== null &&
      (typeof item !== 'string' || Number.isNaN(new Date(item).valueOf()))
    ) throw new Error(`The host state ${key} value is invalid.`)
  }
  if (value.updatedAt === null) throw new Error('The host state update time is missing.')
  for (const key of ['health', 'lastNotifiedHealth'] as const) {
    const item = value[key]
    if (item !== null && (typeof item !== 'string' || !healthValues.has(item))) {
      throw new Error(`The host state ${key} value is invalid.`)
    }
  }
  if (value.lastError !== null && typeof value.lastError !== 'string') {
    throw new Error('The host state error is invalid.')
  }
  return value as unknown as DecisionGardenerHostState
}

async function readHostState(filePath: string, now: Date): Promise<DecisionGardenerHostState> {
  try {
    return parseHostState(parseJson(await fs.readFile(filePath, 'utf8'), 'Host state'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultState(now)
    throw error
  }
}

async function writePrivate(filePath: string, source: string, exclusive = false): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  if (exclusive) {
    await fs.writeFile(filePath, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return
  }
  const temporary = `${filePath}.tmp.${crypto.randomUUID()}`
  try {
    await fs.writeFile(temporary, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, filePath)
    await fs.chmod(filePath, 0o600)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

async function writePrivateJson(filePath: string, value: unknown, exclusive = false): Promise<void> {
  await writePrivate(filePath, `${JSON.stringify(value, null, 2)}\n`, exclusive)
}

async function appendHostLog(runStore: string, value: unknown): Promise<void> {
  const logPath = path.join(runStore, 'host.log')
  await fs.appendFile(logPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 })
  await fs.chmod(logPath, 0o600)
}

function attemptId(now: Date): string {
  const timestamp = now.toISOString().replaceAll('-', '').replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `${timestamp}-${crypto.randomBytes(4).toString('hex')}`
}

function hostEnvironment(config: DecisionGardenerHostConfig): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    LOGNAME: process.env.LOGNAME,
    PATH: config.environmentPath.join(path.delimiter),
    TMPDIR: process.env.TMPDIR,
    USER: process.env.USER
  }
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
}

async function withHostPath<T>(
  config: DecisionGardenerHostConfig,
  operation: () => Promise<T>
): Promise<T> {
  const previous = process.env.PATH
  process.env.PATH = config.environmentPath.join(path.delimiter)
  try {
    return await operation()
  } finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
  }
}

export const runHostCommand: CommandRunner = (executable, args, options = {}) => {
  const result = spawnSync(executable, [...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: 4 * 1024 * 1024
  })
  if (result.error) throw result.error
  return {
    status: result.status ?? 1,
    stderr: result.stderr,
    stdout: result.stdout
  }
}

function notificationCenterCommand(event: string, summary: string): readonly [string, ...string[]] {
  return [
    '/usr/bin/osascript',
    '-e', 'on run argv',
    '-e', 'display notification (item 2 of argv) with title "Markover Decision Gardener" subtitle (item 1 of argv)',
    '-e', 'end run',
    event,
    summary
  ]
}

export function sendDecisionGardenerNotification({
  config,
  event,
  record,
  runCommand = runHostCommand,
  summary
}: {
  config: DecisionGardenerHostConfig
  event: 'failed' | 'recovered' | 'test'
  record: string
  runCommand?: CommandRunner
  summary: string
}): void {
  const command = config.notifier.kind === 'notification-center'
    ? notificationCenterCommand(event, summary)
    : config.notifier.command
  const result = runCommand(command[0], command.slice(1), {
    cwd: config.repository,
    env: {
      ...hostEnvironment(config),
      MARKOVER_DECISION_GARDENER_EVENT: event,
      MARKOVER_DECISION_GARDENER_RECORD: record,
      MARKOVER_DECISION_GARDENER_SUMMARY: summary
    }
  })
  if (result.status !== 0) {
    throw new Error(`Decision-gardener notifier failed: ${result.stderr.trim() || 'non-zero exit'}`)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function lockIsBusy(error: unknown, lockPath: string): boolean {
  return error instanceof Error &&
    error.message.startsWith(`A decision-gardener run already owns ${lockPath}:`)
}

async function updateAttempt(
  recordPath: string,
  record: HostAttemptRecord,
  runStore: string
): Promise<void> {
  await writePrivateJson(recordPath, record)
  await appendHostLog(runStore, record)
}

export async function runDecisionGardenerHostCycle({
  configPath,
  force = false,
  trigger = 'heartbeat'
}: {
  configPath: string
  force?: boolean
  trigger?: 'heartbeat' | 'run-now'
}, dependencies: HostCycleDependencies = {}): Promise<DecisionGardenerHostOutcome> {
  const config = await loadDecisionGardenerHostConfig(configPath)
  const now = dependencies.now ?? (() => new Date())
  const runCommand = dependencies.runCommand ?? runHostCommand
  const started = now()
  await fs.mkdir(config.runStore, { recursive: true, mode: 0o700 })
  await fs.chmod(config.runStore, 0o700)
  const recordsDirectory = path.join(config.runStore, 'host-runs')
  await fs.mkdir(recordsDirectory, { recursive: true, mode: 0o700 })
  const recordPath = path.join(recordsDirectory, `${attemptId(started)}.json`)
  const record: HostAttemptRecord = {
    schemaVersion: decisionGardenerHostSchemaVersion,
    startedAt: started.toISOString(),
    status: 'running',
    trigger
  }
  await writePrivateJson(recordPath, record, true)
  await appendHostLog(config.runStore, record)
  const lockPath = path.join(config.runStore, 'host.lock')
  const acquireLock = dependencies.acquireLock ?? acquireSingleFlightLock
  let lease
  try {
    lease = await acquireLock(lockPath, { record: recordPath, trigger })
  } catch (error) {
    const finished = now().toISOString()
    if (!lockIsBusy(error, lockPath)) {
      const failed: HostAttemptRecord = {
        ...record,
        error: errorMessage(error),
        finishedAt: finished,
        status: 'failed'
      }
      await updateAttempt(recordPath, failed, config.runStore)
      throw error
    }
    const busy: HostAttemptRecord = { ...record, finishedAt: finished, status: 'busy' }
    await updateAttempt(recordPath, busy, config.runStore)
    return { record: recordPath, status: 'busy', trigger }
  }
  let attemptFinalized = false
  try {
    const statePath = path.join(config.runStore, 'host-state.json')
    const state = await readHostState(statePath, started)
    const intervalMilliseconds = config.auditIntervalMinutes * 60 * 1000
    const lastAudit = state.lastAuditAt === null ? null : new Date(state.lastAuditAt)
    const nextAudit = lastAudit === null
      ? started
      : new Date(lastAudit.valueOf() + intervalMilliseconds)
    if (!force && state.health !== 'failed' && nextAudit > started) {
      const finished = now().toISOString()
      const notDue: HostAttemptRecord = {
        ...record,
        finishedAt: finished,
        nextAuditAt: nextAudit.toISOString(),
        status: 'not_due'
      }
      await updateAttempt(recordPath, notDue, config.runStore)
      attemptFinalized = true
      return {
        nextAuditAt: nextAudit.toISOString(),
        record: recordPath,
        status: 'not_due',
        trigger: 'heartbeat'
      }
    }
    const runAudit = dependencies.runAudit ?? runDecisionGardener
    try {
      const audit = await withHostPath(config, () => runAudit({
        codex: config.codex,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        repository: config.repository,
        runStore: config.runStore
      }))
      const finished = now()
      if (state.health === 'failed') {
        sendDecisionGardenerNotification({
          config,
          event: 'recovered',
          record: recordPath,
          runCommand,
          summary: `Gardener recovered with outcome ${audit.status}.`
        })
      }
      const healthy: DecisionGardenerHostState = {
        health: 'healthy',
        lastAuditAt: finished.toISOString(),
        lastError: null,
        lastNotifiedHealth: 'healthy',
        schemaVersion: decisionGardenerHostSchemaVersion,
        updatedAt: finished.toISOString()
      }
      await writePrivateJson(statePath, healthy)
      const completed: HostAttemptRecord = {
        ...record,
        audit,
        finishedAt: finished.toISOString(),
        status: 'completed'
      }
      await updateAttempt(recordPath, completed, config.runStore)
      attemptFinalized = true
      return { audit, record: recordPath, status: 'completed', trigger }
    } catch (error) {
      const failedAt = now()
      const message = errorMessage(error)
      let notificationError: string | null = null
      if (state.lastNotifiedHealth !== 'failed') {
        try {
          sendDecisionGardenerNotification({
            config,
            event: 'failed',
            record: recordPath,
            runCommand,
            summary: message
          })
        } catch (notifyError) {
          notificationError = errorMessage(notifyError)
        }
      }
      const combinedError = notificationError === null
        ? message
        : `${message} Notifier error: ${notificationError}`
      const failed: DecisionGardenerHostState = {
        health: 'failed',
        lastAuditAt: state.lastAuditAt,
        lastError: combinedError,
        lastNotifiedHealth: notificationError === null ? 'failed' : state.lastNotifiedHealth,
        schemaVersion: decisionGardenerHostSchemaVersion,
        updatedAt: failedAt.toISOString()
      }
      await writePrivateJson(statePath, failed)
      const failedRecord: HostAttemptRecord = {
        ...record,
        error: combinedError,
        finishedAt: failedAt.toISOString(),
        status: 'failed'
      }
      await updateAttempt(recordPath, failedRecord, config.runStore)
      attemptFinalized = true
      throw new Error(combinedError, { cause: error })
    }
  } catch (error) {
    if (!attemptFinalized) {
      const failed: HostAttemptRecord = {
        ...record,
        error: errorMessage(error),
        finishedAt: now().toISOString(),
        status: 'failed'
      }
      await updateAttempt(recordPath, failed, config.runStore)
    }
    throw error
  } finally {
    await lease.release()
  }
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function renderDecisionGardenerLaunchAgent({
  config,
  configPath,
  nodeExecutable,
  scriptPath
}: {
  config: DecisionGardenerHostConfig
  configPath: string
  nodeExecutable: string
  scriptPath: string
}): string {
  const stdoutPath = path.join(config.runStore, 'logs', 'launchd.stdout.log')
  const stderrPath = path.join(config.runStore, 'logs', 'launchd.stderr.log')
  const programArguments = [
    nodeExecutable, scriptPath, 'heartbeat', '--config', path.resolve(configPath)
  ]
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${decisionGardenerHostLabel}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...programArguments.map((argument) => `    <string>${xml(argument)}</string>`),
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  <string>${xml(config.repository)}</string>`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>PATH</key>',
    `    <string>${xml(config.environmentPath.join(path.delimiter))}</string>`,
    '  </dict>',
    '  <key>StartInterval</key>',
    `  <integer>${String(decisionGardenerHeartbeatSeconds)}</integer>`,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>ProcessType</key>',
    '  <string>Background</string>',
    '  <key>Umask</key>',
    '  <integer>63</integer>',
    '  <key>StandardOutPath</key>',
    `  <string>${xml(stdoutPath)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xml(stderrPath)}</string>`,
    '</dict>',
    '</plist>',
    ''
  ].join('\n')
}

export function decisionGardenerLaunchAgentPath(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, 'Library', 'LaunchAgents', `${decisionGardenerHostLabel}.plist`)
}

function requireMac(platform: NodeJS.Platform): void {
  if (platform !== 'darwin') throw new Error('Decision-gardener host operations require macOS.')
}

async function requireDirectory(directory: string, label: string): Promise<void> {
  const stats = await fs.stat(directory)
  if (!stats.isDirectory()) throw new Error(`${label} must be a directory.`)
}

async function requireFile(filePath: string, label: string, mode: number): Promise<void> {
  const stats = await fs.lstat(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`)
  }
  await fs.access(filePath, mode)
}

function serviceTarget(uid: number): string {
  return `gui/${String(uid)}/${decisionGardenerHostLabel}`
}

function domainTarget(uid: number): string {
  return `gui/${String(uid)}`
}

function commandSucceeded(result: CommandResult): boolean {
  return result.status === 0
}

export function testDecisionGardenerNotifier(
  config: DecisionGardenerHostConfig,
  configPath: string,
  runCommand: CommandRunner = runHostCommand
): void {
  sendDecisionGardenerNotification({
    config,
    event: 'test',
    record: path.resolve(configPath),
    runCommand,
    summary: 'Notifier self-test succeeded; scheduled activation may proceed.'
  })
}

export async function installDecisionGardenerLaunchAgent(
  configPath: string,
  dependencies: LaunchAgentDependencies = {}
): Promise<{ label: string; plist: string; status: 'installed' }> {
  const platform = dependencies.platform ?? process.platform
  requireMac(platform)
  const uid = dependencies.uid ?? process.getuid?.()
  if (uid === undefined) throw new Error('Could not resolve the current macOS user ID.')
  const runCommand = dependencies.runCommand ?? runHostCommand
  const config = await loadDecisionGardenerHostConfig(configPath)
  testDecisionGardenerNotifier(config, configPath, runCommand)
  const homeDirectory = dependencies.homeDirectory ?? os.homedir()
  const plistPath = decisionGardenerLaunchAgentPath(homeDirectory)
  const nodeExecutable = absolutePath(
    dependencies.nodeExecutable ?? process.execPath,
    'The Node executable'
  )
  const scriptPath = absolutePath(
    dependencies.scriptPath ?? path.join(__dirname, 'decision-gardener-host.js'),
    'The host-controller script'
  )
  await requireDirectory(config.repository, 'The gardener repository')
  await requireFile(config.codex, 'The Codex executable', fsConstants.X_OK)
  await requireFile(nodeExecutable, 'The Node executable', fsConstants.X_OK)
  await requireFile(scriptPath, 'The host-controller script', fsConstants.R_OK)
  await fs.mkdir(path.join(config.runStore, 'logs'), { recursive: true, mode: 0o700 })
  await fs.chmod(config.runStore, 0o700)
  await fs.mkdir(path.dirname(plistPath), { recursive: true })
  await writePrivate(plistPath, renderDecisionGardenerLaunchAgent({
    config,
    configPath,
    nodeExecutable,
    scriptPath
  }))
  const target = serviceTarget(uid)
  if (commandSucceeded(runCommand('/bin/launchctl', ['print', target]))) {
    const removed = runCommand('/bin/launchctl', ['bootout', target])
    if (!commandSucceeded(removed)) {
      throw new Error(`Could not unload the existing gardener agent: ${removed.stderr.trim()}`)
    }
  }
  const loaded = runCommand('/bin/launchctl', [
    'bootstrap', domainTarget(uid), plistPath
  ])
  if (!commandSucceeded(loaded)) {
    throw new Error(`Could not load the gardener agent: ${loaded.stderr.trim()}`)
  }
  return { label: decisionGardenerHostLabel, plist: plistPath, status: 'installed' }
}

export async function uninstallDecisionGardenerLaunchAgent(
  dependencies: LaunchAgentDependencies = {}
): Promise<{ label: string; plist: string; status: 'uninstalled' }> {
  const platform = dependencies.platform ?? process.platform
  requireMac(platform)
  const uid = dependencies.uid ?? process.getuid?.()
  if (uid === undefined) throw new Error('Could not resolve the current macOS user ID.')
  const runCommand = dependencies.runCommand ?? runHostCommand
  const target = serviceTarget(uid)
  if (commandSucceeded(runCommand('/bin/launchctl', ['print', target]))) {
    const removed = runCommand('/bin/launchctl', ['bootout', target])
    if (!commandSucceeded(removed)) {
      throw new Error(`Could not unload the gardener agent: ${removed.stderr.trim()}`)
    }
  }
  const plistPath = decisionGardenerLaunchAgentPath(
    dependencies.homeDirectory ?? os.homedir()
  )
  await fs.rm(plistPath, { force: true })
  return { label: decisionGardenerHostLabel, plist: plistPath, status: 'uninstalled' }
}

export async function decisionGardenerHostStatus(
  configPath: string,
  dependencies: LaunchAgentDependencies = {}
): Promise<{
  config: string
  label: string
  loaded: boolean
  plist: string
  state: DecisionGardenerHostState | null
  status: 'configured'
}> {
  const platform = dependencies.platform ?? process.platform
  requireMac(platform)
  const uid = dependencies.uid ?? process.getuid?.()
  if (uid === undefined) throw new Error('Could not resolve the current macOS user ID.')
  const config = await loadDecisionGardenerHostConfig(configPath)
  const statePath = path.join(config.runStore, 'host-state.json')
  let state: DecisionGardenerHostState | null = null
  try {
    state = parseHostState(parseJson(await fs.readFile(statePath, 'utf8'), 'Host state'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const runCommand = dependencies.runCommand ?? runHostCommand
  return {
    config: path.resolve(configPath),
    label: decisionGardenerHostLabel,
    loaded: commandSucceeded(runCommand('/bin/launchctl', [
      'print', serviceTarget(uid)
    ])),
    plist: decisionGardenerLaunchAgentPath(dependencies.homeDirectory ?? os.homedir()),
    state,
    status: 'configured'
  }
}

interface HostCliOptions {
  command: 'heartbeat' | 'install' | 'run-now' | 'status' | 'test-notifier' | 'uninstall'
  configPath: string
}

export function parseDecisionGardenerHostCli(args: readonly string[]): HostCliOptions {
  const command = args[0]
  if (![
    'heartbeat', 'install', 'run-now', 'status', 'test-notifier', 'uninstall'
  ].includes(String(command))) {
    throw new Error(
      'Usage: decision-gardener-host <heartbeat|run-now|test-notifier|install|status|uninstall> [--config <absolute-path>]'
    )
  }
  let configPath = defaultDecisionGardenerHostConfigPath()
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] !== '--config' || args[index + 1] === undefined) {
      throw new Error('The only host-controller option is --config <absolute-path>.')
    }
    configPath = absolutePath(args[index + 1], 'The host config path')
    index += 1
  }
  return { command: command as HostCliOptions['command'], configPath }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseDecisionGardenerHostCli(args)
  let outcome: unknown
  if (options.command === 'heartbeat' || options.command === 'run-now') {
    outcome = await runDecisionGardenerHostCycle({
      configPath: options.configPath,
      force: options.command === 'run-now',
      trigger: options.command
    })
  } else if (options.command === 'test-notifier') {
    const config = await loadDecisionGardenerHostConfig(options.configPath)
    testDecisionGardenerNotifier(config, options.configPath)
    outcome = { status: 'notifier_ok' }
  } else if (options.command === 'install') {
    outcome = await installDecisionGardenerLaunchAgent(options.configPath)
  } else if (options.command === 'uninstall') {
    outcome = await uninstallDecisionGardenerLaunchAgent()
  } else {
    outcome = await decisionGardenerHostStatus(options.configPath)
  }
  process.stdout.write(`${JSON.stringify(outcome)}\n`)
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  })
}

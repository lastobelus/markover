import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  canonicalDescriptorPath,
  parseCanonicalInstanceDescriptor,
  type CanonicalInstanceDescriptor
} from './instance'

const OFFICIAL_ORIGINS = new Set([
  'https://github.com/lastobelus/markover',
  'https://github.com/lastobelus/markover.git',
  'git@github.com:lastobelus/markover',
  'git@github.com:lastobelus/markover.git',
  'ssh://git@github.com/lastobelus/markover',
  'ssh://git@github.com/lastobelus/markover.git'
])

const UPDATE_LOCK_NAME = 'canonical-update.lock'
const UPDATE_RESULT_NAME = 'canonical-update.json'

export type CanonicalUpdateErrorCode =
  | 'CONFIGURATION_UNAVAILABLE'
  | 'CHECKOUT_INVALID'
  | 'WRONG_BRANCH'
  | 'DIRTY_CHECKOUT'
  | 'UNTRUSTED_ORIGIN'
  | 'FETCH_FAILED'
  | 'DIVERGED'
  | 'UPDATE_IN_PROGRESS'
  | 'HELPER_START_FAILED'
  | 'FAST_FORWARD_FAILED'
  | 'DEPENDENCY_INSTALL_FAILED'
  | 'REFRESH_FAILED'

export class CanonicalUpdateError extends Error {
  constructor(
    readonly code: CanonicalUpdateErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'CanonicalUpdateError'
  }
}

export function canonicalUpdateFailureDetail(
  code: CanonicalUpdateErrorCode
): string {
  const details: Record<CanonicalUpdateErrorCode, string> = {
    CONFIGURATION_UNAVAILABLE: 'Canonical update configuration is unavailable. Retry after repairing the canonical setup.',
    CHECKOUT_INVALID: 'The canonical checkout is unavailable. Retry after repairing the canonical setup.',
    WRONG_BRANCH: 'The canonical checkout is on the wrong branch. Retry after restoring its blessed branch.',
    DIRTY_CHECKOUT: 'The canonical checkout has local changes. Retry after making it clean.',
    UNTRUSTED_ORIGIN: 'The canonical checkout does not use the official origin.',
    FETCH_FAILED: 'The update check failed. Check the network connection, then retry.',
    DIVERGED: 'The canonical checkout cannot be fast-forwarded safely.',
    UPDATE_IN_PROGRESS: 'The previous update did not release its lock. Retry to recover it.',
    HELPER_START_FAILED: 'The update helper could not start. Retry after repairing the canonical toolchain.',
    FAST_FORWARD_FAILED: 'The canonical checkout could not be fast-forwarded. Retry after checking it.',
    DEPENDENCY_INSTALL_FAILED: 'The locked dependencies could not be installed. Check the canonical checkout, then retry.',
    REFRESH_FAILED: 'The updated app could not be refreshed. Retry the update.'
  }
  return details[code]
}

export interface CanonicalUpdateInspection {
  format: 'markover-canonical-update-inspection'
  version: 1
  status: 'current' | 'available'
  commitsBehind: number
}

export interface CanonicalUpdateStatus {
  state:
    | 'hidden'
    | 'checking'
    | 'current'
    | 'available'
    | 'starting'
    | 'unavailable'
  detail: string
  pullRequests: Array<{ number: number; title: string }>
}

export interface CanonicalUpdateStartResult {
  status: 'accepted' | 'rejected'
  detail: string
}

export type CanonicalUpdateAttempt = {
  format: 'markover-canonical-update-attempt'
  version: 1
} & (
  | { status: 'updating' }
  | { status: 'completed' }
  | { status: 'failed'; error: CanonicalUpdateErrorCode }
)

interface CommandResult {
  error?: Error | undefined
  status: number | null
  stdout: string
  stderr: string
}

type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; encoding: 'utf8' }
) => CommandResult

interface DetachedChild {
  pid?: number | undefined
  once(event: 'spawn', listener: () => void): DetachedChild
  once(event: 'error', listener: (error: Error) => void): DetachedChild
  unref(): void
}

type DetachedSpawner = (
  command: string,
  args: readonly string[],
  options: {
    detached: true
    env: NodeJS.ProcessEnv
    stdio: 'ignore'
  }
) => DetachedChild

export interface CanonicalUpdateOptions {
  descriptorPath?: string
  runCommand?: CommandRunner
}

export interface StartCanonicalUpdateOptions extends CanonicalUpdateOptions {
  helperEnvironment?: NodeJS.ProcessEnv
  helperPath?: string
  nodeExecutable?: string
  npmCliPath?: string
  processIsAlive?: (pid: number) => boolean
  spawnDetached?: DetachedSpawner
}

interface ValidatedLocalCheckout {
  descriptor: CanonicalInstanceDescriptor
}

interface ValidatedFetchedCheckout extends ValidatedLocalCheckout {
  descriptor: CanonicalInstanceDescriptor
  remoteHead: string
  commitsBehind: number
}

interface UpdateLock {
  version: 1
  token: string
  pid: number
}

function command(
  checkout: string,
  args: readonly string[],
  runCommand: CommandRunner
): CommandResult {
  return runCommand('git', args, { cwd: checkout, encoding: 'utf8' })
}

function successful(result: CommandResult): boolean {
  return !result.error && result.status === 0
}

function output(result: CommandResult): string {
  return typeof result.stdout === 'string' ? result.stdout.trim() : ''
}

function updateStatePaths(descriptorPath: string): {
  lock: string
  result: string
} {
  const stateRoot = path.dirname(descriptorPath)
  return {
    lock: path.join(stateRoot, UPDATE_LOCK_NAME),
    result: path.join(stateRoot, UPDATE_RESULT_NAME)
  }
}

async function readDescriptor(
  descriptorPath: string
): Promise<CanonicalInstanceDescriptor> {
  let value: unknown
  try {
    value = JSON.parse(await fs.readFile(descriptorPath, 'utf8')) as unknown
  } catch {
    throw new CanonicalUpdateError(
      'CONFIGURATION_UNAVAILABLE',
      'Canonical update configuration is unavailable.'
    )
  }
  const descriptor = parseCanonicalInstanceDescriptor(value)
  if (!descriptor) {
    throw new CanonicalUpdateError(
      'CONFIGURATION_UNAVAILABLE',
      'Canonical update configuration is unavailable.'
    )
  }
  return descriptor
}

async function validateLocalCheckout(
  descriptorPath: string,
  runCommand: CommandRunner
): Promise<ValidatedLocalCheckout> {
  const descriptor = await readDescriptor(descriptorPath)
  let checkout: string
  try {
    checkout = await fs.realpath(descriptor.checkout)
  } catch {
    throw new CanonicalUpdateError(
      'CHECKOUT_INVALID',
      'The configured canonical checkout is unavailable.'
    )
  }
  const root = command(checkout, ['rev-parse', '--show-toplevel'], runCommand)
  const resolvedRoot = await (async () => {
    try {
      return successful(root) ? await fs.realpath(output(root)) : ''
    } catch {
      return ''
    }
  })()
  if (!resolvedRoot || resolvedRoot !== checkout) {
    throw new CanonicalUpdateError(
      'CHECKOUT_INVALID',
      'The configured canonical checkout is invalid.'
    )
  }
  const validBranch = command(
    checkout,
    ['check-ref-format', '--branch', descriptor.blessedBranch],
    runCommand
  )
  const branch = command(checkout, ['branch', '--show-current'], runCommand)
  if (
    !successful(validBranch) ||
    !successful(branch) ||
    output(branch) !== descriptor.blessedBranch
  ) {
    throw new CanonicalUpdateError(
      'WRONG_BRANCH',
      'The canonical checkout is not on its blessed branch.'
    )
  }
  const status = command(
    checkout,
    ['status', '--porcelain', '--untracked-files=all'],
    runCommand
  )
  if (!successful(status) || output(status)) {
    throw new CanonicalUpdateError(
      'DIRTY_CHECKOUT',
      'The canonical checkout has local changes.'
    )
  }
  const origin = command(checkout, ['remote', 'get-url', 'origin'], runCommand)
  if (!successful(origin) || !OFFICIAL_ORIGINS.has(output(origin))) {
    throw new CanonicalUpdateError(
      'UNTRUSTED_ORIGIN',
      'The canonical checkout does not use the official origin.'
    )
  }
  return { descriptor: { ...descriptor, checkout } }
}

function fetchCanonicalState(
  local: ValidatedLocalCheckout,
  runCommand: CommandRunner
): ValidatedFetchedCheckout {
  const { descriptor } = local
  const checkout = descriptor.checkout
  const fetched = command(
    checkout,
    [
      'fetch',
      '--no-tags',
      'origin',
      `refs/heads/${descriptor.blessedBranch}`
    ],
    runCommand
  )
  if (!successful(fetched)) {
    throw new CanonicalUpdateError(
      'FETCH_FAILED',
      'Markover could not check the official canonical branch.'
    )
  }
  const head = command(checkout, ['rev-parse', 'HEAD'], runCommand)
  const remoteHead = command(checkout, ['rev-parse', 'FETCH_HEAD'], runCommand)
  if (!successful(head) || !successful(remoteHead)) {
    throw new CanonicalUpdateError(
      'FETCH_FAILED',
      'Markover could not read the canonical update state.'
    )
  }
  const ancestor = command(
    checkout,
    ['merge-base', '--is-ancestor', output(head), output(remoteHead)],
    runCommand
  )
  if (!successful(ancestor)) {
    throw new CanonicalUpdateError(
      'DIVERGED',
      'The canonical checkout cannot be fast-forwarded safely.'
    )
  }
  const count = command(
    checkout,
    ['rev-list', '--count', `${output(head)}..${output(remoteHead)}`],
    runCommand
  )
  const commitsBehind = Number.parseInt(output(count), 10)
  if (!successful(count) || !Number.isSafeInteger(commitsBehind) || commitsBehind < 0) {
    throw new CanonicalUpdateError(
      'FETCH_FAILED',
      'Markover could not read the canonical update state.'
    )
  }
  return {
    descriptor,
    remoteHead: output(remoteHead),
    commitsBehind
  }
}

export async function inspectCanonicalUpdate({
  descriptorPath = canonicalDescriptorPath(),
  runCommand = spawnSync
}: CanonicalUpdateOptions = {}): Promise<CanonicalUpdateInspection> {
  const local = await validateLocalCheckout(descriptorPath, runCommand)
  const checkout = fetchCanonicalState(local, runCommand)
  return {
    format: 'markover-canonical-update-inspection',
    version: 1,
    status: checkout.commitsBehind === 0 ? 'current' : 'available',
    commitsBehind: checkout.commitsBehind
  }
}

function parseLock(value: unknown): UpdateLock | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Reflect.get(value, 'version') !== 1 ||
    typeof Reflect.get(value, 'token') !== 'string' ||
    typeof Reflect.get(value, 'pid') !== 'number'
  ) return null
  const pid = Reflect.get(value, 'pid') as number
  return Number.isSafeInteger(pid) && pid > 0
    ? {
        version: 1,
        token: Reflect.get(value, 'token') as string,
        pid
      }
    : null
}

async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    await fs.rename(temporary, filePath)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}

function defaultProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return Reflect.get(error as object, 'code') === 'EPERM'
  }
}

async function acquireLock(
  paths: { lock: string; result: string },
  processIsAlive: (pid: number) => boolean
): Promise<UpdateLock> {
  const lock = {
    version: 1 as const,
    token: randomBytes(24).toString('hex'),
    pid: process.pid
  }
  try {
    await fs.writeFile(paths.lock, `${JSON.stringify(lock)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    return lock
  } catch (error) {
    if (Reflect.get(error as object, 'code') !== 'EEXIST') throw error
  }
  const existing = await (async () => {
    try {
      return parseLock(JSON.parse(
        await fs.readFile(paths.lock, 'utf8')
      ) as unknown)
    } catch {
      return null
    }
  })()
  if (existing && processIsAlive(existing.pid)) {
    throw new CanonicalUpdateError(
      'UPDATE_IN_PROGRESS',
      'A canonical update is already in progress.'
    )
  }
  await fs.unlink(paths.lock).catch(() => {})
  await fs.unlink(paths.result).catch(() => {})
  try {
    await fs.writeFile(paths.lock, `${JSON.stringify(lock)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    return lock
  } catch {
    throw new CanonicalUpdateError(
      'UPDATE_IN_PROGRESS',
      'A canonical update is already in progress.'
    )
  }
}

async function releaseOwnedLock(lockPath: string, token: string): Promise<void> {
  try {
    const lock = parseLock(JSON.parse(await fs.readFile(lockPath, 'utf8')) as unknown)
    if (lock?.token === token) await fs.unlink(lockPath)
  } catch {
    // A replaced or already-released lock does not belong to this attempt.
  }
}

export async function startCanonicalUpdate({
  descriptorPath = canonicalDescriptorPath(),
  helperEnvironment = process.env,
  helperPath,
  nodeExecutable = 'node',
  npmCliPath = process.env.npm_execpath || 'npm',
  processIsAlive = defaultProcessIsAlive,
  spawnDetached = spawn,
  runCommand = spawnSync
}: StartCanonicalUpdateOptions = {}): Promise<CanonicalUpdateAttempt> {
  const local = await validateLocalCheckout(descriptorPath, runCommand)
  const paths = updateStatePaths(descriptorPath)
  const selectedHelperPath = helperPath || path.join(
    local.descriptor.checkout,
    'build',
    'src',
    'canonical-updater.js'
  )
  await fs.mkdir(path.dirname(paths.lock), { recursive: true, mode: 0o700 })
  const lock = await acquireLock(paths, processIsAlive)
  const updating: CanonicalUpdateAttempt = {
    format: 'markover-canonical-update-attempt',
    version: 1,
    status: 'updating'
  }
  await writePrivateJson(paths.result, updating)
  try {
    const child = spawnDetached(
      nodeExecutable,
      [
        selectedHelperPath,
        '--canonical-update-helper',
        descriptorPath,
        lock.token,
        npmCliPath
      ],
      {
        detached: true,
        env: { ...helperEnvironment },
        stdio: 'ignore'
      }
    )
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.unref()
  } catch {
    const failed: CanonicalUpdateAttempt = {
      format: 'markover-canonical-update-attempt',
      version: 1,
      status: 'failed',
      error: 'HELPER_START_FAILED'
    }
    await writePrivateJson(paths.result, failed).catch(() => {})
    await releaseOwnedLock(paths.lock, lock.token)
    throw new CanonicalUpdateError(
      'HELPER_START_FAILED',
      'Markover could not start the canonical update helper.'
    )
  }
  return updating
}

async function claimHelperLock(lockPath: string, token: string): Promise<void> {
  const lock = await (async () => {
    try {
      return parseLock(JSON.parse(await fs.readFile(lockPath, 'utf8')) as unknown)
    } catch {
      return null
    }
  })()
  if (!lock || lock.token !== token) {
    throw new CanonicalUpdateError(
      'UPDATE_IN_PROGRESS',
      'This canonical update attempt no longer owns the update lock.'
    )
  }
  await writePrivateJson(lockPath, { ...lock, pid: process.pid })
}

function asCanonicalUpdateError(error: unknown): CanonicalUpdateError {
  return error instanceof CanonicalUpdateError
    ? error
    : new CanonicalUpdateError(
        'REFRESH_FAILED',
        'The canonical update did not complete.'
      )
}

export async function runCanonicalUpdateHelper(
  descriptorPath: string,
  token: string,
  runCommand: CommandRunner = spawnSync,
  nodeExecutable = process.execPath,
  npmCliPath = process.env.npm_execpath || 'npm'
): Promise<CanonicalUpdateAttempt> {
  const paths = updateStatePaths(descriptorPath)
  try {
    await claimHelperLock(paths.lock, token)
    const local = await validateLocalCheckout(descriptorPath, runCommand)
    const checkout = fetchCanonicalState(local, runCommand)
    if (checkout.commitsBehind > 0) {
      const merged = command(
        checkout.descriptor.checkout,
        ['merge', '--ff-only', checkout.remoteHead],
        runCommand
      )
      if (!successful(merged)) {
        throw new CanonicalUpdateError(
          'FAST_FORWARD_FAILED',
          'The canonical checkout could not be fast-forwarded.'
        )
      }
    }
    const installed = runCommand(
      nodeExecutable,
      [npmCliPath, 'ci'],
      { cwd: checkout.descriptor.checkout, encoding: 'utf8' }
    )
    if (!successful(installed)) {
      throw new CanonicalUpdateError(
        'DEPENDENCY_INSTALL_FAILED',
        'Markover could not install the updated locked dependencies.'
      )
    }
    const refreshed = runCommand(
      nodeExecutable,
      [npmCliPath, '--silent', 'run', 'markover', '--', 'canonical', 'refresh'],
      { cwd: checkout.descriptor.checkout, encoding: 'utf8' }
    )
    if (!successful(refreshed)) {
      throw new CanonicalUpdateError(
        'REFRESH_FAILED',
        'The canonical app could not be refreshed.'
      )
    }
    const completed: CanonicalUpdateAttempt = {
      format: 'markover-canonical-update-attempt',
      version: 1,
      status: 'completed'
    }
    await writePrivateJson(paths.result, completed)
    return completed
  } catch (error) {
    const updateError = asCanonicalUpdateError(error)
    const failed: CanonicalUpdateAttempt = {
      format: 'markover-canonical-update-attempt',
      version: 1,
      status: 'failed',
      error: updateError.code
    }
    await writePrivateJson(paths.result, failed).catch(() => {})
    return failed
  } finally {
    await releaseOwnedLock(paths.lock, token)
  }
}

export async function readCanonicalUpdateAttempt(
  descriptorPath = canonicalDescriptorPath(),
  processIsAlive: (pid: number) => boolean = defaultProcessIsAlive
): Promise<CanonicalUpdateAttempt | null> {
  const paths = updateStatePaths(descriptorPath)
  let value: unknown
  try {
    value = JSON.parse(await fs.readFile(paths.result, 'utf8')) as unknown
  } catch {
    return null
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Reflect.get(value, 'format') !== 'markover-canonical-update-attempt' ||
    Reflect.get(value, 'version') !== 1
  ) return null
  const record = value as Record<string, unknown>
  const status = record.status
  if (status === 'updating') {
    const lock = await (async () => {
      try {
        return parseLock(JSON.parse(
          await fs.readFile(paths.lock, 'utf8')
        ) as unknown)
      } catch {
        return null
      }
    })()
    if (!lock || !processIsAlive(lock.pid)) {
      await fs.unlink(paths.lock).catch(() => {})
      await fs.unlink(paths.result).catch(() => {})
      return null
    }
    return {
      format: 'markover-canonical-update-attempt',
      version: 1,
      status
    }
  }
  if (status === 'completed') {
    return {
      format: 'markover-canonical-update-attempt',
      version: 1,
      status
    }
  }
  const error = record.error
  if (status !== 'failed' || typeof error !== 'string') return null
  const allowed: readonly CanonicalUpdateErrorCode[] = [
    'CONFIGURATION_UNAVAILABLE',
    'CHECKOUT_INVALID',
    'WRONG_BRANCH',
    'DIRTY_CHECKOUT',
    'UNTRUSTED_ORIGIN',
    'FETCH_FAILED',
    'DIVERGED',
    'UPDATE_IN_PROGRESS',
    'HELPER_START_FAILED',
    'FAST_FORWARD_FAILED',
    'DEPENDENCY_INSTALL_FAILED',
    'REFRESH_FAILED'
  ]
  return allowed.includes(error as CanonicalUpdateErrorCode)
    ? {
        format: 'markover-canonical-update-attempt',
        version: 1,
        status: 'failed',
        error: error as CanonicalUpdateErrorCode
      }
    : null
}

if (require.main === module && process.argv[2] === '--canonical-update-helper') {
  const descriptorPath = process.argv[3]
  const token = process.argv[4]
  const npmCliPath = process.argv[5]
  if (descriptorPath && token && npmCliPath) {
    void runCanonicalUpdateHelper(
      descriptorPath,
      token,
      spawnSync,
      process.execPath,
      npmCliPath
    ).then((result) => {
      process.exitCode = result.status === 'completed' ? 0 : 1
    })
  } else {
    process.exitCode = 1
  }
}

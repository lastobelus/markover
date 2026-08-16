import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  developmentGeneratedRoot,
  type ResolvedInstance
} from './instance'

export type SchemeHandlerLookup = (scheme: string) => Promise<string[]>
export type SchemeHandlerCommandRunner = (
  command: string,
  args: string[],
  options: { encoding: BufferEncoding }
) => {
  error?: Error
  status: number | null
  stderr: string
  stdout: string
}
export type TrashMover = (source: string, destination: string) => Promise<void>

export interface CleanupDevelopmentInstanceOptions {
  handlersForScheme?: SchemeHandlerLookup
  homeDirectory?: string
  now?: () => Date
  platform?: NodeJS.Platform
  randomSuffix?: () => string
  trashDirectory?: string
  moveToTrash?: TrashMover
}

export interface CleanupDevelopmentInstanceResult {
  status: 'trashed'
  identity: `pr-${number}`
  recoveryPath: string
}

export class InstanceCleanupError extends Error {
  readonly code:
    | 'CANONICAL_CLEANUP_REFUSED'
    | 'HANDLER_STATUS_UNAVAILABLE'
    | 'HANDLER_STILL_INSTALLED'
    | 'INSTANCE_RUNNING'
    | 'INSTANCE_STATE_MISSING'
    | 'OUT_OF_SCOPE_GENERATED_ROOT'
    | 'OUT_OF_SCOPE_STATE_ROOT'
    | 'PLATFORM_UNSUPPORTED'
    | 'TARGET_IDENTITY_MISMATCH'

  constructor(code: InstanceCleanupError['code'], message: string) {
    super(message)
    this.name = 'InstanceCleanupError'
    this.code = code
  }
}

export const schemeHandlersSource = [
  'import AppKit',
  'import Foundation',
  'let url = URL(string: CommandLine.arguments[1] + "://handler-status")!',
  'for app in NSWorkspace.shared.urlsForApplications(toOpen: url) {',
  '  print(app.path)',
  '}'
].join('\n')

export async function macosSchemeHandlers(
  scheme: string,
  runCommand: SchemeHandlerCommandRunner = spawnSync
): Promise<string[]> {
  const result = await Promise.resolve().then(() => runCommand(
    '/usr/bin/swift',
    ['-e', schemeHandlersSource, scheme],
    { encoding: 'utf8' }
  ))
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() ||
      `swift exited ${String(result.status ?? 1)}`
    throw new InstanceCleanupError(
      'HANDLER_STATUS_UNAVAILABLE',
      `Could not verify that the ${scheme}: handler was removed: ${detail}`
    )
  }
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
}

function timestamp(date: Date): string {
  return date.toISOString().replaceAll(/[-:.]/g, '').replace('Z', 'Z')
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object'
    ? Reflect.get(error, 'code')
    : null
}

export interface CrossDeviceMoveOptions {
  copy?: typeof fs.cp
  randomSuffix?: () => string
  remove?: typeof fs.rm
  rename?: typeof fs.rename
}

export async function moveDirectoryToTrash(
  source: string,
  destination: string,
  {
    copy = fs.cp,
    randomSuffix = () => randomBytes(6).toString('hex'),
    remove = fs.rm,
    rename = fs.rename
  }: CrossDeviceMoveOptions = {}
): Promise<void> {
  try {
    await rename(source, destination)
    return
  } catch (error) {
    if (errorCode(error) !== 'EXDEV') throw error
  }

  const suffix = `${String(process.pid)}-${randomSuffix()}`
  const partialDestination = `${destination}.partial-${suffix}`
  const sourceTombstone = path.join(
    path.dirname(source),
    `.${path.basename(source)}-trashed-${suffix}`
  )
  try {
    await copy(source, partialDestination, {
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: true,
      verbatimSymlinks: true
    })
    await rename(partialDestination, destination)
    try {
      await rename(source, sourceTombstone)
    } catch (error) {
      await remove(destination, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    await remove(sourceTombstone, { recursive: true, force: true }).catch(() => {})
  } finally {
    await remove(partialDestination, { recursive: true, force: true })
      .catch(() => {})
  }
}

async function unusedTrashPath(
  trashDirectory: string,
  identity: `pr-${number}`,
  now: () => Date,
  randomSuffix: () => string
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const destination = path.join(
      trashDirectory,
      `Markover-${identity}-instance-${timestamp(now())}-${randomSuffix()}`
    )
    try {
      await fs.access(destination)
    } catch (error) {
      const code: unknown = error !== null && typeof error === 'object'
        ? Reflect.get(error, 'code')
        : null
      if (code === 'ENOENT') return destination
      throw error
    }
  }
  throw new Error('Could not allocate a collision-safe Trash destination.')
}

export async function cleanupDevelopmentInstance(
  instance: ResolvedInstance,
  expectedIdentity: string,
  {
    handlersForScheme = macosSchemeHandlers,
    homeDirectory = os.homedir(),
    now = () => new Date(),
    moveToTrash = moveDirectoryToTrash,
    platform = process.platform,
    randomSuffix = () => randomBytes(6).toString('hex'),
    trashDirectory = path.join(homeDirectory, '.Trash')
  }: CleanupDevelopmentInstanceOptions = {}
): Promise<CleanupDevelopmentInstanceResult> {
  if (platform !== 'darwin') {
    throw new InstanceCleanupError(
      'PLATFORM_UNSUPPORTED',
      'Recoverable Markover instance cleanup currently requires macOS Trash.'
    )
  }
  if (instance.identity.kind !== 'development') {
    throw new InstanceCleanupError(
      'CANONICAL_CLEANUP_REFUSED',
      'Canonical Markover state can never be removed by development cleanup.'
    )
  }
  if (expectedIdentity !== instance.identity.key) {
    throw new InstanceCleanupError(
      'TARGET_IDENTITY_MISMATCH',
      `Cleanup requires the exact identity ${instance.identity.key}.`
    )
  }
  if (instance.process.status !== 'stopped') {
    throw new InstanceCleanupError(
      'INSTANCE_RUNNING',
      `${instance.identity.key} is still running. Quit it before cleanup.`
    )
  }
  const checkout = instance.checkout
  if (!checkout) {
    throw new InstanceCleanupError(
      'OUT_OF_SCOPE_STATE_ROOT',
      'Development cleanup requires an exact checkout.'
    )
  }
  let stateStats
  try {
    stateStats = await fs.lstat(instance.stateRoot)
  } catch (error) {
    const code: unknown = error !== null && typeof error === 'object'
      ? Reflect.get(error, 'code')
      : null
    if (code === 'ENOENT') {
      throw new InstanceCleanupError(
        'INSTANCE_STATE_MISSING',
        `No development state exists at ${instance.stateRoot}.`
      )
    }
    throw error
  }
  if (!stateStats.isDirectory() || stateStats.isSymbolicLink()) {
    throw new InstanceCleanupError(
      'OUT_OF_SCOPE_STATE_ROOT',
      'Development state must be a real worktree-local directory.'
    )
  }
  const checkoutRoot = await fs.realpath(checkout)
  const expectedStateRoot = path.join(checkoutRoot, '.markover', 'instance')
  const actualStateRoot = await fs.realpath(instance.stateRoot)
  if (actualStateRoot !== expectedStateRoot) {
    throw new InstanceCleanupError(
      'OUT_OF_SCOPE_STATE_ROOT',
      `Refusing state outside ${expectedStateRoot}.`
    )
  }

  const expectedGeneratedRoot = path.join(
    developmentGeneratedRoot(checkoutRoot),
    instance.identity.key
  )
  let actualGeneratedRoot: string | null = null
  try {
    const generatedStats = await fs.lstat(expectedGeneratedRoot)
    if (!generatedStats.isDirectory() || generatedStats.isSymbolicLink()) {
      throw new InstanceCleanupError(
        'OUT_OF_SCOPE_GENERATED_ROOT',
        'Development-generated artifacts must be a real directory.'
      )
    }
    actualGeneratedRoot = await fs.realpath(expectedGeneratedRoot)
    if (actualGeneratedRoot !== expectedGeneratedRoot) {
      throw new InstanceCleanupError(
        'OUT_OF_SCOPE_GENERATED_ROOT',
        `Refusing generated artifacts outside ${expectedGeneratedRoot}.`
      )
    }
  } catch (error) {
    const code: unknown = error !== null && typeof error === 'object'
      ? Reflect.get(error, 'code')
      : null
    if (code !== 'ENOENT') throw error
  }

  const handlers = await handlersForScheme(instance.scheme)
  if (handlers.length) {
    throw new InstanceCleanupError(
      'HANDLER_STILL_INSTALLED',
      `Remove the ${instance.scheme}: handler before cleanup (${handlers.join(', ')}).`
    )
  }

  await fs.mkdir(trashDirectory, { recursive: true, mode: 0o700 })
  const recoveryPath = await unusedTrashPath(
    trashDirectory,
    instance.identity.key,
    now,
    randomSuffix
  )
  if (actualGeneratedRoot !== null) {
    const stagedGeneratedRoot = path.join(
      actualStateRoot,
      '.generated-artifacts'
    )
    try {
      await fs.lstat(stagedGeneratedRoot)
      throw new InstanceCleanupError(
        'OUT_OF_SCOPE_GENERATED_ROOT',
        `Cleanup staging already exists at ${stagedGeneratedRoot}.`
      )
    } catch (error) {
      const code: unknown = error !== null && typeof error === 'object'
        ? Reflect.get(error, 'code')
        : null
      if (code !== 'ENOENT') throw error
    }
    await fs.rename(actualGeneratedRoot, stagedGeneratedRoot)
  }
  await moveToTrash(actualStateRoot, recoveryPath)
  return {
    status: 'trashed',
    identity: instance.identity.key,
    recoveryPath
  }
}

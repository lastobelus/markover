import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  assertAddressedBundleMetadata,
  readAddressedBundleMetadata,
  type AddressedDevelopmentBundle
} from './development-bundle'
import {
  INSTALLED_CANONICAL_APPLICATION_PATH
} from '../src/canonical-application'

export { INSTALLED_CANONICAL_APPLICATION_PATH } from '../src/canonical-application'

export interface CanonicalApplicationTransaction {
  readonly backupPath: string
  readonly destinationPath: string
  readonly stagedPath: string
  commit: () => Promise<void>
  discard: () => Promise<void>
  replace: () => Promise<void>
  rollback: () => Promise<void>
}

export interface StageCanonicalApplicationOptions {
  copy?: typeof fs.cp
  destinationPath?: string
  exists?: (filePath: string) => Promise<boolean>
  randomSuffix?: () => string
  remove?: typeof fs.rm
  rename?: typeof fs.rename
  verify?: (
    appPath: string,
    address: AddressedDevelopmentBundle
  ) => Promise<void>
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      Reflect.get(error, 'code') === 'ENOENT'
    ) return false
    throw error
  }
}

function commandFailure(result: ReturnType<typeof spawnSync>): string {
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  return result.error?.message || stderr || stdout ||
    `codesign exited ${String(result.status ?? 1)}`
}

function verifyCanonicalApplicationCopy(
  appPath: string,
  address: AddressedDevelopmentBundle
): Promise<void> {
  assertAddressedBundleMetadata(
    address,
    readAddressedBundleMetadata(appPath, address)
  )
  const result = spawnSync(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', appPath],
    { encoding: 'utf8' }
  )
  if (result.error || result.status !== 0) {
    throw new Error(
      `Staged canonical application verification failed: ${commandFailure(result)}`
    )
  }
  return Promise.resolve()
}

export async function stageCanonicalApplication(
  address: AddressedDevelopmentBundle,
  {
    copy = fs.cp,
    destinationPath = INSTALLED_CANONICAL_APPLICATION_PATH,
    exists = pathExists,
    randomSuffix = () => randomBytes(6).toString('hex'),
    remove = fs.rm,
    rename = fs.rename,
    verify = verifyCanonicalApplicationCopy
  }: StageCanonicalApplicationOptions = {}
): Promise<CanonicalApplicationTransaction> {
  if (
    address.identityKey !== 'canonical' ||
    address.appName !== 'Markover' ||
    path.basename(destinationPath) !== 'Markover.app'
  ) {
    throw new Error('Canonical installation requires the exact Markover canonical bundle.')
  }
  const suffix = `${String(process.pid)}-${randomSuffix()}`
  const parent = path.dirname(destinationPath)
  const stagedPath = path.join(parent, `.Markover.app.refresh-${suffix}`)
  const backupPath = path.join(parent, `.Markover.app.previous-${suffix}`)
  const failedPath = path.join(parent, `.Markover.app.failed-${suffix}`)
  let hadDestination = false
  let replaced = false
  let closed = false

  try {
    await copy(address.appPath, stagedPath, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true
    })
    await verify(stagedPath, address)
  } catch (error) {
    await remove(stagedPath, { recursive: true, force: true })
    throw error
  }

  return {
    backupPath,
    destinationPath,
    stagedPath,
    async replace() {
      if (closed || replaced) {
        throw new Error('Canonical application replacement is no longer pending.')
      }
      hadDestination = await exists(destinationPath)
      if (hadDestination) await rename(destinationPath, backupPath)
      try {
        await rename(stagedPath, destinationPath)
        replaced = true
      } catch (error) {
        if (hadDestination) {
          try {
            await rename(backupPath, destinationPath)
          } catch (restoreError) {
            throw new AggregateError(
              [error, restoreError],
              `Could not replace ${destinationPath}; the previous application remains at ${backupPath}.`,
              { cause: restoreError }
            )
          }
        }
        throw error
      }
    },
    async commit() {
      if (!replaced || closed) {
        throw new Error('Canonical application replacement is not active.')
      }
      if (hadDestination) {
        await remove(backupPath, { recursive: true, force: true })
      }
      closed = true
    },
    async rollback() {
      if (closed) return
      if (!replaced) {
        await remove(stagedPath, { recursive: true, force: true })
        closed = true
        return
      }
      if (!hadDestination) {
        await remove(destinationPath, { recursive: true, force: true })
        closed = true
        return
      }
      await rename(destinationPath, failedPath)
      try {
        await rename(backupPath, destinationPath)
      } catch (error) {
        try {
          await rename(failedPath, destinationPath)
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            `Could not restore ${backupPath}; the failed application remains at ${failedPath}.`,
            { cause: restoreError }
          )
        }
        throw error
      }
      await remove(failedPath, { recursive: true, force: true })
      closed = true
    },
    async discard() {
      if (closed) return
      if (replaced) {
        throw new Error('An active canonical replacement must be committed or rolled back.')
      }
      await remove(stagedPath, { recursive: true, force: true })
      closed = true
    }
  }
}

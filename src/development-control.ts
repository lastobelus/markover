import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const DEVELOPMENT_WATCH_ENVIRONMENT = 'MARKOVER_DEVELOPMENT_WATCH'
export const DEVELOPMENT_RENDERER_ROOT_ENVIRONMENT =
  'MARKOVER_DEVELOPMENT_RENDERER_ROOT'

export type DevelopmentWatchStage =
  | 'build'
  | 'readiness'
  | 'startup'

export type DevelopmentWatchPhase =
  | 'build-failed'
  | 'building'
  | 'ready'
  | 'restart-required'
  | 'starting'
  | 'startup-failed'
  | 'stopped'
  | 'watching'

export interface DevelopmentWatchState {
  version: 1
  checkout: string
  head: string
  dirty: boolean
  identityKey: string
  scheme: string
  watcherPid: number
  phase: DevelopmentWatchPhase
  stage: DevelopmentWatchStage
  updatedAt: string
  outcome: 'launched' | 'reloaded' | 'unchanged' | null
  error: {
    code: string | null
    message: string
  } | null
  service: {
    instanceId: string
    pid: number
    port: number
    startupReady: boolean
  } | null
}

function validIdentityKey(identityKey: string): boolean {
  return /^(?:canonical|pr-[1-9]\d*)$/.test(identityKey)
}

export function developmentWatchStatePath(
  checkout: string,
  identityKey: string
): string {
  if (!path.isAbsolute(checkout) || !validIdentityKey(identityKey)) {
    throw new Error('Development watcher identity is invalid.')
  }
  return path.join(
    checkout,
    '.markover',
    'generated',
    identityKey,
    'development-watch.json'
  )
}

export async function writeDevelopmentWatchState(
  filePath: string,
  state: DevelopmentWatchState
): Promise<void> {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(
    directory,
    `.development-watch-${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`
  )
  await fs.mkdir(directory, { recursive: true })
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    if (process.platform !== 'win32') await fs.chmod(temporaryPath, 0o600)
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.unlink(temporaryPath).catch((error: unknown) => {
      if (
        error === null ||
        typeof error !== 'object' ||
        Reflect.get(error, 'code') !== 'ENOENT'
      ) throw error
    })
  }
}

export function developmentRendererRoot(
  checkout: string,
  identityKey: string
): string {
  if (
    !path.isAbsolute(checkout) ||
    !validIdentityKey(identityKey)
  ) {
    throw new Error('Development renderer identity is invalid.')
  }
  return path.join(
    checkout,
    '.markover',
    'generated',
    identityKey,
    'live-renderer'
  )
}

export const DEVELOPMENT_CONTROL_QUIT = {
  action: 'quit',
  type: 'markover-development-control',
  version: 1
} as const

export function isDevelopmentControlQuit(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 3 &&
    record.action === DEVELOPMENT_CONTROL_QUIT.action &&
    record.type === DEVELOPMENT_CONTROL_QUIT.type &&
    record.version === DEVELOPMENT_CONTROL_QUIT.version
}

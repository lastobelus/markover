import path from 'node:path'

export const DEVELOPMENT_WATCH_ENVIRONMENT = 'MARKOVER_DEVELOPMENT_WATCH'
export const DEVELOPMENT_RENDERER_ROOT_ENVIRONMENT =
  'MARKOVER_DEVELOPMENT_RENDERER_ROOT'

export function developmentRendererRoot(
  checkout: string,
  identityKey: string
): string {
  if (
    !path.isAbsolute(checkout) ||
    !/^(?:canonical|pr-[1-9]\d*)$/.test(identityKey)
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

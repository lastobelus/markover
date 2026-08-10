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

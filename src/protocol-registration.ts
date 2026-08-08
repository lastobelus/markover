import fs from 'node:fs/promises'
import path from 'node:path'

export const SUPPRESS_PROTOCOL_REGISTRATION_ENVIRONMENT =
  'MARKOVER_SUPPRESS_PROTOCOL_REGISTRATION'

export type ProtocolRegistrationOutcome =
  | 'already-default'
  | 'registered'
  | 'registration-failed'

export interface ProtocolRegistrationRecord {
  version: 1
  scheme: string
  attemptedAt: string
  outcome: ProtocolRegistrationOutcome
}

export interface ProtocolClient {
  isDefaultProtocolClient: (scheme: string) => boolean
  setAsDefaultProtocolClient: (scheme: string) => boolean
}

export type ProtocolRegistrationResult =
  | { status: 'suppressed' }
  | { status: 'recorded'; record: ProtocolRegistrationRecord }
  | { status: 'attempted'; record: ProtocolRegistrationRecord }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseProtocolRegistrationRecord(
  value: unknown,
  scheme: string
): ProtocolRegistrationRecord | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.scheme !== scheme ||
    typeof value.attemptedAt !== 'string' ||
    (
      value.outcome !== 'already-default' &&
      value.outcome !== 'registered' &&
      value.outcome !== 'registration-failed'
    )
  ) return null
  return {
    version: 1,
    scheme,
    attemptedAt: value.attemptedAt,
    outcome: value.outcome
  }
}

export async function registerProtocolOnFirstLaunch({
  client,
  recordPath,
  scheme,
  suppressed = false,
  now = () => new Date()
}: {
  client: ProtocolClient
  recordPath: string
  scheme: string
  suppressed?: boolean
  now?: () => Date
}): Promise<ProtocolRegistrationResult> {
  if (suppressed) return { status: 'suppressed' }

  try {
    const existing: unknown = JSON.parse(await fs.readFile(recordPath, 'utf8'))
    const record = parseProtocolRegistrationRecord(existing, scheme)
    if (record) return { status: 'recorded', record }
  } catch {
    // A missing or malformed record means this launch owns one fresh attempt.
  }

  const outcome: ProtocolRegistrationOutcome = client.isDefaultProtocolClient(scheme)
    ? 'already-default'
    : client.setAsDefaultProtocolClient(scheme)
      ? 'registered'
      : 'registration-failed'
  const record: ProtocolRegistrationRecord = {
    version: 1,
    scheme,
    attemptedAt: now().toISOString(),
    outcome
  }
  await fs.mkdir(path.dirname(recordPath), { recursive: true })
  await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return { status: 'attempted', record }
}

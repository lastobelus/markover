import fs from 'node:fs/promises'

export const REMOTE_PROFILE_ENVIRONMENT_VARIABLE = 'MARKOVER_REMOTE_PROFILE'

export interface RemoteProfile {
  baseUrl: string
}

export class RemoteProfileError extends Error {
  readonly code = 'INVALID_REMOTE_PROFILE'

  constructor(message: string) {
    super(message)
    this.name = 'RemoteProfileError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalidProfile(): RemoteProfileError {
  return new RemoteProfileError('The Markover remote profile is invalid.')
}

export function parseRemoteProfile(value: unknown): RemoteProfile {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.baseUrl !== 'string'
  ) {
    throw invalidProfile()
  }

  let url: URL
  try {
    url = new URL(value.baseUrl)
  } catch {
    throw invalidProfile()
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.port !== '' && Number(url.port) < 1) ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    !url.hostname.endsWith('.ts.net') ||
    url.hostname === '.ts.net' ||
    url.hostname.includes(':')
  ) {
    throw invalidProfile()
  }

  const labels = url.hostname.slice(0, -'.ts.net'.length).split('.')
  if (
    labels.some((label) => (
      label.length === 0 ||
      label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    ))
  ) {
    throw invalidProfile()
  }

  return { baseUrl: url.href }
}

export interface LoadRemoteProfileOptions {
  environment?: NodeJS.ProcessEnv
  readFile?: (profilePath: string) => Promise<string>
}

export async function loadRemoteProfile({
  environment = process.env,
  readFile = async (profilePath) => fs.readFile(profilePath, 'utf8')
}: LoadRemoteProfileOptions = {}): Promise<RemoteProfile | null> {
  const profilePath = environment[REMOTE_PROFILE_ENVIRONMENT_VARIABLE]
  if (profilePath === undefined || profilePath === '') return null

  let value: unknown
  try {
    value = JSON.parse(await readFile(profilePath))
  } catch {
    throw invalidProfile()
  }
  return parseRemoteProfile(value)
}

import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { CAPABILITY_TOKEN_PATTERN } from './service-endpoint'

export const REMOTE_GATEWAY_CREDENTIAL_NAME = 'remote-gateway.token'

interface RemoteGatewayCredential {
  version: 1
  token: string
}

export class RemoteGatewayCredentialError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RemoteGatewayCredentialError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorCode(error: unknown): unknown {
  return isRecord(error) ? error.code : null
}

function parseCredential(value: unknown): RemoteGatewayCredential | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.version !== 1 ||
    typeof value.token !== 'string' ||
    !CAPABILITY_TOKEN_PATTERN.test(value.token)
  ) return null
  return { version: 1, token: value.token }
}

export function remoteGatewayCredentialPath(stateRoot: string): string {
  return path.join(stateRoot, REMOTE_GATEWAY_CREDENTIAL_NAME)
}

async function readCredential(
  credentialPath: string,
  uid: number,
  platform: NodeJS.Platform
): Promise<string | null> {
  let stats
  try {
    stats = await fs.lstat(credentialPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    (platform !== 'win32' && (stats.uid !== uid || (stats.mode & 0o077) !== 0))
  ) {
    throw new RemoteGatewayCredentialError(
      'REMOTE_GATEWAY_CREDENTIAL_UNSAFE',
      'The remote gateway credential is not an owner-only regular file.'
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(credentialPath, 'utf8'))
  } catch {
    throw new RemoteGatewayCredentialError(
      'REMOTE_GATEWAY_CREDENTIAL_INVALID',
      'The remote gateway credential is invalid.'
    )
  }
  const credential = parseCredential(parsed)
  if (!credential) {
    throw new RemoteGatewayCredentialError(
      'REMOTE_GATEWAY_CREDENTIAL_INVALID',
      'The remote gateway credential is invalid.'
    )
  }
  return credential.token
}

export interface LoadRemoteGatewayCredentialOptions {
  credentialPath: string
  platform?: NodeJS.Platform
  uid?: number
  token?: () => string
}

export async function loadOrCreateRemoteGatewayCredential({
  credentialPath,
  platform = process.platform,
  uid = typeof process.getuid === 'function' ? process.getuid() : -1,
  token = () => randomBytes(32).toString('base64url')
}: LoadRemoteGatewayCredentialOptions): Promise<string> {
  if (platform !== 'win32' && uid < 0) {
    throw new RemoteGatewayCredentialError(
      'REMOTE_GATEWAY_CREDENTIAL_PLATFORM_UNSUPPORTED',
      'The remote gateway credential requires an operating-system account.'
    )
  }
  const parent = path.dirname(credentialPath)
  await fs.mkdir(parent, { recursive: true, mode: 0o700 })
  const parentStats = await fs.lstat(parent)
  if (
    !parentStats.isDirectory() ||
    parentStats.isSymbolicLink() ||
    (platform !== 'win32' && parentStats.uid !== uid)
  ) {
    throw new RemoteGatewayCredentialError(
      'REMOTE_GATEWAY_CREDENTIAL_PARENT_UNSAFE',
      'The remote gateway credential parent must be an owned directory.'
    )
  }
  if (platform !== 'win32') await fs.chmod(parent, 0o700)

  const existing = await readCredential(credentialPath, uid, platform)
  if (existing) return existing

  const generated = token()
  if (!CAPABILITY_TOKEN_PATTERN.test(generated)) {
    throw new RemoteGatewayCredentialError(
      'REMOTE_GATEWAY_CREDENTIAL_INVALID',
      'The generated remote gateway credential is invalid.'
    )
  }
  const contents = `${JSON.stringify({ version: 1, token: generated }, null, 2)}\n`
  try {
    await fs.writeFile(credentialPath, contents, {
      encoding: 'utf8',
      flag: 'wx',
      flush: true,
      mode: 0o600
    })
    if (platform !== 'win32') await fs.chmod(credentialPath, 0o600)
    return generated
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error
    const raced = await readCredential(credentialPath, uid, platform)
    if (raced) return raced
    throw new RemoteGatewayCredentialError(
      'REMOTE_GATEWAY_CREDENTIAL_INVALID',
      'The remote gateway credential is invalid.'
    )
  }
}

import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { replaceJsonFile } from './atomic-json'

export const CAPABILITY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const SERVICE_INSTANCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ServiceIdentity {
  instanceId: string
  token: string
}

export interface ServiceEndpoint {
  version: 2
  instanceId: string
  port: number
  pid: number
}

export interface ServiceCredential {
  version: 1
  instanceId: string
  token: string
}

export interface ServiceDirectoryOptions {
  platform?: NodeJS.Platform
  homeDirectory?: string
  environment?: NodeJS.ProcessEnv
}

export function serviceDirectory({
  platform = process.platform,
  homeDirectory = os.homedir(),
  environment = process.env
}: ServiceDirectoryOptions = {}): string {
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', 'Markover')
  }
  if (platform === 'win32') {
    return path.join(environment.APPDATA || homeDirectory, 'Markover')
  }
  return path.join(
    environment.XDG_CONFIG_HOME || path.join(homeDirectory, '.config'),
    'Markover'
  )
}

export function serviceEndpointPath(options?: ServiceDirectoryOptions): string {
  return path.join(serviceDirectory(options), 'service.json')
}

export function serviceTokenPath(options?: ServiceDirectoryOptions): string {
  return path.join(serviceDirectory(options), 'service.token')
}

export function tokenPathForEndpoint(endpointPath: string): string {
  return path.join(path.dirname(endpointPath), 'service.token')
}

export function reviewsDirectory(options?: ServiceDirectoryOptions): string {
  return path.join(serviceDirectory(options), 'reviews')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseServiceEndpoint(value: unknown): ServiceEndpoint | null {
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    typeof value.instanceId !== 'string' ||
    !SERVICE_INSTANCE_PATTERN.test(value.instanceId) ||
    typeof value.port !== 'number' ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    typeof value.pid !== 'number' ||
    !Number.isInteger(value.pid) ||
    value.pid < 1
  ) return null

  return {
    version: 2,
    instanceId: value.instanceId,
    port: value.port,
    pid: value.pid
  }
}

export function parseServiceCredential(value: unknown): ServiceCredential | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.instanceId !== 'string' ||
    !SERVICE_INSTANCE_PATTERN.test(value.instanceId) ||
    typeof value.token !== 'string' ||
    !CAPABILITY_TOKEN_PATTERN.test(value.token)
  ) return null

  return {
    version: 1,
    instanceId: value.instanceId,
    token: value.token
  }
}

export function createServiceIdentity(): ServiceIdentity {
  return {
    instanceId: randomUUID(),
    token: randomBytes(32).toString('base64url')
  }
}

export async function secureServiceDirectory(
  directoryPath = serviceDirectory(),
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 })
  if (platform !== 'win32') await fs.chmod(directoryPath, 0o700)
}

async function writePrivateJson(
  filePath: string,
  value: unknown,
  platform: NodeJS.Platform
): Promise<void> {
  await replaceJsonFile(filePath, value, { platform })
}

export interface PublishServiceConnectionOptions {
  endpointPath?: string
  identity: ServiceIdentity
  port: number
  pid?: number
  platform?: NodeJS.Platform
}

export async function publishServiceConnection({
  endpointPath = serviceEndpointPath(),
  identity,
  port,
  pid = process.pid,
  platform = process.platform
}: PublishServiceConnectionOptions): Promise<void> {
  const endpoint = parseServiceEndpoint({
    version: 2,
    instanceId: identity.instanceId,
    port,
    pid
  })
  const credential = parseServiceCredential({
    version: 1,
    instanceId: identity.instanceId,
    token: identity.token
  })
  if (!endpoint || !credential) {
    throw new Error('Markover service identity is invalid.')
  }

  await secureServiceDirectory(path.dirname(endpointPath), platform)
  await writePrivateJson(tokenPathForEndpoint(endpointPath), credential, platform)
  await writePrivateJson(endpointPath, endpoint, platform)
}

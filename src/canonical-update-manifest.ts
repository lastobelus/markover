import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const CANONICAL_UPDATE_MANIFEST_URL =
  'https://lastobelus.github.io/markover/update-manifest.json'
export const CANONICAL_UPDATE_MANIFEST_NAME = 'canonical-update-manifest.json'
export const MAXIMUM_CANONICAL_UPDATE_MANIFEST_BYTES = 64 * 1024
export const MAXIMUM_CANONICAL_UPDATE_PULL_REQUESTS = 100
export const MAXIMUM_CANONICAL_UPDATE_TITLE_CHARACTERS = 240
export const DEFAULT_CANONICAL_UPDATE_FETCH_TIMEOUT_MILLISECONDS = 3_000
export const MAXIMUM_CANONICAL_UPDATE_FETCH_TIMEOUT_MILLISECONDS = 10_000

const COMMIT_PATTERN = /^[a-f0-9]{40}$/
const REPOSITORY = 'lastobelus/markover'
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const ROOT_KEYS = [
  'baseCommit',
  'generatedAt',
  'headCommit',
  'pullRequests',
  'repository',
  'version'
] as const
const PULL_REQUEST_KEYS = [
  'mergeCommit',
  'mergedAt',
  'number',
  'title'
] as const

export interface CanonicalUpdatePullRequest {
  number: number
  title: string
  mergeCommit: string
  mergedAt: string
}

export interface CanonicalUpdateManifest {
  version: 1
  repository: typeof REPOSITORY
  generatedAt: string
  baseCommit: string
  headCommit: string
  pullRequests: CanonicalUpdatePullRequest[]
}

export class CanonicalUpdateManifestError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CanonicalUpdateManifestError'
    this.code = code
  }
}

function manifestError(code: string, message: string): CanonicalUpdateManifestError {
  return new CanonicalUpdateManifestError(code, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function decodePullRequest(value: unknown): CanonicalUpdatePullRequest {
  if (!isRecord(value) || !hasExactKeys(value, PULL_REQUEST_KEYS)) {
    throw manifestError(
      'CANONICAL_UPDATE_MANIFEST_INVALID',
      'The canonical update manifest contains an invalid pull request.'
    )
  }
  const number = value.number
  const title = value.title
  const mergeCommit = value.mergeCommit
  const mergedAt = value.mergedAt
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    typeof title !== 'string' ||
    title.length < 1 ||
    title.length > MAXIMUM_CANONICAL_UPDATE_TITLE_CHARACTERS ||
    title.trim() !== title ||
    containsControlCharacter(title) ||
    typeof mergeCommit !== 'string' ||
    !COMMIT_PATTERN.test(mergeCommit) ||
    !validTimestamp(mergedAt)
  ) {
    throw manifestError(
      'CANONICAL_UPDATE_MANIFEST_INVALID',
      'The canonical update manifest contains an invalid pull request.'
    )
  }
  return { number, title, mergeCommit, mergedAt }
}

function sourceBytes(source: string | Uint8Array): Uint8Array {
  return typeof source === 'string' ? Buffer.from(source, 'utf8') : source
}

export function decodeCanonicalUpdateManifest(
  source: string | Uint8Array
): CanonicalUpdateManifest {
  const bytes = sourceBytes(source)
  if (bytes.byteLength > MAXIMUM_CANONICAL_UPDATE_MANIFEST_BYTES) {
    throw manifestError(
      'CANONICAL_UPDATE_MANIFEST_TOO_LARGE',
      'The canonical update manifest is too large.'
    )
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw manifestError(
      'CANONICAL_UPDATE_MANIFEST_INVALID',
      'The canonical update manifest is not valid JSON.'
    )
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ROOT_KEYS) ||
    value.version !== 1 ||
    value.repository !== REPOSITORY ||
    !validTimestamp(value.generatedAt) ||
    typeof value.baseCommit !== 'string' ||
    !COMMIT_PATTERN.test(value.baseCommit) ||
    typeof value.headCommit !== 'string' ||
    !COMMIT_PATTERN.test(value.headCommit) ||
    !Array.isArray(value.pullRequests) ||
    value.pullRequests.length > MAXIMUM_CANONICAL_UPDATE_PULL_REQUESTS
  ) {
    throw manifestError(
      'CANONICAL_UPDATE_MANIFEST_INVALID',
      'The canonical update manifest has an invalid shape.'
    )
  }

  const pullRequests = value.pullRequests.map(decodePullRequest)
  const numbers = new Set<number>()
  const commits = new Set<string>([value.baseCommit])
  let previousMergedAt = 0
  for (const pullRequest of pullRequests) {
    const mergedAt = Date.parse(pullRequest.mergedAt)
    if (
      numbers.has(pullRequest.number) ||
      commits.has(pullRequest.mergeCommit) ||
      mergedAt < previousMergedAt
    ) {
      throw manifestError(
        'CANONICAL_UPDATE_MANIFEST_INVALID',
        'The canonical update manifest contains duplicate or unordered pull requests.'
      )
    }
    numbers.add(pullRequest.number)
    commits.add(pullRequest.mergeCommit)
    previousMergedAt = mergedAt
  }
  const lastCommit = pullRequests.at(-1)?.mergeCommit ?? value.baseCommit
  if (lastCommit !== value.headCommit) {
    throw manifestError(
      'CANONICAL_UPDATE_MANIFEST_INVALID',
      'The canonical update manifest head does not match its pull request history.'
    )
  }

  return {
    version: 1,
    repository: REPOSITORY,
    generatedAt: value.generatedAt,
    baseCommit: value.baseCommit,
    headCommit: value.headCommit,
    pullRequests
  }
}

export function selectCanonicalUpdateChangelist(
  manifest: CanonicalUpdateManifest,
  currentCommit: string
): CanonicalUpdatePullRequest[] | null {
  if (!COMMIT_PATTERN.test(currentCommit)) return null
  if (currentCommit === manifest.headCommit) return []
  if (currentCommit === manifest.baseCommit) return [...manifest.pullRequests]
  const currentIndex = manifest.pullRequests.findIndex(
    (pullRequest) => pullRequest.mergeCommit === currentCommit
  )
  return currentIndex < 0 ? null : manifest.pullRequests.slice(currentIndex + 1)
}

export function canonicalUpdateManifestCachePath(stateRoot: string): string {
  return path.join(stateRoot, CANONICAL_UPDATE_MANIFEST_NAME)
}

function errorCode(error: unknown): unknown {
  return isRecord(error) ? error.code : null
}

interface CacheOptions {
  platform?: NodeJS.Platform
  uid?: number
}

async function assertOwnedDirectory(
  directory: string,
  platform: NodeJS.Platform,
  uid: number
): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const stats = await fs.lstat(directory)
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    (platform !== 'win32' && stats.uid !== uid)
  ) {
    throw manifestError(
      'CANONICAL_UPDATE_CACHE_UNSAFE',
      'The canonical update cache directory is not owner-controlled.'
    )
  }
  if (platform !== 'win32') await fs.chmod(directory, 0o700)
}

export async function readCanonicalUpdateManifestCache(
  cachePath: string,
  {
    platform = process.platform,
    uid = typeof process.getuid === 'function' ? process.getuid() : -1
  }: CacheOptions = {}
): Promise<CanonicalUpdateManifest | null> {
  let stats
  try {
    stats = await fs.lstat(cachePath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size > MAXIMUM_CANONICAL_UPDATE_MANIFEST_BYTES ||
    (platform !== 'win32' && (stats.uid !== uid || (stats.mode & 0o077) !== 0))
  ) {
    throw manifestError(
      'CANONICAL_UPDATE_CACHE_UNSAFE',
      'The canonical update cache is not an owner-only regular file.'
    )
  }
  try {
    return decodeCanonicalUpdateManifest(await fs.readFile(cachePath))
  } catch (error) {
    if (error instanceof CanonicalUpdateManifestError) return null
    throw error
  }
}

export async function writeCanonicalUpdateManifestCache(
  cachePath: string,
  manifest: CanonicalUpdateManifest,
  {
    platform = process.platform,
    uid = typeof process.getuid === 'function' ? process.getuid() : -1
  }: CacheOptions = {}
): Promise<void> {
  const encoded = `${JSON.stringify(manifest, null, 2)}\n`
  decodeCanonicalUpdateManifest(encoded)
  const directory = path.dirname(cachePath)
  await assertOwnedDirectory(directory, platform, uid)
  try {
    const existing = await fs.lstat(cachePath)
    if (
      !existing.isFile() ||
      existing.isSymbolicLink() ||
      (platform !== 'win32' &&
        (existing.uid !== uid || (existing.mode & 0o077) !== 0))
    ) {
      throw manifestError(
        'CANONICAL_UPDATE_CACHE_UNSAFE',
        'The canonical update cache is not an owner-only regular file.'
      )
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
  const temporary = path.join(
    directory,
    `.${path.basename(cachePath)}-${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`
  )
  try {
    await fs.writeFile(temporary, encoded, {
      encoding: 'utf8',
      flag: 'wx',
      flush: true,
      mode: 0o600
    })
    if (platform !== 'win32') await fs.chmod(temporary, 0o600)
    await fs.rename(temporary, cachePath)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}

export type CanonicalUpdateManifestFetch = (
  input: string,
  init: RequestInit
) => Promise<Response>

export interface FetchCanonicalUpdateManifestOptions {
  fetchImplementation?: CanonicalUpdateManifestFetch
  timeoutMilliseconds?: number
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length')
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAXIMUM_CANONICAL_UPDATE_MANIFEST_BYTES)
  ) {
    throw manifestError(
      'CANONICAL_UPDATE_MANIFEST_TOO_LARGE',
      'The canonical update manifest is too large.'
    )
  }
  if (!response.body) {
    throw manifestError(
      'CANONICAL_UPDATE_FETCH_FAILED',
      'The canonical update manifest response has no body.'
    )
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    let result = await reader.read()
    while (!result.done) {
      length += result.value.byteLength
      if (length > MAXIMUM_CANONICAL_UPDATE_MANIFEST_BYTES) {
        throw manifestError(
          'CANONICAL_UPDATE_MANIFEST_TOO_LARGE',
          'The canonical update manifest is too large.'
        )
      }
      chunks.push(result.value)
      result = await reader.read()
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function fetchCanonicalUpdateManifest({
  fetchImplementation = fetch,
  timeoutMilliseconds = DEFAULT_CANONICAL_UPDATE_FETCH_TIMEOUT_MILLISECONDS
}: FetchCanonicalUpdateManifestOptions = {}): Promise<CanonicalUpdateManifest> {
  if (
    !Number.isInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > MAXIMUM_CANONICAL_UPDATE_FETCH_TIMEOUT_MILLISECONDS
  ) {
    throw manifestError(
      'CANONICAL_UPDATE_FETCH_TIMEOUT_INVALID',
      'The canonical update manifest timeout is invalid.'
    )
  }
  const controller = new AbortController()
  let timeout: NodeJS.Timeout | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(manifestError(
        'CANONICAL_UPDATE_FETCH_TIMEOUT',
        'The canonical update manifest request timed out.'
      ))
    }, timeoutMilliseconds)
  })
  try {
    const response = await Promise.race([
      fetchImplementation(CANONICAL_UPDATE_MANIFEST_URL, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal
      }),
      timedOut
    ])
    if (response.status !== 200) {
      throw manifestError(
        'CANONICAL_UPDATE_FETCH_FAILED',
        `The canonical update manifest request returned HTTP ${String(response.status)}.`
      )
    }
    const contentType = response.headers.get('content-type')
    if (!contentType?.toLowerCase().startsWith('application/json')) {
      throw manifestError(
        'CANONICAL_UPDATE_FETCH_FAILED',
        'The canonical update manifest response is not JSON.'
      )
    }
    return decodeCanonicalUpdateManifest(await Promise.race([
      readBoundedResponse(response),
      timedOut
    ]))
  } finally {
    clearTimeout(timeout)
  }
}

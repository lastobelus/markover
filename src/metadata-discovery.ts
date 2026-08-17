import { execFile } from 'node:child_process'
import { createReadStream, type Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'

import { isPortableRepositoryUrl } from './review-format'

const execFileAsync = promisify(execFile)
const HANDOFF_KEY_PATTERN = /^mko_handoff_[a-zA-Z0-9]{16,64}$/

export type GitRunner = (
  args: string[],
  workingDirectory: string
) => Promise<string | null>

export interface GitMetadata {
  repositoryUrl?: string
  branch?: string
  commit?: string
}

export interface CodexThread {
  provider: 'codex'
  id: string
  discovery: 'explicit' | 'handoff-key'
  cwd?: string | null
  logPath?: string
  parentThreadId?: string | null
  forkedFromId?: string | null
}

export interface ClaudeThread {
  provider: 'claude'
  id: string
  discovery: 'handoff-key'
  cwd?: string | null
  logPath?: string
}

interface SessionLog {
  logPath: string
  modifiedAt: number
  size: number
}

interface CodexDiscoveryOptions {
  sessionsDirectory?: string
  maximumLogs?: number
  tailBytes?: number
  maximumBytes?: number
  expectedPath?: string
}

interface ClaudeDiscoveryOptions {
  projectsDirectory?: string
  maximumLogs?: number
  tailBytes?: number
  maximumBytes?: number
  expectedPath?: string
}

interface GitDiscoveryOptions {
  runGit?: GitRunner
}

export interface ReviewMetadataOptions {
  git?: GitDiscoveryOptions
  codex?: CodexDiscoveryOptions
  claude?: ClaudeDiscoveryOptions
}

export interface ReviewMetadataInput {
  sourcePath: string
  branch?: string | null
  pullRequestNumber?: number | null
  pullRequestUrl?: string | null
  threadId?: string | null
  threadHostKind?: string | null
  threadHostProvider?: string | null
  threadHostThreadId?: string | null
  threadHostMachine?: string | null
  handoffKey?: string | null
}

export interface ReviewMetadata {
  git: GitMetadata | null
  agentThread: ReviewAgentThread | null
  pullRequest: {
    number: number
    url?: string
  } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function runGit(
  args: string[],
  workingDirectory: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', workingDirectory, ...args],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024
      }
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

export async function discoverRepositoryRoot(
  sourcePath: string,
  options: GitDiscoveryOptions = {}
): Promise<string | null> {
  const git = options.runGit || runGit
  const workingDirectory = path.dirname(path.resolve(sourcePath))
  return git(['rev-parse', '--show-toplevel'], workingDirectory)
}

export async function discoverGitMetadata(
  sourcePath: string,
  options: GitDiscoveryOptions = {}
): Promise<GitMetadata | null> {
  const git = options.runGit || runGit
  const workingDirectory = path.dirname(path.resolve(sourcePath))
  const repositoryRoot = await discoverRepositoryRoot(sourcePath, { runGit: git })
  if (!repositoryRoot) return null

  const [branch, commit, remoteUrl] = await Promise.all([
    git(['symbolic-ref', '--quiet', '--short', 'HEAD'], workingDirectory),
    git(['rev-parse', '--verify', 'HEAD'], workingDirectory),
    git(['config', '--get', 'remote.origin.url'], workingDirectory)
  ])
  const repositoryUrl = sanitizeRemoteUrl(remoteUrl)
  const metadata: GitMetadata = {
    ...(repositoryUrl ? { repositoryUrl } : {}),
    ...(branch ? { branch } : {}),
    ...(commit ? { commit } : {})
  }
  return Object.keys(metadata).length ? metadata : null
}

export function sanitizeRemoteUrl(
  remoteUrl: string | null | undefined
): string | null {
  const candidate = remoteUrl?.trim()
  if (!candidate) return null
  if (!candidate.includes('://')) {
    return isPortableRepositoryUrl(candidate) ? candidate : null
  }
  try {
    const parsed = new URL(candidate)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    const sanitized = parsed.toString()
    return isPortableRepositoryUrl(sanitized) ? sanitized : null
  } catch {
    return null
  }
}

async function sessionLogPaths(directory: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sessionLogPaths(entryPath)
    return entry.isFile() && entry.name.endsWith('.jsonl')
      ? [entryPath]
      : []
  }))
  return nested.flat()
}

async function claudeSessionLogPaths(directory: string): Promise<string[]> {
  let projects: Dirent[]
  try {
    projects = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const logs = await Promise.all(projects.map(async (project) => {
    if (!project.isDirectory() || project.name === 'subagents') return []
    const projectPath = path.join(directory, project.name)
    let entries: Dirent[]
    try {
      entries = await fs.readdir(projectPath, { withFileTypes: true })
    } catch {
      return []
    }
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(projectPath, entry.name))
  }))
  return logs.flat()
}

export function containsHandoffKey(contents: string, key: string): boolean {
  let index = contents.indexOf(key)
  while (index !== -1) {
    const before = contents[index - 1] || ''
    const after = contents[index + key.length] || ''
    if (
      !/[a-zA-Z0-9_]/.test(before) &&
      !/[a-zA-Z0-9_]/.test(after)
    ) {
      return true
    }
    index = contents.indexOf(key, index + key.length)
  }
  return false
}

async function readTail(
  logPath: string,
  size: number,
  maximumBytes: number
): Promise<string> {
  const bytesToRead = Math.min(size, maximumBytes)
  const buffer = Buffer.alloc(bytesToRead)
  const handle = await fs.open(logPath, 'r')
  try {
    await handle.read(buffer, 0, bytesToRead, size - bytesToRead)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

async function readSessionMetadata(
  logPath: string
): Promise<Record<string, unknown> | null> {
  const input = createReadStream(logPath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      try {
        const record: unknown = JSON.parse(line)
        if (
          isRecord(record) &&
          record.type === 'session_meta' &&
          isRecord(record.payload)
        ) {
          return record.payload
        }
      } catch {
        // Ignore malformed log records and continue scanning the session.
      }
      return null
    }
    return null
  } finally {
    lines.close()
    input.destroy()
  }
}

export function sessionMetadata(
  contents: string
): Record<string, unknown> | null {
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue
    try {
      const record: unknown = JSON.parse(line)
      if (
        isRecord(record) &&
        record.type === 'session_meta' &&
        isRecord(record.payload)
      ) {
        return record.payload
      }
    } catch {
      // Ignore malformed log records and continue scanning the supplied text.
    }
  }
  return null
}

function claudeSessionMetadata(
  contents: string
): { id: string; cwd: string | null } | null {
  const sessionIds = new Set<string>()
  let cwd: string | null = null
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      // A bounded tail can begin in the middle of a record.
      continue
    }
    if (!isRecord(record)) continue
    if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
      sessionIds.add(record.sessionId.trim())
    }
    if (cwd === null && typeof record.cwd === 'string' && record.cwd.trim()) {
      cwd = record.cwd
    }
  }
  if (sessionIds.size !== 1) return null
  const [id] = sessionIds
  return id ? { id, cwd } : null
}

async function recentSessionLogs(paths: string[]): Promise<SessionLog[]> {
  const logs = (await Promise.all(paths.map(async (logPath) => {
    try {
      const stats = await fs.stat(logPath)
      return {
        logPath,
        modifiedAt: stats.mtimeMs,
        size: stats.size
      }
    } catch {
      return null
    }
  }))).filter((log): log is SessionLog => log !== null)
  logs.sort((left, right) => right.modifiedAt - left.modifiedAt)
  return logs
}

function oneWorkspaceCandidate<T extends { cwd?: string | null }>(
  matches: T[],
  expectedPath: string | undefined
): T | null {
  const resolvedExpectedPath = expectedPath ? path.resolve(expectedPath) : null
  const matchingWorkspace = resolvedExpectedPath
    ? matches.filter((match) => {
        if (!match.cwd) return false
        const relative = path.relative(path.resolve(match.cwd), resolvedExpectedPath)
        return relative === '' || (
          !relative.startsWith('..') &&
          !path.isAbsolute(relative)
        )
      })
    : []
  const candidates = matchingWorkspace.length ? matchingWorkspace : matches
  return candidates.length === 1 ? candidates[0] ?? null : null
}

export async function discoverCodexThread(
  handoffKey: string | null | undefined,
  options: CodexDiscoveryOptions = {}
): Promise<CodexThread | null> {
  const key = handoffKey?.trim()
  if (!key || !HANDOFF_KEY_PATTERN.test(key)) return null
  const directory = options.sessionsDirectory || path.join(
    os.homedir(),
    '.codex',
    'sessions'
  )
  const paths = await sessionLogPaths(directory)
  const logs = await recentSessionLogs(paths)

  const maximumLogs = options.maximumLogs ?? 50
  const tailBytes = options.tailBytes ?? 512 * 1024
  let remainingBytes = options.maximumBytes ?? 16 * 1024 * 1024
  const matches: CodexThread[] = []
  for (const log of logs.slice(0, maximumLogs)) {
    const bytesToRead = Math.min(log.size, tailBytes, remainingBytes)
    if (bytesToRead <= 0) break
    remainingBytes -= bytesToRead
    let contents
    try {
      contents = await readTail(log.logPath, log.size, bytesToRead)
    } catch {
      continue
    }
    if (!containsHandoffKey(contents, key)) continue
    let metadata: Record<string, unknown> | null
    try {
      metadata = await readSessionMetadata(log.logPath)
    } catch {
      continue
    }
    if (!metadata) continue
    const sessionId = typeof metadata.id === 'string'
      ? metadata.id
      : metadata.session_id
    if (typeof sessionId !== 'string' || !sessionId) continue
    matches.push({
      provider: 'codex',
      id: sessionId,
      discovery: 'handoff-key',
      cwd: typeof metadata.cwd === 'string' ? metadata.cwd : null,
      logPath: log.logPath,
      parentThreadId: typeof metadata.parent_thread_id === 'string'
        ? metadata.parent_thread_id
        : null,
      forkedFromId: typeof metadata.forked_from_id === 'string'
        ? metadata.forked_from_id
        : null
    })
  }

  return oneWorkspaceCandidate(matches, options.expectedPath)
}

export async function discoverClaudeThread(
  handoffKey: string | null | undefined,
  options: ClaudeDiscoveryOptions = {}
): Promise<ClaudeThread | null> {
  const key = handoffKey?.trim()
  if (!key || !HANDOFF_KEY_PATTERN.test(key)) return null
  const directory = options.projectsDirectory || path.join(
    os.homedir(),
    '.claude',
    'projects'
  )
  const logs = await recentSessionLogs(await claudeSessionLogPaths(directory))
  const maximumLogs = options.maximumLogs ?? 50
  const tailBytes = options.tailBytes ?? 512 * 1024
  let remainingBytes = options.maximumBytes ?? 16 * 1024 * 1024
  const matches: ClaudeThread[] = []
  for (const log of logs.slice(0, maximumLogs)) {
    const bytesToRead = Math.min(log.size, tailBytes, remainingBytes)
    if (bytesToRead <= 0) break
    remainingBytes -= bytesToRead
    let contents: string
    try {
      contents = await readTail(log.logPath, log.size, bytesToRead)
    } catch {
      continue
    }
    if (!containsHandoffKey(contents, key)) continue
    const metadata = claudeSessionMetadata(contents)
    if (!metadata) continue
    matches.push({
      provider: 'claude',
      id: metadata.id,
      discovery: 'handoff-key',
      cwd: metadata.cwd,
      logPath: log.logPath
    })
  }
  return oneWorkspaceCandidate(matches, options.expectedPath)
}

function localSessionProvider(
  provider: string | null | undefined
): 'codex' | 'claude' | null {
  switch (provider?.trim().toLowerCase()) {
    case 'codex':
    case 'openai':
      return 'codex'
    case 'claude':
    case 'anthropic':
    case 'claudeagent':
      return 'claude'
    default:
      return null
  }
}

export async function discoverReviewMetadata({
  sourcePath,
  branch = null,
  pullRequestNumber = null,
  pullRequestUrl = null,
  threadId = null,
  threadHostKind = null,
  threadHostProvider = null,
  threadHostThreadId = null,
  threadHostMachine = null,
  handoffKey = null
}: ReviewMetadataInput, options: ReviewMetadataOptions = {}): Promise<ReviewMetadata> {
  const discoveredGit = await discoverGitMetadata(
    sourcePath,
    options.git
  ).catch(() => null)
  const git: GitMetadata | null = discoveredGit || (branch ? {} : null)
  if (branch && git) {
    git.branch = branch
  }

  let providerThreadId = threadId
  if (!providerThreadId && handoffKey) {
    const provider = localSessionProvider(threadHostProvider)
    const discoveredThread = provider === 'codex'
      ? await discoverCodexThread(handoffKey, {
          ...options.codex,
          expectedPath: sourcePath
        }).catch(() => null)
      : provider === 'claude'
        ? await discoverClaudeThread(handoffKey, {
            ...options.claude,
            expectedPath: sourcePath
          }).catch(() => null)
        : null
    providerThreadId = discoveredThread?.id || null
  }
  const agentThread: ReviewAgentThread | null =
    providerThreadId && threadHostKind && threadHostProvider
      ? {
          id: providerThreadId,
          threadHost: {
            kind: threadHostKind,
            provider: threadHostProvider,
            ...(threadHostThreadId ? { threadId: threadHostThreadId } : {}),
            ...(threadHostMachine ? { machine: threadHostMachine } : {})
          }
        }
      : null

  return {
    git,
    agentThread,
    pullRequest: pullRequestNumber
      ? {
          number: pullRequestNumber,
          ...(pullRequestUrl ? { url: pullRequestUrl } : {})
        }
      : null
  }
}

export { HANDOFF_KEY_PATTERN }

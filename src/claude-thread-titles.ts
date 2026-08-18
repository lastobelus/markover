import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'

import { claudeSessionLogPaths } from './metadata-discovery'
import { isClaudeCodeThreadHost } from './provider-identity'

export interface ClaudeThreadTitleReadOptions {
  projectsDirectory?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function claudeRequestingThreadIds(
  reviews: readonly ReviewArtifact[]
): string[] {
  const ids = new Set<string>()
  for (const artifact of reviews) {
    const agentThread = artifact.review.agentThread
    if (
      !agentThread ||
      !isClaudeCodeThreadHost(
        agentThread.threadHost.kind,
        agentThread.threadHost.provider
      )
    ) continue
    const id = agentThread.id.trim()
    if (id) ids.add(id)
  }
  return [...ids]
}

export function resolveClaudeProjectsDirectory(override?: string): string {
  const candidate = override?.trim()
  if (!candidate) return path.join(os.homedir(), '.claude', 'projects')
  if (candidate === '~') return os.homedir()
  if (candidate.startsWith('~/')) {
    return path.join(os.homedir(), candidate.slice(2))
  }
  return path.resolve(candidate)
}

async function readClaudeThreadTitle(
  logPath: string,
  threadId: string
): Promise<string | null> {
  const input = createReadStream(logPath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let observedExactSession = false
  let title: string | null = null
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      const parsed: unknown = JSON.parse(line)
      if (!isRecord(parsed)) {
        throw new Error('Claude session artifact contains a malformed record.')
      }
      if (parsed.sessionId === threadId) observedExactSession = true
      if (parsed.type !== 'custom-title') continue
      if (
        typeof parsed.sessionId !== 'string' ||
        typeof parsed.customTitle !== 'string'
      ) {
        throw new Error('Claude session artifact contains a malformed title record.')
      }
      if (parsed.sessionId !== threadId) continue
      const candidate = parsed.customTitle.trim()
      if (candidate) title = candidate
    }
  } finally {
    lines.close()
    input.destroy()
  }
  if (!observedExactSession) {
    throw new Error('Claude session artifact did not confirm the exact session ID.')
  }
  return title
}

export async function readClaudeThreadTitles(
  projectsDirectory: string,
  threadIds: readonly string[]
): Promise<ClaudeThreadTitleSnapshot> {
  const ids = [...new Set(threadIds.map((id) => id.trim()).filter(Boolean))]
  if (!ids.length) {
    return {
      status: 'available',
      detail: 'No Claude Code requesting threads are available.',
      titles: []
    }
  }

  try {
    const stats = await fs.stat(projectsDirectory)
    if (!stats.isDirectory()) throw new Error('Claude projects root is not a directory.')
    const logs = await claudeSessionLogPaths(projectsDirectory)
    const pathsById = new Map<string, string[]>()
    for (const logPath of logs) {
      const threadId = path.basename(logPath, '.jsonl')
      if (!ids.includes(threadId)) continue
      const paths = pathsById.get(threadId) || []
      paths.push(logPath)
      pathsById.set(threadId, paths)
    }

    const titles: ClaudeThreadTitle[] = []
    let matchedArtifact = false
    for (const threadId of ids) {
      const paths = pathsById.get(threadId) || []
      if (!paths.length) continue
      if (paths.length !== 1) {
        throw new Error('Claude session artifact lookup was ambiguous.')
      }
      matchedArtifact = true
      const [logPath] = paths
      if (!logPath) throw new Error('Claude session artifact lookup failed.')
      const title = await readClaudeThreadTitle(logPath, threadId)
      if (title) titles.push({ threadId, title })
    }
    if (!matchedArtifact) {
      throw new Error('No exact Claude session artifact matched.')
    }
    return {
      status: 'available',
      detail: titles.length
        ? `${String(titles.length)} Claude Code requesting-thread title${titles.length === 1 ? '' : 's'} available.`
        : 'Claude Code session artifacts are available; no requesting-thread titles matched.',
      titles
    }
  } catch {
    return {
      status: 'unavailable',
      detail: 'Claude Code session artifacts are temporarily unavailable.',
      titles: []
    }
  }
}

export async function claudeThreadTitleSnapshot(
  settings: Pick<MarkoverSettings, 'claudeThreadTitlesEnabled'>,
  reviews: readonly ReviewArtifact[],
  options: ClaudeThreadTitleReadOptions = {}
): Promise<ClaudeThreadTitleSnapshot> {
  if (!settings.claudeThreadTitlesEnabled) {
    return {
      status: 'disabled',
      detail: 'Claude Code requesting-thread titles are disabled.',
      titles: []
    }
  }
  return readClaudeThreadTitles(
    resolveClaudeProjectsDirectory(options.projectsDirectory),
    claudeRequestingThreadIds(reviews)
  )
}

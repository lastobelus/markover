import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const T3_THREAD_TITLE_QUERY = `
  SELECT title
  FROM projection_threads
  WHERE thread_id = ? AND deleted_at IS NULL
`

export const DEFAULT_T3_METADATA_DATABASE_PATH = path.join(
  os.homedir(),
  '.t3',
  'userdata',
  'state.sqlite'
)

function normalizedThreadHostKind(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function t3RequestingThreadIds(
  reviews: readonly ReviewArtifact[]
): string[] {
  const ids = new Set<string>()
  for (const artifact of reviews) {
    const agentThread = artifact.review.agentThread
    if (
      !agentThread ||
      normalizedThreadHostKind(agentThread.threadHost.kind) !== 't3code'
    ) continue
    const id = agentThread.threadHost.threadId?.trim() || agentThread.id.trim()
    if (id) ids.add(id)
  }
  return [...ids]
}

export function resolveT3MetadataDatabasePath(override: string): string {
  const candidate = override.trim()
  if (!candidate) return DEFAULT_T3_METADATA_DATABASE_PATH
  if (candidate === '~') return os.homedir()
  if (candidate.startsWith('~/')) {
    return path.join(os.homedir(), candidate.slice(2))
  }
  return path.resolve(candidate)
}

export function readT3ThreadTitles(
  databasePath: string,
  threadIds: readonly string[]
): T3ThreadTitleSnapshot {
  let database: DatabaseSync | null = null
  try {
    database = new DatabaseSync(databasePath, {
      readOnly: true,
      timeout: 100
    })
    const statement = database.prepare(T3_THREAD_TITLE_QUERY)
    const titles: T3ThreadTitle[] = []
    for (const threadId of new Set(threadIds)) {
      const row = statement.get(threadId) as Record<string, unknown> | undefined
      const title = typeof row?.title === 'string' ? row.title.trim() : ''
      if (title) titles.push({ threadId, title })
    }
    return {
      status: 'available',
      detail: titles.length
        ? `${String(titles.length)} requesting-thread title${titles.length === 1 ? '' : 's'} available.`
        : 'T3 metadata is available; no requesting-thread titles matched.',
      titles
    }
  } catch {
    return {
      status: 'unavailable',
      detail: 'T3 metadata is temporarily unavailable.',
      titles: []
    }
  } finally {
    database?.close()
  }
}

export function t3ThreadTitleSnapshot(
  settings: Pick<
    MarkoverSettings,
    't3ThreadTitlesEnabled' | 't3MetadataDatabasePath'
  >,
  reviews: readonly ReviewArtifact[]
): T3ThreadTitleSnapshot {
  if (!settings.t3ThreadTitlesEnabled) {
    return {
      status: 'disabled',
      detail: 'T3 requesting-thread titles are disabled.',
      titles: []
    }
  }
  return readT3ThreadTitles(
    resolveT3MetadataDatabasePath(settings.t3MetadataDatabasePath),
    t3RequestingThreadIds(reviews)
  )
}

import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const T3_THREAD_TITLE_QUERY = `
  SELECT title
  FROM projection_threads
  WHERE thread_id = ? AND deleted_at IS NULL
  LIMIT 1
`

const T3_PROVIDER_SESSION_TITLE_QUERY = `
  SELECT threads.title
  FROM provider_session_runtime AS runtime
  JOIN projection_threads AS threads
    ON threads.thread_id = runtime.thread_id
  WHERE runtime.provider_name = ?
    AND runtime.adapter_key = ?
    AND json_valid(runtime.resume_cursor_json)
    AND json_type(runtime.resume_cursor_json, ?) = 'text'
    AND json_extract(runtime.resume_cursor_json, ?) = ?
    AND threads.deleted_at IS NULL
  LIMIT 2
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

type T3ProviderRuntime = 'codex' | 'claudeAgent'

const T3_PROVIDER_RUNTIMES = {
  codex: {
    adapterKey: 'codex',
    providerName: 'codex',
    sessionPath: '$.threadId'
  },
  claudeAgent: {
    adapterKey: 'claudeAgent',
    providerName: 'claudeAgent',
    sessionPath: '$.resume'
  }
} as const satisfies Record<T3ProviderRuntime, {
  adapterKey: string
  providerName: string
  sessionPath: string
}>

export interface T3ThreadTitleRequest {
  provider: T3ProviderRuntime | null
  providerSession: boolean
  threadId: string
}

function addT3ThreadTitleRequest(
  requests: Map<string, T3ThreadTitleRequest>,
  candidate: T3ThreadTitleRequest
): void {
  const existing = requests.get(candidate.threadId)
  if (!existing || !candidate.providerSession) {
    requests.set(candidate.threadId, candidate)
  } else if (
    existing.providerSession &&
    existing.provider !== candidate.provider
  ) {
    requests.set(candidate.threadId, { ...existing, provider: null })
  }
}

function normalizedProviderRuntime(value: string): T3ProviderRuntime | null {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (normalized === 'codex' || normalized === 'openai') return 'codex'
  if (
    normalized === 'claude' ||
    normalized === 'anthropic' ||
    normalized === 'claudeagent'
  ) return 'claudeAgent'
  return null
}

export function t3RequestingThreadRequests(
  reviews: readonly ReviewArtifact[]
): T3ThreadTitleRequest[] {
  const requests = new Map<string, T3ThreadTitleRequest>()
  for (const artifact of reviews) {
    const agentThread = artifact.review.agentThread
    if (
      !agentThread ||
      normalizedThreadHostKind(agentThread.threadHost.kind) !== 't3code'
    ) continue
    const hostThreadId = agentThread.threadHost.threadId?.trim() || ''
    const threadId = hostThreadId || agentThread.id.trim()
    if (!threadId) continue
    const candidate: T3ThreadTitleRequest = {
      threadId,
      provider: hostThreadId
        ? null
        : normalizedProviderRuntime(agentThread.threadHost.provider),
      providerSession: !hostThreadId
    }
    addT3ThreadTitleRequest(requests, candidate)
  }
  return [...requests.values()]
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
  requests: readonly T3ThreadTitleRequest[]
): T3ThreadTitleSnapshot {
  let database: DatabaseSync | null = null
  try {
    database = new DatabaseSync(databasePath, {
      readOnly: true,
      timeout: 100
    })
    const statement = database.prepare(T3_THREAD_TITLE_QUERY)
    let providerStatement: ReturnType<DatabaseSync['prepare']> | null = null
    const titles: T3ThreadTitle[] = []
    for (const request of deduplicateT3ThreadTitleRequests(requests)) {
      const row = statement.get(request.threadId) as
        Record<string, unknown> | undefined
      const title = typeof row?.title === 'string' ? row.title.trim() : ''
      if (row) {
        if (title) titles.push({ threadId: request.threadId, title })
        continue
      }
      if (!request.providerSession || !request.provider) continue
      providerStatement ||= database.prepare(T3_PROVIDER_SESSION_TITLE_QUERY)
      const runtime = T3_PROVIDER_RUNTIMES[request.provider]
      const rows = providerStatement.all(
        runtime.providerName,
        runtime.adapterKey,
        runtime.sessionPath,
        runtime.sessionPath,
        request.threadId
      ) as Record<string, unknown>[]
      if (rows.length !== 1) continue
      const providerTitle = typeof rows[0]?.title === 'string'
        ? rows[0].title.trim()
        : ''
      if (providerTitle) {
        titles.push({ threadId: request.threadId, title: providerTitle })
      }
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

function deduplicateT3ThreadTitleRequests(
  requests: readonly T3ThreadTitleRequest[]
): T3ThreadTitleRequest[] {
  const byThreadId = new Map<string, T3ThreadTitleRequest>()
  for (const request of requests) {
    const threadId = request.threadId.trim()
    if (!threadId) continue
    const candidate = { ...request, threadId }
    addT3ThreadTitleRequest(byThreadId, candidate)
  }
  return [...byThreadId.values()]
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
    t3RequestingThreadRequests(reviews)
  )
}

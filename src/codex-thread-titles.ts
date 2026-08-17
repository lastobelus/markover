import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'

import { isCodexProvider } from './provider-identity'

const DEFAULT_CODEX_APP_SERVER_TIMEOUT_MS = 3_000
const CODEX_CLIENT_INFO = {
  name: 'markover',
  title: 'Markover',
  version: '0.1.0'
} as const

interface JsonRpcError {
  code: number
  message: string
}

interface JsonRpcResponse {
  id: number
  result?: unknown
  error?: JsonRpcError
}

export interface CodexThreadTitleReadOptions {
  clientVersion?: string
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function jsonRpcResponse(value: unknown): JsonRpcResponse | null {
  if (!isRecord(value) || !Number.isInteger(value.id)) return null
  const error = value.error
  if (error !== undefined) {
    if (
      !isRecord(error) ||
      !Number.isInteger(error.code) ||
      typeof error.message !== 'string'
    ) return null
    return {
      id: Number(value.id),
      error: { code: Number(error.code), message: error.message }
    }
  }
  return { id: Number(value.id), result: value.result }
}

function missingThread(error: JsonRpcError | undefined): boolean {
  return error?.code === -32600 && error.message.startsWith('thread not loaded:')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function codexRequestingThreadIds(
  reviews: readonly ReviewArtifact[]
): string[] {
  const ids = new Set<string>()
  for (const artifact of reviews) {
    const agentThread = artifact.review.agentThread
    if (
      !agentThread ||
      !isCodexProvider(agentThread.threadHost.provider)
    ) continue
    const id = agentThread.id.trim()
    if (id) ids.add(id)
  }
  return [...ids]
}

export function resolveCodexExecutable(override: string): string {
  const candidate = override.trim()
  if (!candidate) return 'codex'
  if (candidate === '~') return os.homedir()
  if (candidate.startsWith('~/')) {
    return path.join(os.homedir(), candidate.slice(2))
  }
  if (path.isAbsolute(candidate)) return candidate
  return candidate.includes(path.sep) ? path.resolve(candidate) : candidate
}

export async function readCodexThreadTitles(
  executable: string,
  threadIds: readonly string[],
  options: CodexThreadTitleReadOptions = {}
): Promise<CodexThreadTitleSnapshot> {
  const ids = [...new Set(threadIds.map((id) => id.trim()).filter(Boolean))]
  if (!ids.length) {
    return {
      status: 'available',
      detail: 'No Codex requesting threads are available.',
      titles: []
    }
  }

  const timeoutMs = Math.max(
    1,
    options.timeoutMs ?? DEFAULT_CODEX_APP_SERVER_TIMEOUT_MS
  )
  const process = spawn(executable, ['app-server', '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  const closed = new Promise<void>((resolve) => {
    process.once('close', () => {
      resolve()
    })
  })
  process.stderr.resume()
  const pending = new Map<number, {
    reject: (error: Error) => void
    resolve: (response: JsonRpcResponse) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  const output = createInterface({ input: process.stdout })
  let requestId = 0
  let failed: Error | null = null

  const fail = (error: Error): void => {
    if (!failed) failed = error
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }

  output.on('line', (line) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      fail(new Error('Codex app-server returned invalid JSON.'))
      return
    }
    const response = jsonRpcResponse(parsed)
    if (!response) return
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    clearTimeout(request.timer)
    request.resolve(response)
  })
  process.on('error', (error) => {
    fail(error)
  })
  process.stdin.on('error', (error) => {
    fail(error)
  })
  process.on('close', () => {
    fail(new Error('Codex app-server closed before completing the lookup.'))
  })

  const request = (
    method: string,
    params: Record<string, unknown>
  ): Promise<JsonRpcResponse> => {
    if (failed) return Promise.reject(failed)
    requestId += 1
    const id = requestId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        const error = new Error('Codex app-server lookup timed out.')
        fail(error)
        reject(error)
      }, timeoutMs)
      pending.set(id, { reject, resolve, timer })
      process.stdin.write(`${JSON.stringify({ method, id, params })}\n`)
    })
  }

  try {
    const initialized = await request('initialize', {
      clientInfo: {
        ...CODEX_CLIENT_INFO,
        version: options.clientVersion || CODEX_CLIENT_INFO.version
      }
    })
    if (initialized.error) throw new Error('Codex app-server initialization failed.')
    process.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)

    const titles: CodexThreadTitle[] = []
    for (const threadId of ids) {
      const response = await request('thread/read', {
        threadId,
        includeTurns: false
      })
      if (missingThread(response.error)) continue
      if (response.error) throw new Error('Codex app-server thread lookup failed.')
      if (!isRecord(response.result) || !isRecord(response.result.thread)) {
        throw new Error('Codex app-server returned a malformed thread.')
      }
      const thread = response.result.thread
      if (thread.id !== threadId) {
        throw new Error('Codex app-server returned a mismatched thread.')
      }
      if (thread.name === null || thread.name === undefined) continue
      if (typeof thread.name !== 'string') {
        throw new Error('Codex app-server returned a malformed thread name.')
      }
      const title = thread.name.trim()
      if (title) titles.push({ threadId, title })
    }
    return {
      status: 'available',
      detail: titles.length
        ? `${String(titles.length)} Codex requesting-thread title${titles.length === 1 ? '' : 's'} available.`
        : 'Codex app-server is available; no requesting-thread titles matched.',
      titles
    }
  } catch {
    return {
      status: 'unavailable',
      detail: 'Codex app-server is temporarily unavailable.',
      titles: []
    }
  } finally {
    output.close()
    if (!process.stdin.destroyed) process.stdin.end()
    await Promise.race([closed, delay(200)])
    if (process.exitCode === null && process.signalCode === null) {
      process.kill('SIGTERM')
    }
    await Promise.race([closed, delay(200)])
    if (process.exitCode === null && process.signalCode === null) {
      process.kill('SIGKILL')
    }
  }
}

export async function codexThreadTitleSnapshot(
  settings: Pick<
    MarkoverSettings,
    'codexThreadTitlesEnabled' | 'codexExecutablePath'
  >,
  reviews: readonly ReviewArtifact[],
  options: CodexThreadTitleReadOptions = {}
): Promise<CodexThreadTitleSnapshot> {
  if (!settings.codexThreadTitlesEnabled) {
    return {
      status: 'disabled',
      detail: 'Codex requesting-thread titles are disabled.',
      titles: []
    }
  }
  return readCodexThreadTitles(
    resolveCodexExecutable(settings.codexExecutablePath),
    codexRequestingThreadIds(reviews),
    options
  )
}

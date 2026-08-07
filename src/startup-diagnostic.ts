import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  BuildIdentity,
  StartupFailureCategory,
  StartupPhase,
  StartupWarning
} from './startup-contract'

interface DiagnosticPhase {
  durationMs: number | null
  finishedAt: string | null
  startedAt: string
}

interface DiagnosticFailure {
  category: StartupFailureCategory
  message: string
  stack: string | null
}

export interface StartupDiagnosticDocument {
  format: 'markover-startup-diagnostic'
  version: 1
  status: 'starting' | 'ready' | 'failed' | 'crashed'
  build: BuildIdentity
  runtime: {
    architecture: string
    platform: NodeJS.Platform
  }
  startedAt: string
  finishedAt: string | null
  phases: Partial<Record<StartupPhase, DiagnosticPhase>>
  warnings: StartupWarning[]
  failure: DiagnosticFailure | null
}

export interface StartupDiagnosticOptions {
  appDirectory: string
  build: BuildIdentity
  filePath: string
  now?: () => Date
  temporaryDirectory?: string
}

function replaceAll(source: string, value: string, replacement: string): string {
  if (!value) return source
  return source.split(value).join(replacement)
}

export function sanitizeDiagnosticText(
  value: unknown,
  {
    appDirectory,
    homeDirectory = os.homedir(),
    temporaryDirectory = os.tmpdir()
  }: {
    appDirectory: string
    homeDirectory?: string
    temporaryDirectory?: string
  }
): string {
  let result = typeof value === 'string' ? value : String(value)
  for (const [localPath, replacement] of [
    [appDirectory, '<app>'],
    [temporaryDirectory, '<temp>'],
    [homeDirectory, '~']
  ] as const) {
    result = replaceAll(result, localPath, replacement)
  }
  result = result
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://<redacted>@')
    .replace(/\b[A-Za-z0-9_-]{43}\b/g, '<redacted>')
  return result.slice(0, 12_000)
}

function errorText(error: unknown, key: 'message' | 'stack'): string | null {
  if (error === null || typeof error !== 'object') {
    return key === 'message' ? String(error) : null
  }
  const value: unknown = Reflect.get(error, key)
  return typeof value === 'string' ? value : null
}

export class StartupDiagnostic {
  readonly filePath: string
  private readonly appDirectory: string
  private readonly now: () => Date
  private readonly temporaryDirectory: string
  private document: StartupDiagnosticDocument
  private latestWriteAvailable = false
  private writer: Promise<void> = Promise.resolve()

  constructor({
    appDirectory,
    build,
    filePath,
    now = () => new Date(),
    temporaryDirectory = os.tmpdir()
  }: StartupDiagnosticOptions) {
    this.appDirectory = appDirectory
    this.filePath = filePath
    this.now = now
    this.temporaryDirectory = temporaryDirectory
    this.document = {
      format: 'markover-startup-diagnostic',
      version: 1,
      status: 'starting',
      build,
      runtime: {
        architecture: process.arch,
        platform: process.platform
      },
      startedAt: this.timestamp(),
      finishedAt: null,
      phases: {},
      warnings: [],
      failure: null
    }
  }

  start(): Promise<void> {
    return this.write()
  }

  get available(): boolean {
    return this.latestWriteAvailable
  }

  setBuildIdentity(build: BuildIdentity): Promise<void> {
    this.document.build = { ...build }
    return this.write()
  }

  begin(phase: StartupPhase): Promise<void> {
    this.document.phases[phase] = {
      durationMs: null,
      finishedAt: null,
      startedAt: this.timestamp()
    }
    return this.write()
  }

  complete(phase: StartupPhase): Promise<void> {
    const current = this.document.phases[phase]
    if (!current) throw new Error(`Startup phase was not begun: ${phase}`)
    const finishedAt = this.timestamp()
    current.finishedAt = finishedAt
    current.durationMs = Math.max(
      0,
      Date.parse(finishedAt) - Date.parse(current.startedAt)
    )
    return this.write()
  }

  warnings(warnings: StartupWarning[]): Promise<void> {
    this.document.warnings = warnings.map((warning) => ({ ...warning }))
    return this.write()
  }

  ready(): Promise<void> {
    this.document.status = 'ready'
    this.document.finishedAt = this.timestamp()
    this.document.failure = null
    return this.write()
  }

  fail(
    category: StartupFailureCategory,
    error: unknown,
    crashed = false
  ): Promise<void> {
    if (
      this.document.status === 'failed' ||
      this.document.status === 'crashed'
    ) return this.write()
    const options = {
      appDirectory: this.appDirectory,
      temporaryDirectory: this.temporaryDirectory
    }
    this.document.status = crashed ? 'crashed' : 'failed'
    this.document.finishedAt = this.timestamp()
    this.document.failure = {
      category,
      message: sanitizeDiagnosticText(
        errorText(error, 'message') || 'Unknown startup failure.',
        options
      ),
      stack: errorText(error, 'stack')
        ? sanitizeDiagnosticText(errorText(error, 'stack'), options)
        : null
    }
    return this.write()
  }

  snapshot(): StartupDiagnosticDocument {
    return structuredClone(this.document)
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private write(): Promise<void> {
    const snapshot = this.snapshot()
    this.writer = this.writer.catch(() => {}).then(async () => {
      this.latestWriteAvailable = false
      const directory = path.dirname(this.filePath)
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      if (process.platform !== 'win32') await fs.chmod(directory, 0o700)
      const temporaryPath = path.join(
        directory,
        `.${path.basename(this.filePath)}-${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`
      )
      try {
        await fs.writeFile(
          temporaryPath,
          `${JSON.stringify(snapshot, null, 2)}\n`,
          { encoding: 'utf8', flag: 'wx', flush: true, mode: 0o600 }
        )
        if (process.platform !== 'win32') await fs.chmod(temporaryPath, 0o600)
        await fs.rename(temporaryPath, this.filePath)
        this.latestWriteAvailable = true
      } finally {
        await fs.unlink(temporaryPath).catch((error: unknown) => {
          if (
            error === null ||
            typeof error !== 'object' ||
            Reflect.get(error, 'code') !== 'ENOENT'
          ) throw error
        })
      }
    })
    return this.writer
  }
}

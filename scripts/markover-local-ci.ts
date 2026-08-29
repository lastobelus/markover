#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const LOCAL_CI_COMMAND_VERSION = 1
export const LOCAL_CI_TIMEOUT_MILLISECONDS = 30 * 60_000
export const LOCAL_CI_LOG_TAIL_LINES = 40

export interface LocalCiIdentity {
  repository: string
  head: string
  base: string
  baseRef: string
  clean: boolean
  commandVersion: typeof LOCAL_CI_COMMAND_VERSION
}

export interface LocalCiTestCounts {
  tests: number
  passed: number
  failed: number
  skipped: number
  cancelled: number
  todo: number
}

export interface LocalCiSmokeResult {
  ok: boolean
  checks: number | null
}

export type LocalCiOutcome =
  | 'passed'
  | 'failed'
  | 'head-changed'
  | 'base-changed'
  | 'dirty-worktree'
  | 'cancelled'
  | 'timed-out'

export interface LocalCiSummary {
  outcome: LocalCiOutcome
  repository: string
  head: string
  base: string
  baseRef: string
  commandVersion: number
  durationMs: number
  tests?: LocalCiTestCounts
  smoke?: LocalCiSmokeResult
  failingGate?: string
  detail?: string
  finalHead?: string
  finalBase?: string
}

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
}

interface CompletedProcess {
  code: number | null
  signal: NodeJS.Signals | null
  cancelled: boolean
  timedOut: boolean
}

interface KillableProcess {
  pid?: number | undefined
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill: (signal?: NodeJS.Signals | number) => boolean
}

type KillProcess = (pid: number, signal: NodeJS.Signals) => boolean

const BASE_REMOTE = 'origin'
const BASE_BRANCH = 'main'

function command(
  cwd: string,
  executable: string,
  args: ReadonlyArray<string>
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000
  })
  if (result.error) throw result.error
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  }
}

function requiredCommandText(
  cwd: string,
  executable: string,
  args: ReadonlyArray<string>
): string {
  const result = command(cwd, executable, args)
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `${executable} ${args.join(' ')} failed.`
    )
  }
  return result.stdout.trim()
}

export function normalizeRepository(remoteUrl: string): string {
  const match = /(?:github\.com[:/])([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl.trim())
  return match?.[1] ?? remoteUrl.trim()
}

function readRemoteBase(cwd: string): string {
  const output = requiredCommandText(cwd, 'git', [
    'ls-remote',
    '--exit-code',
    BASE_REMOTE,
    `refs/heads/${BASE_BRANCH}`
  ])
  const sha = output.split(/\s+/)[0] ?? ''
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`Could not resolve ${BASE_REMOTE}/${BASE_BRANCH}.`)
  }
  return sha
}

export function readLocalCiIdentity(cwd = process.cwd()): LocalCiIdentity {
  const root = requiredCommandText(cwd, 'git', ['rev-parse', '--show-toplevel'])
  const remoteUrl = requiredCommandText(root, 'git', [
    'remote',
    'get-url',
    BASE_REMOTE
  ])
  return {
    repository: normalizeRepository(remoteUrl),
    head: requiredCommandText(root, 'git', ['rev-parse', 'HEAD']),
    base: readRemoteBase(root),
    baseRef: `${BASE_REMOTE}/${BASE_BRANCH}`,
    clean: requiredCommandText(root, 'git', [
      'status',
      '--porcelain=v1',
      '--untracked-files=all'
    ]).length === 0,
    commandVersion: LOCAL_CI_COMMAND_VERSION
  }
}

function count(value: string | undefined): number {
  return value === undefined ? 0 : Number.parseInt(value, 10)
}

export function parseTestCounts(log: string): LocalCiTestCounts | null {
  const fields = new Map<string, string>()
  for (const match of log.matchAll(/^(?:#|ℹ) (tests|pass|fail|skipped|cancelled|todo) (\d+)$/gm)) {
    fields.set(match[1] ?? '', match[2] ?? '')
  }
  if (!fields.has('tests') || !fields.has('pass') || !fields.has('fail')) return null
  return {
    tests: count(fields.get('tests')),
    passed: count(fields.get('pass')),
    failed: count(fields.get('fail')),
    skipped: count(fields.get('skipped')),
    cancelled: count(fields.get('cancelled')),
    todo: count(fields.get('todo'))
  }
}

export function parseSmokeResult(log: string): LocalCiSmokeResult | null {
  for (const line of log.split('\n').reverse()) {
    if (!line.includes('"format":"markover-smoke"')) continue
    try {
      const value: unknown = JSON.parse(line.trim())
      if (
        value !== null &&
        typeof value === 'object' &&
        (value as Record<string, unknown>).format === 'markover-smoke' &&
        (value as Record<string, unknown>).version === 1 &&
        typeof (value as Record<string, unknown>).ok === 'boolean'
      ) {
        const result = value as Record<string, unknown>
        const checks = result.checks
        return {
          ok: result.ok as boolean,
          checks: checks !== null && typeof checks === 'object'
            ? Object.keys(checks).length
            : null
        }
      }
    } catch {
      // A malformed lookalike is not smoke evidence.
    }
  }
  return null
}

const GATE_SCRIPTS = new Map([
  ['build', 'build'],
  ['clean', 'build'],
  ['copy-build-assets', 'build'],
  ['build-app', 'build'],
  ['lint', 'lint'],
  ['typecheck', 'typecheck'],
  ['notices:check:built', 'notices'],
  ['test:built', 'tests'],
  ['smoke:built', 'smoke']
])

export function inferFailingGate(log: string): string {
  let gate = 'build'
  for (const match of log.matchAll(/^> markover@[^ ]+ ([^\s]+)$/gm)) {
    gate = GATE_SCRIPTS.get(match[1] ?? '') ?? gate
  }
  return gate
}

export function boundedLogTail(
  log: string,
  maximumLines = LOCAL_CI_LOG_TAIL_LINES
): string {
  const lines = log.replace(/\s+$/, '').split('\n')
  return lines.slice(-maximumLines).join('\n')
}

export function decideLocalCiSummary(input: {
  baseline: LocalCiIdentity
  final: LocalCiIdentity
  code: number | null
  log: string
  durationMs: number
  cancelled: boolean
  timedOut: boolean
}): LocalCiSummary {
  const common = {
    repository: input.baseline.repository,
    head: input.baseline.head,
    base: input.baseline.base,
    baseRef: input.baseline.baseRef,
    commandVersion: input.baseline.commandVersion,
    durationMs: input.durationMs
  }
  if (input.cancelled) return { outcome: 'cancelled', ...common }
  if (input.timedOut) return { outcome: 'timed-out', ...common }
  if (input.final.repository !== input.baseline.repository) {
    return {
      outcome: 'failed',
      ...common,
      failingGate: 'repository-identity',
      detail: `Repository changed to ${input.final.repository}.`
    }
  }
  if (input.final.head !== input.baseline.head) {
    return {
      outcome: 'head-changed',
      ...common,
      finalHead: input.final.head
    }
  }
  if (input.final.base !== input.baseline.base) {
    return {
      outcome: 'base-changed',
      ...common,
      finalBase: input.final.base
    }
  }
  if (!input.baseline.clean || !input.final.clean) {
    return { outcome: 'dirty-worktree', ...common }
  }
  if (input.code !== 0) {
    return {
      outcome: 'failed',
      ...common,
      failingGate: inferFailingGate(input.log)
    }
  }
  const tests = parseTestCounts(input.log)
  const smoke = parseSmokeResult(input.log)
  if (tests === null || smoke === null || !smoke.ok) {
    return {
      outcome: 'failed',
      ...common,
      failingGate: tests === null ? 'test-summary' : 'smoke-summary',
      detail: 'Local CI exited successfully without complete test and smoke evidence.'
    }
  }
  return { outcome: 'passed', ...common, tests, smoke }
}

export function formatLocalCiSummary(summary: LocalCiSummary): string {
  return `[run-local-ci] Summary: ${JSON.stringify(summary)}`
}

function logPath(root: string, head: string, startedAt: number): string {
  const timestamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-')
  return path.join(root, 'tmp/local-ci', `${timestamp}-${head.slice(0, 12)}.log`)
}

export function terminateProcessGroup(
  child: KillableProcess,
  signal: NodeJS.Signals,
  killProcess: KillProcess = (pid, processSignal) => process.kill(pid, processSignal)
): void {
  if (child.pid !== undefined) {
    try {
      killProcess(-child.pid, signal)
      return
    } catch {
      // The process group may have exited between the state check and signal.
    }
  }
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill(signal)
}

export function terminateProcessGroupWithEscalation(
  child: KillableProcess,
  escalationDelayMilliseconds = 1_000
): NodeJS.Timeout {
  terminateProcessGroup(child, 'SIGTERM')
  const escalation = setTimeout(() => {
    terminateProcessGroup(child, 'SIGKILL')
  }, escalationDelayMilliseconds)
  escalation.unref()
  return escalation
}

async function runCi(
  root: string,
  outputPath: string,
  timeoutMilliseconds: number
): Promise<CompletedProcess> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const output = fs.createWriteStream(outputPath, { flags: 'w' })
  const child = spawn('npm', ['run', 'ci:local'], {
    cwd: root,
    detached: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.pipe(output, { end: false })
  child.stderr.pipe(output, { end: false })
  let cancelled = false
  let timedOut = false
  let terminationEscalation: NodeJS.Timeout | undefined
  const terminate = (): void => {
    terminationEscalation ??= terminateProcessGroupWithEscalation(child)
  }
  const cancel = (): void => {
    cancelled = true
    terminate()
  }
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  const deadline = setTimeout(() => {
    timedOut = true
    terminate()
  }, timeoutMilliseconds)
  try {
    return await new Promise<CompletedProcess>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        output.end(() => { resolve({ code, signal, cancelled, timedOut }) })
      })
    })
  } finally {
    clearTimeout(deadline)
    if (terminationEscalation !== undefined) clearTimeout(terminationEscalation)
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  }
}

function exitCode(summary: LocalCiSummary): number {
  if (summary.outcome === 'failed') return 1
  if (summary.outcome === 'timed-out') return 124
  if (summary.outcome === 'cancelled') return 130
  return 0
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  const root = requiredCommandText(process.cwd(), 'git', ['rev-parse', '--show-toplevel'])
  const baseline = readLocalCiIdentity(root)
  process.stdout.write(`[run-local-ci] Baseline ${JSON.stringify(baseline)}\n`)
  if (!baseline.clean) {
    const summary: LocalCiSummary = {
      outcome: 'dirty-worktree',
      repository: baseline.repository,
      head: baseline.head,
      base: baseline.base,
      baseRef: baseline.baseRef,
      commandVersion: baseline.commandVersion,
      durationMs: Date.now() - startedAt
    }
    process.stdout.write(`${formatLocalCiSummary(summary)}\n`)
    return
  }

  const outputPath = logPath(root, baseline.head, startedAt)
  const configuredTimeout = Number.parseInt(
    process.env.MARKOVER_LOCAL_CI_TIMEOUT_MS ?? '',
    10
  )
  const timeoutMilliseconds = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : LOCAL_CI_TIMEOUT_MILLISECONDS
  const completed = await runCi(root, outputPath, timeoutMilliseconds)
  const log = fs.readFileSync(outputPath, 'utf8')
  let final: LocalCiIdentity
  try {
    final = readLocalCiIdentity(root)
  } catch (error) {
    const tail = boundedLogTail(log)
    if (tail.length > 0) {
      process.stdout.write(`[run-local-ci] Log tail (${Math.min(LOCAL_CI_LOG_TAIL_LINES, tail.split('\n').length)} lines):\n${tail}\n`)
    }
    const detail = (error instanceof Error ? error.message : String(error))
      .replace(/\s+/g, ' ')
      .trim()
    process.stdout.write(`${formatLocalCiSummary({
      outcome: 'failed',
      repository: baseline.repository,
      head: baseline.head,
      base: baseline.base,
      baseRef: baseline.baseRef,
      commandVersion: baseline.commandVersion,
      durationMs: Date.now() - startedAt,
      failingGate: 'final-identity',
      detail
    })}\n`)
    process.exitCode = 1
    return
  }
  const summary = decideLocalCiSummary({
    baseline,
    final,
    code: completed.code,
    log,
    durationMs: Date.now() - startedAt,
    cancelled: completed.cancelled,
    timedOut: completed.timedOut
  })
  const tail = boundedLogTail(log)
  if (tail.length > 0) {
    process.stdout.write(`[run-local-ci] Log tail (${Math.min(LOCAL_CI_LOG_TAIL_LINES, tail.split('\n').length)} lines):\n${tail}\n`)
  }
  process.stdout.write(`${formatLocalCiSummary(summary)}\n`)
  process.exitCode = exitCode(summary)
}

export async function runMain(): Promise<void> {
  await main().catch((error: unknown) => {
    const detail = (error instanceof Error ? error.message : String(error))
      .replace(/\s+/g, ' ')
      .trim()
    process.stderr.write(`${formatLocalCiSummary({
      outcome: 'failed',
      repository: 'unknown',
      head: 'unknown',
      base: 'unknown',
      baseRef: `${BASE_REMOTE}/${BASE_BRANCH}`,
      commandVersion: LOCAL_CI_COMMAND_VERSION,
      durationMs: 0,
      failingGate: 'preflight',
      detail: detail || 'Unknown error.'
    })}\n`)
    process.exitCode = 1
  })
}

if (require.main === module) void runMain()

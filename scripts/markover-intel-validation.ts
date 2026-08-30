#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import {
  boundedLogTail,
  parseSmokeResult,
  parseTestCounts,
  readLocalCiIdentity,
  terminateProcessGroupWithEscalation,
  type LocalCiIdentity,
  type LocalCiSmokeResult,
  type LocalCiTestCounts
} from './markover-local-ci'
import { parseServiceEndpoint, serviceEndpointPath } from '../src/service-endpoint'

export const INTEL_VALIDATION_COMMAND_VERSION = 1
export const INTEL_VALIDATION_TIMEOUT_MILLISECONDS = 45 * 60_000

export type IntelValidationStageName =
  | 'environment'
  | 'local-ci'
  | 'package'
  | 'archive'
  | 'preflight'
  | 'smoke'

export type IntelValidationOutcome =
  | 'passed'
  | 'environment-failed'
  | 'ci-failed'
  | 'package-failed'
  | 'preflight-failed'
  | 'smoke-failed'
  | 'target-drifted'
  | 'dirty-worktree'
  | 'cancelled'
  | 'timed-out'

export interface IntelValidationHost {
  architecture: string
  translated: boolean
  macosVersion: string
  model: string
  node: string
  npm: string
  xcode: string
}

export interface IntelValidationStage {
  name: IntelValidationStageName
  status: 'passed' | 'failed'
  durationMs: number
}

export interface IntelValidationSummary {
  outcome: IntelValidationOutcome
  repository: string
  head: string
  base: string
  baseRef: string
  commandVersion: number
  durationMs: number
  host?: IntelValidationHost | undefined
  stages: IntelValidationStage[]
  failingStage?: IntelValidationStageName | 'final-identity' | undefined
  detail?: string | undefined
  finalHead?: string | undefined
  finalBase?: string | undefined
  tests?: LocalCiTestCounts | undefined
  localSmoke?: LocalCiSmokeResult | undefined
  artifact?: {
    archive: string
    checksum: string
    sha256: string
    evidence: string
    reviewId: string
  } | undefined
}

interface StageResult {
  code: number | null
  cancelled: boolean
  timedOut: boolean
  durationMs: number
  log: string
}

interface PackagedSmokeEvidence {
  format: string
  version: number
  status: string
  sourceCommit: string
  evidenceKind: string
  cleanMachine: boolean
  artifact: { architecture?: unknown; sha256?: unknown; trustMode?: unknown }
  review: { id?: unknown; preserved?: unknown }
}

const BASE_REF = 'origin/main'
const FORMAT = 'run-intel-validation'

function commandText(root: string, executable: string, args: readonly string[]): string {
  const result = spawnSync(executable, [...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() ||
      `${executable} ${args.join(' ')} failed.`
    )
  }
  return result.stdout.trim()
}

function translated(root: string): boolean {
  const result = spawnSync('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated'], {
    cwd: root,
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  if (result.status !== 0 && /unknown oid/i.test(result.stderr)) return false
  if (result.status !== 0) throw new Error('Could not read Rosetta translation state.')
  if (result.stdout.trim() === '0') return false
  if (result.stdout.trim() === '1') return true
  throw new Error('Rosetta translation state was neither 0 nor 1.')
}

export function readIntelValidationHost(root: string): IntelValidationHost {
  return {
    architecture: commandText(root, '/usr/bin/uname', ['-m']),
    translated: translated(root),
    macosVersion: commandText(root, '/usr/bin/sw_vers', ['-productVersion']),
    model: commandText(root, '/usr/sbin/sysctl', ['-n', 'hw.model']),
    node: process.version,
    npm: commandText(root, 'npm', ['--version']),
    xcode: commandText(root, '/usr/bin/xcodebuild', ['-version'])
      .replace(/\s+/g, ' ')
  }
}

export function environmentFailure(
  platform: NodeJS.Platform,
  processArchitecture: string,
  host: IntelValidationHost
): string | null {
  if (platform !== 'darwin') return 'Intel validation requires macOS.'
  if (processArchitecture !== 'x64' || host.architecture !== 'x86_64') {
    return 'Intel validation requires native x64 Node on an x86_64 host.'
  }
  if (host.translated) return 'Intel validation cannot run under Rosetta translation.'
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(host.node)
  if (!match) return `Could not parse Node version ${host.node}.`
  const version = match.slice(1).map(Number)
  if (
    (version[0] ?? 0) < 22 ||
    ((version[0] ?? 0) === 22 && (version[1] ?? 0) < 13)
  ) return 'Intel validation requires Node 22.13.0 or newer.'
  return null
}

export function runningMarkoverFailure(
  value: unknown,
  isProcessAlive: (pid: number) => boolean = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      if (
        error !== null && typeof error === 'object' &&
        Reflect.get(error, 'code') === 'ESRCH'
      ) return false
      throw error
    }
  }
): string | null {
  const endpoint = parseServiceEndpoint(value)
  if (!endpoint || !isProcessAlive(endpoint.pid)) return null
  return `Quit the running Markover app (PID ${String(endpoint.pid)}) before Intel validation; the action will not stop an existing app.`
}

async function readRunningMarkoverFailure(): Promise<string | null> {
  try {
    const value: unknown = JSON.parse(
      await fsp.readFile(serviceEndpointPath(), 'utf8')
    )
    return runningMarkoverFailure(value)
  } catch (error) {
    if (
      error !== null && typeof error === 'object' &&
      Reflect.get(error, 'code') === 'ENOENT'
    ) return null
    throw error
  }
}

export function validatePackagedSmokeEvidence(
  value: unknown,
  expected: { head: string; sha256: string }
): { reviewId: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Packaged smoke evidence is not an object.')
  }
  const evidence = value as PackagedSmokeEvidence
  if (
    evidence.format !== 'markover-packaged-smoke-evidence' ||
    evidence.version !== 1 ||
    evidence.status !== 'passed' ||
    evidence.sourceCommit !== expected.head ||
    evidence.evidenceKind !== 'local' ||
    evidence.cleanMachine ||
    evidence.artifact.architecture !== 'x64' ||
    evidence.artifact.sha256 !== expected.sha256 ||
    evidence.artifact.trustMode !== 'ad-hoc' ||
    evidence.review.preserved !== true ||
    typeof evidence.review.id !== 'string'
  ) throw new Error('Packaged smoke evidence does not match this Intel validation run.')
  return { reviewId: evidence.review.id }
}

function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => { hash.update(chunk) })
    stream.on('error', reject)
    stream.on('end', () => { resolve(hash.digest('hex')) })
  })
}

function artifactRoot(root: string, head: string, startedAt: number): string {
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-')
  return path.join(root, '.markover', 'intel-validation', `${stamp}-${head.slice(0, 12)}`)
}

function stageLogPath(directory: string, name: IntelValidationStageName): string {
  return path.join(directory, `${name}.log`)
}

function outcomeForStage(name: IntelValidationStageName): IntelValidationOutcome {
  if (name === 'environment') return 'environment-failed'
  if (name === 'local-ci') return 'ci-failed'
  if (name === 'package' || name === 'archive') return 'package-failed'
  if (name === 'preflight') return 'preflight-failed'
  return 'smoke-failed'
}

function compactDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, ' ')
    .trim()
}

function exitCode(outcome: IntelValidationOutcome): number {
  if (
    outcome === 'passed' || outcome === 'target-drifted' ||
    outcome === 'dirty-worktree'
  ) return 0
  if (outcome === 'cancelled') return 130
  if (outcome === 'timed-out') return 124
  return 1
}

async function runStage(
  root: string,
  directory: string,
  name: IntelValidationStageName,
  executable: string,
  args: readonly string[],
  deadline: number
): Promise<StageResult> {
  const startedAt = Date.now()
  const outputPath = stageLogPath(directory, name)
  const output = fs.createWriteStream(outputPath, { flags: 'w' })
  const child = spawn(executable, [...args], {
    cwd: root,
    detached: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.pipe(output, { end: false })
  child.stderr.pipe(output, { end: false })
  let cancelled = false
  let timedOut = false
  let escalation: NodeJS.Timeout | undefined
  const terminate = (): void => {
    escalation ??= terminateProcessGroupWithEscalation(child)
  }
  const cancel = (): void => {
    cancelled = true
    terminate()
  }
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  const remaining = Math.max(1, deadline - Date.now())
  const timeout = setTimeout(() => {
    timedOut = true
    terminate()
  }, remaining)
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (status) => {
        output.end(() => { resolve(status) })
      })
    })
    return {
      code,
      cancelled,
      timedOut,
      durationMs: Date.now() - startedAt,
      log: await fsp.readFile(outputPath, 'utf8')
    }
  } finally {
    clearTimeout(timeout)
    if (escalation) clearTimeout(escalation)
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  }
}

function printTail(name: IntelValidationStageName, log: string): void {
  const tail = boundedLogTail(log)
  if (!tail) return
  process.stdout.write(
    `[${FORMAT}] ${name} tail (${String(tail.split('\n').length)} lines):\n${tail}\n`
  )
}

export function formatIntelValidationSummary(summary: IntelValidationSummary): string {
  return `[${FORMAT}] Summary: ${JSON.stringify(summary)}`
}

function commonSummary(
  baseline: LocalCiIdentity,
  startedAt: number,
  stages: IntelValidationStage[],
  host?: IntelValidationHost
): Omit<IntelValidationSummary, 'outcome'> {
  return {
    repository: baseline.repository,
    head: baseline.head,
    base: baseline.base,
    baseRef: baseline.baseRef,
    commandVersion: INTEL_VALIDATION_COMMAND_VERSION,
    durationMs: Date.now() - startedAt,
    ...(host ? { host } : {}),
    stages
  }
}

export function packageVersion(value: unknown): string {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value) ||
    typeof Reflect.get(value, 'version') !== 'string'
  ) throw new Error('package.json does not contain a version.')
  return Reflect.get(value, 'version') as string
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  const root = commandText(process.cwd(), 'git', ['rev-parse', '--show-toplevel'])
  const baseline = readLocalCiIdentity(root)
  const stages: IntelValidationStage[] = []
  let host: IntelValidationHost | undefined
  process.stdout.write(`[${FORMAT}] Baseline ${JSON.stringify({
    ...baseline,
    commandVersion: INTEL_VALIDATION_COMMAND_VERSION
  })}\n`)
  const finish = (summary: IntelValidationSummary): void => {
    process.stdout.write(`${formatIntelValidationSummary(summary)}\n`)
    process.exitCode = exitCode(summary.outcome)
  }
  if (!baseline.clean) {
    finish({ outcome: 'dirty-worktree', ...commonSummary(baseline, startedAt, stages) })
    return
  }

  try {
    const environmentStarted = Date.now()
    host = readIntelValidationHost(root)
    const failure = environmentFailure(process.platform, process.arch, host) ??
      await readRunningMarkoverFailure()
    stages.push({
      name: 'environment',
      status: failure ? 'failed' : 'passed',
      durationMs: Date.now() - environmentStarted
    })
    if (failure) {
      finish({
        outcome: 'environment-failed',
        ...commonSummary(baseline, startedAt, stages, host),
        failingStage: 'environment',
        detail: failure
      })
      return
    }
  } catch (error) {
    stages.push({ name: 'environment', status: 'failed', durationMs: 0 })
    finish({
      outcome: 'environment-failed',
      ...commonSummary(baseline, startedAt, stages, host),
      failingStage: 'environment',
      detail: compactDetail(error)
    })
    return
  }

  const directory = artifactRoot(root, baseline.head, startedAt)
  await fsp.mkdir(directory, { recursive: true })
  const configuredTimeout = Number.parseInt(
    process.env.MARKOVER_INTEL_VALIDATION_TIMEOUT_MS ?? '',
    10
  )
  const timeoutMilliseconds = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : INTEL_VALIDATION_TIMEOUT_MILLISECONDS
  const deadline = Date.now() + timeoutMilliseconds
  const packageJson: unknown = JSON.parse(
    await fsp.readFile(path.join(root, 'package.json'), 'utf8')
  )
  const version = packageVersion(packageJson)
  const architecture = 'x64'
  const archive = path.join(directory, `Markover-darwin-${architecture}.zip`)
  const checksum = `${archive}.sha256`
  const evidence = path.join(directory, `packaged-smoke-${architecture}.json`)

  const commands: Array<{
    name: IntelValidationStageName
    executable: string
    args: string[]
  }> = [
    { name: 'local-ci', executable: 'npm', args: ['run', 'ci:local'] },
    { name: 'package', executable: 'npm', args: ['run', 'package:mac'] },
    {
      name: 'archive',
      executable: '/usr/bin/ditto',
      args: [
        '-c', '-k', '--sequesterRsrc', '--keepParent',
        path.join(root, 'dist', 'Markover-darwin-x64', 'Markover.app'),
        archive
      ]
    },
    {
      name: 'preflight',
      executable: 'npm',
      args: [
        'run', 'release:preflight', '--', 'verify-macos',
        `--archive=${archive}`,
        `--checksum=${checksum}`,
        '--architecture=x64',
        `--version=${version}`,
        '--trust-mode=ad-hoc'
      ]
    },
    {
      name: 'smoke',
      executable: 'npm',
      args: [
        'run', 'smoke:packaged', '--',
        `--archive=${archive}`,
        `--checksum=${checksum}`,
        '--architecture=x64',
        `--version=${version}`,
        '--trust-mode=ad-hoc',
        '--evidence-kind=local',
        `--evidence=${evidence}`
      ]
    }
  ]

  let tests: LocalCiTestCounts | undefined
  let localSmoke: LocalCiSmokeResult | undefined
  let digest = ''
  for (const step of commands) {
    process.stdout.write(`[${FORMAT}] Starting ${step.name}.\n`)
    const result = await runStage(
      root,
      directory,
      step.name,
      step.executable,
      step.args,
      deadline
    )
    let passed = result.code === 0 && !result.cancelled && !result.timedOut
    let stageDetail: string | undefined
    if (step.name === 'archive' && passed) {
      try {
        digest = await sha256(archive)
        await fsp.writeFile(
          checksum,
          `${digest}  ${path.basename(archive)}\n`,
          { encoding: 'utf8', flag: 'wx' }
        )
      } catch (error) {
        passed = false
        stageDetail = compactDetail(error)
      }
    }
    stages.push({
      name: step.name,
      status: passed ? 'passed' : 'failed',
      durationMs: result.durationMs
    })
    if (step.name === 'local-ci' && passed) {
      tests = parseTestCounts(result.log) ?? undefined
      localSmoke = parseSmokeResult(result.log) ?? undefined
      if (!tests || !localSmoke?.ok) {
        printTail(step.name, result.log)
        finish({
          outcome: 'ci-failed',
          ...commonSummary(baseline, startedAt, stages, host),
          failingStage: step.name,
          detail: 'Local CI exited without complete test and smoke evidence.'
        })
        return
      }
    }
    if (!passed) {
      printTail(step.name, result.log)
      finish({
        outcome: result.cancelled
          ? 'cancelled'
          : result.timedOut
            ? 'timed-out'
            : outcomeForStage(step.name),
        ...commonSummary(baseline, startedAt, stages, host),
        failingStage: step.name,
        detail: stageDetail ?? (
          result.code === null ? undefined : `${step.name} exited ${String(result.code)}.`
        )
      })
      return
    }
    process.stdout.write(`[${FORMAT}] Passed ${step.name}.\n`)
  }

  let artifact: IntelValidationSummary['artifact']
  try {
    const smokeEvidence: unknown = JSON.parse(await fsp.readFile(evidence, 'utf8'))
    const { reviewId } = validatePackagedSmokeEvidence(smokeEvidence, {
      head: baseline.head,
      sha256: digest
    })
    artifact = { archive, checksum, sha256: digest, evidence, reviewId }
  } catch (error) {
    finish({
      outcome: 'smoke-failed',
      ...commonSummary(baseline, startedAt, stages, host),
      failingStage: 'smoke',
      detail: compactDetail(error),
      tests,
      localSmoke
    })
    return
  }

  let final: LocalCiIdentity
  try {
    final = readLocalCiIdentity(root)
  } catch (error) {
    finish({
      outcome: 'target-drifted',
      ...commonSummary(baseline, startedAt, stages, host),
      failingStage: 'final-identity',
      detail: compactDetail(error),
      tests,
      localSmoke,
      artifact
    })
    return
  }
  if (
    final.repository !== baseline.repository || final.head !== baseline.head ||
    final.base !== baseline.base || !final.clean
  ) {
    finish({
      outcome: final.clean ? 'target-drifted' : 'dirty-worktree',
      ...commonSummary(baseline, startedAt, stages, host),
      failingStage: 'final-identity',
      finalHead: final.head,
      finalBase: final.base,
      tests,
      localSmoke,
      artifact
    })
    return
  }
  finish({
    outcome: 'passed',
    ...commonSummary(baseline, startedAt, stages, host),
    tests,
    localSmoke,
    artifact
  })
}

export async function runMain(): Promise<void> {
  await main().catch((error: unknown) => {
    process.stderr.write(`${formatIntelValidationSummary({
      outcome: 'environment-failed',
      repository: 'unknown',
      head: 'unknown',
      base: 'unknown',
      baseRef: BASE_REF,
      commandVersion: INTEL_VALIDATION_COMMAND_VERSION,
      durationMs: 0,
      stages: [],
      failingStage: 'environment',
      detail: compactDetail(error) || 'Unknown error.'
    })}\n`)
    process.exitCode = 1
  })
}

if (require.main === module) void runMain()

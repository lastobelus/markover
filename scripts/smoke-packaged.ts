#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  verifyMacosArtifact,
  type MacosArtifactReport
} from './macos-artifact-preflight'
import {
  appBundleId,
  parseMacosArchitecture,
  parseMacosTrustMode,
  type MacosArchitecture,
  type MacosTrustMode
} from './macos-release-contract'
import {
  handoffAndReopenHappyPathSmokeReview,
  openHappyPathSmokeReview
} from './smoke-auth'
import { probeService } from '../src/local-client'
import { ReviewStore, type ReviewArtifact } from '../src/review-store'
import {
  reviewsDirectory,
  serviceEndpointPath,
  type ServiceEndpoint
} from '../src/service-endpoint'

export type PackagedSmokeEvidenceKind =
  | 'local'
  | 'ci'
  | 'clean-intel-sonoma'

export interface PackagedSmokeOptions {
  appPath?: string | undefined
  architecture: MacosArchitecture
  archivePath: string
  checksumPath: string
  evidenceKind: PackagedSmokeEvidenceKind
  evidencePath: string
  launchTimeoutMilliseconds?: number | undefined
  trustMode: MacosTrustMode
  version: string
}

export interface PackagedSmokeHost {
  architecture: string
  macosVersion: string
  model: string
  runner: string | null
}

export interface PackagedSmokeEvidence {
  format: 'markover-packaged-smoke-evidence'
  version: 1
  status: 'passed'
  scope: 'packaged-happy-path'
  collectedAt: string
  sourceCommit: string
  evidenceKind: PackagedSmokeEvidenceKind
  cleanMachine: boolean
  host: PackagedSmokeHost
  artifact: MacosArtifactReport & {
    appleVerified: false
    notarized: false
  }
  review: {
    id: string
    preserved: true
  }
  steps: {
    exactArtifactVerified: true
    packagedAppLaunched: true
    cliOpenCreatedReview: true
    savedStateConfirmedBeforeRestart: true
    appRestarted: true
    savedReviewRestored: true
    cliGetHandedOffReview: true
    cliEditReopenedReview: true
    reopenedStateConfirmedOnDisk: true
  }
  cleanIntel: {
    quarantinePresent: boolean | null
    gatekeeperOverrideExercised: boolean | null
    rollbackVerified: false
  }
  exclusions: readonly [
    'adversarial-authorization',
    'bounded-loss-durability'
  ]
}

interface PreparedApp {
  appPath: string
  cleanup: () => Promise<void>
  provided: boolean
}

export interface PackagedSmokeDependencies {
  handoffAndReopen?: ((endpointPath: string, reviewId: string) => Promise<void>) | undefined
  host?: (() => PackagedSmokeHost) | undefined
  loadReview?: ((reviewId: string) => Promise<ReviewArtifact>) | undefined
  now?: (() => Date) | undefined
  openReview?: ((endpointPath: string, sourcePath: string) => Promise<string>) | undefined
  prepareApp?: ((options: PackagedSmokeOptions) => Promise<PreparedApp>) | undefined
  quarantinePresent?: ((appPath: string) => boolean) | undefined
  revision?: (() => string) | undefined
  serviceRunning?: ((endpointPath: string) => Promise<boolean>) | undefined
  startApp?: ((
    appPath: string,
    endpointPath: string,
    previousPid: number | null,
    timeoutMilliseconds: number,
    onLaunch: () => void
  ) => Promise<ServiceEndpoint>) | undefined
  stopApp?: ((endpointPath: string, timeoutMilliseconds: number) => Promise<void>) | undefined
  verifyArtifact?: ((options: PackagedSmokeOptions) => Promise<MacosArtifactReport>) | undefined
}

const smokeSource = [
  '# Markover packaged smoke review',
  '',
  'This review proves the saved packaged happy path.',
  'It does not assert adversarial authorization or bounded-loss durability.',
  ''
].join('\n')

function command(
  executable: string,
  args: readonly string[]
): string {
  const result = spawnSync(executable, [...args], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
      result.stdout.trim() ||
      `${path.basename(executable)} exited ${String(result.status)}`
    )
  }
  return result.stdout.trim()
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function defaultServiceRunning(endpointPath: string): Promise<boolean> {
  try {
    await probeService(endpointPath)
    return true
  } catch {
    return false
  }
}

async function waitForStartedService(
  endpointPath: string,
  previousPid: number | null,
  timeoutMilliseconds: number
): Promise<ServiceEndpoint> {
  const deadline = Date.now() + timeoutMilliseconds
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      const { endpoint } = await probeService(endpointPath)
      if (previousPid === null || endpoint.pid !== previousPid) return endpoint
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(
    `Packaged Markover did not become ready within ${String(timeoutMilliseconds)}ms${suffix}`
  )
}

async function defaultStartApp(
  appPath: string,
  endpointPath: string,
  previousPid: number | null,
  timeoutMilliseconds: number,
  onLaunch: () => void
): Promise<ServiceEndpoint> {
  command('/usr/bin/open', [
    '-g',
    '-j',
    '-n',
    appPath,
    '--args',
    '--markover-server'
  ])
  onLaunch()
  return await waitForStartedService(
    endpointPath,
    previousPid,
    timeoutMilliseconds
  )
}

async function defaultStopApp(
  endpointPath: string,
  timeoutMilliseconds: number
): Promise<void> {
  command('/usr/bin/osascript', [
    '-e',
    `tell application id "${appBundleId}" to quit`
  ])
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (!await defaultServiceRunning(endpointPath)) return
    await delay(100)
  }
  throw new Error('Packaged Markover did not quit before the restart deadline.')
}

async function defaultPrepareApp(
  options: PackagedSmokeOptions
): Promise<PreparedApp> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-packaged-smoke-')
  )
  try {
    command('/usr/bin/ditto', [
      '-x',
      '-k',
      path.resolve(options.archivePath),
      directory
    ])
    const extractedAppPath = path.join(directory, 'Markover.app')
    const stats = await fs.stat(extractedAppPath)
    if (!stats.isDirectory()) {
      throw new Error('The verified release ZIP did not extract Markover.app.')
    }
    if (options.appPath) {
      const appPath = path.resolve(options.appPath)
      const providedStats = await fs.stat(appPath)
      if (
        !providedStats.isDirectory() ||
        path.basename(appPath) !== 'Markover.app'
      ) {
        throw new Error('--app must identify an installed Markover.app directory.')
      }
      await assertEquivalentAppBundle(extractedAppPath, appPath)
      return {
        appPath,
        provided: true,
        cleanup: () => fs.rm(directory, { recursive: true, force: true })
      }
    }
    return {
      appPath: extractedAppPath,
      provided: false,
      cleanup: () => fs.rm(directory, { recursive: true, force: true })
    }
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function fileDigest(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => {
      hash.update(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => {
      resolve(hash.digest('hex'))
    })
  })
}

function entryKind(
  stats: Awaited<ReturnType<typeof fs.lstat>>
): 'directory' | 'file' | 'symlink' | 'unsupported' {
  if (stats.isDirectory()) return 'directory'
  if (stats.isFile()) return 'file'
  if (stats.isSymbolicLink()) return 'symlink'
  return 'unsupported'
}

async function assertEquivalentAppEntry(
  referencePath: string,
  providedPath: string,
  relativePath: string
): Promise<void> {
  const [referenceStats, providedStats] = await Promise.all([
    fs.lstat(referencePath),
    fs.lstat(providedPath)
  ])
  const referenceKind = entryKind(referenceStats)
  const providedKind = entryKind(providedStats)
  if (referenceKind !== providedKind || referenceKind === 'unsupported') {
    throw new Error(
      `The installed app differs from the verified archive at ${relativePath}.`
    )
  }
  if (referenceKind === 'directory') {
    const [referenceNames, providedNames] = await Promise.all([
      fs.readdir(referencePath),
      fs.readdir(providedPath)
    ])
    referenceNames.sort()
    providedNames.sort()
    if (referenceNames.join('\0') !== providedNames.join('\0')) {
      throw new Error(
        `The installed app differs from the verified archive at ${relativePath}.`
      )
    }
    for (const name of referenceNames) {
      await assertEquivalentAppEntry(
        path.join(referencePath, name),
        path.join(providedPath, name),
        path.join(relativePath, name)
      )
    }
    return
  }
  if (referenceKind === 'symlink') {
    const [referenceTarget, providedTarget] = await Promise.all([
      fs.readlink(referencePath),
      fs.readlink(providedPath)
    ])
    if (referenceTarget !== providedTarget) {
      throw new Error(
        `The installed app differs from the verified archive at ${relativePath}.`
      )
    }
    return
  }
  if (
    referenceStats.size !== providedStats.size ||
    (referenceStats.mode & 0o777) !== (providedStats.mode & 0o777)
  ) {
    throw new Error(
      `The installed app differs from the verified archive at ${relativePath}.`
    )
  }
  const [referenceDigest, providedDigest] = await Promise.all([
    fileDigest(referencePath),
    fileDigest(providedPath)
  ])
  if (referenceDigest !== providedDigest) {
    throw new Error(
      `The installed app differs from the verified archive at ${relativePath}.`
    )
  }
}

export async function assertEquivalentAppBundle(
  referenceAppPath: string,
  providedAppPath: string
): Promise<void> {
  await assertEquivalentAppEntry(
    referenceAppPath,
    providedAppPath,
    'Markover.app'
  )
}

function defaultHost(): PackagedSmokeHost {
  return {
    architecture: command('/usr/bin/uname', ['-m']),
    macosVersion: command('/usr/bin/sw_vers', ['-productVersion']),
    model: command('/usr/sbin/sysctl', ['-n', 'hw.model']),
    runner: process.env.RUNNER_NAME || null
  }
}

function defaultRevision(): string {
  const revision = process.env.GITHUB_SHA || command('/usr/bin/git', [
    'rev-parse',
    'HEAD'
  ])
  if (!/^[a-f0-9]{40}$/i.test(revision)) {
    throw new Error('The packaged smoke source commit is invalid.')
  }
  return revision.toLowerCase()
}

function defaultQuarantinePresent(appPath: string): boolean {
  const result = spawnSync('/usr/bin/xattr', [
    '-p',
    'com.apple.quarantine',
    appPath
  ], { encoding: 'utf8' })
  if (result.error) throw result.error
  return result.status === 0 && Boolean(result.stdout.trim())
}

function assertPersistedReview(
  artifact: ReviewArtifact,
  reviewId: string,
  expectedStatus: 'editing' | 'pending-agent' = 'editing'
): void {
  if (
    artifact.review.id !== reviewId ||
    artifact.review.status !== expectedStatus ||
    artifact.sourceDocument.content !== smokeSource
  ) {
    throw new Error('The packaged smoke review did not preserve its saved state.')
  }
}

function assertCleanIntelContext(
  options: PackagedSmokeOptions,
  prepared: PreparedApp,
  host: PackagedSmokeHost,
  quarantinePresent: boolean
): void {
  if (options.architecture !== 'x64' || host.architecture !== 'x86_64') {
    throw new Error('Clean Intel evidence requires a native Intel artifact and host.')
  }
  if (!/^14(?:\.|$)/.test(host.macosVersion)) {
    throw new Error('Clean Intel evidence requires macOS 14 Sonoma.')
  }
  if (!prepared.provided) {
    throw new Error('Clean Intel evidence requires the separately installed draft app.')
  }
  if (!quarantinePresent) {
    throw new Error('Clean Intel evidence requires the Safari quarantine attribute.')
  }
}

async function defaultVerifyArtifact(
  options: PackagedSmokeOptions
): Promise<MacosArtifactReport> {
  return await verifyMacosArtifact({
    architecture: options.architecture,
    archivePath: options.archivePath,
    checksumPath: options.checksumPath,
    trustMode: options.trustMode,
    version: options.version
  })
}

export async function runPackagedSmoke(
  options: PackagedSmokeOptions,
  dependencies: PackagedSmokeDependencies = {}
): Promise<PackagedSmokeEvidence> {
  if (process.platform !== 'darwin' && !dependencies.verifyArtifact) {
    throw new Error('Packaged Markover smoke requires macOS.')
  }
  const endpointPath = serviceEndpointPath()
  const serviceRunning = dependencies.serviceRunning || defaultServiceRunning
  if (await serviceRunning(endpointPath)) {
    throw new Error('Quit the running Markover app before packaged smoke.')
  }

  const verifyArtifact = dependencies.verifyArtifact || defaultVerifyArtifact
  const artifact = await verifyArtifact(options)
  const prepareApp = dependencies.prepareApp || defaultPrepareApp
  const prepared = await prepareApp(options)
  const startApp = dependencies.startApp || defaultStartApp
  const stopApp = dependencies.stopApp || defaultStopApp
  const loadReview = dependencies.loadReview || ((reviewId: string) => (
    new ReviewStore(reviewsDirectory()).load(reviewId)
  ))
  const timeout = options.launchTimeoutMilliseconds ?? 120_000
  const sourcePath = path.join(
    os.tmpdir(),
    `markover-packaged-smoke-${String(process.pid)}.md`
  )
  const openReview = dependencies.openReview || (async (
    smokeEndpointPath: string,
    smokeSourcePath: string
  ) => (
    await openHappyPathSmokeReview({
      endpointPath: smokeEndpointPath,
      sourcePath: smokeSourcePath,
      sourceContent: smokeSource,
      contextSummary: 'Packaged happy-path smoke evidence — safe to preserve.'
    })
  ).reviewId)
  const handoffAndReopen = dependencies.handoffAndReopen || (async (
    smokeEndpointPath: string,
    smokeReviewId: string
  ) => {
    await handoffAndReopenHappyPathSmokeReview(
      smokeEndpointPath,
      smokeReviewId
    )
  })
  let appStarted = false
  try {
    const host = (dependencies.host || defaultHost)()
    const quarantinePresent = (
      dependencies.quarantinePresent || defaultQuarantinePresent
    )(prepared.appPath)
    if (options.evidenceKind === 'clean-intel-sonoma') {
      assertCleanIntelContext(options, prepared, host, quarantinePresent)
    }

    const first = await startApp(
      prepared.appPath,
      endpointPath,
      null,
      timeout,
      () => { appStarted = true }
    )
    appStarted = true
    const reviewId = await openReview(endpointPath, sourcePath)
    assertPersistedReview(await loadReview(reviewId), reviewId)

    await stopApp(endpointPath, timeout)
    appStarted = false
    await startApp(
      prepared.appPath,
      endpointPath,
      first.pid,
      timeout,
      () => { appStarted = true }
    )
    appStarted = true
    assertPersistedReview(await loadReview(reviewId), reviewId)

    await handoffAndReopen(endpointPath, reviewId)
    assertPersistedReview(await loadReview(reviewId), reviewId)
    await stopApp(endpointPath, timeout)
    appStarted = false

    const cleanMachine = options.evidenceKind === 'clean-intel-sonoma'
    const evidence: PackagedSmokeEvidence = {
      format: 'markover-packaged-smoke-evidence',
      version: 1,
      status: 'passed',
      scope: 'packaged-happy-path',
      collectedAt: (dependencies.now || (() => new Date()))().toISOString(),
      sourceCommit: (dependencies.revision || defaultRevision)(),
      evidenceKind: options.evidenceKind,
      cleanMachine,
      host,
      artifact: {
        ...artifact,
        appleVerified: false,
        notarized: false
      },
      review: {
        id: reviewId,
        preserved: true
      },
      steps: {
        exactArtifactVerified: true,
        packagedAppLaunched: true,
        cliOpenCreatedReview: true,
        savedStateConfirmedBeforeRestart: true,
        appRestarted: true,
        savedReviewRestored: true,
        cliGetHandedOffReview: true,
        cliEditReopenedReview: true,
        reopenedStateConfirmedOnDisk: true
      },
      cleanIntel: {
        quarantinePresent: cleanMachine ? quarantinePresent : null,
        gatekeeperOverrideExercised: cleanMachine ? true : null,
        rollbackVerified: false
      },
      exclusions: [
        'adversarial-authorization',
        'bounded-loss-durability'
      ]
    }
    await fs.mkdir(path.dirname(path.resolve(options.evidencePath)), {
      recursive: true
    })
    await fs.writeFile(
      path.resolve(options.evidencePath),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    )
    return evidence
  } finally {
    if (appStarted) await stopApp(endpointPath, timeout).catch(() => {})
    await fs.unlink(sourcePath).catch(() => {})
    await prepared.cleanup()
  }
}

function parseEvidenceKind(value: string): PackagedSmokeEvidenceKind {
  if (value === 'local' || value === 'ci' || value === 'clean-intel-sonoma') {
    return value
  }
  throw new Error(`Unsupported packaged smoke evidence kind: ${value}`)
}

export function parsePackagedSmokeOptions(
  args: readonly string[]
): PackagedSmokeOptions {
  const values = new Map<string, string>()
  for (const argument of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument)
    if (!match?.[1] || match[2] === undefined) {
      throw new Error(`Invalid argument: ${argument}`)
    }
    if (values.has(match[1])) {
      throw new Error(`Duplicate argument: --${match[1]}`)
    }
    values.set(match[1], match[2])
  }
  const required = [
    'architecture',
    'archive',
    'checksum',
    'evidence',
    'trust-mode',
    'version'
  ]
  for (const name of required) {
    if (!values.has(name)) throw new Error(`Missing argument: --${name}`)
  }
  for (const name of values.keys()) {
    if (![...required, 'app', 'evidence-kind', 'launch-timeout-ms'].includes(name)) {
      throw new Error(`Unknown argument: --${name}`)
    }
  }
  const timeoutValue = values.get('launch-timeout-ms')
  const launchTimeoutMilliseconds = timeoutValue === undefined
    ? undefined
    : Number(timeoutValue)
  if (
    launchTimeoutMilliseconds !== undefined &&
    (!Number.isSafeInteger(launchTimeoutMilliseconds) ||
      launchTimeoutMilliseconds < 1_000 ||
      launchTimeoutMilliseconds > 600_000)
  ) {
    throw new Error('--launch-timeout-ms must be an integer from 1000 to 600000.')
  }
  return {
    appPath: values.get('app'),
    architecture: parseMacosArchitecture(values.get('architecture') || ''),
    archivePath: values.get('archive') || '',
    checksumPath: values.get('checksum') || '',
    evidenceKind: parseEvidenceKind(values.get('evidence-kind') || 'local'),
    evidencePath: values.get('evidence') || '',
    launchTimeoutMilliseconds,
    trustMode: parseMacosTrustMode(values.get('trust-mode')),
    version: values.get('version') || ''
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  try {
    const options = parsePackagedSmokeOptions(args)
    const evidence = await runPackagedSmoke(options)
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      evidence: path.resolve(options.evidencePath),
      reviewId: evidence.review.id
    })}\n`)
  } catch (error) {
    process.stderr.write(
      `markover packaged smoke: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  }
}

if (require.main === module) void main()

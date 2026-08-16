import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import { canonicalApplicationAddress } from './canonical-application'
import {
  resolveInstance,
  type ResolvedInstance
} from './instance'
import {
  inspectLinkHandler,
  type LinkHandlerStatus
} from './link-handler'
import { probeService } from './local-client'
import type { BuildIdentity } from './startup-contract'

export const CANONICAL_REFRESH_COMMAND =
  'npm --silent run markover -- canonical refresh'

export interface CanonicalDoctorResult {
  format: 'markover-canonical-doctor'
  version: 1
  status: 'healthy' | 'unhealthy'
  identity: 'canonical'
  checkout: {
    path: string | null
    branch: string | null
    head: string | null
    clean: boolean | null
  }
  service: {
    status: 'ready' | 'stopped'
    endpointPath: string
    instanceId: string | null
    pid: number | null
  }
  window: {
    status: 'electron-visible' | 'electron-hidden' | 'unknown' | 'absent'
  }
  application: {
    status: 'current' | 'mismatch' | 'unavailable'
    source: 'installed' | 'generated' | null
    executablePath: string | null
    bundlePath: string | null
    bundleIdentifier: string | null
    expectedBundleIdentifier: string
    expectedExecutablePaths: string[]
  }
  build: {
    status: 'current' | 'mismatch' | 'unavailable'
    commit: string | null
    dirty: boolean | null
    startupStatus: string | null
  }
  handler: LinkHandlerStatus
  issues: string[]
  repairCommand: string | null
}

export class CanonicalMaintenanceError extends Error {
  readonly code:
    | 'CANONICAL_CHECKOUT_UNAVAILABLE'
    | 'CANONICAL_ROUTING_UNHEALTHY'

  constructor(code: CanonicalMaintenanceError['code'], message: string) {
    super(message)
    this.name = 'CanonicalMaintenanceError'
    this.code = code
  }
}

interface StartupDiagnosticSnapshot {
  status: string
  build: BuildIdentity
}

interface ServiceProbeResult {
  endpoint: {
    instanceId: string
    pid: number
  }
  executablePath?: string | null
  windowVisible?: boolean | null
}

export interface InspectCanonicalHealthOptions {
  inspectHandler?: (
    scheme: string,
    expectedInstance: ResolvedInstance
  ) => Promise<LinkHandlerStatus>
  probe?: (endpointPath: string) => Promise<ServiceProbeResult>
  readFile?: typeof fs.readFile
  readBundleIdentifier?: (appPath: string) => string | null
  resolve?: () => Promise<ResolvedInstance>
  runCommand?: typeof spawnSync
}

function applicationBundlePath(executablePath: string): string | null {
  const macosDirectory = path.dirname(executablePath)
  const contentsDirectory = path.dirname(macosDirectory)
  const appPath = path.dirname(contentsDirectory)
  return path.basename(macosDirectory) === 'MacOS' &&
    path.basename(contentsDirectory) === 'Contents' &&
    path.extname(appPath) === '.app'
    ? appPath
    : null
}

function readApplicationBundleIdentifier(appPath: string): string | null {
  const result = spawnSync(
    '/usr/bin/plutil',
    [
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      path.join(appPath, 'Contents', 'Info.plist')
    ],
    { encoding: 'utf8' }
  )
  return !result.error && result.status === 0
    ? result.stdout.trim() || null
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseStartupDiagnosticSnapshot(
  value: unknown
): StartupDiagnosticSnapshot | null {
  if (
    !isRecord(value) ||
    value.format !== 'markover-startup-diagnostic' ||
    value.version !== 1 ||
    typeof value.status !== 'string' ||
    !isRecord(value.build) ||
    typeof value.build.version !== 'string' ||
    (value.build.commit !== null && typeof value.build.commit !== 'string') ||
    typeof value.build.dirty !== 'boolean' ||
    typeof value.build.rendererSha256 !== 'string'
  ) return null
  return {
    status: value.status,
    build: {
      version: value.build.version,
      commit: value.build.commit,
      dirty: value.build.dirty,
      rendererSha256: value.build.rendererSha256
    }
  }
}

function commandText(
  checkout: string,
  args: readonly string[],
  runCommand: typeof spawnSync
): string | null {
  const result = runCommand('git', [...args], {
    cwd: checkout,
    encoding: 'utf8'
  })
  return !result.error && result.status === 0 && typeof result.stdout === 'string'
    ? result.stdout.trim()
    : null
}

async function readDiagnostic(
  filePath: string,
  readFile: typeof fs.readFile
): Promise<StartupDiagnosticSnapshot | null> {
  try {
    return parseStartupDiagnosticSnapshot(JSON.parse(
      await readFile(filePath, 'utf8')
    ) as unknown)
  } catch {
    return null
  }
}

export async function inspectCanonicalHealth(
  expectedInstance?: ResolvedInstance,
  {
    inspectHandler = inspectLinkHandler,
    probe = probeService,
    readBundleIdentifier = readApplicationBundleIdentifier,
    readFile = fs.readFile,
    resolve = () => resolveInstance('canonical'),
    runCommand = spawnSync
  }: InspectCanonicalHealthOptions = {}
): Promise<CanonicalDoctorResult> {
  const instance = expectedInstance || await resolve()
  const checkoutPath = instance.checkout
  const head = checkoutPath
    ? commandText(checkoutPath, ['rev-parse', 'HEAD'], runCommand)
    : null
  const branch = checkoutPath
    ? commandText(checkoutPath, ['branch', '--show-current'], runCommand)
    : null
  const statusOutput = checkoutPath
    ? commandText(
        checkoutPath,
        ['status', '--porcelain', '--untracked-files=all'],
        runCommand
      )
    : null
  const clean = statusOutput === null ? null : statusOutput.length === 0
  const diagnostic = await readDiagnostic(
    path.join(instance.stateRoot, 'startup-diagnostic.json'),
    readFile
  )
  const service = await probe(instance.service.endpointPath).catch(() => null)
  const handler = await inspectHandler(instance.scheme, instance)
  const applicationAddress = checkoutPath
    ? canonicalApplicationAddress(instance)
    : null
  const executablePath = service?.executablePath || null
  const bundlePath = executablePath
    ? applicationBundlePath(executablePath)
    : null
  const source = applicationAddress && executablePath ===
    applicationAddress.installedExecutablePath
    ? 'installed' as const
    : applicationAddress && executablePath ===
      applicationAddress.generatedExecutablePath
      ? 'generated' as const
      : null
  const bundleIdentifier = bundlePath
    ? readBundleIdentifier(bundlePath)
    : null
  const applicationCurrent = Boolean(
    applicationAddress &&
    service &&
    source &&
    bundleIdentifier === applicationAddress.bundleIdentifier
  )
  const buildCurrent = Boolean(
    checkoutPath &&
    clean &&
    head &&
    diagnostic?.status === 'ready' &&
    diagnostic.build.commit === head &&
    !diagnostic.build.dirty
  )
  const issues: string[] = []
  if (!checkoutPath) {
    issues.push(
      `Canonical checkout unavailable: ${instance.coldStart.blockedBy || 'descriptor missing'}.`
    )
  } else if (
    instance.coldStart.blockedBy !== null &&
    instance.coldStart.blockedBy !== 'already-running'
  ) {
    issues.push(`Canonical checkout invalid: ${instance.coldStart.blockedBy}.`)
  }
  if (!service) issues.push('Canonical service is not ready.')
  if (service && !applicationCurrent) {
    issues.push(
      `Running canonical executable ${executablePath || 'unknown'} is not an exact addressed canonical application with bundle identifier ${applicationAddress?.bundleIdentifier || 'unknown'}.`
    )
  }
  if (!diagnostic) {
    issues.push('Canonical startup diagnostic is unavailable or invalid.')
  } else if (!buildCurrent) {
    issues.push(
      `Running build ${diagnostic.build.commit || 'unknown'} does not match a clean canonical checkout at ${head || 'unknown'}.`
    )
  }
  if (handler.status !== 'healthy') {
    issues.push(
      `${instance.scheme}: routing is ${handler.status}; current owner is ${handler.ownerPath || 'unclaimed'}.`
    )
  }
  return {
    format: 'markover-canonical-doctor',
    version: 1,
    status: issues.length === 0 ? 'healthy' : 'unhealthy',
    identity: 'canonical',
    checkout: {
      path: checkoutPath,
      branch,
      head,
      clean
    },
    service: {
      status: service ? 'ready' : 'stopped',
      endpointPath: instance.service.endpointPath,
      instanceId: service?.endpoint.instanceId || null,
      pid: service?.endpoint.pid || null
    },
    window: {
      status: !service
        ? 'absent'
        : service.windowVisible === true
          ? 'electron-visible'
          : service.windowVisible === false
            ? 'electron-hidden'
            : 'unknown'
    },
    application: {
      status: !service || !executablePath
        ? 'unavailable'
        : applicationCurrent ? 'current' : 'mismatch',
      source,
      executablePath,
      bundlePath,
      bundleIdentifier,
      expectedBundleIdentifier: applicationAddress?.bundleIdentifier ||
        'com.lastobelus.markover.development.canonical',
      expectedExecutablePaths: applicationAddress
        ? [
            applicationAddress.installedExecutablePath,
            applicationAddress.generatedExecutablePath
          ]
        : []
    },
    build: {
      status: diagnostic
        ? buildCurrent ? 'current' : 'mismatch'
        : 'unavailable',
      commit: diagnostic?.build.commit || null,
      dirty: diagnostic?.build.dirty ?? null,
      startupStatus: diagnostic?.status || null
    },
    handler,
    issues,
    repairCommand: issues.length === 0 ? null : CANONICAL_REFRESH_COMMAND
  }
}

export async function assertCanonicalReviewRoutingReady(
  instance: ResolvedInstance,
  inspectHandler: (
    scheme: string,
    expectedInstance: ResolvedInstance
  ) => Promise<LinkHandlerStatus> = inspectLinkHandler
): Promise<void> {
  if (instance.identity.kind !== 'canonical' || !instance.checkout) return
  const handler = await inspectHandler(instance.scheme, instance)
  if (handler.status === 'healthy') return
  throw new CanonicalMaintenanceError(
    'CANONICAL_ROUTING_UNHEALTHY',
    `Cannot create a canonical review while ${instance.scheme}: routing is ${handler.status}` +
      ` (owner: ${handler.ownerPath || 'unclaimed'}). Run ` +
      `"${CANONICAL_REFRESH_COMMAND}" from any Markover checkout, then retry open.`
  )
}

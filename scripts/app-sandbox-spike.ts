#!/usr/bin/env node

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { applyMacosFusePolicy, readMacosFusePolicy } from './macos-fuses'
import {
  copyThirdPartyNotices,
  loadThirdPartyNotices,
  sanitizePackagedCapabilities,
  setMinimumSystemVersion,
  verifyPackagedAppLayout
} from './package-macos'

const projectDirectory = path.resolve(__dirname, '../..')
const spikeName = 'MarkoverSandboxSpike'
const spikeBundleId = 'com.lastobelus.markover.sandbox-spike'
const outputRoot = path.join(projectDirectory, 'tmp', 'app-sandbox-spike')
const packageRoot = path.join(
  outputRoot,
  `${spikeName}-mas-${process.arch}`
)
const appPath = path.join(packageRoot, `${spikeName}.app`)
const executablePath = path.join(
  appPath,
  'Contents',
  'MacOS',
  spikeName
)
const entitlementsRoot = path.join(
  projectDirectory,
  'config',
  'macos',
  'app-sandbox-spike'
)
const appEntitlementsPath = path.join(entitlementsRoot, 'app.plist')
const inheritedEntitlementsPath = path.join(entitlementsRoot, 'inherit.plist')
const evidencePath = path.join(outputRoot, 'evidence.json')

export type AppSandboxSpikeBlocker =
  | 'ad-hoc-team-identity-required'
  | 'sandbox-runtime-denied'
  | 'runtime-failed'
  | 'runtime-timeout'

export interface AppSandboxSpikeClassification {
  blocker: AppSandboxSpikeBlocker
  observed: string
}

export interface AppSandboxSpikeEvidence {
  format: 'markover-app-sandbox-spike'
  version: 1
  status: 'blocked' | 'passed'
  host: {
    architecture: string
    macosVersion: string
    model: string
  }
  prototype: {
    bundleId: typeof spikeBundleId
    electronPlatform: 'mas'
    productionEntitlementsChanged: false
    signature: 'ad-hoc'
    signedBundleVerified: true
    sandboxEntitlementsVerified: true
  }
  runtime: {
    blocker: AppSandboxSpikeBlocker | null
    exitCode: number | null
    launched: boolean
    observed: string
    stderrSha256: string
    timedOut: boolean
  }
}

function command(
  executable: string,
  args: readonly string[],
  options: {
    env?: NodeJS.ProcessEnv
    timeout?: number
  } = {}
): SpawnSyncReturns<string> {
  const result = spawnSync(executable, [...args], {
    cwd: projectDirectory,
    encoding: 'utf8',
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout
  })
  if (result.error && !('code' in result.error && result.error.code === 'ETIMEDOUT')) {
    throw result.error
  }
  return result
}

function requireSuccess(
  executable: string,
  args: readonly string[],
  description: string
): string {
  const result = command(executable, args)
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
      result.stdout.trim() ||
      `${description} exited ${String(result.status)}`
    )
  }
  return result.stdout.trim()
}

export function classifyAppSandboxSpikeFailure(
  stderr: string,
  timedOut: boolean
): AppSandboxSpikeClassification {
  if (timedOut) {
    return {
      blocker: 'runtime-timeout',
      observed: 'The sandbox prototype did not finish before its deadline.'
    }
  }
  if (
    /MachPortRendezvousServer/.test(stderr) &&
    /Permission denied/.test(stderr)
  ) {
    return {
      blocker: 'ad-hoc-team-identity-required',
      observed:
        'Electron MAS process rendezvous was denied because the ad-hoc spike has no shared Apple Team ID application group.'
    }
  }
  if (
    /deny\(1\)/.test(stderr) ||
    /Operation not permitted/.test(stderr) ||
    /Permission denied/.test(stderr)
  ) {
    return {
      blocker: 'sandbox-runtime-denied',
      observed: 'The sandbox denied the prototype before the smoke flow completed.'
    }
  }
  return {
    blocker: 'runtime-failed',
    observed: 'The sandbox prototype failed before the smoke flow completed.'
  }
}

export function readSmokeTimeoutEvidence(timeoutPath: string): boolean {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(timeoutPath, 'utf8'))
    return value !== null &&
      typeof value === 'object' &&
      Reflect.get(value, 'timedOut') === true
  } catch {
    return false
  }
}

function stripProductionUrlScheme(): void {
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist')
  const result = command(
    '/usr/bin/plutil',
    ['-remove', 'CFBundleURLTypes', infoPlist]
  )
  if (result.status !== 0 && !/Could not modify plist/.test(result.stderr)) {
    throw new Error(result.stderr.trim() || 'Could not remove the URL scheme.')
  }
}

async function packagePrototype(): Promise<void> {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(projectDirectory, 'package.json'),
    'utf8'
  )) as { devDependencies?: { electron?: string } }
  const electronVersion = manifest.devDependencies?.electron
  if (!electronVersion) throw new Error('package.json must pin Electron.')

  fs.rmSync(outputRoot, { recursive: true, force: true })
  fs.mkdirSync(outputRoot, { recursive: true })
  const packagerPath = path.join(
    projectDirectory,
    'node_modules',
    '.bin',
    'electron-packager'
  )
  const result = command(packagerPath, [
    path.join(projectDirectory, 'build', 'app'),
    spikeName,
    '--platform=mas',
    `--arch=${process.arch}`,
    `--electron-version=${electronVersion}`,
    `--out=${outputRoot}`,
    '--overwrite',
    '--asar',
    '--prune=false',
    `--icon=${path.join(projectDirectory, 'design/brand/markover-app-icon.icns')}`,
    `--app-bundle-id=${spikeBundleId}`,
    `--helper-bundle-id=${spikeBundleId}.helper`,
    '--app-category-type=public.app-category.developer-tools',
    `--extend-info=${path.join(projectDirectory, 'config/macos/info.plist')}`
  ])
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Electron MAS packaging failed.')
  }

  await verifyPackagedAppLayout(appPath)
  copyThirdPartyNotices(appPath, loadThirdPartyNotices())
  setMinimumSystemVersion(appPath)
  sanitizePackagedCapabilities(appPath)
  stripProductionUrlScheme()
  await applyMacosFusePolicy(appPath)

  const { sign } = await import('@electron/osx-sign')
  await sign({
    app: appPath,
    platform: 'mas',
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
    optionsForFile(filePath) {
      return {
        entitlements: filePath === appPath
          ? appEntitlementsPath
          : inheritedEntitlementsPath,
        hardenedRuntime: true,
        timestamp: 'none'
      }
    }
  })
  await readMacosFusePolicy(appPath)
  requireSuccess(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=4', appPath],
    'codesign verification'
  )

  const signedEntitlements = requireSuccess(
    '/usr/bin/codesign',
    ['--display', '--entitlements', ':-', appPath],
    'entitlement inspection'
  )
  for (const entitlement of [
    'com.apple.security.app-sandbox',
    'com.apple.security.files.bookmarks.app-scope',
    'com.apple.security.files.user-selected.read-only',
    'com.apple.security.network.client',
    'com.apple.security.network.server'
  ]) {
    if (!signedEntitlements.includes(entitlement)) {
      throw new Error(`Signed spike is missing ${entitlement}.`)
    }
  }
}

function hostValue(executable: string, args: readonly string[]): string {
  const result = command(executable, args)
  return result.status === 0 ? result.stdout.trim() : 'unknown'
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('The App Sandbox spike requires macOS.')
  }
  await packagePrototype()

  const runSmokePath = path.join(projectDirectory, 'build', 'scripts', 'run-smoke.js')
  const runtime = command(
    process.execPath,
    [runSmokePath, '--timeout=60', `--app=${executablePath}`],
    {
      env: {
        ...process.env,
        MARKOVER_SUPPRESS_PROTOCOL_REGISTRATION: '1'
      },
      timeout: 75_000
    }
  )
  const outerTimedOut = runtime.error !== undefined &&
    'code' in runtime.error &&
    runtime.error.code === 'ETIMEDOUT'
  const runnerTimedOut = runtime.status !== 0 &&
    /Smoke failed; evidence saved to /.test(runtime.stderr) &&
    readSmokeTimeoutEvidence(
      path.join(projectDirectory, 'tmp', 'smoke-failures', 'timeout.json')
    )
  const timedOut = outerTimedOut || runnerTimedOut
  const launched = runtime.status === 0
  const classification = launched
    ? null
    : classifyAppSandboxSpikeFailure(runtime.stderr, timedOut)
  const evidence: AppSandboxSpikeEvidence = {
    format: 'markover-app-sandbox-spike',
    version: 1,
    status: launched ? 'passed' : 'blocked',
    host: {
      architecture: process.arch,
      macosVersion: hostValue('/usr/bin/sw_vers', ['-productVersion']),
      model: hostValue('/usr/sbin/sysctl', ['-n', 'hw.model'])
    },
    prototype: {
      bundleId: spikeBundleId,
      electronPlatform: 'mas',
      productionEntitlementsChanged: false,
      signature: 'ad-hoc',
      signedBundleVerified: true,
      sandboxEntitlementsVerified: true
    },
    runtime: {
      blocker: classification?.blocker ?? null,
      exitCode: runtime.status,
      launched,
      observed: classification?.observed ?? 'The hidden Markover smoke passed.',
      stderrSha256: createHash('sha256').update(runtime.stderr).digest('hex'),
      timedOut
    }
  }
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600
  })
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover app-sandbox spike: ${message}\n`)
    process.exitCode = 1
  })
}

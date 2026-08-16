import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { Options as PackagerOptions } from '@electron/packager' with {
  'resolution-mode': 'import'
}

import { generateDevelopmentIcon } from './generate-development-icon'
import { applyMacosFusePolicy, readMacosFusePolicy } from './macos-fuses'
import {
  copyThirdPartyNotices,
  loadThirdPartyNotices,
  sanitizePackagedCapabilities,
  setMinimumSystemVersion,
  verifyPackagedAppLayout
} from './package-macos'
import {
  entitlementsDirectory,
  parseMacosArchitecture
} from './macos-release-contract'
import {
  DEVELOPMENT_BUNDLE_ID_PREFIX,
  developmentGeneratedRoot,
  type ResolvedInstance
} from '../src/instance'

export { DEVELOPMENT_BUNDLE_ID_PREFIX } from '../src/instance'

const APP_CATEGORY = 'public.app-category.developer-tools'
const helperSuffixes = ['', ' (GPU)', ' (Plugin)', ' (Renderer)'] as const

export interface AddressedDevelopmentBundle {
  appBundleId: string
  appName: string
  appPath: string
  bundleDirectory: string
  generatedRoot: string
  helperBundleId: string
  identityKey: ResolvedInstance['identity']['key']
  scheme: string
}

export interface AddressedBundleMetadata {
  main: Readonly<Record<string, unknown>>
  helpers: ReadonlyArray<Readonly<Record<string, unknown>>>
}

export type ElectronPackager = (
  options: PackagerOptions
) => Promise<string[]>

export interface BuildAddressedDevelopmentBundleOptions {
  architecture?: NodeJS.Architecture
  packager?: ElectronPackager
  platform?: NodeJS.Platform
  prepareBundle?: (
    appPath: string,
    address: AddressedDevelopmentBundle,
    checkout: string
  ) => Promise<void>
  randomSuffix?: () => string
}

function positivePullRequestNumber(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Development bundle identity requires a pull-request number.')
  }
}

function requiredCheckout(instance: ResolvedInstance): string {
  if (!instance.checkout) {
    throw new Error(
      `Cannot build ${instance.identity.key}: its checkout is unavailable.`
    )
  }
  return path.resolve(instance.checkout)
}

function identityBundleId(instance: ResolvedInstance): string {
  if (instance.identity.kind === 'canonical') {
    return `${DEVELOPMENT_BUNDLE_ID_PREFIX}.canonical`
  }
  positivePullRequestNumber(instance.identity.pullRequestNumber)
  return `${DEVELOPMENT_BUNDLE_ID_PREFIX}.pr${String(
    instance.identity.pullRequestNumber
  )}`
}

export function addressedDevelopmentBundle(
  instance: ResolvedInstance
): AddressedDevelopmentBundle {
  const checkout = requiredCheckout(instance)
  const appName = instance.branding.appName
  if (
    !appName ||
    path.basename(appName) !== appName ||
    appName === '.' ||
    appName === '..'
  ) {
    throw new Error(`Invalid addressed application name: ${appName}`)
  }
  const appBundleId = identityBundleId(instance)
  const generatedRoot = path.join(
    developmentGeneratedRoot(checkout),
    instance.identity.key
  )
  const bundleDirectory = path.join(generatedRoot, 'bundle')
  return {
    appBundleId,
    appName,
    appPath: path.join(bundleDirectory, `${appName}.app`),
    bundleDirectory,
    generatedRoot,
    helperBundleId: `${appBundleId}.helper`,
    identityKey: instance.identity.key,
    scheme: instance.scheme
  }
}

export function addressedDevelopmentExecutable(
  instance: ResolvedInstance
): string {
  const address = addressedDevelopmentBundle(instance)
  return path.join(
    address.appPath,
    'Contents',
    'MacOS',
    address.appName
  )
}

function resolvedIconPath(instance: ResolvedInstance, checkout: string): string {
  return path.isAbsolute(instance.branding.iconIcnsPath)
    ? instance.branding.iconIcnsPath
    : path.join(checkout, instance.branding.iconIcnsPath)
}

interface PackageManifest {
  devDependencies?: { electron?: string }
}

async function electronVersion(checkout: string): Promise<string> {
  const manifest = JSON.parse(await fs.readFile(
    path.join(checkout, 'package.json'),
    'utf8'
  )) as PackageManifest
  const version = manifest.devDependencies?.electron
  if (!version) throw new Error('package.json must pin Electron.')
  return version
}

export async function addressedPackagerOptions(
  instance: ResolvedInstance,
  out: string,
  architecture: NodeJS.Architecture = process.arch
): Promise<PackagerOptions> {
  const checkout = requiredCheckout(instance)
  const address = addressedDevelopmentBundle(instance)
  const arch = parseMacosArchitecture(architecture)
  return {
    appBundleId: address.appBundleId,
    appCategoryType: APP_CATEGORY,
    arch,
    asar: true,
    dir: path.join(checkout, 'build', 'app'),
    electronVersion: await electronVersion(checkout),
    helperBundleId: address.helperBundleId,
    icon: resolvedIconPath(instance, checkout),
    name: address.appName,
    out,
    overwrite: true,
    platform: 'darwin',
    protocols: [{
      name: `${address.appBundleId}.review`,
      schemes: [address.scheme]
    }],
    prune: false,
    quiet: true
  }
}

function exactString(
  value: Readonly<Record<string, unknown>>,
  key: string,
  expected: string,
  component: string
): void {
  if (value[key] !== expected) {
    throw new Error(
      `${component} ${key} expected ${expected}, found ${String(value[key])}.`
    )
  }
}

export function assertAddressedBundleMetadata(
  address: AddressedDevelopmentBundle,
  { main, helpers }: AddressedBundleMetadata
): void {
  exactString(main, 'CFBundleIdentifier', address.appBundleId, 'Application')
  exactString(main, 'CFBundleDisplayName', address.appName, 'Application')
  exactString(main, 'CFBundleExecutable', address.appName, 'Application')
  const expectedProtocols = [{
    CFBundleURLName: `${address.appBundleId}.review`,
    CFBundleURLSchemes: [address.scheme]
  }]
  if (JSON.stringify(main.CFBundleURLTypes) !== JSON.stringify(expectedProtocols)) {
    throw new Error(
      `Application CFBundleURLTypes does not address ${address.scheme}: exactly.`
    )
  }
  if (helpers.length !== helperSuffixes.length) {
    throw new Error(
      `Expected ${String(helperSuffixes.length)} helper bundles, found ${String(
        helpers.length
      )}.`
    )
  }
  helpers.forEach((helper, index) => {
    const suffix = helperSuffixes[index]
    const displayName = `${address.appName} Helper${suffix}`
    exactString(
      helper,
      'CFBundleIdentifier',
      address.helperBundleId,
      displayName
    )
    exactString(helper, 'CFBundleDisplayName', displayName, displayName)
    exactString(helper, 'CFBundleExecutable', displayName, displayName)
  })
}

function readPlist(filePath: string): Readonly<Record<string, unknown>> {
  const result = spawnSync(
    '/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', filePath],
    { encoding: 'utf8' }
  )
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message || result.stderr.trim() ||
      `plutil exited ${String(result.status ?? 1)}`
    )
  }
  const parsed: unknown = JSON.parse(result.stdout)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a plist dictionary.`)
  }
  return parsed as Readonly<Record<string, unknown>>
}

export function readAddressedBundleMetadata(
  appPath: string,
  address: AddressedDevelopmentBundle
): AddressedBundleMetadata {
  return {
    main: readPlist(path.join(appPath, 'Contents', 'Info.plist')),
    helpers: helperSuffixes.map((suffix) => readPlist(path.join(
      appPath,
      'Contents',
      'Frameworks',
      `${address.appName} Helper${suffix}.app`,
      'Contents',
      'Info.plist'
    )))
  }
}

function addressedEntitlements(
  appPath: string,
  filePath: string,
  appName: string,
  checkout: string
): string {
  const relative = path.relative(appPath, filePath)
  let filename = 'code.plist'
  if (
    relative === '' ||
    relative === path.join('Contents', 'MacOS', appName)
  ) {
    filename = 'app.plist'
  } else if (relative.startsWith(path.join(
    'Contents',
    'Frameworks',
    `${appName} Helper (Renderer).app`
  ))) {
    filename = 'helper-renderer.plist'
  } else if (relative.startsWith(path.join(
    'Contents',
    'Frameworks',
    `${appName} Helper (Plugin).app`
  ))) {
    filename = 'helper-plugin.plist'
  } else if (relative.startsWith(path.join(
    'Contents',
    'Frameworks',
    `${appName} Helper (GPU).app`
  ))) {
    filename = 'helper-gpu.plist'
  } else if (relative.startsWith(path.join(
    'Contents',
    'Frameworks',
    `${appName} Helper.app`
  ))) {
    filename = 'helper.plist'
  }
  return path.join(entitlementsDirectory(checkout), filename)
}

async function prepareAddressedBundle(
  appPath: string,
  address: AddressedDevelopmentBundle,
  checkout: string
): Promise<void> {
  await verifyPackagedAppLayout(appPath)
  copyThirdPartyNotices(appPath, loadThirdPartyNotices(checkout))
  setMinimumSystemVersion(appPath)
  sanitizePackagedCapabilities(appPath)
  await applyMacosFusePolicy(appPath)
  assertAddressedBundleMetadata(
    address,
    readAddressedBundleMetadata(appPath, address)
  )
  const { sign } = await import('@electron/osx-sign')
  await sign({
    app: appPath,
    platform: 'darwin',
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
    optionsForFile(filePath: string) {
      return {
        entitlements: addressedEntitlements(
          appPath,
          filePath,
          address.appName,
          checkout
        ),
        hardenedRuntime: true,
        timestamp: 'none'
      }
    }
  })
  await readMacosFusePolicy(appPath)
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    const code: unknown = error !== null && typeof error === 'object'
      ? Reflect.get(error, 'code')
      : null
    if (code === 'ENOENT') return false
    throw error
  }
}

async function publishBundleDirectory(
  readyDirectory: string,
  finalDirectory: string,
  backupDirectory: string
): Promise<void> {
  const hadPrevious = await exists(finalDirectory)
  if (hadPrevious) await fs.rename(finalDirectory, backupDirectory)
  try {
    await fs.rename(readyDirectory, finalDirectory)
  } catch (error) {
    if (hadPrevious) {
      try {
        await fs.rename(backupDirectory, finalDirectory)
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `Could not publish the addressed bundle or restore ${backupDirectory}.`,
          { cause: restoreError }
        )
      }
    }
    throw error
  }
  if (hadPrevious) {
    await fs.rm(backupDirectory, { recursive: true, force: true })
  }
}

export async function buildAddressedDevelopmentBundle(
  instance: ResolvedInstance,
  {
    architecture = process.arch,
    packager = async (options) => {
      const module = await import('@electron/packager')
      return module.packager(options)
    },
    platform = process.platform,
    prepareBundle = prepareAddressedBundle,
    randomSuffix = () => randomBytes(6).toString('hex')
  }: BuildAddressedDevelopmentBundleOptions = {}
): Promise<AddressedDevelopmentBundle> {
  if (platform !== 'darwin') {
    throw new Error('Addressed development bundles require macOS.')
  }
  const checkout = requiredCheckout(instance)
  if (instance.identity.kind === 'development') {
    await generateDevelopmentIcon({
      checkout,
      pullRequestNumber: instance.identity.pullRequestNumber,
      platform
    })
  }
  const address = addressedDevelopmentBundle(instance)
  await fs.mkdir(address.generatedRoot, { recursive: true })
  const suffix = `${String(process.pid)}-${randomSuffix()}`
  const scratchDirectory = path.join(
    address.generatedRoot,
    `.bundle-build-${suffix}`
  )
  const outputDirectory = path.join(scratchDirectory, 'packager')
  const readyDirectory = path.join(scratchDirectory, 'ready')
  const backupDirectory = path.join(
    address.generatedRoot,
    `.bundle-backup-${suffix}`
  )
  try {
    const options = await addressedPackagerOptions(
      instance,
      outputDirectory,
      architecture
    )
    const outputs = await packager(options)
    if (outputs.length !== 1) {
      throw new Error(
        `Expected one addressed bundle output, found ${String(outputs.length)}.`
      )
    }
    const packagedAppPath = path.join(
      outputs[0] as string,
      `${address.appName}.app`
    )
    await prepareBundle(packagedAppPath, address, checkout)
    await fs.mkdir(readyDirectory)
    await fs.rename(
      packagedAppPath,
      path.join(readyDirectory, `${address.appName}.app`)
    )
    await publishBundleDirectory(
      readyDirectory,
      address.bundleDirectory,
      backupDirectory
    )
    return address
  } finally {
    await fs.rm(scratchDirectory, { recursive: true, force: true })
  }
}

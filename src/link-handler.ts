import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ResolvedInstance } from './instance'
import { probeService } from './local-client'
import { isReviewInstanceScheme } from './review-url'

const projectDirectory = path.resolve(__dirname, '../..')
const swiftSourcePath = path.join(
  projectDirectory,
  'native/MarkoverLinkHandler.swift'
)
const launchServicesRegister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

export const LINK_HANDLER_FORMAT_VERSION = 1
export const LINK_HANDLER_EXECUTABLE = 'MarkoverLinkHandler'

export interface LinkHandlerBinding {
  version: 1
  scheme: string
  identity: string
  displayName: string
  instanceName: string
  checkoutPath: string | null
  endpointPath: string
  credentialPath: string
  diagnosticsPath: string
}

export type LinkHandlerStatusKind =
  | 'absent'
  | 'conflicting'
  | 'exact'
  | 'healthy'
  | 'incompatible'
  | 'stale'

export interface LinkHandlerStatus {
  format: 'markover-link-handler-status'
  version: 1
  scheme: string
  status: LinkHandlerStatusKind
  expectedPath: string
  ownerPath: string | null
  identity: string | null
  endpointPath: string | null
}

export interface LinkHandlerMutationResult extends LinkHandlerStatus {
  action: 'installed' | 'repaired' | 'replaced' | 'removed' | 'unchanged'
  previousOwnerPath?: string | null
}

export interface LinkHandlerOptions {
  handlerRoot?: string
  inspectOwner?: (scheme: string) => Promise<string | null>
  probe?: (endpointPath: string) => Promise<boolean>
  register?: (appPath: string) => Promise<void>
  renamePath?: (sourcePath: string, destinationPath: string) => Promise<void>
  restoreOwner?: (appPath: string, scheme: string) => Promise<void>
  removePath?: (
    targetPath: string,
    options: { recursive: true, force: true }
  ) => Promise<void>
  unregister?: (appPath: string) => Promise<void>
  runCommand?: typeof spawnSync
  sourcePath?: string
}

export class LinkHandlerError extends Error {
  readonly code:
    | 'HANDLER_BUILD_FAILED'
    | 'HANDLER_CONFLICT'
    | 'HANDLER_DAMAGED'
    | 'HANDLER_INSTALL_FAILED'
    | 'INVALID_SCHEME'
    | 'PLATFORM_UNSUPPORTED'
    | 'PULL_REQUEST_NOT_OPEN'

  constructor(code: LinkHandlerError['code'], message: string) {
    super(message)
    this.name = 'LinkHandlerError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorCode(error: unknown): unknown {
  return isRecord(error) ? error.code : null
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function commandFailure(
  result: ReturnType<typeof spawnSync>,
  fallback: string
): string {
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  return result.error?.message || stderr || stdout || fallback
}

function identityForScheme(scheme: string): string {
  if (!isReviewInstanceScheme(scheme)) {
    throw new LinkHandlerError(
      'INVALID_SCHEME',
      `Expected markover or one exact markover-N scheme, received ${scheme}.`
    )
  }
  return scheme === 'markover'
    ? 'canonical'
    : `pr-${scheme.slice('markover-'.length)}`
}

export function linkHandlerRoot(homeDirectory = os.homedir()): string {
  return path.join(
    homeDirectory,
    'Library/Application Support/Markover/Development/Link Handlers'
  )
}

export function linkHandlerDisplayName(scheme: string): string {
  const identity = identityForScheme(scheme)
  return identity === 'canonical'
    ? 'Markover Development Link Handler'
    : `Markover PR ${identity.slice(3)} Link Handler`
}

export function linkHandlerInstanceName(scheme: string): string {
  const identity = identityForScheme(scheme)
  return identity === 'canonical'
    ? 'Markover'
    : `Markover PR #${identity.slice(3)}`
}

export function linkHandlerBundleId(scheme: string): string {
  const identity = identityForScheme(scheme).replace('-', '.')
  return `com.lastobelus.markover.link-handler.${identity}`
}

export function linkHandlerAppPath(scheme: string, root: string): string {
  return path.join(root, `${linkHandlerDisplayName(scheme)}.app`)
}

export function linkHandlerBinding(
  instance: ResolvedInstance,
  root: string
): LinkHandlerBinding {
  return {
    version: LINK_HANDLER_FORMAT_VERSION,
    scheme: instance.scheme,
    identity: instance.identity.key,
    displayName: linkHandlerDisplayName(instance.scheme),
    instanceName: linkHandlerInstanceName(instance.scheme),
    checkoutPath: instance.checkout,
    endpointPath: instance.service.endpointPath,
    credentialPath: instance.service.tokenPath,
    diagnosticsPath: path.join(root, 'diagnostics.json')
  }
}

export function parseLinkHandlerBinding(
  value: unknown,
  expectedScheme?: string
): LinkHandlerBinding | null {
  if (
    !isRecord(value) ||
    value.version !== LINK_HANDLER_FORMAT_VERSION ||
    typeof value.scheme !== 'string' ||
    !isReviewInstanceScheme(value.scheme) ||
    (expectedScheme !== undefined && value.scheme !== expectedScheme) ||
    value.identity !== identityForScheme(value.scheme) ||
    value.displayName !== linkHandlerDisplayName(value.scheme) ||
    value.instanceName !== linkHandlerInstanceName(value.scheme) ||
    (value.checkoutPath !== null && (
      typeof value.checkoutPath !== 'string' ||
      !path.isAbsolute(value.checkoutPath)
    )) ||
    typeof value.endpointPath !== 'string' ||
    !path.isAbsolute(value.endpointPath) ||
    typeof value.credentialPath !== 'string' ||
    !path.isAbsolute(value.credentialPath) ||
    typeof value.diagnosticsPath !== 'string' ||
    !path.isAbsolute(value.diagnosticsPath)
  ) return null
  return {
    version: LINK_HANDLER_FORMAT_VERSION,
    scheme: value.scheme,
    identity: value.identity,
    displayName: value.displayName,
    instanceName: value.instanceName,
    checkoutPath: value.checkoutPath,
    endpointPath: value.endpointPath,
    credentialPath: value.credentialPath,
    diagnosticsPath: value.diagnosticsPath
  }
}

function infoPlist(
  binding: LinkHandlerBinding,
  hasIcon: boolean
): string {
  const icon = hasIcon
    ? '  <key>CFBundleIconFile</key>\n  <string>handler.icns</string>\n'
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${xml(binding.displayName)}</string>
  <key>CFBundleExecutable</key>
  <string>${LINK_HANDLER_EXECUTABLE}</string>
  <key>CFBundleIdentifier</key>
  <string>${xml(linkHandlerBundleId(binding.scheme))}</string>
${icon}  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${xml(binding.displayName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>${xml(linkHandlerBundleId(binding.scheme))}</string>
      <key>CFBundleURLSchemes</key>
      <array><string>${xml(binding.scheme)}</string></array>
    </dict>
  </array>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
`
}

async function existingFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

function iconSource(instance: ResolvedInstance): string {
  return path.isAbsolute(instance.branding.iconIcnsPath)
    ? instance.branding.iconIcnsPath
    : path.join(
        instance.checkout || projectDirectory,
        instance.branding.iconIcnsPath
      )
}

async function buildHandlerApp(
  instance: ResolvedInstance,
  root: string,
  {
    runCommand = spawnSync,
    sourcePath = swiftSourcePath
  }: Pick<LinkHandlerOptions, 'runCommand' | 'sourcePath'>
): Promise<string> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  await fs.chmod(root, 0o700)
  const temporaryRoot = await fs.mkdtemp(path.join(root, '.build-'))
  const appPath = linkHandlerAppPath(instance.scheme, temporaryRoot)
  const contents = path.join(appPath, 'Contents')
  const macos = path.join(contents, 'MacOS')
  const resources = path.join(contents, 'Resources')
  try {
    await fs.mkdir(macos, { recursive: true })
    await fs.mkdir(resources, { recursive: true })
    const binding = linkHandlerBinding(instance, root)
    const sourceIcon = iconSource(instance)
    const hasIcon = await existingFile(sourceIcon)
    if (hasIcon) await fs.copyFile(sourceIcon, path.join(resources, 'handler.icns'))
    await fs.writeFile(
      path.join(contents, 'Info.plist'),
      infoPlist(binding, hasIcon),
      'utf8'
    )
    const bindingPath = path.join(resources, 'binding.json')
    await fs.writeFile(
      bindingPath,
      `${JSON.stringify(binding, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o444 }
    )
    const executablePath = path.join(macos, LINK_HANDLER_EXECUTABLE)
    const compiled = runCommand('/usr/bin/swiftc', [
      '-O',
      '-framework', 'AppKit',
      '-framework', 'CoreServices',
      '-o', executablePath,
      sourcePath
    ], { encoding: 'utf8' })
    if (compiled.error || compiled.status !== 0) {
      throw new LinkHandlerError(
        'HANDLER_BUILD_FAILED',
        commandFailure(compiled, 'Swift link-handler compilation failed.')
      )
    }
    const signed = runCommand('/usr/bin/codesign', [
      '--force', '--deep', '--sign', '-', appPath
    ], { encoding: 'utf8' })
    if (signed.error || signed.status !== 0) {
      throw new LinkHandlerError(
        'HANDLER_BUILD_FAILED',
        commandFailure(signed, 'Link-handler signing failed.')
      )
    }
    return appPath
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}

async function readBinding(appPath: string): Promise<LinkHandlerBinding | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(
      path.join(appPath, 'Contents/Resources/binding.json'),
      'utf8'
    ))
    return parseLinkHandlerBinding(value)
  } catch {
    return null
  }
}

async function generatedAppIsIntact(
  appPath: string,
  runCommand: typeof spawnSync = spawnSync
): Promise<boolean> {
  if (!await existingFile(path.join(
    appPath,
    'Contents/MacOS',
    LINK_HANDLER_EXECUTABLE
  ))) return false
  const result = await Promise.resolve().then(() => runCommand(
    '/usr/bin/codesign',
    ['--verify', '--strict', appPath],
    { encoding: 'utf8' }
  ))
  return !result.error && result.status === 0
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function comparablePath(filePath: string): Promise<string> {
  try {
    return await fs.realpath(filePath)
  } catch {
    return path.resolve(filePath)
  }
}

export const defaultHandlerPathSource = [
  'import AppKit',
  'import Foundation',
  'let url = URL(string: CommandLine.arguments[1] + "://handler-status")!',
  'if let app = NSWorkspace.shared.urlForApplication(toOpen: url) {',
  '  print(app.path)',
  '}'
].join('\n')

export async function macosDefaultHandlerPath(
  scheme: string,
  runCommand: typeof spawnSync = spawnSync
): Promise<string | null> {
  identityForScheme(scheme)
  const result = await Promise.resolve().then(() => runCommand(
    '/usr/bin/swift',
    ['-e', defaultHandlerPathSource, scheme],
    { encoding: 'utf8' }
  ))
  if (result.error || result.status !== 0) {
    throw new LinkHandlerError(
      'HANDLER_INSTALL_FAILED',
      commandFailure(result, `Could not inspect the ${scheme}: handler.`)
    )
  }
  return typeof result.stdout === 'string' && result.stdout.trim()
    ? result.stdout.trim()
    : null
}

function defaultRegister(appPath: string): Promise<void> {
  const registered = spawnSync(
    launchServicesRegister,
    ['-f', appPath],
    { encoding: 'utf8' }
  )
  if (registered.error || registered.status !== 0) {
    throw new LinkHandlerError(
      'HANDLER_INSTALL_FAILED',
      commandFailure(registered, 'LaunchServices registration failed.')
    )
  }
  const claimed = spawnSync(
    path.join(appPath, 'Contents/MacOS', LINK_HANDLER_EXECUTABLE),
    ['--claim'],
    { encoding: 'utf8' }
  )
  if (claimed.error || claimed.status !== 0) {
    throw new LinkHandlerError(
      'HANDLER_INSTALL_FAILED',
      commandFailure(claimed, 'The generated link handler could not claim its scheme.')
    )
  }
  return Promise.resolve()
}

function defaultUnregister(appPath: string): Promise<void> {
  const result = spawnSync(
    launchServicesRegister,
    ['-u', appPath],
    { encoding: 'utf8' }
  )
  if (result.error || result.status !== 0) {
    throw new LinkHandlerError(
      'HANDLER_INSTALL_FAILED',
      commandFailure(result, 'LaunchServices unregistration failed.')
    )
  }
  return Promise.resolve()
}

const defaultOwnerRestoreSource = [
  'import AppKit',
  'import CoreServices',
  'import Foundation',
  'let appURL = URL(fileURLWithPath: CommandLine.arguments[1])',
  'guard let bundleId = Bundle(url: appURL)?.bundleIdentifier else { exit(2) }',
  'guard LSRegisterURL(appURL as CFURL, true) == noErr else { exit(3) }',
  'exit(LSSetDefaultHandlerForURLScheme(',
  '  CommandLine.arguments[2] as CFString,',
  '  bundleId as CFString',
  '))'
].join('\n')

function defaultRestoreOwner(appPath: string, scheme: string): Promise<void> {
  const result = spawnSync(
    '/usr/bin/swift',
    ['-e', defaultOwnerRestoreSource, appPath, scheme],
    { encoding: 'utf8' }
  )
  if (result.error || result.status !== 0) {
    throw new LinkHandlerError(
      'HANDLER_INSTALL_FAILED',
      commandFailure(result, 'Previous LaunchServices ownership could not be restored.')
    )
  }
  return Promise.resolve()
}

function bindingMatches(
  left: LinkHandlerBinding,
  right: LinkHandlerBinding
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function inspectLinkHandler(
  scheme: string,
  expectedInstance?: ResolvedInstance,
  options: LinkHandlerOptions = {}
): Promise<LinkHandlerStatus> {
  identityForScheme(scheme)
  const root = options.handlerRoot || linkHandlerRoot()
  const expectedPath = linkHandlerAppPath(scheme, root)
  const inspectOwner = options.inspectOwner || ((target) => (
    macosDefaultHandlerPath(target, options.runCommand)
  ))
  const probe = options.probe || (async (endpointPath: string) => {
    try {
      await probeService(endpointPath)
      return true
    } catch {
      return false
    }
  })
  const [installed, ownerPath] = await Promise.all([
    pathExists(expectedPath),
    inspectOwner(scheme)
  ])
  const base = {
    format: 'markover-link-handler-status' as const,
    version: 1 as const,
    scheme,
    expectedPath,
    ownerPath
  }
  if (!installed) {
    return {
      ...base,
      status: ownerPath ? 'conflicting' : 'absent',
      identity: null,
      endpointPath: null
    }
  }

  const [binding, intact] = await Promise.all([
    readBinding(expectedPath),
    generatedAppIsIntact(expectedPath, options.runCommand)
  ])
  if (!binding || binding.scheme !== scheme || !intact) {
    return {
      ...base,
      status: 'incompatible',
      identity: null,
      endpointPath: null
    }
  }
  if (
    expectedInstance &&
    !bindingMatches(binding, linkHandlerBinding(expectedInstance, root))
  ) {
    return {
      ...base,
      status: 'conflicting',
      identity: binding.identity,
      endpointPath: binding.endpointPath
    }
  }
  if (
    binding.checkoutPath !== null &&
    !await pathExists(binding.checkoutPath)
  ) {
    return {
      ...base,
      status: 'stale',
      identity: binding.identity,
      endpointPath: binding.endpointPath
    }
  }
  if (
    ownerPath &&
    await comparablePath(ownerPath) !== await comparablePath(expectedPath)
  ) {
    return {
      ...base,
      status: 'conflicting',
      identity: binding.identity,
      endpointPath: binding.endpointPath
    }
  }
  const running = await probe(binding.endpointPath)
  return {
    ...base,
    status: ownerPath && running ? 'healthy' : 'exact',
    identity: binding.identity,
    endpointPath: binding.endpointPath
  }
}

function assertInstallable(instance: ResolvedInstance): void {
  if (
    instance.identity.kind === 'development' &&
    instance.pullRequest?.state !== 'open'
  ) {
    throw new LinkHandlerError(
      'PULL_REQUEST_NOT_OPEN',
      `${instance.identity.key} must name a live open pull request before its handler can be installed or repaired.`
    )
  }
}

interface PendingAppReplacement {
  backupPath: string | null
  temporaryRoot: string
}

async function beginGeneratedAppReplacement(
  stagedApp: string,
  destination: string,
  renamePath: NonNullable<LinkHandlerOptions['renamePath']>
): Promise<PendingAppReplacement> {
  const temporaryRoot = path.dirname(stagedApp)
  const backup = `${destination}.previous-${String(process.pid)}-${randomBytes(6).toString('hex')}`
  const hadDestination = await pathExists(destination)
  try {
    if (hadDestination) await renamePath(destination, backup)
    await renamePath(stagedApp, destination)
    return {
      backupPath: hadDestination ? backup : null,
      temporaryRoot
    }
  } catch (error) {
    const recoveryFailures: string[] = []
    if (!await pathExists(destination) && await pathExists(backup)) {
      await renamePath(backup, destination).catch((recoveryError: unknown) => {
        recoveryFailures.push(
          recoveryError instanceof Error
            ? recoveryError.message
            : String(recoveryError)
        )
      })
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(
      (recoveryError: unknown) => {
        recoveryFailures.push(
          recoveryError instanceof Error
            ? recoveryError.message
            : String(recoveryError)
        )
      }
    )
    if (recoveryFailures.length > 0) {
      const failure = error instanceof Error ? error.message : String(error)
      const preservedBackup = await pathExists(backup)
      throw new LinkHandlerError(
        'HANDLER_INSTALL_FAILED',
        `${failure} Staging recovery also failed: ${recoveryFailures.join(' ')}` +
          (preservedBackup ? ` Previous handler backup: ${backup}.` : '')
      )
    }
    throw error
  }
}

async function commitGeneratedAppReplacement(
  replacement: PendingAppReplacement,
  removePath: NonNullable<LinkHandlerOptions['removePath']>
): Promise<void> {
  await removePath(replacement.temporaryRoot, { recursive: true, force: true })
}

async function cleanupCommittedAppReplacement(
  replacement: PendingAppReplacement,
  removePath: NonNullable<LinkHandlerOptions['removePath']>
): Promise<void> {
  if (replacement.backupPath) {
    await removePath(replacement.backupPath, { recursive: true, force: true })
  }
}

async function rollbackGeneratedAppReplacement(
  replacement: PendingAppReplacement,
  destination: string
): Promise<void> {
  await fs.rm(destination, { recursive: true, force: true })
  if (replacement.backupPath && await pathExists(replacement.backupPath)) {
    await fs.rename(replacement.backupPath, destination)
  }
  await fs.rm(replacement.temporaryRoot, { recursive: true, force: true })
}

export async function installLinkHandler(
  action: 'install' | 'repair' | 'replace',
  instance: ResolvedInstance,
  options: LinkHandlerOptions = {}
): Promise<LinkHandlerMutationResult> {
  if (process.platform !== 'darwin') {
    throw new LinkHandlerError(
      'PLATFORM_UNSUPPORTED',
      'Markover development link handlers require macOS.'
    )
  }
  assertInstallable(instance)
  const root = options.handlerRoot || linkHandlerRoot()
  const before = await inspectLinkHandler(instance.scheme, instance, options)
  const renamePath = options.renamePath || fs.rename
  const hasConflictingOwner = before.ownerPath !== null && (
    await comparablePath(before.ownerPath) !==
    await comparablePath(before.expectedPath)
  )
  if (action === 'install' && (before.status === 'healthy' || before.status === 'exact')) {
    const register = options.register || defaultRegister
    await register(before.expectedPath)
    const current = await inspectLinkHandler(instance.scheme, instance, options)
    if (current.ownerPath === null || (
      await comparablePath(current.ownerPath) !==
      await comparablePath(current.expectedPath)
    )) {
      throw new LinkHandlerError(
        'HANDLER_INSTALL_FAILED',
        `LaunchServices did not select ${current.expectedPath} for ${instance.scheme}:.`
      )
    }
    return { ...current, action: 'unchanged' }
  }
  if (
    action !== 'replace' &&
    (before.status === 'conflicting' || hasConflictingOwner)
  ) {
    throw new LinkHandlerError(
      'HANDLER_CONFLICT',
      `${instance.scheme}: is owned by ${before.ownerPath || before.expectedPath}; use replace only after confirming that owner.`
    )
  }

  const staged = await buildHandlerApp(instance, root, options)
  const replacement = await beginGeneratedAppReplacement(
    staged,
    before.expectedPath,
    renamePath
  )
  const register = options.register || defaultRegister
  const removePath = options.removePath || fs.rm
  let current: LinkHandlerStatus
  try {
    await register(before.expectedPath)
    current = await inspectLinkHandler(instance.scheme, instance, options)
    if (current.ownerPath === null || (
      await comparablePath(current.ownerPath) !==
      await comparablePath(current.expectedPath)
    )) {
      throw new LinkHandlerError(
        'HANDLER_INSTALL_FAILED',
        `LaunchServices did not select ${current.expectedPath} for ${instance.scheme}:.`
      )
    }
    await commitGeneratedAppReplacement(replacement, removePath)
  } catch (error) {
    const unregister = options.unregister || defaultUnregister
    const restoreOwner = options.restoreOwner || defaultRestoreOwner
    const rollbackFailures: string[] = []
    await unregister(before.expectedPath).catch((rollbackError: unknown) => {
      rollbackFailures.push(
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError)
      )
    })
    await rollbackGeneratedAppReplacement(
      replacement,
      before.expectedPath
    ).catch((rollbackError: unknown) => {
      rollbackFailures.push(
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError)
      )
    })
    if (before.ownerPath) {
      await restoreOwner(before.ownerPath, instance.scheme).catch(
        (rollbackError: unknown) => {
          rollbackFailures.push(
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          )
        }
      )
    }
    const failure = error instanceof Error ? error.message : String(error)
    throw new LinkHandlerError(
      'HANDLER_INSTALL_FAILED',
      rollbackFailures.length > 0
        ? `${failure} Rollback also failed: ${rollbackFailures.join(' ')}`
        : failure
    )
  }
  // Registration and temporary cleanup are committed at this point. A stale
  // backup is safer than rolling back a healthy handler after commit.
  await cleanupCommittedAppReplacement(replacement, removePath).catch(() => {})
  return {
    ...current,
    action: action === 'install'
      ? 'installed'
      : action === 'repair'
        ? 'repaired'
        : 'replaced',
    previousOwnerPath: before.ownerPath
  }
}

export async function removeLinkHandler(
  scheme: string,
  {
    force = false,
    ...options
  }: LinkHandlerOptions & { force?: boolean } = {}
): Promise<LinkHandlerMutationResult> {
  if (process.platform !== 'darwin') {
    throw new LinkHandlerError(
      'PLATFORM_UNSUPPORTED',
      'Markover development link handlers require macOS.'
    )
  }
  const before = await inspectLinkHandler(scheme, undefined, options)
  if (before.status === 'absent') return { ...before, action: 'unchanged' }
  const ownerIsExpected = before.ownerPath !== null && (
    await comparablePath(before.ownerPath) ===
    await comparablePath(before.expectedPath)
  )
  if (before.ownerPath && !ownerIsExpected && !force) {
    throw new LinkHandlerError(
      'HANDLER_CONFLICT',
      `${scheme}: is owned by ${before.ownerPath}; pass --force only to remove Markover's expected generated app without changing that owner.`
    )
  }
  if (!await pathExists(before.expectedPath)) {
    return { ...before, action: 'unchanged' }
  }
  const binding = await readBinding(before.expectedPath)
  if ((!binding || binding.scheme !== scheme) && !force) {
    throw new LinkHandlerError(
      'HANDLER_DAMAGED',
      `Refusing to remove an incompatible app at ${before.expectedPath}; inspect it and pass --force only if it is the expected generated handler.`
    )
  }
  const unregister = options.unregister || defaultUnregister
  await unregister(before.expectedPath)
  await fs.rm(before.expectedPath, { recursive: true, force: true })
  const current = await inspectLinkHandler(scheme, undefined, options)
  return {
    ...current,
    action: 'removed',
    previousOwnerPath: before.ownerPath
  }
}

export function isMissingHandlerPath(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

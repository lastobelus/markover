import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  appBundleId,
  entitlementKeysForSignedFile,
  expectedArchiveName,
  minimumMacosVersion,
  signedAppComponents,
  type MacosArchitecture,
  type MacosTrustMode
} from './macos-release-contract'

export interface CommandResult {
  status: number
  stderr: string
  stdout: string
}

export type CommandRunner = (
  command: string,
  args: readonly string[]
) => CommandResult

export interface VerifyMacosArtifactOptions {
  architecture: MacosArchitecture
  archivePath: string
  checksumPath: string
  commandRunner?: CommandRunner
  discoverSignedPaths?: (appPath: string) => Promise<string[]>
  platform?: NodeJS.Platform
  temporaryDirectory?: string
  trustMode: string
  version: string
}

export interface MacosArtifactReport {
  architecture: MacosArchitecture
  gatekeeper: 'rejected-as-expected'
  sha256: string
  trustMode: MacosTrustMode
  version: string
}

export const runCommand: CommandRunner = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf8' })
  if (result.error) throw result.error
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr
  }
}

async function discoverSignedPaths(appPath: string): Promise<string[]> {
  const { walk } = await import('@electron/osx-sign')
  return await walk(appPath)
}

function commandOutput(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim()
}

function requireCommand(
  runner: CommandRunner,
  command: string,
  args: readonly string[]
): CommandResult {
  const result = runner(command, args)
  if (result.status !== 0) {
    throw new Error(
      commandOutput(result) ||
      `${path.basename(command)} exited ${String(result.status)}`
    )
  }
  return result
}

function plistValue(
  runner: CommandRunner,
  plistPath: string,
  key: string
): string {
  return requireCommand(
    runner,
    '/usr/bin/plutil',
    ['-extract', key, 'raw', '-o', '-', plistPath]
  ).stdout.trim()
}

export function validateArchiveEntries(entries: string): void {
  const paths = entries.split(/\r?\n/).filter(Boolean)
  if (paths.length === 0) throw new Error('The release ZIP is empty.')
  for (const entry of paths) {
    const segments = entry.split('/')
    if (
      entry.startsWith('/') ||
      entry.includes('\\') ||
      entry.includes('\0') ||
      segments.includes('..')
    ) {
      throw new Error(`The release ZIP contains an unsafe path: ${entry}`)
    }
  }
  if (!paths.some((entry) => entry.startsWith('Markover.app/'))) {
    throw new Error('The release ZIP does not contain Markover.app.')
  }
}

function entitlementKeys(output: string): string[] {
  return [...output.matchAll(/<key>([^<]+)<\/key>/g)]
    .map((match) => match[1] ?? '')
    .filter(Boolean)
    .sort()
}

function assertExactValues(
  actual: readonly string[],
  expected: readonly string[],
  label: string
): void {
  const actualSorted = [...actual].sort()
  const expectedSorted = [...expected].sort()
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    throw new Error(
      `${label} expected [${expectedSorted.join(', ')}], found [${actualSorted.join(', ')}].`
    )
  }
}

async function verifyChecksum(
  archivePath: string,
  checksumPath: string
): Promise<string> {
  const checksum = await fs.readFile(checksumPath, 'utf8')
  const expected = checksum.match(/^[a-f0-9]{64}(?=\s|$)/i)?.[0]
  if (!expected) throw new Error('The release checksum file is invalid.')
  const actual = crypto.createHash('sha256')
    .update(await fs.readFile(archivePath))
    .digest('hex')
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${path.basename(archivePath)}.`)
  }
  return actual
}

function verifySignatureMetadata(
  runner: CommandRunner,
  componentPath: string
): void {
  const display = commandOutput(requireCommand(
    runner,
    '/usr/bin/codesign',
    ['--display', '--verbose=4', componentPath]
  ))
  if (!/^Signature=adhoc$/m.test(display)) {
    throw new Error(`${path.basename(componentPath)} is not ad-hoc signed.`)
  }
  if (!/^TeamIdentifier=not set$/m.test(display)) {
    throw new Error(`${path.basename(componentPath)} has an unexpected Team ID.`)
  }
  if (!/^CodeDirectory .*\bflags=.*\bruntime\b/m.test(display)) {
    throw new Error(
      `${path.basename(componentPath)} does not enable hardened runtime.`
    )
  }
}

function verifyComponent(
  runner: CommandRunner,
  appPath: string,
  architecture: MacosArchitecture,
  component: (typeof signedAppComponents)[number]
): void {
  const componentPath = path.join(appPath, component.relativePath)
  const infoPlist = path.join(componentPath, 'Contents', 'Info.plist')
  if (plistValue(runner, infoPlist, 'CFBundleIdentifier') !== component.bundleId) {
    throw new Error(
      `${path.basename(componentPath)} has an unexpected bundle identifier.`
    )
  }
  const executableName = plistValue(runner, infoPlist, 'CFBundleExecutable')
  const executablePath = path.join(
    componentPath,
    'Contents',
    'MacOS',
    executableName
  )
  const architectures = requireCommand(
    runner,
    '/usr/bin/lipo',
    ['-archs', executablePath]
  ).stdout.trim().split(/\s+/).filter(Boolean)
  assertExactValues(architectures, [architecture], `${executableName} architectures`)
}

function verifySignedPath(
  runner: CommandRunner,
  appPath: string,
  signedPath: string
): void {
  verifySignatureMetadata(runner, signedPath)
  const entitlements = commandOutput(requireCommand(
    runner,
    '/usr/bin/codesign',
    ['--display', '--entitlements', ':-', signedPath]
  ))
  assertExactValues(
    entitlementKeys(entitlements),
    entitlementKeysForSignedFile(appPath, signedPath),
    `${path.basename(signedPath)} entitlements`
  )
}

export async function verifyMacosArtifact({
  architecture,
  archivePath,
  checksumPath,
  commandRunner = runCommand,
  discoverSignedPaths: discoverPaths = discoverSignedPaths,
  platform = process.platform,
  temporaryDirectory = os.tmpdir(),
  trustMode,
  version
}: VerifyMacosArtifactOptions): Promise<MacosArtifactReport> {
  if (platform !== 'darwin') {
    throw new Error('macOS artifact verification requires macOS.')
  }
  if (trustMode !== 'ad-hoc') {
    throw new Error(`Unsupported macOS trust mode: ${trustMode}`)
  }
  const expectedName = expectedArchiveName(architecture)
  if (path.basename(archivePath) !== expectedName) {
    throw new Error(`Expected archive name ${expectedName}.`)
  }
  const sha256 = await verifyChecksum(archivePath, checksumPath)
  const entries = requireCommand(
    commandRunner,
    '/usr/bin/zipinfo',
    ['-1', archivePath]
  ).stdout
  validateArchiveEntries(entries)

  const extractionDirectory = await fs.mkdtemp(
    path.join(temporaryDirectory, 'markover-preflight-')
  )
  try {
    requireCommand(
      commandRunner,
      '/usr/bin/ditto',
      ['-x', '-k', archivePath, extractionDirectory]
    )
    const topLevel = (await fs.readdir(extractionDirectory))
      .filter((entry) => entry !== '__MACOSX')
    assertExactValues(topLevel, ['Markover.app'], 'Release ZIP top-level entries')
    const appPath = path.join(extractionDirectory, 'Markover.app')
    const appInfo = path.join(appPath, 'Contents', 'Info.plist')
    if (plistValue(commandRunner, appInfo, 'CFBundleIdentifier') !== appBundleId) {
      throw new Error('Markover.app has an unexpected bundle identifier.')
    }
    if (
      plistValue(commandRunner, appInfo, 'CFBundleShortVersionString') !== version
    ) {
      throw new Error('Markover.app has an unexpected version.')
    }
    if (
      plistValue(commandRunner, appInfo, 'LSMinimumSystemVersion') !==
      minimumMacosVersion
    ) {
      throw new Error(
        `Markover.app must require macOS ${minimumMacosVersion} or newer.`
      )
    }
    requireCommand(
      commandRunner,
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', appPath]
    )
    for (const component of signedAppComponents) {
      verifyComponent(commandRunner, appPath, architecture, component)
    }
    const signedPaths = new Set(await discoverPaths(appPath))
    signedPaths.add(appPath)
    for (const signedPath of signedPaths) {
      verifySignedPath(commandRunner, appPath, signedPath)
    }
    const gatekeeper = commandRunner(
      '/usr/sbin/spctl',
      ['--assess', '--type', 'execute', '--verbose=4', appPath]
    )
    if (gatekeeper.status === 0) {
      throw new Error(
        'Gatekeeper unexpectedly accepted an ad-hoc signed release artifact.'
      )
    }
    if (!/reject|not accepted|no usable signature/i.test(commandOutput(gatekeeper))) {
      throw new Error('Gatekeeper rejection could not be confirmed.')
    }
  } finally {
    await fs.rm(extractionDirectory, { recursive: true, force: true })
  }

  return {
    architecture,
    gatekeeper: 'rejected-as-expected',
    sha256,
    trustMode,
    version
  }
}

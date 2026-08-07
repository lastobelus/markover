import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

const repository = 'lastobelus/markover'
const appBundleId = 'com.lastobelus.markover'
const minimumMacosVersion = '14.0'
const validationMarkerName = '.markover-verified-v1'

export interface BootstrapCommandResult {
  status: number
  stderr: string
  stdout: string
}

export type BootstrapCommandRunner = (
  command: string,
  args: readonly string[]
) => BootstrapCommandResult

export interface InstalledAppValidation {
  architecture: string
  trustMode: string
  version: string
}

function machOArchitecture(architecture: string): 'arm64' | 'x86_64' {
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`Unsupported macOS architecture: ${architecture}`)
  }
  return architecture === 'x64' ? 'x86_64' : architecture
}

const runCommand: BootstrapCommandRunner = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf8' })
  if (result.error) throw result.error
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr
  }
}

function commandOutput(result: BootstrapCommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim()
}

function requireCommand(
  runner: BootstrapCommandRunner,
  command: string,
  args: readonly string[]
): BootstrapCommandResult {
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
  runner: BootstrapCommandRunner,
  plistPath: string,
  key: string
): string {
  return requireCommand(
    runner,
    '/usr/bin/plutil',
    ['-extract', key, 'raw', '-o', '-', plistPath]
  ).stdout.trim()
}

function verifyMachOArchitecture(
  runner: BootstrapCommandRunner,
  executable: string,
  expectedArchitecture: string
): void {
  const architectures = requireCommand(
    runner,
    '/usr/bin/lipo',
    ['-archs', executable]
  ).stdout.trim().split(/\s+/).filter(Boolean)
  if (
    architectures.length !== 1 ||
    architectures[0] !== expectedArchitecture
  ) {
    throw new Error(
      `The downloaded ${path.basename(executable)} has unexpected architectures: ${architectures.join(', ')}.`
    )
  }
}

function embeddedMachOFiles(
  runner: BootstrapCommandRunner,
  appPath: string,
  mainExecutable: string
): string[] {
  const files = requireCommand(
    runner,
    '/usr/bin/find',
    [appPath, '-type', 'f', '-print0']
  ).stdout.split('\0').filter(Boolean)
  return files.filter((filePath) => {
    if (filePath === mainExecutable) return false
    const mimeType = requireCommand(
      runner,
      '/usr/bin/file',
      ['--brief', '--mime-type', filePath]
    ).stdout.trim()
    return mimeType === 'application/x-mach-binary'
  })
}

function verifyTrustMetadata(
  runner: BootstrapCommandRunner,
  signedPath: string,
  label: string
): void {
  const signature = commandOutput(requireCommand(
    runner,
    '/usr/bin/codesign',
    ['--display', '--verbose=4', signedPath]
  ))
  if (!/^Signature=adhoc$/m.test(signature)) {
    throw new Error(`${label} is not ad-hoc signed as expected.`)
  }
  if (!/^TeamIdentifier=not set$/m.test(signature)) {
    throw new Error(`${label} has an unexpected Team ID.`)
  }
  if (!/^CodeDirectory .*\bflags=.*\bruntime\b/m.test(signature)) {
    throw new Error(`${label} does not enable hardened runtime.`)
  }
}

export function validateMacosApp(
  appPath: string,
  { architecture, trustMode, version }: InstalledAppValidation,
  runner: BootstrapCommandRunner = runCommand
): void {
  const expectedArchitecture = machOArchitecture(architecture)
  if (trustMode !== 'ad-hoc') {
    throw new Error(`Unsupported macOS trust mode: ${trustMode}`)
  }
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist')
  if (plistValue(runner, infoPlist, 'CFBundleIdentifier') !== appBundleId) {
    throw new Error('The downloaded app has an unexpected bundle identifier.')
  }
  if (
    plistValue(runner, infoPlist, 'CFBundleShortVersionString') !== version
  ) {
    throw new Error('The downloaded app has an unexpected version.')
  }
  if (
    plistValue(runner, infoPlist, 'LSMinimumSystemVersion') !==
    minimumMacosVersion
  ) {
    throw new Error(
      `The downloaded app must require macOS ${minimumMacosVersion} or newer.`
    )
  }
  const executable = path.join(appPath, 'Contents', 'MacOS', 'Markover')
  verifyMachOArchitecture(runner, executable, expectedArchitecture)
  const embeddedExecutables = embeddedMachOFiles(
    runner,
    appPath,
    executable
  )
  for (const embeddedExecutable of embeddedExecutables) {
    verifyMachOArchitecture(
      runner,
      embeddedExecutable,
      expectedArchitecture
    )
  }
  requireCommand(
    runner,
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath]
  )
  verifyTrustMetadata(runner, appPath, 'The downloaded app')
  for (const embeddedExecutable of embeddedExecutables) {
    verifyTrustMetadata(
      runner,
      embeddedExecutable,
      `The downloaded ${path.basename(embeddedExecutable)}`
    )
  }
}

export function releaseAssetName(architecture: string): string {
  if (architecture !== 'arm64') {
    throw new Error(
      `Markover releases currently support Apple Silicon only; unsupported macOS architecture: ${architecture}`
    )
  }
  return 'Markover-darwin-arm64.zip'
}

export function download(
  url: string | URL,
  destination: string,
  redirects = 5,
  timeoutMilliseconds = 30000
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const transport = new URL(url).protocol === 'http:' ? http : https
    const request = transport.get(url, {
      headers: { 'user-agent': 'markover-bootstrap' }
    }, (response) => {
      const statusCode = response.statusCode
      if (
        statusCode !== undefined &&
        statusCode >= 300 &&
        statusCode < 400 &&
        response.headers.location
      ) {
        response.resume()
        if (!redirects) {
          reject(new Error(`Too many redirects downloading ${url}`))
          return
        }
        resolve(download(
          new URL(response.headers.location, url),
          destination,
          redirects - 1,
          timeoutMilliseconds
        ))
        return
      }
      if (statusCode !== 200) {
        response.resume()
        reject(new Error(`Download failed (${String(statusCode)}): ${String(url)}`))
        return
      }
      response.setTimeout(timeoutMilliseconds, () => {
        response.destroy(new Error(`Download timed out: ${url}`))
      })
      const output = fsSync.createWriteStream(destination, { flags: 'wx' })
      pipeline(response, output).then(resolve, reject)
    })
    request.setTimeout(timeoutMilliseconds, () => {
      request.destroy(new Error(`Download timed out: ${url}`))
    })
    request.on('error', reject)
  })
}

function extract(archivePath: string, destination: string): Promise<void> {
  return Promise.resolve().then(() => {
    const result = spawnSync(
      '/usr/bin/ditto',
      ['-x', '-k', archivePath, destination],
      { encoding: 'utf8' }
    )
    if (result.status !== 0) {
      throw new Error(
        result.stderr.trim() || `ditto exited ${String(result.status)}`
      )
    }
  })
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object'
    ? Reflect.get(error, 'code')
    : null
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

function validationMarker(
  architecture: string,
  version: string
): string {
  return [
    'markover-cache-validation-v1',
    `version=${version}`,
    `architecture=${architecture}`,
    'trust-mode=ad-hoc',
    ''
  ].join('\n')
}

async function isValidatedInstall(
  executable: string,
  markerPath: string,
  expectedMarker: string
): Promise<boolean> {
  if (!await exists(executable)) return false
  try {
    return await fs.readFile(markerPath, 'utf8') === expectedMarker
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

export interface EnsureInstalledAppOptions {
  architecture?: string
  cacheDirectory?: string
  downloadFile?: typeof download
  extractArchive?: (archivePath: string, destination: string) => Promise<void>
  platform?: NodeJS.Platform
  progress?: (message: string) => void
  releaseBaseUrl?: string
  validateApp?: (
    appPath: string,
    expected: InstalledAppValidation
  ) => Promise<void> | void
  version?: string
}

export async function ensureInstalledApp({
  architecture = process.arch,
  cacheDirectory = process.env.MARKOVER_CACHE_DIRECTORY ||
    path.join(os.homedir(), 'Library', 'Caches', 'Markover'),
  downloadFile = download,
  extractArchive = extract,
  platform = process.platform,
  progress = (message) => process.stderr.write(`${message}\n`),
  releaseBaseUrl = process.env.MARKOVER_RELEASE_BASE_URL,
  validateApp = validateMacosApp,
  version
}: EnsureInstalledAppOptions = {}): Promise<string> {
  if (platform !== 'darwin') {
    throw new Error('Markover currently supports macOS only.')
  }
  if (!version) throw new Error('The Markover bootstrap version is missing.')

  const assetName = releaseAssetName(architecture)
  const installDirectory = path.join(cacheDirectory, `v${version}`, architecture)
  const appPath = path.join(installDirectory, 'Markover.app')
  const executable = path.join(appPath, 'Contents', 'MacOS', 'Markover')
  const markerPath = path.join(installDirectory, validationMarkerName)
  const expectedMarker = validationMarker(architecture, version)
  if (await exists(executable)) {
    if (await isValidatedInstall(executable, markerPath, expectedMarker)) {
      return appPath
    }
    throw new Error(
      'The cached Markover app is missing its validation marker; remove that cached version and retry.'
    )
  }

  const baseUrl = releaseBaseUrl ||
    `https://github.com/${repository}/releases/download/v${version}`
  await fs.mkdir(cacheDirectory, { recursive: true })
  const staging = await fs.mkdtemp(path.join(cacheDirectory, '.install-'))
  try {
    progress(`Downloading Markover v${version} for ${architecture}…`)
    const archivePath = path.join(staging, assetName)
    const checksumPath = `${archivePath}.sha256`
    await downloadFile(`${baseUrl}/${assetName}`, archivePath)
    await downloadFile(`${baseUrl}/${assetName}.sha256`, checksumPath)
    const expected = (await fs.readFile(checksumPath, 'utf8')).match(/^[a-f0-9]{64}/i)?.[0]
    if (!expected) throw new Error('The release checksum file is invalid.')
    const actual = crypto.createHash('sha256')
      .update(await fs.readFile(archivePath))
      .digest('hex')
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Checksum mismatch for ${assetName}.`)
    }

    const extracted = path.join(staging, 'extracted')
    await fs.mkdir(extracted)
    await extractArchive(archivePath, extracted)
    const stagedApp = path.join(extracted, 'Markover.app')
    if (!await exists(path.join(stagedApp, 'Contents', 'MacOS', 'Markover'))) {
      throw new Error(`${assetName} does not contain Markover.app.`)
    }
    await validateApp(stagedApp, {
      architecture,
      trustMode: 'ad-hoc',
      version
    })
    await fs.writeFile(
      path.join(extracted, validationMarkerName),
      expectedMarker,
      { flag: 'wx' }
    )
    await fs.mkdir(path.dirname(installDirectory), { recursive: true })
    try {
      await fs.rename(extracted, installDirectory)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST' && errorCode(error) !== 'ENOTEMPTY') {
        throw error
      }
    }
    if (!await isValidatedInstall(executable, markerPath, expectedMarker)) {
      throw new Error('Markover could not be installed in the local cache.')
    }
    progress(
      'Warning: Markover is not Apple-verified. If macOS blocks it, use the safe per-app opening steps at https://github.com/lastobelus/markover#opening-markover-on-macos'
    )
    return appPath
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

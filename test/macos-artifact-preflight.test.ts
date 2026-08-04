import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  validateArchiveEntries,
  verifyMacosArtifact,
  type CommandResult,
  type CommandRunner
} from '../scripts/macos-artifact-preflight'
import {
  appBundleId,
  helperBundleId,
  signedAppComponents
} from '../scripts/macos-release-contract'

interface FakeRunnerOptions {
  architecture?: string
  entitlementDrift?: boolean
  failCommand?: string
  frameworkEntitlementDrift?: boolean
  gatekeeperAccepted?: boolean
  mainBundleId?: string
  signature?: string
}

interface Fixture {
  archivePath: string
  checksumPath: string
  directory: string
}

async function createFixture(
  architecture: 'arm64' | 'x64' = 'arm64'
): Promise<Fixture> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-artifact-'))
  const archiveName = `Markover-darwin-${architecture}.zip`
  const archivePath = path.join(directory, archiveName)
  const archive = Buffer.from('fake release ZIP')
  await fs.writeFile(archivePath, archive)
  const checksum = crypto.createHash('sha256').update(archive).digest('hex')
  const checksumPath = `${archivePath}.sha256`
  await fs.writeFile(checksumPath, `${checksum}  ${archiveName}\n`)
  return { archivePath, checksumPath, directory }
}

function success(stdout = '', stderr = ''): CommandResult {
  return { status: 0, stdout, stderr }
}

function componentName(plistPath: string): string {
  const matches = [...plistPath.matchAll(/(Markover(?: Helper(?: \([^)]+\))?)?\.app)\/Contents/g)]
  return matches.at(-1)?.[1] ?? 'Markover.app'
}

function bundleIdForComponent(name: string, mainBundleId: string): string {
  if (name === 'Markover.app') return mainBundleId
  if (name === 'Markover Helper.app') return helperBundleId
  return helperBundleId
}

function createExtractedApp(extractionDirectory: string): void {
  for (const component of signedAppComponents) {
    const componentPath = path.join(
      extractionDirectory,
      'Markover.app',
      component.relativePath
    )
    const executableName = path.basename(componentPath, '.app')
    const executable = path.join(
      componentPath,
      'Contents',
      'MacOS',
      executableName
    )
    fsSync.mkdirSync(path.dirname(executable), { recursive: true })
    fsSync.writeFileSync(executable, 'fake executable')
    fsSync.writeFileSync(
      path.join(componentPath, 'Contents', 'Info.plist'),
      'fake plist'
    )
  }
}

function fakeSignedPaths(appPath: string): Promise<string[]> {
  return Promise.resolve([
    ...signedAppComponents
      .filter((component) => component.relativePath !== '')
      .map((component) => path.join(appPath, component.relativePath)),
    path.join(appPath, 'Contents', 'MacOS', 'Markover'),
    path.join(
      appPath,
      'Contents',
      'Frameworks',
      'Electron Framework.framework'
    )
  ])
}

function fakeRunner(
  options: FakeRunnerOptions = {},
  onExtract?: (directory: string) => void
): CommandRunner {
  const {
    architecture = 'arm64',
    entitlementDrift = false,
    failCommand,
    frameworkEntitlementDrift = false,
    gatekeeperAccepted = false,
    mainBundleId = appBundleId,
    signature = 'CodeDirectory v=20500 flags=0x10002(adhoc,runtime)\nSignature=adhoc\nTeamIdentifier=not set'
  } = options
  return (command, args) => {
    if (path.basename(command) === failCommand) {
      return { status: 2, stdout: '', stderr: `${failCommand} failed` }
    }
    if (command === '/usr/bin/zipinfo') {
      return success('Markover.app/Contents/MacOS/Markover\n')
    }
    if (command === '/usr/bin/ditto') {
      const extractionDirectory = args.at(-1) ?? ''
      createExtractedApp(extractionDirectory)
      onExtract?.(extractionDirectory)
      return success()
    }
    if (command === '/usr/bin/plutil') {
      const key = args[1]
      const plistPath = args.at(-1) ?? ''
      const name = componentName(plistPath)
      if (key === 'CFBundleIdentifier') {
        return success(`${bundleIdForComponent(name, mainBundleId)}\n`)
      }
      if (key === 'CFBundleExecutable') {
        return success(`${path.basename(name, '.app')}\n`)
      }
      if (key === 'CFBundleShortVersionString') return success('1.2.3\n')
      if (key === 'LSMinimumSystemVersion') return success('14.0\n')
    }
    if (command === '/usr/bin/lipo') return success(`${architecture}\n`)
    if (command === '/usr/bin/codesign') {
      if (args.includes('--entitlements')) {
        const componentPath = args.at(-1) ?? ''
        const plugin = componentPath.includes('(Plugin).app')
        const appOrHelper = componentPath.endsWith('Markover.app') ||
          componentPath.endsWith('/Contents/MacOS/Markover') ||
          componentPath.includes('Markover Helper')
        const keys = appOrHelper && !plugin
          ? ['com.apple.security.cs.allow-jit']
          : []
        if (entitlementDrift && componentPath.endsWith('Markover.app')) {
          keys.push('com.apple.security.device.camera')
        }
        if (
          frameworkEntitlementDrift &&
          componentPath.endsWith('Electron Framework.framework')
        ) {
          keys.push('com.apple.security.cs.disable-library-validation')
        }
        return success(
          `<?xml version="1.0"?><plist><dict>${keys.map((key) => `<key>${key}</key><true/>`).join('')}</dict></plist>`
        )
      }
      if (args.includes('--display')) return success('', signature)
      return success()
    }
    if (command === '/usr/sbin/spctl') {
      return gatekeeperAccepted
        ? success('accepted')
        : { status: 3, stdout: '', stderr: 'rejected (the code is valid but does not seem to be an app)' }
    }
    return { status: 127, stdout: '', stderr: `unexpected command: ${command}` }
  }
}

test('verifies the exact hardened ad-hoc final ZIP', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }))

  const report = await verifyMacosArtifact({
    architecture: 'arm64',
    archivePath: fixture.archivePath,
    checksumPath: fixture.checksumPath,
    commandRunner: fakeRunner(),
    discoverSignedPaths: fakeSignedPaths,
    platform: 'darwin',
    temporaryDirectory: fixture.directory,
    trustMode: 'ad-hoc',
    version: '1.2.3'
  })

  assert.equal(report.architecture, 'arm64')
  assert.equal(report.gatekeeper, 'rejected-as-expected')
  assert.match(report.sha256, /^[a-f0-9]{64}$/)
})

test('maps the x64 release name to the x86_64 Mach-O architecture', async (t) => {
  const fixture = await createFixture('x64')
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }))

  const report = await verifyMacosArtifact({
    architecture: 'x64',
    archivePath: fixture.archivePath,
    checksumPath: fixture.checksumPath,
    commandRunner: fakeRunner({ architecture: 'x86_64' }),
    discoverSignedPaths: fakeSignedPaths,
    platform: 'darwin',
    temporaryDirectory: fixture.directory,
    trustMode: 'ad-hoc',
    version: '1.2.3'
  })

  assert.equal(report.architecture, 'x64')
})

test('rejects unsafe ZIP paths before extraction', () => {
  assert.throws(
    () => {
      validateArchiveEntries('../Markover.app/Contents/MacOS/Markover\n')
    },
    /unsafe path/
  )
  assert.throws(
    () => {
      validateArchiveEntries('/Markover.app/Contents/MacOS/Markover\n')
    },
    /unsafe path/
  )
  assert.throws(
    () => {
      validateArchiveEntries('readme.txt\n')
    },
    /does not contain/
  )
})

test('rejects checksum, bundle metadata, and architecture mismatches', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }))
  await fs.writeFile(fixture.checksumPath, `${'0'.repeat(64)}\n`)
  await assert.rejects(
    verifyMacosArtifact({
      architecture: 'arm64',
      archivePath: fixture.archivePath,
      checksumPath: fixture.checksumPath,
      commandRunner: fakeRunner(),
      discoverSignedPaths: fakeSignedPaths,
      platform: 'darwin',
      temporaryDirectory: fixture.directory,
      trustMode: 'ad-hoc',
      version: '1.2.3'
    }),
    /Checksum mismatch/
  )

  const archive = await fs.readFile(fixture.archivePath)
  const checksum = crypto.createHash('sha256').update(archive).digest('hex')
  await fs.writeFile(fixture.checksumPath, `${checksum}\n`)
  await assert.rejects(
    verifyMacosArtifact({
      architecture: 'arm64',
      archivePath: fixture.archivePath,
      checksumPath: fixture.checksumPath,
      commandRunner: fakeRunner({ mainBundleId: 'example.invalid' }),
      discoverSignedPaths: fakeSignedPaths,
      platform: 'darwin',
      temporaryDirectory: fixture.directory,
      trustMode: 'ad-hoc',
      version: '1.2.3'
    }),
    /unexpected bundle identifier/
  )
  await assert.rejects(
    verifyMacosArtifact({
      architecture: 'arm64',
      archivePath: fixture.archivePath,
      checksumPath: fixture.checksumPath,
      commandRunner: fakeRunner({ architecture: 'x64' }),
      discoverSignedPaths: fakeSignedPaths,
      platform: 'darwin',
      temporaryDirectory: fixture.directory,
      trustMode: 'ad-hoc',
      version: '1.2.3'
    }),
    /architectures expected/
  )
})

test('rejects entitlement drift and unexpected signature modes', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }))
  const base = {
    architecture: 'arm64' as const,
    archivePath: fixture.archivePath,
    checksumPath: fixture.checksumPath,
    discoverSignedPaths: fakeSignedPaths,
    platform: 'darwin' as const,
    temporaryDirectory: fixture.directory,
    trustMode: 'ad-hoc' as const,
    version: '1.2.3'
  }
  await assert.rejects(
    verifyMacosArtifact({
      ...base,
      commandRunner: fakeRunner({ entitlementDrift: true })
    }),
    /entitlements expected/
  )
  await assert.rejects(
    verifyMacosArtifact({
      ...base,
      commandRunner: fakeRunner({ frameworkEntitlementDrift: true })
    }),
    /Electron Framework\.framework entitlements expected/
  )
  await assert.rejects(
    verifyMacosArtifact({
      ...base,
      commandRunner: fakeRunner({
        signature: 'CodeDirectory v=20500 flags=0x2(adhoc)\nSignature=adhoc\nTeamIdentifier=not set'
      })
    }),
    /does not enable hardened runtime/
  )
  await assert.rejects(
    verifyMacosArtifact({
      ...base,
      commandRunner: fakeRunner({
        signature: 'CodeDirectory v=20500 flags=0x10000(runtime)\nAuthority=Developer ID Application: Example\nTeamIdentifier=TEAM'
      })
    }),
    /not ad-hoc signed/
  )
})

test('requires an observable Gatekeeper rejection in ad-hoc mode', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }))
  await assert.rejects(
    verifyMacosArtifact({
      architecture: 'arm64',
      archivePath: fixture.archivePath,
      checksumPath: fixture.checksumPath,
      commandRunner: fakeRunner({ gatekeeperAccepted: true }),
      discoverSignedPaths: fakeSignedPaths,
      platform: 'darwin',
      temporaryDirectory: fixture.directory,
      trustMode: 'ad-hoc',
      version: '1.2.3'
    }),
    /unexpectedly accepted/
  )
})

test('command failures clean extracted staging data', async (t) => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }))
  let extractionDirectory = ''
  await assert.rejects(
    verifyMacosArtifact({
      architecture: 'arm64',
      archivePath: fixture.archivePath,
      checksumPath: fixture.checksumPath,
      commandRunner: fakeRunner(
        { failCommand: 'plutil' },
        (directory) => { extractionDirectory = directory }
      ),
      discoverSignedPaths: fakeSignedPaths,
      platform: 'darwin',
      temporaryDirectory: fixture.directory,
      trustMode: 'ad-hoc',
      version: '1.2.3'
    }),
    /plutil failed/
  )
  assert.ok(extractionDirectory)
  assert.equal(fsSync.existsSync(extractionDirectory), false)
})

test('release preflight uses one command with strict subcommands and clean output', () => {
  const script = path.join(__dirname, '../scripts/release-preflight.js')
  const missing = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.equal(missing.stdout, '')
  assert.match(missing.stderr, /A preflight subcommand is required/)

  const unknown = spawnSync(process.execPath, [script, 'wat'], {
    encoding: 'utf8'
  })
  assert.equal(unknown.status, 1)
  assert.equal(unknown.stdout, '')
  assert.match(unknown.stderr, /Unknown preflight subcommand: wat/)
})

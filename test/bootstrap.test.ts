import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  download,
  ensureInstalledApp,
  releaseAssetName,
  validateMacosApp,
  type BootstrapCommandRunner,
  type EnsureInstalledAppOptions
} from '../packages/cli/src/bootstrap'
import { main as publicCliMain } from '../packages/cli/src/index'
import { main as buildCli } from '../scripts/build-cli'

test('release assets are architecture-specific', () => {
  assert.equal(releaseAssetName('arm64'), 'Markover-darwin-arm64.zip')
  assert.equal(releaseAssetName('x64'), 'Markover-darwin-x64.zip')
  assert.throws(() => releaseAssetName('ia32'), /Unsupported macOS architecture/)
})

test('Intel bootstrap selects the native x64 release asset', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-bootstrap-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const downloads: string[] = []
  await assert.rejects(
    ensureInstalledApp({
      architecture: 'x64',
      cacheDirectory: directory,
      platform: 'darwin',
      version: '1.2.3',
      downloadFile(url) {
        downloads.push(String(url))
        return Promise.reject(new Error('stop after asset selection'))
      }
    }),
    /stop after asset selection/
  )
  assert.deepEqual(downloads, [
    'https://github.com/lastobelus/markover/releases/download/v1.2.3/Markover-darwin-x64.zip'
  ])
  assert.deepEqual(
    (await fs.readdir(directory)).filter((entry) => entry.startsWith('.install-')),
    []
  )
})

test('configured remote author commands bypass app bootstrap on Intel', async () => {
  let bootstrapCalls = 0
  const commands: string[][] = []
  await publicCliMain(['get', 'mko_aaa11111'], {
    ensureApp() {
      bootstrapCalls += 1
      return Promise.resolve('/Applications/Markover.app')
    },
    loadProfile() {
      return Promise.resolve({ baseUrl: 'https://canonical.example.ts.net/' })
    },
    run(args) {
      commands.push(args || [])
      return Promise.resolve()
    }
  })
  assert.equal(bootstrapCalls, 0)
  assert.deepEqual(commands[0], ['get', 'mko_aaa11111'])
})

test('invalid syntax is reported before bootstrap starts', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, '../packages/cli/src/index.js'), 'wat'],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Unknown command: wat/)
  assert.match(
    result.stderr,
    /npx --yes --package=https:\/\/github\.com\/lastobelus\/markover\/releases\/latest\/download\/markover-cli\.tgz markover help/
  )
  assert.doesNotMatch(result.stderr, /Downloading Markover|supports macOS only/)
})

test('bundled public CLI preserves exact command output', async () => {
  await buildCli()
  const sourceCli = path.join(__dirname, '../packages/cli/src/index.js')
  const bundledCli = path.resolve(
    __dirname,
    '../../packages/cli/bin/markover.js'
  )

  for (const args of [['help'], ['wat']]) {
    const expected = spawnSync(process.execPath, [sourceCli, ...args], {
      encoding: 'utf8'
    })
    const actual = spawnSync(process.execPath, [bundledCli, ...args], {
      encoding: 'utf8'
    })
    assert.equal(actual.status, expected.status)
    assert.equal(actual.stdout, expected.stdout)
    assert.equal(actual.stderr, expected.stderr)
  }
})

test('downloads, verifies, and atomically caches Markover.app', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-bootstrap-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const archive = Buffer.from('fake Markover archive')
  const checksum = crypto.createHash('sha256').update(archive).digest('hex')
  const downloads: string[] = []
  const progress: string[] = []
  const validations: Array<{ appPath: string, architecture: string, version: string }> = []

  const options: EnsureInstalledAppOptions = {
    architecture: 'arm64',
    cacheDirectory: directory,
    platform: 'darwin',
    progress(message) { progress.push(message) },
    releaseBaseUrl: 'https://releases.example/v1.2.3',
    version: '1.2.3',
    async downloadFile(url: string | URL, destination: string) {
      const sourceUrl = String(url)
      downloads.push(sourceUrl)
      await fs.writeFile(
        destination,
        sourceUrl.endsWith('.sha256') ? `${checksum}  archive.zip\n` : archive
      )
    },
    async extractArchive(_archivePath: string, destination: string) {
      const executable = path.join(
        destination,
        'Markover.app',
        'Contents',
        'MacOS',
        'Markover'
      )
      await fs.mkdir(path.dirname(executable), { recursive: true })
      await fs.writeFile(executable, 'app')
    },
    validateApp(appPath, expected) {
      validations.push({
        appPath,
        architecture: expected.architecture,
        version: expected.version
      })
    }
  }

  const appPath = await ensureInstalledApp(options)
  assert.equal(
    appPath,
    path.join(directory, 'v1.2.3', 'arm64', 'Markover.app')
  )
  assert.deepEqual(downloads, [
    'https://releases.example/v1.2.3/Markover-darwin-arm64.zip',
    'https://releases.example/v1.2.3/Markover-darwin-arm64.zip.sha256'
  ])
  assert.equal(validations.length, 1)
  const validation = validations[0]
  assert.ok(validation)
  assert.equal(validation.architecture, 'arm64')
  assert.equal(validation.version, '1.2.3')
  assert.match(progress.at(-1) ?? '', /not Apple-verified/)
  assert.match(progress.at(-1) ?? '', /opening-markover-on-macos/)
  downloads.length = 0
  const progressCount = progress.length
  assert.equal(await ensureInstalledApp(options), appPath)
  assert.deepEqual(downloads, [])
  assert.equal(progress.length, progressCount)
})

function validationRunner(overrides: {
  architecture?: string
  bundleId?: string
  embeddedArchitecture?: string
  embeddedSignature?: string
  signature?: string
  version?: string
  minimumVersion?: string
  failCodesign?: boolean
} = {}): BootstrapCommandRunner {
  return (command, args) => {
    if (command === '/usr/bin/plutil') {
      const values: Record<string, string> = {
        CFBundleIdentifier: overrides.bundleId ?? 'com.lastobelus.markover',
        CFBundleShortVersionString: overrides.version ?? '1.2.3',
        LSMinimumSystemVersion: overrides.minimumVersion ?? '14.0'
      }
      const value = values[args[1] ?? '']
      return value === undefined
        ? { status: 1, stdout: '', stderr: 'unknown plist key' }
        : { status: 0, stdout: `${value}\n`, stderr: '' }
    }
    if (command === '/usr/bin/lipo') {
      const executable = args.at(-1) ?? ''
      return {
        status: 0,
        stdout: `${executable.endsWith('Electron Framework') ? overrides.embeddedArchitecture ?? overrides.architecture ?? 'arm64' : overrides.architecture ?? 'arm64'}\n`,
        stderr: ''
      }
    }
    if (command === '/usr/bin/find') {
      return {
        status: 0,
        stdout: [
          '/staging/Markover.app/Contents/MacOS/Markover',
          '/staging/Markover.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
          '/staging/Markover.app/Contents/Resources/app.asar',
          ''
        ].join('\0'),
        stderr: ''
      }
    }
    if (command === '/usr/bin/file') {
      return {
        status: 0,
        stdout: (args.at(-1) ?? '').endsWith('Electron Framework')
          ? 'application/x-mach-binary\n'
          : 'application/octet-stream\n',
        stderr: ''
      }
    }
    if (command === '/usr/bin/codesign' && args.includes('--verify')) {
      return overrides.failCodesign
        ? { status: 1, stdout: '', stderr: 'invalid code seal' }
        : { status: 0, stdout: '', stderr: '' }
    }
    if (command === '/usr/bin/codesign') {
      const signedPath = args.at(-1) ?? ''
      return {
        status: 0,
        stdout: '',
        stderr: signedPath.endsWith('Electron Framework')
          ? overrides.embeddedSignature ?? overrides.signature ??
            'CodeDirectory v=20500 flags=0x10002(adhoc,runtime)\nSignature=adhoc\nTeamIdentifier=not set'
          : overrides.signature ??
          'CodeDirectory v=20500 flags=0x10002(adhoc,runtime)\nSignature=adhoc\nTeamIdentifier=not set'
      }
    }
    return { status: 127, stdout: '', stderr: 'unexpected command' }
  }
}

test('bootstrap validation enforces metadata, architecture, seal, and trust mode', () => {
  const appPath = '/staging/Markover.app'
  const expected = {
    architecture: 'arm64',
    trustMode: 'ad-hoc' as const,
    version: '1.2.3'
  }
  validateMacosApp(appPath, expected, validationRunner())
  validateMacosApp(
    appPath,
    { ...expected, architecture: 'x64' },
    validationRunner({ architecture: 'x86_64' })
  )
  assert.throws(
    () => {
      validateMacosApp(
        appPath,
        expected,
        validationRunner({ bundleId: 'example.invalid' })
      )
    },
    /unexpected bundle identifier/
  )
  assert.throws(
    () => {
      validateMacosApp(
        appPath,
        expected,
        validationRunner({ architecture: 'x64' })
      )
    },
    /unexpected architectures/
  )
  assert.throws(
    () => {
      validateMacosApp(
        appPath,
        expected,
        validationRunner({ embeddedArchitecture: 'x86_64' })
      )
    },
    /Electron Framework has unexpected architectures/
  )
  assert.throws(
    () => {
      validateMacosApp(
        appPath,
        expected,
        validationRunner({
          embeddedSignature: 'CodeDirectory v=20500 flags=0x2(adhoc)\nSignature=adhoc\nTeamIdentifier=not set'
        })
      )
    },
    /downloaded Electron Framework does not enable hardened runtime/
  )
  assert.throws(
    () => {
      validateMacosApp(
        appPath,
        expected,
        validationRunner({ failCodesign: true })
      )
    },
    /invalid code seal/
  )
  assert.throws(
    () => {
      validateMacosApp(
        appPath,
        expected,
        validationRunner({
          signature: 'CodeDirectory v=20500 flags=0x10000(runtime)\nAuthority=Developer ID Application: Example\nTeamIdentifier=TEAM'
        })
      )
    },
    /not ad-hoc signed/
  )
  assert.throws(
    () => {
      validateMacosApp(
        appPath,
        expected,
        validationRunner({
          signature: 'CodeDirectory v=20500 flags=0x2(adhoc)\nSignature=adhoc\nTeamIdentifier=not set'
        })
      )
    },
    /does not enable hardened runtime/
  )
})

test('failed staged-app validation leaves no cache or staging install', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-bootstrap-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const archive = Buffer.from('fake Markover archive')
  const checksum = crypto.createHash('sha256').update(archive).digest('hex')

  await assert.rejects(
    ensureInstalledApp({
      architecture: 'arm64',
      cacheDirectory: directory,
      platform: 'darwin',
      progress() {},
      version: '1.2.3',
      async downloadFile(url: string | URL, destination: string) {
        await fs.writeFile(
          destination,
          String(url).endsWith('.sha256') ? `${checksum}\n` : archive
        )
      },
      async extractArchive(_archivePath: string, destination: string) {
        const executable = path.join(
          destination,
          'Markover.app',
          'Contents',
          'MacOS',
          'Markover'
        )
        await fs.mkdir(path.dirname(executable), { recursive: true })
        await fs.writeFile(executable, 'app')
      },
      validateApp() {
        throw new Error('unexpected signature mode')
      }
    }),
    /unexpected signature mode/
  )
  assert.deepEqual(await fs.readdir(directory), [])
})

test('an unmarked cached executable cannot bypass first-install validation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-bootstrap-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const executable = path.join(
    directory,
    'v1.2.3',
    'arm64',
    'Markover.app',
    'Contents',
    'MacOS',
    'Markover'
  )
  await fs.mkdir(path.dirname(executable), { recursive: true })
  await fs.writeFile(executable, 'unvalidated app')
  let downloaded = false

  await assert.rejects(
    ensureInstalledApp({
      architecture: 'arm64',
      cacheDirectory: directory,
      platform: 'darwin',
      progress() {},
      version: '1.2.3',
      downloadFile() {
        downloaded = true
        return Promise.resolve()
      }
    }),
    /missing its validation marker/
  )
  assert.equal(downloaded, false)
})

test('rejects a release whose checksum does not match', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-bootstrap-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await assert.rejects(
    ensureInstalledApp({
      architecture: 'arm64',
      cacheDirectory: directory,
      platform: 'darwin',
      progress() {},
      validateApp() {},
      version: '1.2.3',
      async downloadFile(url: string | URL, destination: string) {
        await fs.writeFile(destination, String(url).endsWith('.sha256')
          ? `${'0'.repeat(64)}\n`
          : 'different')
      }
    }),
    /Checksum mismatch/
  )
})

test('a stalled download fails within its timeout', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-download-'))
  const destination = path.join(directory, 'partial.zip')
  const server = http.createServer((_request, response) => {
    response.writeHead(200)
    response.write('partial')
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  })

  await assert.rejects(
    download(
      `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/archive.zip`,
      destination,
      0,
      30
    ),
    /timed out/
  )
})

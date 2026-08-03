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
  type EnsureInstalledAppOptions
} from '../packages/cli/src/bootstrap'
import { main as buildCli } from '../scripts/build-cli'

test('release assets are architecture-specific', () => {
  assert.equal(releaseAssetName('arm64'), 'Markover-darwin-arm64.zip')
  assert.equal(releaseAssetName('x64'), 'Markover-darwin-x64.zip')
  assert.throws(() => releaseAssetName('ia32'), /Unsupported macOS architecture/)
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

  const options: EnsureInstalledAppOptions = {
    architecture: 'arm64',
    cacheDirectory: directory,
    platform: 'darwin',
    progress() {},
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
  downloads.length = 0
  assert.equal(await ensureInstalledApp(options), appPath)
  assert.deepEqual(downloads, [])
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

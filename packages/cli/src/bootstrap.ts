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

export function releaseAssetName(architecture: string): string {
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`Unsupported macOS architecture: ${architecture}`)
  }
  return `Markover-darwin-${architecture}.zip`
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

export interface EnsureInstalledAppOptions {
  architecture?: string
  cacheDirectory?: string
  downloadFile?: typeof download
  extractArchive?: (archivePath: string, destination: string) => Promise<void>
  platform?: NodeJS.Platform
  progress?: (message: string) => void
  releaseBaseUrl?: string
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
  if (await exists(executable)) return appPath

  const baseUrl = releaseBaseUrl ||
    `https://github.com/${repository}/releases/download/v${version}`
  await fs.mkdir(path.dirname(installDirectory), { recursive: true })
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
    await fs.mkdir(path.dirname(installDirectory), { recursive: true })
    try {
      await fs.rename(extracted, installDirectory)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST' && errorCode(error) !== 'ENOTEMPTY') {
        throw error
      }
    }
    if (!await exists(executable)) {
      throw new Error('Markover could not be installed in the local cache.')
    }
    return appPath
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  buildMacosIcon,
  type IconCommandRunner
} from './build-macos-icon'
import { developmentGeneratedRoot } from '../src/instance'

const GENERATOR_VERSION = 1

export interface DevelopmentIconPaths {
  directory: string
  manifest: string
  svg: string
  png: string
  icns: string
}

export interface GenerateDevelopmentIconOptions {
  checkout: string
  pullRequestNumber: number
  platform?: NodeJS.Platform
  runCommand?: IconCommandRunner
  sourceSvgPath?: string
}

export interface GeneratedDevelopmentIcon {
  cached: boolean
  paths: DevelopmentIconPaths
}

function commandRunner(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
      `${path.basename(command)} exited ${String(result.status ?? 1)}`
    )
  }
}

function positivePullRequestNumber(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Development icon generation requires a pull-request number.')
  }
}

export function developmentIconPaths(
  checkout: string,
  pullRequestNumber: number
): DevelopmentIconPaths {
  positivePullRequestNumber(pullRequestNumber)
  const directory = path.join(
    developmentGeneratedRoot(checkout),
    `pr-${String(pullRequestNumber)}`
  )
  return {
    directory,
    manifest: path.join(directory, 'manifest.json'),
    svg: path.join(directory, 'markover-app-icon.svg'),
    png: path.join(directory, 'markover-app-icon.png'),
    icns: path.join(directory, 'markover-app-icon.icns')
  }
}

export function watermarkedIconSvg(
  source: string,
  pullRequestNumber: number
): string {
  positivePullRequestNumber(pullRequestNumber)
  const closingTag = source.lastIndexOf('</svg>')
  if (closingTag === -1) throw new Error('The Markover icon SVG is invalid.')
  const label = String(pullRequestNumber)
  const width = Math.max(260, 110 + label.length * 92)
  const x = 914 - width
  const fontSize = label.length < 4 ? 150 : 124
  const badge = [
    `  <g id="markover-development-watermark" aria-label="Pull request ${label}">`,
    `    <rect x="${String(x)}" y="680" width="${String(width)}" height="210" rx="72" fill="#075b7a" stroke="#fffaf4" stroke-width="18"/>`,
    `    <text x="${String(x + width / 2)}" y="790" text-anchor="middle" dominant-baseline="middle" fill="#fffaf4" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="${String(fontSize)}" font-weight="800">${label}</text>`,
    '  </g>',
    ''
  ].join('\n')
  return `${source.slice(0, closingTag)}${badge}${source.slice(closingTag)}`
}

function fingerprint(source: string, pullRequestNumber: number): string {
  return createHash('sha256').update([
    `markover-development-icon-v${String(GENERATOR_VERSION)}`,
    String(pullRequestNumber),
    source
  ].join('\n')).digest('hex')
}

async function cacheMatches(
  paths: DevelopmentIconPaths,
  expectedFingerprint: string
): Promise<boolean> {
  try {
    const manifest: unknown = JSON.parse(await fs.readFile(paths.manifest, 'utf8'))
    if (
      manifest === null ||
      typeof manifest !== 'object' ||
      Array.isArray(manifest) ||
      Reflect.get(manifest, 'version') !== GENERATOR_VERSION ||
      Reflect.get(manifest, 'fingerprint') !== expectedFingerprint
    ) return false
    await Promise.all([
      fs.access(paths.svg),
      fs.access(paths.png),
      fs.access(paths.icns)
    ])
    return true
  } catch {
    return false
  }
}

export async function generateDevelopmentIcon({
  checkout,
  pullRequestNumber,
  platform = process.platform,
  runCommand = commandRunner,
  sourceSvgPath = path.join(
    checkout,
    'design',
    'brand',
    'markover-app-icon.svg'
  )
}: GenerateDevelopmentIconOptions): Promise<GeneratedDevelopmentIcon> {
  if (platform !== 'darwin') {
    throw new Error('Development icon generation currently requires macOS.')
  }
  positivePullRequestNumber(pullRequestNumber)
  const source = await fs.readFile(sourceSvgPath, 'utf8')
  const expectedFingerprint = fingerprint(source, pullRequestNumber)
  const paths = developmentIconPaths(checkout, pullRequestNumber)
  if (await cacheMatches(paths, expectedFingerprint)) {
    return { cached: true, paths }
  }

  await fs.mkdir(paths.directory, { recursive: true })
  await fs.writeFile(paths.svg, watermarkedIconSvg(source, pullRequestNumber))
  runCommand('/usr/bin/sips', [
    '-s',
    'format',
    'png',
    paths.svg,
    '--out',
    paths.png
  ])
  buildMacosIcon({
    sourcePath: paths.png,
    outputPath: paths.icns,
    platform,
    runCommand
  })
  if (!fsSync.existsSync(paths.png) || !fsSync.existsSync(paths.icns)) {
    throw new Error('Development icon generation did not produce all assets.')
  }
  await fs.writeFile(paths.manifest, `${JSON.stringify({
    version: GENERATOR_VERSION,
    fingerprint: expectedFingerprint
  }, null, 2)}\n`)
  return { cached: false, paths }
}

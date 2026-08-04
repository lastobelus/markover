import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const loadModule = createRequire(__filename)
const loadedElectron: unknown = loadModule('electron')
if (typeof loadedElectron !== 'string') {
  throw new Error('Electron executable path is unavailable.')
}
const electronPath = loadedElectron

const projectDirectory = path.resolve(__dirname, '../..')
const defaultReviewsDirectory = path.join(projectDirectory, '.markover', 'reviews')

export interface OpenReviewArguments {
  resumeId: string | null
  sourcePath: string | null
}

export interface ReviewConfig {
  format: 'markover-durable-review'
  version: 1
  reviewId: string
  durable: true
  inputPath: string
  originalPath: string
  name: string
  attachmentsDirectory: string
  autosavePath: string
}

export interface ReviewPaths {
  autosavePath: string
  configPath: string
  directory: string
  attachmentsDirectory: string
}

export type ReviewConfiguration = ReviewPaths & { config: ReviewConfig }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertReviewConfig(value: unknown): asserts value is ReviewConfig {
  if (
    !isRecord(value) ||
    value.format !== 'markover-durable-review' ||
    value.version !== 1 ||
    value.durable !== true ||
    typeof value.reviewId !== 'string' ||
    typeof value.inputPath !== 'string' ||
    typeof value.originalPath !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.attachmentsDirectory !== 'string' ||
    typeof value.autosavePath !== 'string'
  ) {
    throw new Error('Invalid durable review configuration.')
  }
}

export function parseOpenReviewArguments(args: string[]): OpenReviewArguments {
  let resumeId = null
  let sourcePath = null

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === undefined) break
    if (argument === '--resume') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--resume requires a review ID.')
      }
      resumeId = value
      index += 1
      continue
    }
    if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`)
    }
    if (sourcePath) throw new Error('Expected exactly one Markdown path.')
    sourcePath = argument
  }

  if (resumeId && sourcePath) {
    throw new Error('Pass a Markdown path or --resume, not both.')
  }
  if (!resumeId && !sourcePath) {
    throw new Error('Pass a Markdown path or --resume <review-id>.')
  }

  return { resumeId, sourcePath }
}

export function createReviewId(): string {
  return `mko_${randomBytes(4).toString('hex')}`
}

export function reviewPaths(
  reviewId: string,
  reviewsDirectory = defaultReviewsDirectory
): ReviewPaths {
  const directory = path.join(reviewsDirectory, reviewId)
  return {
    autosavePath: path.join(directory, 'review.json'),
    configPath: path.join(directory, 'config.json'),
    directory,
    attachmentsDirectory: path.join(directory, 'attachments')
  }
}

export async function createReviewConfig(
  sourcePath: string,
  reviewsDirectory?: string
): Promise<ReviewConfiguration> {
  const inputPath = path.resolve(sourcePath)
  const stats = await fs.stat(inputPath)
  if (!stats.isFile()) throw new Error(`Not a file: ${inputPath}`)

  const reviewId = createReviewId()
  const paths = reviewPaths(reviewId, reviewsDirectory)
  const config: ReviewConfig = {
    format: 'markover-durable-review',
    version: 1,
    reviewId,
    durable: true,
    inputPath,
    originalPath: inputPath,
    name: path.basename(inputPath),
    attachmentsDirectory: paths.attachmentsDirectory,
    autosavePath: paths.autosavePath
  }

  await fs.mkdir(paths.attachmentsDirectory, { recursive: true })
  await fs.writeFile(paths.configPath, `${JSON.stringify(config, null, 2)}\n`)
  return { config, ...paths }
}

export async function loadReviewConfig(
  reviewId: string,
  reviewsDirectory?: string
): Promise<ReviewConfiguration> {
  const paths = reviewPaths(reviewId, reviewsDirectory)
  const config: unknown = JSON.parse(await fs.readFile(paths.configPath, 'utf8'))
  assertReviewConfig(config)
  return { config, ...paths }
}

export function launchDetachedReview(
  reviewId: string,
  configPath: string
): string {
  if (process.platform !== 'darwin') {
    throw new Error('Durable review launching currently requires macOS.')
  }

  const label = `com.markover.review.${reviewId.replace(/[^a-zA-Z0-9.-]/g, '-')}`
  spawnSync('/bin/launchctl', ['remove', label], { stdio: 'ignore' })

  const cleanEnvironment = [
    '/usr/bin/env',
    '-i',
    `HOME=${os.homedir()}`,
    `TMPDIR=${os.tmpdir()}`,
    `USER=${os.userInfo().username}`,
    'PATH=/usr/bin:/bin:/usr/sbin:/sbin',
    electronPath,
    projectDirectory,
    '--markover-review',
    '--markover-review-config',
    configPath
  ]
  const result = spawnSync(
    '/bin/launchctl',
    ['submit', '-l', label, '--', ...cleanEnvironment],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `launchctl exited ${String(result.status)}`
    )
  }
  return label
}

async function main(): Promise<void> {
  try {
    const { resumeId, sourcePath } = parseOpenReviewArguments(
      process.argv.slice(2)
    )
    let review: ReviewConfiguration
    if (resumeId) {
      review = await loadReviewConfig(resumeId)
    } else {
      if (!sourcePath) throw new Error('A Markdown path is required.')
      review = await createReviewConfig(sourcePath)
    }
    const label = launchDetachedReview(review.config.reviewId, review.configPath)

    process.stdout.write(`${JSON.stringify({
      reviewId: review.config.reviewId,
      autosavePath: review.config.autosavePath,
      launchdLabel: label
    })}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover: ${message}\n`)
    process.exitCode = 1
  }
}

if (require.main === module) void main()

const { randomBytes } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const electronPath = require('electron')

const projectDirectory = path.resolve(__dirname, '../..')
const defaultReviewsDirectory = path.join(projectDirectory, '.markover', 'reviews')

function parseOpenReviewArguments(args) {
  let resumeId = null
  let sourcePath = null

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
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

function createReviewId() {
  return `mko_${randomBytes(4).toString('hex')}`
}

function reviewPaths(reviewId, reviewsDirectory = defaultReviewsDirectory) {
  const directory = path.join(reviewsDirectory, reviewId)
  return {
    autosavePath: path.join(directory, 'review.json'),
    configPath: path.join(directory, 'config.json'),
    directory,
    attachmentsDirectory: path.join(directory, 'attachments')
  }
}

async function createReviewConfig(sourcePath, reviewsDirectory) {
  const inputPath = path.resolve(sourcePath)
  const stats = await fs.stat(inputPath)
  if (!stats.isFile()) throw new Error(`Not a file: ${inputPath}`)

  const reviewId = createReviewId()
  const paths = reviewPaths(reviewId, reviewsDirectory)
  const config = {
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

async function loadReviewConfig(reviewId, reviewsDirectory) {
  const paths = reviewPaths(reviewId, reviewsDirectory)
  const config = JSON.parse(await fs.readFile(paths.configPath, 'utf8'))
  return { config, ...paths }
}

function launchDetachedReview(reviewId, configPath) {
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
    throw new Error(result.stderr.trim() || `launchctl exited ${result.status}`)
  }
  return label
}

async function main() {
  try {
    const { resumeId, sourcePath } = parseOpenReviewArguments(
      process.argv.slice(2)
    )
    const review = resumeId
      ? await loadReviewConfig(resumeId)
      : await createReviewConfig(sourcePath)
    const label = launchDetachedReview(review.config.reviewId, review.configPath)

    process.stdout.write(`${JSON.stringify({
      reviewId: review.config.reviewId,
      autosavePath: review.config.autosavePath,
      launchdLabel: label
    })}\n`)
  } catch (error) {
    process.stderr.write(`markover: ${error.message}\n`)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {
  createReviewConfig,
  createReviewId,
  launchDetachedReview,
  loadReviewConfig,
  parseOpenReviewArguments,
  reviewPaths
}

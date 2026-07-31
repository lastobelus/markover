const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  createReviewConfig,
  loadReviewConfig,
  parseOpenReviewArguments,
  reviewPaths
} = require('../scripts/open-review')

test('parses a new durable review or a resume request', () => {
  assert.deepEqual(
    parseOpenReviewArguments(['doc/plans/example.md']),
    { resumeId: null, sourcePath: 'doc/plans/example.md' }
  )
  assert.deepEqual(
    parseOpenReviewArguments(['--resume', 'mko_1234']),
    { resumeId: 'mko_1234', sourcePath: null }
  )
  assert.throws(
    () => parseOpenReviewArguments(['doc.md', '--resume', 'mko_1234']),
    /not both/
  )
})

test('creates and reloads a durable review config', async () => {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-open-test-')
  )
  const reviewsDirectory = path.join(temporaryDirectory, 'reviews')
  const sourcePath = path.join(temporaryDirectory, 'plan.md')
  await fs.writeFile(sourcePath, '# Plan\n', 'utf8')

  const created = await createReviewConfig(sourcePath, reviewsDirectory)
  const expectedPaths = reviewPaths(created.config.reviewId, reviewsDirectory)

  assert.equal(created.config.durable, true)
  assert.equal(created.config.inputPath, sourcePath)
  assert.equal(created.config.autosavePath, expectedPaths.autosavePath)
  assert.equal(
    created.config.attachmentsDirectory,
    expectedPaths.attachmentsDirectory
  )

  const loaded = await loadReviewConfig(
    created.config.reviewId,
    reviewsDirectory
  )
  assert.deepEqual(loaded.config, created.config)

  await fs.rm(temporaryDirectory, { recursive: true, force: true })
})

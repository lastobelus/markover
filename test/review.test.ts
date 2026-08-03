import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  parseReviewArguments,
  resolveReviewInput
} from '../scripts/review'

test('resolves a path as the named source document', async () => {
  const input = await resolveReviewInput(['DECISIONS.md'])

  assert.equal(input.inputPath, path.resolve('DECISIONS.md'))
  assert.equal(input.originalPath, path.resolve('DECISIONS.md'))
  assert.equal(input.name, 'DECISIONS.md')
  assert.equal(
    input.attachmentsDirectory,
    path.resolve('.markover', 'attachments')
  )
})

test('preserves piped Markdown exactly in a temporary source document', async () => {
  const source = '# Review\r\n\r\n- Keep this ending\r\n'
  const input = await resolveReviewInput([], Readable.from([source]))

  assert.equal(input.name, 'stdin.md')
  assert.equal(input.originalPath, null)
  assert.equal(await fs.readFile(input.inputPath, 'utf8'), source)

  await input.cleanup()
  await assert.rejects(fs.access(input.inputPath))
})

test('rejects ambiguous input arguments', async () => {
  await assert.rejects(
    resolveReviewInput(['one.md', 'two.md']),
    /not both/
  )
})

test('accepts an attachment-directory override before or after the source', () => {
  const expected = path.resolve('tmp', 'screenshots')

  assert.deepEqual(
    parseReviewArguments([
      '--attachments-dir',
      'tmp/screenshots',
      'DECISIONS.md'
    ]),
    {
      attachmentsDirectory: expected,
      sourcePath: 'DECISIONS.md'
    }
  )
  assert.deepEqual(
    parseReviewArguments([
      'DECISIONS.md',
      '--attachments-dir',
      'tmp/screenshots'
    ]),
    {
      attachmentsDirectory: expected,
      sourcePath: 'DECISIONS.md'
    }
  )
})

test('rejects a missing attachment-directory value', () => {
  assert.throws(
    () => parseReviewArguments(['DECISIONS.md', '--attachments-dir']),
    /requires a path/
  )
})

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { importLegacyReviews } from '../src/review-migration'
import { ReviewStore } from '../src/review-store'

function tree(text = 'Plan'): ReviewTree {
  return {
    format: 'markover-review',
    version: 1,
    sourceDocument: {
      name: 'plan.md',
      path: '/project/plan.md',
      content: `# ${text}\n`,
      checksum: `sha256:${text}`
    },
    unsupported: [],
    root: {
      id: 'document',
      type: 'document',
      text: 'Document',
      raw: `# ${text}\n`,
      lineStart: 1,
      lineEnd: 1,
      feedback: '',
      collapsed: false,
      children: [{
        id: 'block-1',
        type: 'heading',
        level: 1,
        text,
        raw: `# ${text}`,
        lineStart: 1,
        lineEnd: 1,
        feedback: '',
        collapsed: false,
        children: []
      }]
    }
  }
}

function child(node: ReviewNode, index = 0): ReviewNode {
  const result = node.children[index]
  assert.ok(result)
  return result
}

test('imports managed checkout reviews once without overwriting user data', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-migrate-'))
  const source = path.join(directory, 'checkout')
  const target = path.join(directory, 'user-data')
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const sourceStore = new ReviewStore(source, { idFactory: () => 'mko_legacy01' })
  const targetStore = new ReviewStore(target, { idFactory: () => 'mko_current1' })
  const legacyTree = tree('Legacy')
  child(legacyTree.root).attachments = [{
    id: 'img-1',
    type: 'image',
    mimeType: 'image/png',
    path: path.join(source, 'mko_legacy01', 'attachments', 'img-1.png'),
    checksum: 'sha256:image',
    width: 1,
    height: 1,
    label: ''
  }]
  await sourceStore.create({ tree: legacyTree, contextSummary: 'Legacy review.' })
  await fs.mkdir(path.join(source, 'mko_legacy01', 'attachments'))
  await fs.writeFile(
    path.join(source, 'mko_legacy01', 'attachments', 'img-1.png'),
    'image'
  )
  await targetStore.create({ tree: tree('Current'), contextSummary: 'Current review.' })

  assert.deepEqual(await importLegacyReviews(source, target), ['mko_legacy01'])
  assert.equal(
    await fs.readFile(
      path.join(target, 'mko_legacy01', 'attachments', 'img-1.png'),
      'utf8'
    ),
    'image'
  )
  assert.equal(
    child((await targetStore.load('mko_legacy01')).root).attachments?.[0]?.path,
    path.join(target, 'mko_legacy01', 'attachments', 'img-1.png')
  )
  assert.deepEqual(await importLegacyReviews(source, target), [])
  assert.deepEqual(
    (await targetStore.list()).map((review) => review.review.id).sort(),
    ['mko_current1', 'mko_legacy01']
  )
})

test('missing checkout review storage is a no-op', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-migrate-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  assert.deepEqual(
    await importLegacyReviews(
      path.join(directory, 'missing'),
      path.join(directory, 'target')
    ),
    []
  )
})

import assert from 'node:assert/strict'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createLocalReview,
  LOCAL_REVIEW_CONTEXT_SUMMARY
} from '../src/local-review'
import { ReviewStore } from '../src/review-store'

const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi

function candidate(filePath: string, source: string): MarkoverDocument {
  return {
    name: path.basename(filePath),
    path: filePath,
    source,
    checksum: 'sha256:local'
  }
}

test('creates a managed local review with source and Git context', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-local-'))
  const sourcePath = path.join(directory, 'notes.md')
  const source = '# Local notes\r\n\r\nKeep the original.\r\n'
  await fs.writeFile(sourcePath, source, 'utf8')
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const selected = candidate(sourcePath, source)
  const tree = parseMarkdown(source, selected.checksum, {
    name: selected.name,
    path: selected.path
  })
  const store = new ReviewStore(path.join(directory, 'reviews'), {
    idFactory: () => 'mko_local001'
  })
  const created = await createLocalReview(selected, tree, store, {
    discoverGit: () => Promise.resolve({
      repositoryRoot: directory,
      branch: 'local-notes',
      sources: { repositoryRoot: 'git-cli', branch: 'git-cli' }
    }),
    interpretationPolicy: 'Use the local review policy.'
  })

  assert.equal(created.review.id, 'mko_local001')
  assert.equal(created.review.contextSummary, LOCAL_REVIEW_CONTEXT_SUMMARY)
  assert.equal(created.review.agentThread, null)
  assert.equal(created.review.pullRequest, null)
  assert.deepEqual(created.review.git, {
    repositoryRoot: directory,
    branch: 'local-notes',
    sources: { repositoryRoot: 'git-cli', branch: 'git-cli' }
  })
  assert.equal(
    created.review.agentGuidance.interpretationPolicy,
    'Use the local review policy.'
  )
  assert.equal(created.sourceDocument.path, sourcePath)
  assert.equal(created.sourceDocument.content, source)
  assert.equal(await fs.readFile(sourcePath, 'utf8'), source)
  assert.deepEqual(
    (await new ReviewStore(path.join(directory, 'reviews')).list()).map(
      (review) => review.review.id
    ),
    ['mko_local001']
  )
})

test('rejects a changed renderer snapshot before creating a review', async () => {
  const selected = candidate('/tmp/notes.md', '# Selected\n')
  const changed = parseMarkdown('# Changed\n', selected.checksum, {
    name: selected.name,
    path: selected.path
  })
  let createCalls = 0

  await assert.rejects(
    createLocalReview(selected, changed, {
      create() {
        createCalls += 1
        throw new Error('must not create')
      }
    }),
    /snapshot changed/
  )
  assert.equal(createCalls, 0)
})

test('Git discovery failure does not block local review creation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-local-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const selected = candidate('/tmp/notes.md', '# Notes\n')
  const tree = parseMarkdown(selected.source, selected.checksum, {
    name: selected.name,
    path: selected.path
  })
  const store = new ReviewStore(directory, {
    idFactory: () => 'mko_local002'
  })

  const created = await createLocalReview(selected, tree, store, {
    discoverGit: () => Promise.reject(new Error('git unavailable'))
  })
  assert.equal(created.review.git, null)
})

test('picker cancellation and failed creation cannot reuse a pending candidate', () => {
  const main = fsSync.readFileSync(
    path.resolve(__dirname, '../../src/main.ts'),
    'utf8'
  )
  const renderer = fsSync.readFileSync(
    path.resolve(__dirname, '../../src/renderer.ts'),
    'utf8'
  )

  assert.match(
    main,
    /async function openMarkdown[\s\S]*pendingLocalReviewCandidate = null[\s\S]*if \(result\.canceled[\s\S]*pendingLocalReviewCandidate = candidate/
  )
  assert.match(
    main,
    /const candidate = pendingLocalReviewCandidate\s*pendingLocalReviewCandidate = null\s*if \(!candidate\)/
  )
  assert.match(
    renderer,
    /localOpenInProgress[\s\S]*const candidate = await bridge\.openMarkdown\(\)\s*if \(!candidate\) return[\s\S]*bridge\.createLocalReview\(tree\)[\s\S]*finally[\s\S]*localOpenInProgress = false/
  )
})

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  defaultWorkspaceState,
  isWorkspaceState,
  parseWorkspaceState,
  reconcileWorkspaceState
} from '../src/workspace-state'
import { WorkspaceStore } from '../src/workspace-store'

function populatedWorkspace(): MarkoverWorkspaceState {
  return {
    ...defaultWorkspaceState(),
    initialized: true,
    navigationMode: 'projects',
    projectExpansion: [{ projectKey: '/repo/markover', expanded: true }],
    threadExpansion: [{
      projectKey: '/repo/markover',
      threadKey: 'codex:thread-1',
      expanded: false
    }],
    openReviewIds: ['mko_abcdef', 'mko_ghijkl'],
    activeReviewId: 'mko_ghijkl',
    annotationPaneWidth: 432,
    reviews: {
      mko_abcdef: {
        selectedBlockId: 'block-2',
        annotatedOnly: true,
        annotationView: 'list',
        sourceCollapsed: true,
        collapsedBlockIds: ['block-1', 'block-4']
      }
    }
  }
}

test('workspace state is independently versioned and exact', () => {
  const workspace = populatedWorkspace()
  assert.equal(isWorkspaceState(workspace), true)
  assert.deepEqual(parseWorkspaceState(workspace), workspace)
  assert.equal(isWorkspaceState({ ...workspace, version: 2 }), false)
  assert.equal(isWorkspaceState({ ...workspace, portableReview: {} }), false)
  assert.equal(isWorkspaceState({
    ...workspace,
    reviews: {
      ...workspace.reviews,
      invalid: workspace.reviews.mko_abcdef
    }
  }), false)
})

test('workspace store persists serialized atomic replacements', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-workspace-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'workspace.json')
  const store = new WorkspaceStore(filePath)
  assert.deepEqual(await store.load(), defaultWorkspaceState())

  const first = populatedWorkspace()
  const second = {
    ...first,
    navigationMode: 'inbox' as const,
    activeReviewId: 'mko_abcdef'
  }
  await Promise.all([store.replace(first), store.replace(second)])
  await store.flush()

  const restored = new WorkspaceStore(filePath)
  assert.deepEqual(await restored.load(), second)
  assert.deepEqual(
    (await fs.readdir(directory)).sort(),
    ['workspace.json']
  )
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600)
  }
})

test('workspace flush reports the latest failed write and later writes recover', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-workspace-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const blockedParent = path.join(directory, 'blocked')
  const filePath = path.join(blockedParent, 'workspace.json')
  await fs.writeFile(blockedParent, 'not a directory', 'utf8')
  const store = new WorkspaceStore(filePath)

  await assert.rejects(store.replace(populatedWorkspace()))
  await assert.rejects(store.flush())

  await fs.unlink(blockedParent)
  await store.flush()
  assert.deepEqual(
    JSON.parse(await fs.readFile(filePath, 'utf8')),
    populatedWorkspace()
  )

  const recovered = {
    ...populatedWorkspace(),
    navigationMode: 'inbox' as const
  }
  await store.replace(recovered)
  await store.flush()
  assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')), recovered)
})

test('missing, malformed, or incompatible private state never affects reviews', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-workspace-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'workspace.json')
  const reviewPath = path.join(directory, 'reviews', 'mko_abcdef', 'review.json')
  await fs.mkdir(path.dirname(reviewPath), { recursive: true })
  await fs.writeFile(reviewPath, '{"portable":"review"}\n', 'utf8')
  const reviewBefore = await fs.readFile(reviewPath, 'utf8')
  const store = new WorkspaceStore(filePath)

  await fs.writeFile(filePath, '{bad json', 'utf8')
  assert.deepEqual(await store.load(), defaultWorkspaceState())
  assert.match(store.lastRecoveryWarning || '', /reviews were left untouched/)
  assert.equal(await fs.readFile(filePath, 'utf8'), '{bad json')
  assert.equal(await fs.readFile(reviewPath, 'utf8'), reviewBefore)

  await fs.writeFile(filePath, JSON.stringify({
    ...populatedWorkspace(),
    version: 2
  }), 'utf8')
  assert.deepEqual(await store.load(), defaultWorkspaceState())
  assert.match(store.lastRecoveryWarning || '', /incompatible/)
  assert.equal(await fs.readFile(reviewPath, 'utf8'), reviewBefore)
})

test('workspace reconciliation prunes stale references without rejecting reviews', () => {
  const state = populatedWorkspace()
  state.projectExpansion.push({ projectKey: '/gone', expanded: true })
  state.threadExpansion.push({
    projectKey: '/gone',
    threadKey: 'gone:thread',
    expanded: true
  })
  state.openReviewIds.push('mko_stale11')
  state.reviews.mko_stale11 = {
    selectedBlockId: null,
    annotatedOnly: false,
    annotationView: 'selected',
    sourceCollapsed: false,
    collapsedBlockIds: []
  }
  const reconciled = reconcileWorkspaceState(state, [{
    reviewId: 'mko_abcdef',
    projectKey: '/repo/markover',
    threadKey: 'codex:thread-1',
    blockIds: ['block-1', 'block-2']
  }])

  assert.deepEqual(reconciled.openReviewIds, ['mko_abcdef'])
  assert.equal(reconciled.activeReviewId, null)
  assert.deepEqual(Object.keys(reconciled.reviews), ['mko_abcdef'])
  assert.deepEqual(reconciled.reviews.mko_abcdef?.collapsedBlockIds, ['block-1'])
  assert.deepEqual(reconciled.projectExpansion, [{
    projectKey: '/repo/markover',
    expanded: true
  }])
  assert.equal(reconciled.threadExpansion.length, 1)
})

test('renderer restoration persists only confirmed private view state', async () => {
  const [renderer, annotations, main, localService, reviewStore] = await Promise.all([
    fs.readFile(path.resolve(__dirname, '../../src/renderer.ts'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../src/annotations.ts'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../src/main.ts'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../src/local-service.ts'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../src/review-store.ts'), 'utf8')
  ])

  assert.match(
    renderer,
    /restoring-workspace[\s\S]*applyWorkspaceState\(await bridge\.getWorkspaceState\(\)\)[\s\S]*activateReview\(activeReviewId,[\s\S]*workspaceStateReady = true[\s\S]*persistWorkspaceState\(\)/
  )
  const snapshotBody = renderer.match(
    /function workspaceSnapshot\(\)[\s\S]*?\n}\n\nfunction persistWorkspaceState/
  )?.[0] || ''
  for (const field of [
    'navigationMode',
    'projectExpansion',
    'threadExpansion',
    'openReviewIds',
    'activeReviewId',
    'annotationPaneWidth',
    'collapsedBlockIds'
  ]) {
    assert.match(snapshotBody, new RegExp(`${field}:`))
  }
  assert.doesNotMatch(
    snapshotBody,
    /sourceDrafts|sourceEditingId|attachmentPreviewUrls|hoveredId|scroll/
  )
  assert.doesNotMatch(renderer, /\bnode\.collapsed\b|\bcurrent\.collapsed\b/)
  assert.doesNotMatch(annotations, /\.collapsed\b/)
  assert.match(renderer, /collapsedBlockIds\.add\(node\.id\)[\s\S]*persistWorkspaceState\(\)/)
  assert.match(main, /new WorkspaceStore\([\s\S]*'workspace\.json'/)
  assert.match(main, /requireWorkspaceStore\(\)\.flush\(\)/)
  assert.doesNotMatch(localService, /MarkoverWorkspaceState|workspace\.json/)
  assert.doesNotMatch(reviewStore, /MarkoverWorkspaceState|workspace\.json/)
})

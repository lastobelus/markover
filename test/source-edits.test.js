const test = require('node:test')
const assert = require('node:assert/strict')
const SourceEdits = require('../src/source-edits')

function editorState() {
  return {
    sourceDrafts: new Map(),
    sourceEditingId: null
  }
}

function node(id, raw) {
  return { id, raw }
}

test('commits a dirty source draft before another node is edited', () => {
  const state = editorState()
  const first = node('block-1', 'Old first')
  const second = node('block-2', 'Old second')

  SourceEdits.begin(state, first)
  SourceEdits.update(state, first, 'Revised first')
  assert.deepEqual(SourceEdits.commit(state, first), {
    ok: true,
    changed: true,
    reason: null
  })

  SourceEdits.begin(state, second)
  SourceEdits.update(state, second, 'Revised second')
  SourceEdits.commit(state, second)

  assert.deepEqual(first.sourceEdit, {
    original: 'Old first',
    current: 'Revised first'
  })
  assert.deepEqual(second.sourceEdit, {
    original: 'Old second',
    current: 'Revised second'
  })
  assert.equal(state.sourceDrafts.has(first.id), false)
})

test('leaving an unchanged source edit clears its transient draft', () => {
  const state = editorState()
  const block = node('block-1', 'Unchanged')

  SourceEdits.begin(state, block)
  assert.deepEqual(SourceEdits.commit(state, block), {
    ok: true,
    changed: false,
    reason: null
  })
  assert.equal(state.sourceEditingId, null)
  assert.equal(state.sourceDrafts.has(block.id), false)
  assert.equal(Object.hasOwn(block, 'sourceEdit'), false)
})

test('an empty source draft remains active instead of being lost on navigation', () => {
  const state = editorState()
  const block = node('block-1', 'Original')

  SourceEdits.begin(state, block)
  SourceEdits.update(state, block, '   ')

  assert.deepEqual(SourceEdits.commit(state, block), {
    ok: false,
    changed: false,
    reason: 'empty'
  })
  assert.equal(state.sourceEditingId, block.id)
  assert.equal(state.sourceDrafts.get(block.id), '   ')
})

test('renderer commits source edits before navigation and tree handoff', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const renderer = fs.readFileSync(
    path.join(__dirname, '../src/renderer.js'),
    'utf8'
  )

  assert.match(
    renderer,
    /function selectNode[\s\S]*finishActiveSourceEdit\(id\)[\s\S]*state\.selectedId = id/
  )
  assert.match(
    renderer,
    /function activateReview[\s\S]*finishActiveSourceEdit\(\)[\s\S]*captureActiveSession\(\)/
  )
  assert.match(
    renderer,
    /function finishActiveSourceEdit[\s\S]*state\.selectedId === node\.id[\s\S]*renderAnnotation\(node\)/
  )
  assert.match(
    renderer,
    /onReviewSnapshotRequested[\s\S]*finishActiveSourceEdit\(\)[\s\S]*Finish or cancel the empty source edit before handoff/
  )
  assert.match(
    renderer,
    /openMarkdownDocument[\s\S]*bridge\.openMarkdown\(\)[\s\S]*finishActiveSourceEdit\(\)[\s\S]*loadDocument\(documentData\)/
  )
  assert.match(
    renderer,
    /copyTreeButton\.addEventListener[\s\S]*finishActiveSourceEdit\(\)[\s\S]*serializeTree\(state\.tree\)/
  )
  assert.match(
    renderer,
    /doneReviewButton\.addEventListener[\s\S]*finishActiveSourceEdit\(\)[\s\S]*finishReview\(state\.tree\)/
  )
})

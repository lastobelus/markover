import assert from 'node:assert/strict'
import test from 'node:test'

const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi
const { isOutsideViewport, move, nextPane } = require('../src/navigation') as
  MarkoverNavigationApi

const tree = parseMarkdown(`# Root

- First
  - Child
- Second

## Next section
`)

const [rootHeading] = tree.root.children
assert.ok(rootHeading)
const [first, second, nextSection] = rootHeading.children
assert.ok(first)
assert.ok(second)
assert.ok(nextSection)
const [child] = first.children
assert.ok(child)

test('left selects parent and right selects first child', () => {
  assert.equal(move(tree.root, child.id, 'left'), first.id)
  assert.equal(move(tree.root, first.id, 'right'), child.id)
})

test('right falls through to the next available sibling', () => {
  assert.equal(move(tree.root, child.id, 'right'), second.id)
  assert.equal(move(tree.root, second.id, 'right'), nextSection.id)
})

test('up and down navigate siblings and climb at boundaries', () => {
  assert.equal(move(tree.root, first.id, 'down'), second.id)
  assert.equal(move(tree.root, second.id, 'up'), first.id)
  assert.equal(move(tree.root, child.id, 'up'), first.id)
  assert.equal(move(tree.root, child.id, 'down'), second.id)
})

test('keeps an empty review selection unset', () => {
  assert.equal(move(tree.root, null, 'down'), null)
})

test('cycles focus through three panes and skips a collapsed documents list', () => {
  assert.equal(nextPane('documents', 1, true), 'preview')
  assert.equal(nextPane('preview', 1, true), 'annotation')
  assert.equal(nextPane('annotation', 1, true), 'documents')
  assert.equal(nextPane('documents', -1, true), 'annotation')
  assert.equal(nextPane('preview', -1, true), 'documents')
  assert.equal(nextPane('annotation', -1, false), 'preview')
  assert.equal(nextPane('preview', 1, false), 'annotation')
})

test('detects a selected row wholly outside the document viewport', () => {
  const viewport = { top: 100, bottom: 500 }

  assert.equal(isOutsideViewport(viewport, { top: 40, bottom: 100 }), true)
  assert.equal(isOutsideViewport(viewport, { top: 500, bottom: 540 }), true)
  assert.equal(isOutsideViewport(viewport, { top: 90, bottom: 120 }), false)
  assert.equal(isOutsideViewport(viewport, { top: 480, bottom: 510 }), false)
  assert.equal(isOutsideViewport(viewport, { top: 180, bottom: 220 }), false)
})

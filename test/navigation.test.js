const test = require('node:test')
const assert = require('node:assert/strict')
const { parseMarkdown } = require('../src/tree')
const { move } = require('../src/navigation')

const tree = parseMarkdown(`# Root

- First
  - Child
- Second

## Next section
`)

const [rootHeading] = tree.root.children
const [first, second, nextSection] = rootHeading.children
const [child] = first.children

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

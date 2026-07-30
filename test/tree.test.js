const test = require('node:test')
const assert = require('node:assert/strict')
const { parseMarkdown, serializeTree } = require('../src/tree')

const markdown = `# One

- Alpha
  - Nested
- Beta

## Two

1. First
2. Second

\`\`\`js
console.log('hello')
\`\`\`
`

test('parses headings, nested lists, and code into a deterministic tree', () => {
  const first = parseMarkdown(markdown, 'sha256:test')
  const second = parseMarkdown(markdown, 'sha256:test')

  assert.equal(serializeTree(first), serializeTree(second))
  assert.equal(first.root.children.length, 1)

  const heading = first.root.children[0]
  assert.equal(heading.type, 'heading')
  assert.equal(heading.text, 'One')
  assert.deepEqual(
    heading.children.map((node) => node.type),
    ['unordered-item', 'unordered-item', 'heading']
  )
  assert.equal(heading.children[0].children[0].text, 'Nested')

  const secondHeading = heading.children[2]
  assert.deepEqual(
    secondHeading.children.map((node) => node.type),
    ['ordered-item', 'ordered-item', 'code']
  )
  assert.equal(secondHeading.children[2].language, 'js')
  assert.equal(secondHeading.children[2].text, "console.log('hello')")
  assert.deepEqual(first.unsupported, [])
})

test('retains exact source and records unsupported non-empty lines', () => {
  const source = '# Title\r\n\r\nA paragraph\r\n'
  const tree = parseMarkdown(source, 'sha256:value')

  assert.equal(tree.source, source)
  assert.equal(tree.checksum, 'sha256:value')
  assert.deepEqual(tree.unsupported, [{ line: 3, text: 'A paragraph' }])
})

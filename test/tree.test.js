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
  assert.equal(secondHeading.children[0].marker, '1.')
  assert.equal(secondHeading.children[1].marker, '2.')
  assert.equal(secondHeading.children[0].listPosition, 1)
  assert.equal(secondHeading.children[1].listPosition, 2)
  assert.equal(secondHeading.children[0].listLength, 2)
  assert.equal(secondHeading.children[1].listLength, 2)
  assert.equal(secondHeading.children[2].language, 'js')
  assert.equal(secondHeading.children[2].text, "console.log('hello')")
  assert.deepEqual(first.unsupported, [])
})

test('retains hard-wrapped list content as one block', () => {
  const tree = parseMarkdown(`1. **One item** starts here
   and continues on the next line
2. Another item
`)
  const [first, second] = tree.root.children

  assert.equal(
    first.text,
    '**One item** starts here\nand continues on the next line'
  )
  assert.equal(first.raw, '1. **One item** starts here\n   and continues on the next line')
  assert.equal(first.lineEnd, 2)
  assert.equal(second.marker, '2.')
  assert.equal(first.listLength, 2)
  assert.equal(second.listPosition, 2)
  assert.deepEqual(tree.unsupported, [])
})

test('retains exact source metadata and parses standalone paragraphs', () => {
  const source = '# Title\r\n\r\nA paragraph\r\n'
  const tree = parseMarkdown(source, 'sha256:value', {
    name: 'example.md',
    path: '/tmp/example.md'
  })

  assert.deepEqual(tree.sourceDocument, {
    name: 'example.md',
    path: '/tmp/example.md',
    content: source,
    checksum: 'sha256:value'
  })
  const paragraph = tree.root.children[0].children[0]
  assert.equal(paragraph.type, 'paragraph')
  assert.equal(paragraph.text, 'A paragraph')
  assert.equal(paragraph.raw, 'A paragraph')
  assert.deepEqual(tree.unsupported, [])
})

test('parses cheap block types while keeping blockquotes and tables opaque', () => {
  const source = `# More blocks

A paragraph with an ![inert image](diagram.png).

> One quoted block.
>
> - This list is not a child node.

---

| State | Meaning |
| --- | --- |
| open | needs work |

- [ ] Open task
- [x] Finished task
`
  const tree = parseMarkdown(source)
  const heading = tree.root.children[0]

  assert.deepEqual(
    heading.children.map((node) => node.type),
    [
      'paragraph',
      'blockquote',
      'thematic-break',
      'table',
      'unordered-item',
      'unordered-item'
    ]
  )

  const quote = heading.children[1]
  assert.equal(
    quote.raw,
    '> One quoted block.\n>\n> - This list is not a child node.'
  )
  assert.deepEqual(quote.children, [])

  const table = heading.children[3]
  assert.match(table.raw, /^\| State \| Meaning \|/)
  assert.deepEqual(table.children, [])

  const [openTask, finishedTask] = heading.children.slice(4)
  assert.equal(openTask.task, true)
  assert.equal(openTask.checked, false)
  assert.equal(openTask.text, 'Open task')
  assert.equal(openTask.raw, '- [ ] Open task')
  assert.equal(finishedTask.task, true)
  assert.equal(finishedTask.checked, true)
  assert.equal(finishedTask.text, 'Finished task')
  assert.equal(openTask.listLength, 2)
  assert.equal(finishedTask.listPosition, 2)
  assert.deepEqual(tree.unsupported, [])
})

test('degrades unsupported extension syntax to a visible paragraph', () => {
  const source = `<details>
<summary>Raw HTML</summary>
Hidden text
</details>
`
  const tree = parseMarkdown(source)

  assert.equal(tree.root.children.length, 1)
  assert.equal(tree.root.children[0].type, 'paragraph')
  assert.equal(
    tree.root.children[0].text,
    '<details>\n<summary>Raw HTML</summary>\nHidden text\n</details>'
  )
  assert.deepEqual(tree.unsupported, [])
  assert.equal(tree.sourceDocument.content, source)
})

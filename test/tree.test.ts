import assert from 'node:assert/strict'
import test from 'node:test'

const {
  nodePosition,
  parseMarkdown,
  serializeTree,
  yamlDiagnostic
} = require('../src/tree') as MarkoverTreeApi

type NodeOfType<T extends ReviewNodeType> = Extract<ReviewNode, { type: T }>

function expectNode<T extends ReviewNodeType>(
  node: ReviewNode | undefined,
  type: T
): NodeOfType<T> {
  assert.ok(node)
  assert.equal(node.type, type)
  return node as NodeOfType<T>
}

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

  const heading = expectNode(first.root.children[0], 'heading')
  assert.equal(heading.text, 'One')
  assert.deepEqual(
    heading.children.map((node) => node.type),
    ['unordered-item', 'unordered-item', 'heading']
  )
  const firstItem = expectNode(heading.children[0], 'unordered-item')
  assert.equal(firstItem.children[0]?.text, 'Nested')

  const secondHeading = expectNode(heading.children[2], 'heading')
  assert.deepEqual(
    secondHeading.children.map((node) => node.type),
    ['ordered-item', 'ordered-item', 'code']
  )
  const firstOrdered = expectNode(secondHeading.children[0], 'ordered-item')
  const secondOrdered = expectNode(secondHeading.children[1], 'ordered-item')
  const code = expectNode(secondHeading.children[2], 'code')
  assert.equal(firstOrdered.marker, '1.')
  assert.equal(secondOrdered.marker, '2.')
  assert.equal(firstOrdered.listPosition, 1)
  assert.equal(secondOrdered.listPosition, 2)
  assert.equal(firstOrdered.listLength, 2)
  assert.equal(secondOrdered.listLength, 2)
  assert.equal(code.language, 'js')
  assert.equal(code.text, "console.log('hello')")
  assert.deepEqual(first.unsupported, [])
})

test('reports a selected block position in document order', () => {
  const tree = parseMarkdown(markdown, 'sha256:test')

  assert.deepEqual(nodePosition(tree.root, 'block-1'), { index: 1, total: 8 })
  assert.deepEqual(nodePosition(tree.root, 'block-5'), { index: 5, total: 8 })
  assert.deepEqual(nodePosition(tree.root, 'missing'), { index: 0, total: 8 })
})

test('retains hard-wrapped list content as one block', () => {
  const tree = parseMarkdown(`1. **One item** starts here
   and continues on the next line
2. Another item
`)
  const first = expectNode(tree.root.children[0], 'ordered-item')
  const second = expectNode(tree.root.children[1], 'ordered-item')

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
  const heading = expectNode(tree.root.children[0], 'heading')
  const paragraph = expectNode(heading.children[0], 'paragraph')
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
  const heading = expectNode(tree.root.children[0], 'heading')

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

  const quote = expectNode(heading.children[1], 'blockquote')
  assert.equal(
    quote.raw,
    '> One quoted block.\n>\n> - This list is not a child node.'
  )
  assert.deepEqual(quote.children, [])

  const table = expectNode(heading.children[3], 'table')
  assert.match(table.raw, /^\| State \| Meaning \|/)
  assert.deepEqual(table.children, [])

  const openTask = expectNode(heading.children[4], 'unordered-item')
  const finishedTask = expectNode(heading.children[5], 'unordered-item')
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
  const paragraph = expectNode(tree.root.children[0], 'paragraph')
  assert.equal(
    paragraph.text,
    '<details>\n<summary>Raw HTML</summary>\nHidden text\n</details>'
  )
  assert.deepEqual(tree.unsupported, [])
  assert.equal(tree.sourceDocument.content, source)
})

test('parses YAML frontmatter into a non-editable parent and top-level pairs', () => {
  const source = `---
title: Better frontmatter
tags:
  - markdown
  - review
description: |
  A multiline value.
  Kept with its key.
draft: false
---

# Document
`
  const tree = parseMarkdown(source)
  const frontmatter = expectNode(tree.root.children[0], 'frontmatter')
  const heading = expectNode(tree.root.children[1], 'heading')

  assert.equal(frontmatter.text, 'YAML Frontmatter')
  assert.equal(frontmatter.sourceEditable, false)
  assert.equal(Object.hasOwn(frontmatter, 'collapsed'), false)
  assert.equal(frontmatter.lineStart, 1)
  assert.equal(frontmatter.lineEnd, 10)
  assert.deepEqual(
    frontmatter.children.map(
      (node) => expectNode(node, 'frontmatter-entry').key
    ),
    ['title', 'tags', 'description', 'draft']
  )
  assert.deepEqual(
    frontmatter.children.map((node) => node.type),
    Array(4).fill('frontmatter-entry')
  )
  const title = expectNode(frontmatter.children[0], 'frontmatter-entry')
  const tags = expectNode(frontmatter.children[1], 'frontmatter-entry')
  const description = expectNode(frontmatter.children[2], 'frontmatter-entry')
  const draft = expectNode(frontmatter.children[3], 'frontmatter-entry')
  assert.equal(title.raw, 'title: Better frontmatter')
  assert.equal(title.lineStart, 2)
  assert.equal(title.lineEnd, 2)
  assert.equal(tags.raw, 'tags:\n  - markdown\n  - review')
  assert.equal(tags.lineStart, 3)
  assert.equal(tags.lineEnd, 5)
  assert.equal(
    description.raw,
    'description: |\n  A multiline value.\n  Kept with its key.'
  )
  assert.equal(draft.raw, 'draft: false')
  assert.equal(heading.text, 'Document')
  assert.deepEqual(tree.unsupported, [])
})

test('requires YAML mapping pairs and reports syntax errors', () => {
  assert.equal(yamlDiagnostic('title: Review\ndraft: false'), null)

  for (const source of ['borked', '- one\n- two', '{}']) {
    assert.deepEqual(yamlDiagnostic(source), {
      line: 1,
      column: 1,
      message: 'Expected one or more YAML key: value pairs.'
    })
  }

  const diagnostic = yamlDiagnostic('title: Review\ntags: [broken')
  assert.ok(diagnostic)
  assert.equal(diagnostic.line, 2)
  assert.equal(diagnostic.column, 14)
  assert.match(diagnostic.message, /must be sufficiently indented and end with a \]/)
})

test('accepts an explicit YAML end marker and empty frontmatter', () => {
  const tree = parseMarkdown('---\n...\n\nParagraph.\n')
  const frontmatter = expectNode(tree.root.children[0], 'frontmatter')
  const paragraph = expectNode(tree.root.children[1], 'paragraph')

  assert.deepEqual(frontmatter.children, [])
  assert.equal(paragraph.type, 'paragraph')
  assert.equal(paragraph.lineStart, 4)
})

test('keeps comments visible in the parent and only creates line-safe entries', () => {
  const source = `---
# Frontmatter rationale
title: Review # Shown with its pair
# Applies to the next setting
draft:
---
`
  const tree = parseMarkdown(source)
  const frontmatter = expectNode(tree.root.children[0], 'frontmatter')

  assert.equal(frontmatter.raw, source.trimEnd())
  assert.deepEqual(
    frontmatter.children.map((node) => node.raw),
    ['title: Review # Shown with its pair', 'draft:']
  )
})

test('keeps flow maps and explicit keys on the read-only parent', () => {
  const sources = [
    '---\n{title: Review, draft: false}\n---\n',
    '---\n? title\n: Review\n---\n'
  ]

  for (const source of sources) {
    const frontmatter = expectNode(
      parseMarkdown(source).root.children[0],
      'frontmatter'
    )
    assert.deepEqual(frontmatter.children, [])
    assert.equal(frontmatter.raw, source.trimEnd())
  }
})

test('ignores a nullable YAML mapping key without failing the document', () => {
  const source = '---\n: value\n---\n'
  const frontmatter = expectNode(
    parseMarkdown(source).root.children[0],
    'frontmatter'
  )

  assert.deepEqual(frontmatter.children, [])
  assert.equal(frontmatter.raw, source.trimEnd())
})

test('leaves unclosed, malformed, and non-mapping frontmatter to Markdown', () => {
  const sources = [
    '---\ntitle: unclosed\n',
    '---\ntitle: [invalid\n---\n',
    '---\n- first\n- second\n---\n'
  ]

  for (const source of sources) {
    const tree = parseMarkdown(source)
    assert.equal(
      tree.root.children.some((node) => node.type === 'frontmatter'),
      false
    )
  }
})

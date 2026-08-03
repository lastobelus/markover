const test = require('node:test')
const assert = require('node:assert/strict')
const {
  nodePosition,
  parseMarkdown,
  serializeTree,
  yamlDiagnostic
} = require('../src/tree')

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
  const [frontmatter, heading] = tree.root.children

  assert.equal(frontmatter.type, 'frontmatter')
  assert.equal(frontmatter.text, 'YAML Frontmatter')
  assert.equal(frontmatter.sourceEditable, false)
  assert.equal(frontmatter.collapsed, true)
  assert.equal(frontmatter.lineStart, 1)
  assert.equal(frontmatter.lineEnd, 10)
  assert.deepEqual(
    frontmatter.children.map((node) => node.key),
    ['title', 'tags', 'description', 'draft']
  )
  assert.deepEqual(
    frontmatter.children.map((node) => node.type),
    Array(4).fill('frontmatter-entry')
  )
  assert.equal(frontmatter.children[0].raw, 'title: Better frontmatter')
  assert.equal(frontmatter.children[0].lineStart, 2)
  assert.equal(frontmatter.children[0].lineEnd, 2)
  assert.equal(frontmatter.children[1].raw, 'tags:\n  - markdown\n  - review')
  assert.equal(frontmatter.children[1].lineStart, 3)
  assert.equal(frontmatter.children[1].lineEnd, 5)
  assert.equal(
    frontmatter.children[2].raw,
    'description: |\n  A multiline value.\n  Kept with its key.'
  )
  assert.equal(frontmatter.children[3].raw, 'draft: false')
  assert.equal(heading.type, 'heading')
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
  assert.equal(diagnostic.line, 2)
  assert.equal(diagnostic.column, 14)
  assert.match(diagnostic.message, /must be sufficiently indented and end with a \]/)
})

test('accepts an explicit YAML end marker and empty frontmatter', () => {
  const tree = parseMarkdown('---\n...\n\nParagraph.\n')
  const [frontmatter, paragraph] = tree.root.children

  assert.equal(frontmatter.type, 'frontmatter')
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
  const frontmatter = tree.root.children[0]

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
    const frontmatter = parseMarkdown(source).root.children[0]
    assert.equal(frontmatter.type, 'frontmatter')
    assert.deepEqual(frontmatter.children, [])
    assert.equal(frontmatter.raw, source.trimEnd())
  }
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

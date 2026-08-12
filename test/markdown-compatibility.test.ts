import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import MarkdownIt from 'markdown-it'

const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi
const { sourceUrl } = require('../src/image-preview') as MarkoverImagePreviewApi
const compatibilityMarkdown = MarkdownIt('commonmark', {
  html: false,
  linkify: false,
  typographer: false
})
compatibilityMarkdown.enable('table')

type Classification =
  | 'structured'
  | 'opaque'
  | 'preserved-inline'
  | 'visible-uninterpreted'
  | 'source-only'

interface CompatibilityFixture {
  id: string
  classification: Classification
  source: string
  verify: (tree: ReviewTree) => void
}

function flattenedNodes(root: ReviewNode): ReviewNode[] {
  return root.children.flatMap((node) => [node, ...flattenedNodes(node)])
}

function onlyNode(tree: ReviewTree): ReviewNode {
  assert.equal(tree.root.children.length, 1)
  const node = tree.root.children[0]
  assert.ok(node)
  return node
}

const fixtures: CompatibilityFixture[] = [
  {
    id: 'yaml-frontmatter',
    classification: 'structured',
    source: '---\ntitle: Review\ntags:\n  - markdown\n---\n\n# Body\n',
    verify(tree) {
      const nodes = flattenedNodes(tree.root)
      assert.deepEqual(nodes.map((node) => node.type), [
        'frontmatter',
        'frontmatter-entry',
        'frontmatter-entry',
        'heading'
      ])
      assert.deepEqual(
        nodes.map(({ lineStart, lineEnd }) => [lineStart, lineEnd]),
        [[1, 5], [2, 2], [3, 4], [7, 7]]
      )
      assert.equal(nodes[0]?.raw, '---\ntitle: Review\ntags:\n  - markdown\n---')
    }
  },
  {
    id: 'headings-paragraphs',
    classification: 'structured',
    source: '# ATX\n\nSetext\n------\n\nParagraph.\n',
    verify(tree) {
      const nodes = flattenedNodes(tree.root)
      assert.deepEqual(nodes.map((node) => node.type), [
        'heading',
        'heading',
        'paragraph'
      ])
      assert.deepEqual(
        nodes.map(({ lineStart, lineEnd }) => [lineStart, lineEnd]),
        [[1, 1], [3, 4], [6, 6]]
      )
      assert.equal(nodes[1]?.raw, 'Setext\n------')
    }
  },
  {
    id: 'lists-tasks',
    classification: 'structured',
    source: '3. First\r\n4. [x] Done\r\n   continued\r\n   - Nested\r\n',
    verify(tree) {
      const nodes = flattenedNodes(tree.root)
      assert.deepEqual(nodes.map((node) => node.type), [
        'ordered-item',
        'ordered-item',
        'unordered-item'
      ])
      const task = nodes[1]
      assert.ok(task?.type === 'ordered-item')
      assert.equal(task.marker, '4.')
      assert.equal(task.task, true)
      assert.equal(task.checked, true)
      assert.equal(task.raw, '4. [x] Done\n   continued')
      assert.deepEqual(
        nodes.map(({ lineStart, lineEnd }) => [lineStart, lineEnd]),
        [[1, 1], [2, 3], [4, 4]]
      )
    }
  },
  {
    id: 'code-blocks',
    classification: 'structured',
    source: '```js\nconst x = 1\n```\n\n    indented\n',
    verify(tree) {
      const nodes = tree.root.children
      assert.deepEqual(nodes.map((node) => node.type), ['code', 'code'])
      const fenced = nodes[0]
      const indented = nodes[1]
      assert.ok(fenced?.type === 'code')
      assert.ok(indented?.type === 'code')
      assert.equal(fenced.language, 'js')
      assert.equal(fenced.raw, '```js\nconst x = 1\n```')
      assert.equal(indented.language, '')
      assert.deepEqual(
        nodes.map(({ lineStart, lineEnd }) => [lineStart, lineEnd]),
        [[1, 3], [5, 5]]
      )
    }
  },
  {
    id: 'thematic-breaks',
    classification: 'structured',
    source: 'Before\n\n---\n\nAfter\n',
    verify(tree) {
      const nodes = tree.root.children
      assert.deepEqual(nodes.map((node) => node.type), [
        'paragraph',
        'thematic-break',
        'paragraph'
      ])
      assert.deepEqual(
        nodes.map(({ lineStart, lineEnd }) => [lineStart, lineEnd]),
        [[1, 1], [3, 3], [5, 5]]
      )
    }
  },
  {
    id: 'block-quotes',
    classification: 'opaque',
    source: '> Quote\n>\n> - Nested\n',
    verify(tree) {
      const quote = onlyNode(tree)
      assert.equal(quote.type, 'blockquote')
      assert.equal(quote.raw, '> Quote\n>\n> - Nested')
      assert.deepEqual(quote.children, [])
      assert.deepEqual([quote.lineStart, quote.lineEnd], [1, 3])
    }
  },
  {
    id: 'pipe-tables',
    classification: 'opaque',
    source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n',
    verify(tree) {
      const tableNode = onlyNode(tree)
      assert.equal(tableNode.type, 'table')
      assert.equal(tableNode.raw, '| A | B |\n| --- | --- |\n| 1 | 2 |')
      assert.deepEqual(tableNode.children, [])
      assert.deepEqual([tableNode.lineStart, tableNode.lineEnd], [1, 3])
    }
  },
  {
    id: 'inline-formatting',
    classification: 'preserved-inline',
    source: 'Use **strong**, *emphasis*, and `code`.\n',
    verify(tree) {
      const paragraph = onlyNode(tree)
      assert.equal(paragraph.type, 'paragraph')
      assert.equal(paragraph.text, 'Use **strong**, *emphasis*, and `code`.')
      assert.equal(paragraph.raw, paragraph.text)
    }
  },
  {
    id: 'links-images',
    classification: 'preserved-inline',
    source: 'See [label](https://example.com) and ![diagram](diagram.png).\n',
    verify(tree) {
      const paragraph = onlyNode(tree)
      assert.equal(paragraph.type, 'paragraph')
      assert.equal(
        paragraph.text,
        'See [label](https://example.com) and ![diagram](diagram.png).'
      )
      assert.equal(paragraph.raw, paragraph.text)
      assert.equal(sourceUrl('diagram.png'), null)
      assert.equal(sourceUrl('https://example.com/diagram.png'), null)
      assert.equal(
        sourceUrl('data:image/png;base64,AA=='),
        'data:image/png;base64,AA=='
      )
    }
  },
  {
    id: 'raw-html',
    classification: 'visible-uninterpreted',
    source: '<details>\n<summary>Text</summary>\nBody\n</details>\n',
    verify(tree) {
      const paragraph = onlyNode(tree)
      assert.equal(paragraph.type, 'paragraph')
      assert.equal(
        paragraph.text,
        '<details>\n<summary>Text</summary>\nBody\n</details>'
      )
      assert.deepEqual([paragraph.lineStart, paragraph.lineEnd], [1, 4])
    }
  },
  {
    id: 'extension-markers',
    classification: 'visible-uninterpreted',
    source: '~~deleted~~\n\nTerm\n: definition\n\nCall [^note].\n',
    verify(tree) {
      const nodes = tree.root.children
      assert.deepEqual(
        nodes.map((node) => node.type),
        ['paragraph', 'paragraph', 'paragraph']
      )
      assert.deepEqual(
        nodes.map((node) => node.text),
        ['~~deleted~~', 'Term\n: definition', 'Call [^note].']
      )
      assert.deepEqual(
        nodes.map(({ lineStart, lineEnd }) => [lineStart, lineEnd]),
        [[1, 1], [3, 4], [6, 6]]
      )
    }
  },
  {
    id: 'reference-links',
    classification: 'visible-uninterpreted',
    source: 'A [label][id].\n\n[id]: https://example.com "Title"\n',
    verify(tree) {
      const paragraph = onlyNode(tree)
      assert.equal(paragraph.type, 'paragraph')
      assert.equal(paragraph.text, 'A [label][id].')
      assert.deepEqual([paragraph.lineStart, paragraph.lineEnd], [1, 1])
      assert.equal(
        compatibilityMarkdown.renderInline(paragraph.text),
        'A [label][id].'
      )
    }
  },
  {
    id: 'reference-definitions',
    classification: 'source-only',
    source: '[id]: https://example.com "Title"\n\n[^note]: Note\n',
    verify(tree) {
      assert.deepEqual(tree.root.children, [])
    }
  }
]

test('the public compatibility matrix maps one-to-one to executable fixtures', () => {
  const projectDirectory = path.resolve(__dirname, '../..')
  const html = fs.readFileSync(
    path.join(projectDirectory, 'docs/user/limitations/index.html'),
    'utf8'
  )
  const document = new JSDOM(html).window.document
  const rows = [...document.querySelectorAll<HTMLTableRowElement>(
    'tr[data-compatibility-id]'
  )]

  assert.deepEqual(
    rows.map((row) => ({
      id: row.dataset.compatibilityId,
      classification: row.dataset.classification
    })),
    fixtures.map(({ id, classification }) => ({ id, classification }))
  )
})

test('the Markdown compatibility fixtures preserve their published behavior', () => {
  for (const fixture of fixtures) {
    const tree = parseMarkdown(fixture.source, `sha256:${fixture.id}`)
    assert.equal(
      tree.sourceDocument.content,
      fixture.source,
      `${fixture.id} must preserve its exact source`
    )
    assert.deepEqual(
      tree.unsupported,
      [],
      `${fixture.id} must use its published degradation behavior`
    )
    fixture.verify(tree)
  }
})

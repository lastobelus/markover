import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import type { SyntaxHighlightResult } from '../src/contracts'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

interface SyntaxHighlightModule {
  highlight(
    source: string,
    language: string
  ): Promise<SyntaxHighlightResult | null>
}

async function highlighter(): Promise<SyntaxHighlightModule> {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '../src/pierre-diffs-entry.mjs')
  ).href
  return import(moduleUrl) as Promise<SyntaxHighlightModule>
}

function highlightedText(result: SyntaxHighlightResult): string {
  return result.lines
    .map((line) => line.map((token) => token.content).join(''))
    .join('\n')
}

test('highlights HTML, JavaScript, and Ruby with Pierre light and dark colors', async () => {
  const syntax = await highlighter()
  const examples = [
    ['html', '<button type="button">Open</button>'],
    ['javascript', 'const review = { ready: true }'],
    ['ruby', 'puts Review.new(language: "ruby").ready?']
  ] as const

  for (const [language, source] of examples) {
    const result = await syntax.highlight(source, language)
    assert.ok(result)
    assert.equal(highlightedText(result), source)
    assert.ok(result.lines.flat().some((token) => (
      token.lightColor !== token.darkColor
    )))
  }
})

test('normalizes common fence aliases', async () => {
  const syntax = await highlighter()
  const result = await syntax.highlight('const answer = 42', 'js')
  assert.ok(result)
  assert.equal(highlightedText(result), 'const answer = 42')
})

test('extracts the language from fenced-block metadata', async () => {
  const syntax = await highlighter()
  const source = 'const answer = 42'
  const result = await syntax.highlight(source, 'js title=demo')
  assert.ok(result)
  assert.equal(highlightedText(result), source)
})

test('unknown and oversized source falls back to plain text', async () => {
  const syntax = await highlighter()
  assert.equal(await syntax.highlight('plain', 'not-a-real-language'), null)
  assert.equal(await syntax.highlight('x'.repeat(20_001), 'javascript'), null)
})

test('renderer builds token spans without injecting source HTML', () => {
  const renderer = read('src/renderer.ts')
  const styles = read('src/styles.css')
  const start = renderer.indexOf('function syntaxTokenElement')
  const end = renderer.indexOf('const inlineMarkdown', start)
  const highlighting = renderer.slice(start, end)

  assert.match(highlighting, /span\.textContent = token\.content/)
  assert.match(highlighting, /code\.replaceChildren\(fragment\)/)
  assert.doesNotMatch(highlighting, /innerHTML|insertAdjacentHTML/)
  assert.match(styles, /\.syntax-token \{\s*color: var\(--syntax-light\);/)
  assert.match(styles, /data-appearance="dark"\] \.syntax-token \{\s*color: var\(--syntax-dark\);/)
})

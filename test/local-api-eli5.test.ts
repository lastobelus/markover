import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { JSDOM } from 'jsdom'

const root = path.resolve(__dirname, '../..')
const relativePath =
  'doc/explanations/2026-08-03__local-api-authorization-eli5.html'
const filePath = path.join(root, relativePath)
const source = fs.readFileSync(filePath, 'utf8')

test('local API ELI5 is self-contained and truth-scoped', () => {
  assert.doesNotMatch(source, /<script[^>]+src=/)
  assert.doesNotMatch(source, /<link[^>]+rel=["']stylesheet/)
  assert.doesNotMatch(source, /https?:\/\/[^"']+\.(?:css|js|woff2?)/)
  assert.match(
    source,
    /Draft PR 67 · issue 12 final slice · 6 Aug 2026/
  )
  assert.match(source, /name tag, not a lock/i)
  assert.match(source, /never kill/i)
  assert.match(source, /does not replay/i)
  assert.match(source, /One gate in front of every review route/)
  assert.match(source, /No telemetry, analytics, cloud sync/)
  assert.match(source, /Discover agent thread from local session logs/)
  assert.match(source, /An agent handoff crosses the Markover boundary/)
  assert.match(source, /One process per macOS user/)
  assert.ok(
    source.indexOf('<details class="truth-context">') <
      source.indexOf('The Tiny Story')
  )
})

test('local API ELI5 diagrams and local references remain accessible', () => {
  const dom = new JSDOM(source, {
    runScripts: 'dangerously',
    url: pathToFileURL(filePath).href
  })
  const document = dom.window.document
  const context = document.querySelector('details.truth-context')
  assert.ok(context)
  assert.equal(context.hasAttribute('open'), false)
  assert.match(context.querySelector('summary')?.textContent || '', /Where This Is True/)

  const diagrams = [...document.querySelectorAll('svg[role="img"]')]
  assert.equal(diagrams.length, 2)
  for (const diagram of diagrams) {
    assert.ok(diagram.querySelector('title')?.textContent)
    assert.ok(diagram.querySelector('desc')?.textContent)
  }

  const localLinks = [...document.querySelectorAll<HTMLAnchorElement>(
    'a[data-repo-path]'
  )]
  assert.ok(localLinks.length >= 8)
  for (const link of localLinks) {
    assert.match(link.href, /^file:\/\//)
    assert.doesNotMatch(link.getAttribute('href') || '', /\.\./)
  }
  dom.window.close()
})

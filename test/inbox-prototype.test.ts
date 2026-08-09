import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'

async function prototypeDocument(): Promise<Document> {
  const html = await fs.readFile('src/index.html', 'utf8')
  return new JSDOM(html).window.document
}

test('development inbox fixture covers the selected review identities', async () => {
  const document = await prototypeDocument()
  const prototype = document.querySelector<HTMLElement>('#inbox-prototype')
  assert.ok(prototype)
  assert.equal(prototype.hidden, true)

  const inbox = prototype.querySelector('.inbox-prototype-inbox-panel')
  const needsReview = inbox?.querySelector('.inbox-prototype-review-list')
  assert.ok(needsReview)
  assert.equal(needsReview.children.length, 5)

  const threadTitles = Array.from(
    needsReview.querySelectorAll('.inbox-prototype-thread-title strong')
  ).map((element) => element.textContent.trim())
  assert.equal(
    threadTitles.filter((title) => title === 'Improve inbox / review management').length,
    2
  )
  assert.match(needsReview.textContent || '', /2026-08-09__review-inbox-layout-follow-up\.md/)
  assert.match(needsReview.textContent || '', /Local review/)
  assert.match(needsReview.textContent || '', /Branch unavailable/)
  assert.ok(prototype.querySelector('.inbox-prototype-history'))
})

test('development inbox fixture includes projects, rollups, and a closeable working set', async () => {
  const document = await prototypeDocument()
  const prototype = document.querySelector<HTMLElement>('#inbox-prototype')
  assert.ok(prototype)

  const projects = prototype.querySelector('.inbox-prototype-projects-panel')
  assert.ok(projects)
  assert.match(projects.textContent || '', /4 editing · 8m/)
  assert.match(projects.textContent || '', /2 editing · 8m/)
  assert.match(projects.textContent || '', /Local reviews/)
  assert.ok(projects.querySelector('details:not([open])'))

  const tabs = prototype.querySelectorAll('.inbox-prototype-document-tab')
  assert.equal(tabs.length, 3)
  for (const tab of tabs) {
    assert.ok(tab.querySelector('[aria-label="Close tab"]'))
  }
})

test('prototype styling is query-gated and has narrow and medium width bounds', async () => {
  const styles = await fs.readFile('src/styles.css', 'utf8')
  assert.match(
    styles,
    /html\[data-inbox-prototype="true"\] #inbox-prototype\[hidden\]/
  )
  assert.match(styles, /@media \(max-width: 1100px\)/)
  assert.match(styles, /@media \(max-width: 760px\)/)
  assert.match(
    styles,
    /\.inbox-prototype-row-meta \{[\s\S]*?font-size: 10px;/
  )
})

test('the durable prototype launcher preserves the fixture query in-browser', async () => {
  const launcher = await fs.readFile('review-inbox-prototype.html', 'utf8')
  assert.match(
    launcher,
    /url=build\/app\/src\/index\.html\?inboxPrototype=1&amp;palette=ocean&amp;appearance=light/
  )
  assert.doesNotMatch(launcher, /(?:\.\.\/|file:|localhost|127\.0\.0\.1)/)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('canonical brand SVGs use only the normalized semantic inks', () => {
  for (const name of ['markover-mark.svg', 'markover-logotype.svg', 'markover-lockup.svg']) {
    const source = read(`design/brand/${name}`)
    assert.doesNotMatch(source, /rgb\(/)
    const fills = [...source.matchAll(/style="fill:(#[0-9a-f]{6})"/g)]
      .map((match) => match[1])
    assert.ok(fills.length > 0)
    assert.deepEqual([...new Set(fills)].sort(), ['#6d211f', '#c94e1f'])
  }
})

test('the app composes external brand assets and exposes a true empty state', () => {
  const html = read('src/index.html')
  const renderer = read('src/renderer.js')

  assert.match(html, /class="brand" role="img" aria-label="Markover"/)
  assert.match(html, /design\/brand\/markover-mark\.svg/)
  assert.match(html, /design\/brand\/markover-logotype\.svg/)
  assert.match(html, /design\/brand\/markover-lockup\.svg/)
  assert.equal(html.includes('>M/</'), false)
  assert.match(html, /<header class="app-header is-empty">/)
  assert.match(html, /<main id="empty-workspace" class="empty-workspace">/)
  assert.match(html, /<main id="workspace" class="workspace" hidden>/)
  assert.match(renderer, /function setWorkspaceEmpty\(empty\)/)
  assert.match(renderer, /function activateReview\(reviewId\) \{\s*setWorkspaceEmpty\(false\)/)
  assert.match(renderer, /setWorkspaceEmpty\(true\)/)
  assert.doesNotMatch(renderer, /SAMPLE_MARKDOWN/)
})

test('the application palette matches the brand brief at startup and in CSS', () => {
  const styles = read('src/styles.css')
  const main = read('src/main.js')

  for (const token of [
    '--brand-orange: #c94e1f',
    '--brand-burgundy: #6d211f',
    '--ink: #26211e',
    '--muted: #756d67',
    '--paper: #eee8e0',
    '--surface: #fffdf9',
    '--line: #ddd5cc',
    '--brand-soft: #f5e3da'
  ]) assert.match(styles, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.brand-logotype \{\s*display: none;/)
  assert.match(main, /backgroundColor: '#eee8e0'/)
})

test('the working header aligns the brand and uses the primary action color', () => {
  const styles = read('src/styles.css')

  assert.match(styles, /\.brand \{[^}]*align-items: flex-end;/)
  assert.match(styles, /\.button-primary \{[^}]*background: var\(--brand-orange\);/)
})

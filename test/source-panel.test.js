const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const read = (relativePath) => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('source preview wraps, grows to twelve lines, and remains collapsible', () => {
  const html = read('src/index.html')
  const renderer = read('src/renderer.js')
  const styles = read('src/styles.css')

  assert.match(html, /id="source-toggle"[\s\S]*aria-controls="source-content"/)
  assert.match(renderer, /elements\.sourceToggle\.addEventListener\('click',[\s\S]*state\.sourceCollapsed = !state\.sourceCollapsed/)
  assert.match(styles, /\.selected-source \{[^}]*max-height: calc\(17\.4em \+ 20px\);/)
  assert.match(styles, /\.selected-source \{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/)
  assert.match(styles, /\.selected-source \{[^}]*overflow-wrap: anywhere;[^}]*white-space: pre-wrap;/)
})

test('frontmatter parent source is read-only while entries use plain monospace styling', () => {
  const renderer = read('src/renderer.js')
  const styles = read('src/styles.css')

  assert.match(renderer, /isCurrentReviewEditable\(\) && node\.sourceEditable !== false/)
  assert.match(renderer, /content\.className = `block-content frontmatter-entry/)
  assert.match(renderer, /node\.type === 'frontmatter-entry'[\s\S]*node\.sourceEdit\?\.current \|\| node\.text/)
  assert.match(
    styles,
    /\.block-content\.frontmatter-entry \{[^}]*ui-monospace[^}]*white-space: pre-wrap;/
  )
})

test('saved invalid YAML marks the closed source card without blocking edits', () => {
  const html = read('src/index.html')
  const renderer = read('src/renderer.js')
  const styles = read('src/styles.css')

  assert.match(html, /id="source-error-tooltip"[\s\S]*role="tooltip"/)
  assert.match(renderer, /!editing && node\.type === 'frontmatter-entry' && node\.sourceEdit/)
  assert.match(renderer, /MarkoverTree\.yamlDiagnostic\(node\.sourceEdit\.current\)/)
  assert.match(renderer, /sourcePanel\.dataset\.yamlError = yamlError\?\.message \|\| ''/)
  assert.match(renderer, /sourceToggle\.setAttribute\('aria-describedby', 'source-error-tooltip'\)/)
  assert.match(renderer, /sourcePanel\.addEventListener\('mouseenter', showSourceErrorTooltip\)/)
  assert.match(renderer, /sourcePanel\.addEventListener\('focusin', showSourceErrorTooltip\)/)
  assert.match(renderer, /MarkoverAnnotationBlock\.popoverPosition\(/)
  assert.match(renderer, /if \(!elements\.sourceErrorTooltip\.hidden\) showSourceErrorTooltip\(\)/)
  assert.match(styles, /\.source-panel\.has-yaml-error \{[^}]*border-color: var\(--source-error\);[^}]*box-shadow:/)
  assert.match(styles, /\.source-panel\.has-yaml-error \.source-header \{[^}]*background:/)
  assert.match(styles, /\.source-error-tooltip \{[^}]*position: fixed;[^}]*pointer-events: none;/)
})

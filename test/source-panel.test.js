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

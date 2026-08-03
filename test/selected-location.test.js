const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('the line indicator becomes a scroll target only while its row is offscreen', () => {
  const html = read('src/index.html')
  const renderer = read('src/renderer.js')
  const styles = read('src/styles.css')

  assert.match(html, /id="selected-location"[\s\S]*class="status-pill selected-location"[\s\S]*disabled/)
  assert.match(renderer, /function updateSelectedLocationControl\(\)[\s\S]*isOutsideViewport\(/)
  assert.match(renderer, /const isOffscreen = Boolean\(selectedRow\) && \([\s\S]*!hasVisibleGeometry/)
  assert.match(renderer, /elements\.selectedLocation\.disabled = !isOffscreen/)
  assert.match(renderer, /`Scroll to \$\{location\.toLowerCase\(\)\}`/)
  assert.match(renderer, /function scrollToSelectedRow\(\)[\s\S]*revealAnnotation\([\s\S]*renderTree\(\)[\s\S]*scrollIntoView\(\{ block: 'center' \}\)/)
  assert.match(renderer, /elements\.selectedLocation\.addEventListener\('click', scrollToSelectedRow\)/)
  assert.match(styles, /\.selected-location\.is-scroll-target \{[^}]*border-color: var\(--accent\);[^}]*background: var\(--input\);/)
  assert.match(styles, /\.selected-location\.is-scroll-target::before \{[^}]*clip-path: polygon\(/)
})

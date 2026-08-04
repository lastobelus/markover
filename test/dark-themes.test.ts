import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('dark palettes use their selected colorization and accent roles', () => {
  const html = read('src/index.html')
  const renderer = read('src/renderer.ts')
  const styles = read('src/styles.css')

  assert.match(styles, /data-palette="ember"\]\[data-appearance="dark"\]\[data-colorization="low"\][\s\S]*--ink: #dfdedd;[\s\S]*--ink-rgb: 223 222 221;/)
  assert.match(styles, /data-palette="ocean"\]\[data-appearance="dark"\]\[data-colorization="mid"\]/)
  assert.match(styles, /data-palette="olive"\]\[data-appearance="dark"\]\[data-colorization="low"\][\s\S]*--markover-primary: #b5d52a;[\s\S]*--markover-secondary: #4e5828;/)
  assert.doesNotMatch(html, /Dark colorization|ember-ink-slider/)
  assert.doesNotMatch(renderer, /emberInkShade|EMBER_INK_SHADE_KEY/)
})

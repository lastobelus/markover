const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (relativePath) => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('macOS packaging produces a branded application bundle', () => {
  const packageJson = require('../package.json')
  const packaging = read('scripts/package-macos.js')
  const main = read('src/main.js')
  const icon = fs.readFileSync(
    path.join(root, 'design/brand/markover-app-icon.icns')
  )

  assert.equal(packageJson.productName, 'Markover')
  assert.equal(typeof packageJson.devDependencies['@electron/packager'], 'string')
  assert.match(packageJson.scripts['package:mac'], /build:icon:mac/)
  assert.equal(icon.subarray(0, 4).toString(), 'icns')
  assert.match(packaging, /'Markover'/)
  assert.match(packaging, /--app-bundle-id=com\.lastobelus\.markover/)
  assert.match(packaging, /--helper-bundle-id=com\.lastobelus\.markover\.helper/)
  assert.match(packaging, /--icon=design\/brand\/markover-app-icon\.icns/)
  assert.match(packaging, /'\/usr\/bin\/codesign'/)
  assert.match(packaging, /local ad-hoc-signed build/)
  assert.match(main, /new ReviewStore\(reviewsDirectory\(\)\)/)
  assert.match(main, /process\.platform === 'darwin' && !app\.isPackaged/)
})

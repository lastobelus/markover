import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { copyThirdPartyNotices } from '../scripts/package-macos'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

interface PackageManifest {
  devDependencies: Record<string, string>
  productName: string
  scripts: Record<string, string>
}

test('macOS packaging produces a branded application bundle', () => {
  const packageJson = JSON.parse(read('package.json')) as PackageManifest
  const packaging = read('scripts/package-macos.ts')
  const main = read('src/main.js')
  const icon = fs.readFileSync(
    path.join(root, 'design/brand/markover-app-icon.icns')
  )

  assert.equal(packageJson.productName, 'Markover')
  assert.equal(typeof packageJson.devDependencies['@electron/packager'], 'string')
  const packageCommand = packageJson.scripts['package:mac']
  assert.ok(packageCommand)
  assert.match(packageCommand, /build:icon:mac/)
  assert.equal(icon.subarray(0, 4).toString(), 'icns')
  assert.match(packaging, /'Markover'/)
  assert.match(packaging, /--app-bundle-id=com\.lastobelus\.markover/)
  assert.match(packaging, /--helper-bundle-id=com\.lastobelus\.markover\.helper/)
  assert.match(packaging, /--icon=design\/brand\/markover-app-icon\.icns/)
  assert.equal(packaging.includes('eslint\\\\.config'), true)
  assert.equal(packaging.includes('tsconfig\\\\.json'), true)
  assert.match(packaging, /examples\|packages\|scripts\|src\|test/)
  assert.match(packaging, /'\/usr\/bin\/codesign'/)
  assert.ok(
    packaging.indexOf('copyThirdPartyNotices(appPath)') <
      packaging.indexOf("spawnSync(\n    '/usr/bin/codesign'")
  )
  assert.match(packaging, /local ad-hoc-signed build/)
  assert.match(main, /new ReviewStore\(reviewsDirectory\(\)\)/)
  assert.match(main, /process\.platform === 'darwin' && !app\.isPackaged/)
})

test('macOS packaging places application and runtime notices inside the app', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-package-'))
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const appPath = path.join(directory, 'Markover.app')
  const electronDirectory = path.join(directory, 'node_modules/electron/dist')
  fs.mkdirSync(electronDirectory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'THIRD_PARTY_NOTICES.md'), 'application')
  fs.writeFileSync(path.join(electronDirectory, 'LICENSE'), 'electron')
  fs.writeFileSync(path.join(electronDirectory, 'LICENSES.chromium.html'), 'chromium')

  copyThirdPartyNotices(appPath, { rootDirectory: directory })

  const licenses = path.join(appPath, 'Contents/Resources/licenses')
  assert.equal(fs.readFileSync(path.join(licenses, 'THIRD_PARTY_NOTICES.md'), 'utf8'), 'application')
  assert.equal(fs.readFileSync(path.join(licenses, 'ELECTRON_LICENSE'), 'utf8'), 'electron')
  assert.equal(fs.readFileSync(path.join(licenses, 'CHROMIUM_LICENSES.html'), 'utf8'), 'chromium')
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  adHocSigningOptions,
  copyThirdPartyNotices
} from '../scripts/package-macos'
import {
  entitlementsForSignedFile,
  minimumMacosVersion,
  parseMacosTrustMode
} from '../scripts/macos-release-contract'

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
  const iconBuilder = read('scripts/build-macos-icon.ts')
  const main = read('src/main.ts')
  const icon = fs.readFileSync(
    path.join(root, 'design/brand/markover-app-icon.icns')
  )

  assert.equal(packageJson.productName, 'Markover')
  assert.equal(typeof packageJson.devDependencies['@electron/packager'], 'string')
  assert.equal(typeof packageJson.devDependencies['@electron/osx-sign'], 'string')
  const packageCommand = packageJson.scripts['package:mac']
  assert.ok(packageCommand)
  assert.match(packageCommand, /build:icon:mac/)
  assert.match(packageCommand, /--trust-mode=ad-hoc/)
  assert.match(iconBuilder, /path\.resolve\(__dirname, '\.\.\/\.\.'\)/)
  assert.equal(icon.subarray(0, 4).toString(), 'icns')
  assert.match(packaging, /'Markover'/)
  assert.match(packaging, /--app-bundle-id=com\.lastobelus\.markover/)
  assert.match(packaging, /--helper-bundle-id=com\.lastobelus\.markover\.helper/)
  assert.match(packaging, /--icon=design\/brand\/markover-app-icon\.icns/)
  assert.equal(packaging.includes('eslint\\\\.config'), true)
  assert.equal(packaging.includes('tsconfig\\\\.json'), true)
  assert.match(packaging, /examples\|packages\|scripts\|src\|test/)
  assert.doesNotMatch(packaging, /--deep/)
  assert.match(packaging, /await sign\(adHocSigningOptions\(appPath\)\)/)
  assert.ok(
    packaging.indexOf('copyThirdPartyNotices(appPath)') <
      packaging.indexOf('setMinimumSystemVersion(appPath)')
  )
  assert.ok(
    packaging.indexOf('setMinimumSystemVersion(appPath)') <
      packaging.indexOf('await sign(adHocSigningOptions(appPath))')
  )
  assert.match(packaging, /hardened ad-hoc-signed build/)
  assert.match(packaging, /not Apple-verified or notarized/)
  assert.match(main, /new ReviewStore\(reviewsDirectory\(\)\)/)
  assert.match(main, /process\.platform === 'darwin' && !app\.isPackaged/)
})

test('macOS packaging uses an explicit fail-closed ad-hoc signing contract', () => {
  const rootDirectory = path.join(path.sep, 'repo')
  const appPath = path.join(rootDirectory, 'dist', 'Markover.app')
  const options = adHocSigningOptions(appPath, rootDirectory)

  assert.equal(parseMacosTrustMode('ad-hoc'), 'ad-hoc')
  assert.throws(() => parseMacosTrustMode(undefined), /trust mode is required/)
  assert.throws(() => parseMacosTrustMode('developer-id'), /Unsupported/)
  assert.deepEqual({
    identity: options.identity,
    identityValidation: options.identityValidation,
    platform: options.platform,
    preAutoEntitlements: options.preAutoEntitlements,
    preEmbedProvisioningProfile: options.preEmbedProvisioningProfile,
    strictVerify: options.strictVerify
  }, {
    identity: '-',
    identityValidation: false,
    platform: 'darwin',
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true
  })
  const renderer = path.join(
    appPath,
    'Contents/Frameworks/Markover Helper (Renderer).app'
  )
  const framework = path.join(
    appPath,
    'Contents/Frameworks/Electron Framework.framework'
  )
  const mainExecutable = path.join(appPath, 'Contents/MacOS/Markover')
  assert.deepEqual(options.optionsForFile(renderer), {
    entitlements: path.join(
      rootDirectory,
      'config/macos/entitlements/helper-renderer.plist'
    ),
    hardenedRuntime: true,
    timestamp: 'none'
  })
  assert.equal(
    entitlementsForSignedFile(appPath, framework, rootDirectory),
    path.join(rootDirectory, 'config/macos/entitlements/code.plist')
  )
  assert.equal(
    entitlementsForSignedFile(appPath, mainExecutable, rootDirectory),
    path.join(rootDirectory, 'config/macos/entitlements/app.plist')
  )
  assert.equal(minimumMacosVersion, '14.0')
})

test('checked-in entitlements exclude broad device and memory grants', () => {
  const directory = path.join(root, 'config/macos/entitlements')
  const files = fs.readdirSync(directory).sort()
  assert.deepEqual(files, [
    'app.plist',
    'code.plist',
    'helper-gpu.plist',
    'helper-plugin.plist',
    'helper-renderer.plist',
    'helper.plist'
  ])
  const contents = files.map((file) => fs.readFileSync(
    path.join(directory, file),
    'utf8'
  )).join('\n')
  assert.doesNotMatch(contents, /device\.|personal-information/)
  assert.doesNotMatch(contents, /allow-unsigned-executable-memory/)
  assert.doesNotMatch(contents, /disable-library-validation/)
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

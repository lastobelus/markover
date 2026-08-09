import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  mutateAsarHeader,
  successfulSmoke
} from '../scripts/macos-hardening-probes'
import {
  adHocSigningOptions,
  copyThirdPartyNotices,
  loadThirdPartyNotices,
  runPackagedSmoke
} from '../scripts/package-macos'
import {
  assertMacosFusePolicy,
  assertNoDisallowedInfoPlistCapabilities,
  disallowedInfoPlistCapabilityKeys,
  entitlementsForSignedFile,
  helperBundleId,
  macosFusePolicy,
  minimumMacosVersion,
  parseMacosTrustMode,
  signedAppComponents
} from '../scripts/macos-release-contract'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

interface PackageManifest {
  author: string
  copyright: string
  devDependencies: Record<string, string>
  license: string
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
  assert.equal(packageJson.author, 'Michael Johnston (lastobelus)')
  assert.equal(
    packageJson.copyright,
    'Copyright © 2026 Michael Johnston (lastobelus)'
  )
  assert.equal(packageJson.license, 'MIT')
  assert.match(packageJson.scripts['package:mac'] ?? '', /^install-electron --no &&/)
  assert.equal(typeof packageJson.devDependencies['@electron/packager'], 'string')
  assert.equal(typeof packageJson.devDependencies['@electron/asar'], 'string')
  assert.equal(typeof packageJson.devDependencies['@electron/fuses'], 'string')
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
  assert.match(packaging, /--extend-info=/)
  const extendedInfo = read('config/macos/info.plist')
  assert.match(extendedInfo, /<key>CFBundleURLTypes<\/key>/)
  assert.match(extendedInfo, /<string>markover<\/string>/)
  assert.doesNotMatch(extendedInfo, /markover-/)
  assert.deepEqual(
    signedAppComponents.slice(1).map((component) => component.bundleId),
    Array(4).fill(helperBundleId)
  )
  assert.match(packaging, /const appDirectory = path\.join\(projectDirectory, 'build\/app'\)/)
  assert.match(packaging, /`--icon=\$\{path\.join\(projectDirectory, 'design\/brand\/markover-app-icon\.icns'\)\}`/)
  assert.match(packaging, /appDirectory,\n {4}'Markover'/)
  assert.match(packaging, /'--prune=false'/)
  assert.doesNotMatch(packaging, /--ignore=/)
  assert.doesNotMatch(packaging, /--deep/)
  assert.match(packaging, /await sign\(adHocSigningOptions\(appPath\)\)/)
  assert.ok(
    packaging.indexOf('await verifyPackagedAppLayout(appPath)') <
      packaging.indexOf('copyThirdPartyNotices(appPath, thirdPartyNotices)')
  )
  assert.ok(
    packaging.indexOf('copyThirdPartyNotices(appPath, thirdPartyNotices)') <
      packaging.indexOf('setMinimumSystemVersion(appPath)')
  )
  assert.ok(
    packaging.indexOf('setMinimumSystemVersion(appPath)') <
      packaging.indexOf('sanitizePackagedCapabilities(appPath)')
  )
  assert.ok(
    packaging.indexOf('sanitizePackagedCapabilities(appPath)') <
      packaging.indexOf('await applyMacosFusePolicy(appPath)')
  )
  assert.ok(
    packaging.indexOf('await applyMacosFusePolicy(appPath)') <
      packaging.indexOf('await sign(adHocSigningOptions(appPath))')
  )
  assert.ok(
    packaging.indexOf('await sign(adHocSigningOptions(appPath))') <
      packaging.indexOf('await readMacosFusePolicy(appPath)')
  )
  assert.ok(
    packaging.indexOf('await readMacosFusePolicy(appPath)') <
      packaging.indexOf('runPackagedSmoke(appPath)')
  )
  assert.ok(
    packaging.indexOf('runPackagedSmoke(appPath)') <
      packaging.indexOf('await runPackagedHardeningProbes(appPath')
  )
  assert.match(packaging, /hardened ad-hoc-signed build/)
  assert.match(packaging, /not Apple-verified or notarized/)
  assert.match(
    main,
    /new ReviewStore\([\s\S]*smokeStateDirectory[\s\S]*: path\.join\(addressedInstance\.stateRoot, 'reviews'\)/
  )
  assert.match(main, /process\.platform === 'darwin' && !app\.isPackaged && !smokeMode/)
  assert.ok(
    main.indexOf('app.setAboutPanelOptions') <
      main.indexOf('installApplicationMenu()')
  )
})

test('packaged hardening probes recognize smoke and tamper ASAR headers', async (t) => {
  assert.equal(successfulSmoke(JSON.stringify({
    format: 'markover-smoke',
    version: 1,
    ok: true
  })), true)
  assert.equal(successfulSmoke('{"ok":true}'), false)

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-asar-probe-'))
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const header = JSON.stringify({
    files: {
      'main.js': {
        integrity: {
          algorithm: 'SHA256',
          hash: 'a'.repeat(64)
        }
      }
    }
  })
  const archivePath = path.join(directory, 'app.asar')
  fs.writeFileSync(archivePath, Buffer.concat([
    Buffer.from('prefix'),
    Buffer.from(header),
    Buffer.from('payload')
  ]))
  await mutateAsarHeader(archivePath, header)
  const tampered = fs.readFileSync(archivePath, 'utf8')
  assert.match(tampered, /"hash":"b[a-f0-9]{63}"/)
  assert.equal(tampered.length, 'prefix'.length + header.length + 'payload'.length)
})

test('macOS packaging declares an exhaustive fuse and capability policy', () => {
  assert.deepEqual(macosFusePolicy, {
    RunAsNode: false,
    EnableCookieEncryption: true,
    EnableNodeOptionsEnvironmentVariable: false,
    EnableNodeCliInspectArguments: false,
    EnableEmbeddedAsarIntegrityValidation: true,
    OnlyLoadAppFromAsar: true,
    LoadBrowserProcessSpecificV8Snapshot: false,
    GrantFileProtocolExtraPrivileges: true,
    WasmTrapHandlers: true
  })
  assert.doesNotThrow(() => {
    assertMacosFusePolicy(macosFusePolicy)
  })
  assert.throws(
    () => {
      assertMacosFusePolicy({ ...macosFusePolicy, RunAsNode: true })
    },
    /RunAsNode expected false, found true/
  )
  assert.deepEqual(disallowedInfoPlistCapabilityKeys({
    CFBundleIdentifier: 'com.lastobelus.markover',
    NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
    NSCameraUsageDescription: 'camera',
    NSMicrophoneUsageDescription: 'microphone'
  }), [
    'NSAppTransportSecurity',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription'
  ])
  assert.doesNotThrow(() => {
    assertNoDisallowedInfoPlistCapabilities({
      CFBundleIdentifier: 'com.lastobelus.markover'
    })
  })
})

test('packaged smoke uses the signed application executable and release timeout', () => {
  // Spawning the actual runner belongs to the end-to-end package test.
  const packaging = read('scripts/package-macos.ts')
  assert.match(
    packaging,
    /\[runnerPath, '--timeout=60', `--app=\$\{executablePath\}`\]/
  )
  assert.match(
    packaging,
    /const executablePath = path\.join\(appPath, 'Contents\/MacOS\/Markover'\)/
  )
  assert.equal(typeof runPackagedSmoke, 'function')
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

test('checked-in entitlements keep the ad-hoc exception on Electron processes', () => {
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
  for (const file of files) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8')
    if (file === 'code.plist') {
      assert.doesNotMatch(source, /disable-library-validation/)
    } else {
      assert.match(source, /disable-library-validation/)
    }
  }
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
  fs.writeFileSync(path.join(directory, 'node_modules/electron/LICENSE'), 'electron')
  fs.writeFileSync(path.join(electronDirectory, 'LICENSES.chromium.html'), 'chromium')

  const notices = loadThirdPartyNotices(directory)
  fs.rmSync(electronDirectory, { recursive: true, force: true })
  copyThirdPartyNotices(appPath, notices)

  const licenses = path.join(appPath, 'Contents/Resources/licenses')
  assert.equal(fs.readFileSync(path.join(licenses, 'THIRD_PARTY_NOTICES.md'), 'utf8'), 'application')
  assert.equal(fs.readFileSync(path.join(licenses, 'ELECTRON_LICENSE'), 'utf8'), 'electron')
  assert.equal(fs.readFileSync(path.join(licenses, 'CHROMIUM_LICENSES.html'), 'utf8'), 'chromium')
})

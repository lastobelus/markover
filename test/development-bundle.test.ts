import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  addressedDevelopmentBundle,
  addressedDevelopmentExecutable,
  addressedPackagerOptions,
  assertAddressedBundleMetadata,
  buildAddressedDevelopmentBundle,
  DEVELOPMENT_BUNDLE_ID_PREFIX,
  type AddressedDevelopmentBundle
} from '../scripts/development-bundle'
import type { ResolvedInstance } from '../src/instance'

async function temporaryCheckout(t: TestContext): Promise<string> {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-bundle-'))
  t.after(() => fs.rm(checkout, { recursive: true, force: true }))
  await fs.mkdir(path.join(checkout, 'build', 'app'), { recursive: true })
  await fs.mkdir(path.join(checkout, 'design', 'brand'), { recursive: true })
  await fs.writeFile(path.join(checkout, 'package.json'), JSON.stringify({
    devDependencies: { electron: '43.2.0' }
  }))
  return checkout
}

function canonical(checkout: string): ResolvedInstance {
  const stateRoot = path.join(checkout, 'canonical-state')
  return {
    version: 1,
    identity: { kind: 'canonical', key: 'canonical' },
    stateRoot,
    checkout,
    service: {
      root: stateRoot,
      endpointPath: path.join(stateRoot, 'service.json'),
      tokenPath: path.join(stateRoot, 'service.token'),
      singleInstanceLockRoot: stateRoot
    },
    scheme: 'markover',
    process: { status: 'stopped' },
    coldStart: { eligible: true, blockedBy: null },
    branding: {
      appName: 'Markover',
      headerBadge: null,
      iconLabel: null,
      iconSvgPath: 'design/brand/markover-app-icon.svg',
      iconPngPath: 'design/brand/markover-app-icon.png',
      iconIcnsPath: 'design/brand/markover-app-icon.icns'
    },
    pullRequest: null
  }
}

function development(checkout: string, number: number): ResolvedInstance {
  const stateRoot = path.join(checkout, '.markover', 'instance')
  const generated = path.join(checkout, '.markover', 'generated', `pr-${number}`)
  return {
    version: 1,
    identity: {
      kind: 'development',
      key: `pr-${number}`,
      pullRequestNumber: number
    },
    stateRoot,
    checkout,
    service: {
      root: stateRoot,
      endpointPath: path.join(stateRoot, 'service.json'),
      tokenPath: path.join(stateRoot, 'service.token'),
      singleInstanceLockRoot: stateRoot
    },
    scheme: `markover-${number}`,
    process: { status: 'stopped' },
    coldStart: { eligible: true, blockedBy: null },
    branding: {
      appName: `Markover-${number}`,
      headerBadge: `PR ${number}`,
      iconLabel: String(number),
      iconSvgPath: path.join(generated, 'markover-app-icon.svg'),
      iconPngPath: path.join(generated, 'markover-app-icon.png'),
      iconIcnsPath: path.join(generated, 'markover-app-icon.icns')
    },
    pullRequest: { number, state: 'open' }
  }
}

function metadata(address: AddressedDevelopmentBundle) {
  return {
    main: {
      CFBundleIdentifier: address.appBundleId,
      CFBundleDisplayName: address.appName,
      CFBundleExecutable: address.appName,
      CFBundleURLTypes: [{
        CFBundleURLName: `${address.appBundleId}.review`,
        CFBundleURLSchemes: [address.scheme]
      }]
    },
    helpers: ['', ' (GPU)', ' (Plugin)', ' (Renderer)'].map((suffix) => ({
      CFBundleIdentifier: address.helperBundleId,
      CFBundleDisplayName: `${address.appName} Helper${suffix}`,
      CFBundleExecutable: `${address.appName} Helper${suffix}`
    }))
  }
}

test('canonical and worktrees derive deterministic collision-free bundle addresses', async (t) => {
  const checkout = await temporaryCheckout(t)
  const addresses = [
    addressedDevelopmentBundle(canonical(checkout)),
    addressedDevelopmentBundle(development(checkout, 169)),
    addressedDevelopmentBundle(development(checkout, 170))
  ]
  assert.deepEqual(addresses.map(({ appBundleId }) => appBundleId), [
    `${DEVELOPMENT_BUNDLE_ID_PREFIX}.canonical`,
    `${DEVELOPMENT_BUNDLE_ID_PREFIX}.pr169`,
    `${DEVELOPMENT_BUNDLE_ID_PREFIX}.pr170`
  ])
  assert.equal(new Set(addresses.map(({ appBundleId }) => appBundleId)).size, 3)
  assert.equal(new Set(addresses.map(({ helperBundleId }) => helperBundleId)).size, 3)
  assert.equal(new Set(addresses.map(({ appPath }) => appPath)).size, 3)
  assert.equal(
    addresses[1]?.appPath,
    path.join(
      checkout,
      '.markover',
      'generated',
      'pr-169',
      'bundle',
      'Markover-169.app'
    )
  )
  assert.equal(
    addressedDevelopmentExecutable(development(checkout, 169)),
    path.join(addresses[1].appPath, 'Contents', 'MacOS', 'Markover-169')
  )
})

test('packager options address app, helpers, scheme, icon, and owned output', async (t) => {
  const checkout = await temporaryCheckout(t)
  const instance = development(checkout, 169)
  const output = path.join(checkout, '.markover', 'generated', 'stage')
  const options = await addressedPackagerOptions(instance, output, 'arm64')
  assert.deepEqual({
    appBundleId: options.appBundleId,
    arch: options.arch,
    asar: options.asar,
    dir: options.dir,
    electronVersion: options.electronVersion,
    helperBundleId: options.helperBundleId,
    icon: options.icon,
    name: options.name,
    out: options.out,
    overwrite: options.overwrite,
    platform: options.platform,
    protocols: options.protocols,
    prune: options.prune
  }, {
    appBundleId: `${DEVELOPMENT_BUNDLE_ID_PREFIX}.pr169`,
    arch: 'arm64',
    asar: {
      unpack: '**/{canonical-updater,instance,local-client,service-endpoint}.js'
    },
    dir: path.join(checkout, 'build', 'app'),
    electronVersion: '43.2.0',
    helperBundleId: `${DEVELOPMENT_BUNDLE_ID_PREFIX}.pr169.helper`,
    icon: instance.branding.iconIcnsPath,
    name: 'Markover-169',
    out: output,
    overwrite: true,
    platform: 'darwin',
    protocols: [{
      name: `${DEVELOPMENT_BUNDLE_ID_PREFIX}.pr169.review`,
      schemes: ['markover-169']
    }],
    prune: false
  })
  assert.throws(
    () => addressedDevelopmentBundle({ ...instance, checkout: null }),
    /checkout is unavailable/
  )
})

test('metadata verification covers main, scheme, and every helper bundle', async (t) => {
  const checkout = await temporaryCheckout(t)
  const address = addressedDevelopmentBundle(development(checkout, 169))
  assert.doesNotThrow(() => {
    assertAddressedBundleMetadata(address, metadata(address))
  })
  const wrong = metadata(address)
  const plugin = wrong.helpers[2]
  assert.ok(plugin)
  wrong.helpers[2] = {
    ...plugin,
    CFBundleIdentifier: `${DEVELOPMENT_BUNDLE_ID_PREFIX}.pr170.helper`
  }
  assert.throws(
    () => {
      assertAddressedBundleMetadata(address, wrong)
    },
    /Plugin.*CFBundleIdentifier expected/
  )
})

test('verified staging replaces only the owned generated bundle', async (t) => {
  const checkout = await temporaryCheckout(t)
  const instance = canonical(checkout)
  const address = addressedDevelopmentBundle(instance)
  await fs.mkdir(address.appPath, { recursive: true })
  await fs.writeFile(path.join(address.appPath, 'old'), 'old')
  let preparedPath = ''
  const result = await buildAddressedDevelopmentBundle(instance, {
    architecture: 'arm64',
    packager: async (options) => {
      const output = path.join(
        String(options.out),
        `${String(options.name)}-darwin-arm64`
      )
      await fs.mkdir(path.join(output, 'Markover.app'), { recursive: true })
      await fs.writeFile(path.join(output, 'Markover.app', 'new'), 'new')
      return [output]
    },
    platform: 'darwin',
    prepareBundle: async (appPath) => {
      preparedPath = appPath
      assert.equal(await fs.readFile(path.join(appPath, 'new'), 'utf8'), 'new')
    },
    randomSuffix: () => 'fixed'
  })
  assert.equal(result.appPath, address.appPath)
  assert.match(preparedPath, /\.bundle-build-.*\/packager\//)
  assert.equal(await fs.readFile(path.join(address.appPath, 'new'), 'utf8'), 'new')
  await assert.rejects(fs.access(path.join(address.appPath, 'old')))
})

test('failed staged verification preserves the previous owned bundle', async (t) => {
  const checkout = await temporaryCheckout(t)
  const instance = canonical(checkout)
  const address = addressedDevelopmentBundle(instance)
  await fs.mkdir(address.appPath, { recursive: true })
  await fs.writeFile(path.join(address.appPath, 'old'), 'old')
  await assert.rejects(
    buildAddressedDevelopmentBundle(instance, {
      architecture: 'arm64',
      packager: async (options) => {
        const output = path.join(
          String(options.out),
          `${String(options.name)}-darwin-arm64`
        )
        await fs.mkdir(path.join(output, 'Markover.app'), { recursive: true })
        return [output]
      },
      platform: 'darwin',
      prepareBundle: () => Promise.reject(new Error('invalid staged bundle')),
      randomSuffix: () => 'failed'
    }),
    /invalid staged bundle/
  )
  assert.equal(await fs.readFile(path.join(address.appPath, 'old'), 'utf8'), 'old')
  const children = await fs.readdir(address.generatedRoot)
  assert.deepEqual(children, ['bundle'])
})

test('release packaging keeps its existing production bundle identity', async () => {
  const source = await fs.readFile(
    path.join(process.cwd(), 'scripts', 'package-macos.ts'),
    'utf8'
  )
  assert.match(source, /--app-bundle-id=com\.lastobelus\.markover/)
  assert.match(source, /--helper-bundle-id=com\.lastobelus\.markover\.helper/)
  assert.doesNotMatch(source, /DEVELOPMENT_BUNDLE_ID_PREFIX/)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildConfiguredCanonicalBundle
} from '../scripts/build-canonical-bundle'
import type { AddressedDevelopmentBundle } from '../scripts/development-bundle'
import type { ResolvedInstance } from '../src/instance'

const instance = {
  identity: { kind: 'canonical', key: 'canonical' },
  checkout: '/canonical'
} as unknown as ResolvedInstance

const bundle = {
  appBundleId: 'com.lastobelus.markover.development.canonical',
  appName: 'Markover',
  appPath: '/canonical/.markover/generated/canonical/bundle/Markover.app',
  bundleDirectory: '/canonical/.markover/generated/canonical/bundle',
  generatedRoot: '/canonical/.markover/generated/canonical',
  helperBundleId: 'com.lastobelus.markover.development.canonical.helper',
  identityKey: 'canonical',
  scheme: 'markover'
} as const satisfies AddressedDevelopmentBundle

test('configured canonical packaging runs with the descriptor-owned instance', async () => {
  let built: ResolvedInstance | null = null
  assert.equal(await buildConfiguredCanonicalBundle({
    build(target) {
      built = target
      return Promise.resolve(bundle)
    },
    checkout: '/canonical-alias',
    realpath: () => Promise.resolve('/canonical'),
    resolve: () => Promise.resolve(instance)
  }), bundle)
  assert.equal(built, instance)
})

test('configured canonical packaging rejects a different caller checkout', async () => {
  let built = false
  await assert.rejects(buildConfiguredCanonicalBundle({
    build() {
      built = true
      return Promise.resolve(bundle)
    },
    checkout: '/caller',
    realpath(filePath) {
      return Promise.resolve(filePath)
    },
    resolve: () => Promise.resolve(instance)
  }), /must run from its configured checkout/)
  assert.equal(built, false)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aboutPanelBuildVersion,
  aboutPanelOptions,
  aboutPanelPackageMetadata
} from '../src/about-panel'
import type { BuildIdentity } from '../src/startup-contract'

const cleanBuild: BuildIdentity = {
  version: '0.1.3',
  commit: '46e17d9327143c4194a6e9df60bc1ff735b03b79',
  dirty: false,
  rendererSha256: '0'.repeat(64)
}

const packageManifest = {
  author: 'Michael Johnston (lastobelus)',
  copyright: 'Copyright © 2026 Michael Johnston (lastobelus)',
  license: 'MIT'
}

test('native About options use addressed name and authoritative metadata', () => {
  const developmentOptions = aboutPanelOptions(
    'Markover-63',
    cleanBuild,
    packageManifest
  )
  assert.deepEqual(developmentOptions, {
    applicationName: 'Markover-63',
    applicationVersion: '0.1.3',
    version: '46e17d9327143c4194a6e9df60bc1ff735b03b79',
    copyright: 'Copyright © 2026 Michael Johnston (lastobelus)',
    credits: 'Created by Michael Johnston (lastobelus). Free and open-source software under the MIT License.'
  })
  assert.equal(
    aboutPanelOptions('Markover', cleanBuild, packageManifest).applicationName,
    'Markover'
  )
})

test('native About build version marks modified development builds', () => {
  assert.equal(
    aboutPanelBuildVersion({ ...cleanBuild, dirty: true }),
    '46e17d9327143c4194a6e9df60bc1ff735b03b79-dirty'
  )
  assert.equal(
    aboutPanelBuildVersion({ ...cleanBuild, commit: null, dirty: true }),
    'unknown-dirty'
  )
})

test('native About options reject incomplete package metadata', () => {
  assert.throws(
    () => aboutPanelPackageMetadata({ ...packageManifest, author: '' }),
    /must define author as a string/
  )
  assert.throws(
    () => aboutPanelPackageMetadata(null),
    /package metadata is invalid/
  )
})

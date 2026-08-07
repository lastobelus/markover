import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  developmentConfigPath,
  loadDevelopmentConfig,
  parseDevelopmentConfig
} from '../src/development-config'

test('development config resolves inside the ignored worktree directory', () => {
  assert.equal(
    developmentConfigPath('/checkouts/pr-42'),
    '/checkouts/pr-42/.markover/development.json'
  )
})

test('development config starts with Ocean dark and normalizes other settings', () => {
  const config = parseDevelopmentConfig({
    version: 1,
    settings: { palette: 'ocean', appearance: 'dark' }
  })
  assert.equal(config.settings.palette, 'ocean')
  assert.equal(config.settings.appearance, 'dark')
  assert.equal(config.settings.treeDensity, 'comfortable')
})

test('development config rejects malformed contracts', () => {
  assert.throws(() => parseDevelopmentConfig({
    version: 2,
    settings: {}
  }), /version 1/)
  assert.throws(() => parseDevelopmentConfig({
    version: 1,
    settings: null
  }), /settings object/)
})

test('loads development config and gives setup recovery for a missing file', async (t) => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-config-'))
  t.after(() => fs.rm(checkout, { recursive: true, force: true }))
  await assert.rejects(loadDevelopmentConfig(checkout), /setup-worktree\.sh/)

  const filePath = developmentConfigPath(checkout)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify({
    version: 1,
    settings: { palette: 'ocean', appearance: 'dark' }
  }))
  const config = await loadDevelopmentConfig(checkout)
  assert.equal(config.settings.palette, 'ocean')
  assert.equal(config.settings.appearance, 'dark')
})

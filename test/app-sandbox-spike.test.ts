import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { classifyAppSandboxSpikeFailure } from '../scripts/app-sandbox-spike'

const root = path.resolve(__dirname, '../..')

test('classifies the finite ad-hoc Electron rendezvous blocker', () => {
  assert.deepEqual(
    classifyAppSandboxSpikeFailure(
      'bootstrap_check_in bundle.MachPortRendezvousServer.123: Permission denied (1100)',
      false
    ),
    {
      blocker: 'ad-hoc-team-identity-required',
      observed:
        'Electron MAS process rendezvous was denied because the ad-hoc spike has no shared Apple Team ID application group.'
    }
  )
})

test('spike entitlements stay separate from production profiles', () => {
  const spikeRoot = path.join(root, 'config/macos/app-sandbox-spike')
  const productionRoot = path.join(root, 'config/macos/entitlements')
  const app = fs.readFileSync(path.join(spikeRoot, 'app.plist'), 'utf8')
  const inherited = fs.readFileSync(
    path.join(spikeRoot, 'inherit.plist'),
    'utf8'
  )
  const production = fs.readdirSync(productionRoot)
    .map((name) => fs.readFileSync(path.join(productionRoot, name), 'utf8'))
    .join('\n')

  for (const entitlement of [
    'com.apple.security.app-sandbox',
    'com.apple.security.files.bookmarks.app-scope',
    'com.apple.security.files.user-selected.read-only',
    'com.apple.security.network.client',
    'com.apple.security.network.server'
  ]) {
    assert.match(app, new RegExp(entitlement.replaceAll('.', '\\.')))
  }
  assert.match(inherited, /com\.apple\.security\.inherit/)
  assert.doesNotMatch(production, /com\.apple\.security\.app-sandbox/)
})

test('spike packaging is opt-in and strips the production URL scheme', () => {
  const source = fs.readFileSync(
    path.join(root, 'scripts/app-sandbox-spike.ts'),
    'utf8'
  )
  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'package.json'),
    'utf8'
  )) as { scripts: Record<string, string> }

  assert.equal(
    manifest.scripts['spike:app-sandbox'],
    'npm run build --silent && node build/scripts/app-sandbox-spike.js'
  )
  assert.match(source, /--platform=mas/)
  assert.match(source, /CFBundleURLTypes/)
  assert.doesNotMatch(manifest.scripts['package:mac'] ?? '', /app-sandbox-spike/)
})

test('feasibility report records a finite defer decision', () => {
  const report = fs.readFileSync(
    path.join(root, 'docs/developer/app-sandbox-feasibility.md'),
    'utf8'
  )
  const decisions = fs.readFileSync(path.join(root, 'DECISIONS.md'), 'utf8')

  assert.match(report, /## Recommendation: defer/)
  assert.match(report, /## Capability inventory/)
  assert.match(report, /## Security benefit/)
  assert.match(report, /## User-visible cost/)
  assert.match(report, /## Migration and rollback/)
  assert.match(report, /ad-hoc-team-identity-required|shared Apple Team ID/)
  assert.match(decisions, /App Sandbox feasibility report/)
})

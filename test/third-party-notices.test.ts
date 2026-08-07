import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  generatedNotices,
  groupedTexts,
  shippedPackages,
  type PackageRecord
} from '../scripts/generate-third-party-notices'

const root = path.resolve(__dirname, '../..')

interface FixturePackage {
  name: string
  version: string
  license: string
  text?: string
  dev?: boolean
  installed?: boolean
  bundled?: boolean
}

function fixture(t: TestContext, packages: FixturePackage[]): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-notices-'))
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const lockPackages: Record<string, Record<string, unknown>> = {
    '': { name: 'fixture', version: '1.0.0' }
  }
  const inputs: Record<string, Record<string, never>> = {}
  for (const packageEntry of packages) {
    const location = `node_modules/${packageEntry.name}`
    lockPackages[location] = {
      version: packageEntry.version,
      dev: packageEntry.dev
    }
    if (packageEntry.bundled !== false) {
      inputs[`${location}/index.js`] = {}
    }
    if (packageEntry.installed === false) continue
    const packageDirectory = path.join(directory, location)
    fs.mkdirSync(packageDirectory, { recursive: true })
    fs.writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({
      name: packageEntry.name,
      version: packageEntry.version,
      license: packageEntry.license
    }))
    if (packageEntry.text !== undefined) {
      fs.writeFileSync(path.join(packageDirectory, 'LICENSE'), packageEntry.text)
    }
  }
  fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: lockPackages
  }))
  fs.mkdirSync(path.join(directory, 'build/artifacts'), { recursive: true })
  fs.writeFileSync(
    path.join(directory, 'build/artifacts/renderer-metafile.json'),
    JSON.stringify({ inputs })
  )
  return directory
}

test('committed third-party notices match bundled renderer dependencies', () => {
  const committed = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  assert.equal(committed, generatedNotices(root))
  assert.match(committed, /`@pierre\/theming`/)
  assert.match(committed, /`yaml`/)
  assert.doesNotMatch(committed, /`lru_map`/)
})

test('shipped discovery follows bundle inputs regardless of dependency kind', (t) => {
  const directory = fixture(t, [
    { name: 'runtime', version: '1.0.0', license: 'MIT', text: 'same' },
    { name: 'development', version: '1.0.0', license: 'MIT', text: 'dev', dev: true },
    {
      name: 'unbundled',
      version: '1.0.0',
      license: 'MIT',
      text: 'unused',
      bundled: false
    },
    {
      name: 'absent-platform',
      version: '1.0.0',
      license: 'MIT',
      installed: false,
      bundled: false
    }
  ])
  assert.deepEqual(
    shippedPackages(directory, {}).map((entry) => entry.id),
    ['development@1.0.0', 'runtime@1.0.0']
  )
})

test('shipped discovery fails when license text is missing', (t) => {
  const directory = fixture(t, [
    { name: 'missing', version: '1.0.0', license: 'MIT' }
  ])
  assert.throws(
    () => shippedPackages(directory, {}),
    /missing@1\.0\.0 does not include usable license text/
  )
})

test('only byte-identical texts are consolidated', () => {
  const packageRecord = (id: string, text: string): PackageRecord => ({
    id,
    name: id.split('@')[0] ?? id,
    version: '1.0.0',
    license: 'MIT',
    location: `node_modules/${id}`,
    texts: [{
      kind: 'license',
      name: 'LICENSE',
      path: `/tmp/${id}/LICENSE`,
      text
    }]
  })
  const packages = [
    packageRecord('one@1.0.0', 'same\n'),
    packageRecord('two@1.0.0', 'same\n'),
    packageRecord('three@1.0.0', 'same')
  ]
  const groups = groupedTexts(packages)
  assert.equal(groups.length, 2)
  const [shared, distinct] = groups
  assert.ok(shared)
  assert.ok(distinct)
  assert.deepEqual(shared.packages.map((entry) => entry.id), ['one@1.0.0', 'two@1.0.0'])
  assert.deepEqual(distinct.packages.map((entry) => entry.id), ['three@1.0.0'])
})

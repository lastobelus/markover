const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  generatedNotices,
  groupedTexts,
  productionPackages
} = require('../scripts/generate-third-party-notices')

const root = path.resolve(__dirname, '../..')

function fixture(t, packages) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-notices-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const lockPackages = { '': { name: 'fixture', version: '1.0.0' } }
  for (const packageEntry of packages) {
    const location = `node_modules/${packageEntry.name}`
    lockPackages[location] = {
      version: packageEntry.version,
      dev: packageEntry.dev
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
  return directory
}

test('committed third-party notices match installed production dependencies', () => {
  const committed = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  assert.equal(committed, generatedNotices(root))
  assert.match(committed, /`@pierre\/theming`/)
  assert.match(committed, /`lru_map`/)
  assert.match(committed, /`yaml`/)
})

test('production discovery ignores development and absent platform packages', (t) => {
  const directory = fixture(t, [
    { name: 'runtime', version: '1.0.0', license: 'MIT', text: 'same' },
    { name: 'development', version: '1.0.0', license: 'MIT', text: 'dev', dev: true },
    { name: 'absent', version: '1.0.0', license: 'MIT', installed: false }
  ])
  assert.deepEqual(
    productionPackages(directory, {}).map((entry) => entry.id),
    ['runtime@1.0.0']
  )
})

test('production discovery fails when license text is missing', (t) => {
  const directory = fixture(t, [
    { name: 'missing', version: '1.0.0', license: 'MIT' }
  ])
  assert.throws(
    () => productionPackages(directory, {}),
    /missing@1\.0\.0 does not include usable license text/
  )
})

test('only byte-identical texts are consolidated', () => {
  const packages = [
    { id: 'one@1.0.0', license: 'MIT', texts: [{ kind: 'license', text: 'same\n' }] },
    { id: 'two@1.0.0', license: 'MIT', texts: [{ kind: 'license', text: 'same\n' }] },
    { id: 'three@1.0.0', license: 'MIT', texts: [{ kind: 'license', text: 'same' }] }
  ]
  const groups = groupedTexts(packages)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].packages.map((entry) => entry.id), ['one@1.0.0', 'two@1.0.0'])
  assert.deepEqual(groups[1].packages.map((entry) => entry.id), ['three@1.0.0'])
})

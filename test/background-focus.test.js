const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (relativePath) => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('agent review events update the renderer without showing or focusing it', () => {
  const main = read('src/main.js')
  const managedReview = main.match(
    /function sendManagedReview\(artifact\) \{[\s\S]*?\n\}/
  )?.[0] || ''

  assert.match(managedReview, /webContents\.send\('review:opened'/)
  assert.match(managedReview, /createWindow\(\{ show: false \}\)/)
  assert.doesNotMatch(managedReview, /\.show\(\)|\.focus\(\)|\.restore\(\)/)
})

test('background startup stays hidden and background second instances do not activate', () => {
  const main = read('src/main.js')

  assert.match(
    main,
    /function createWindow\(\{ show = !backgroundServerMode \} = \{\}\)[\s\S]*new BrowserWindow\(\{[\s\S]*\n    show,/
  )
  assert.match(
    main,
    /app\.on\('second-instance',[\s\S]*commandLine\.includes\('--markover-server'\)\) return[\s\S]*if \(!mainWindow\) createWindow\(\)[\s\S]*mainWindow\.show\(\)[\s\S]*mainWindow\.focus\(\)/
  )
})

test('shutdown leaves the shared endpoint for health-checked stale recovery', () => {
  const main = read('src/main.js')

  assert.doesNotMatch(main, /unlink\(endpointPath\)/)
})

test('automatic startup uses one-shot hidden background LaunchServices flags', () => {
  const cli = read('scripts/markover.js')

  assert.match(cli, /'\/usr\/bin\/open'/)
  for (const flag of ["'-g'", "'-j'", "'-n'"]) {
    assert.match(cli, new RegExp(flag))
  }
  assert.doesNotMatch(cli, /launchctl[\s\S]*submit/)
})

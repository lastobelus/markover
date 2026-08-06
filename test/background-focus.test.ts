import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('agent review events update the renderer without showing or focusing it', () => {
  const main = read('src/main.ts')
  const managedReview = main.match(
    /function sendManagedReview\(artifact: ReviewArtifact\): void \{[\s\S]*?\n\}/
  )?.[0] || ''

  assert.match(managedReview, /webContents\.send\('review:opened'/)
  assert.match(managedReview, /createWindow\(\{ show: false \}\)/)
  assert.doesNotMatch(managedReview, /\.show\(\)|\.focus\(\)|\.restore\(\)/)
})

test('preload exposes one exact typed capability object', () => {
  const preload = read('src/preload.ts')

  assert.match(preload, /const bridge = \{[\s\S]*\} satisfies MarkoverBridge/)
  assert.match(
    preload,
    /contextBridge\.exposeInMainWorld\('markover', bridge\)/
  )
  assert.doesNotMatch(preload, /exposeInMainWorld\([^,]+,\s*ipcRenderer/)
})

test('background startup stays hidden and background notifications repair records', () => {
  const main = read('src/main.ts')

  assert.match(
    main,
    /function createWindow\([\s\S]*show = !backgroundServerMode[\s\S]*\): BrowserWindow \{[\s\S]*new BrowserWindow\(\{[\s\S]*\n {4}show,/
  )
  assert.match(
    main,
    /app\.on\('second-instance',[\s\S]*commandLine\.includes\('--markover-server'\)\) \{[\s\S]*repairServiceRecords\(\)[\s\S]*return[\s\S]*if \(!mainWindow\) createWindow\(\)[\s\S]*const window = mainWindow[\s\S]*window\.show\(\)[\s\S]*window\.focus\(\)/
  )
  assert.match(
    main,
    /function repairServiceRecords\(\): Promise<void> \{[\s\S]*serviceRepairQueue = serviceRepairQueue\.catch\(\(\) => \{\}\)\.then[\s\S]*publishServiceConnection\(\{[\s\S]*identity,[\s\S]*port: service\.port/
  )
})

test('shutdown leaves the shared endpoint for health-checked stale recovery', () => {
  const main = read('src/main.ts')

  assert.doesNotMatch(main, /unlink\(endpointPath\)/)
})

test('development startup imports legacy reviews from the checkout root', () => {
  const main = read('src/main.ts')

  assert.match(
    main,
    /const checkoutDirectory = path\.resolve\(projectDirectory, '\.\.'\)/
  )
  assert.match(
    main,
    /!app\.isPackaged\) await importLegacyReviews\(\s*path\.join\(checkoutDirectory, '\.markover', 'reviews'\)/
  )
})

test('automatic startup uses one-shot hidden background LaunchServices flags', () => {
  const cli = read('scripts/markover.ts')

  assert.match(cli, /'\/usr\/bin\/open'/)
  for (const flag of ["'-g'", "'-j'", "'-n'"]) {
    assert.match(cli, new RegExp(flag))
  }
  assert.match(cli, /delete environment\.ELECTRON_RUN_AS_NODE/)
  assert.match(cli, /resolveMarkoverApp/)
  assert.match(cli, /const appArguments = packagedApp\s*\? \['--markover-server'\]/)
  assert.match(cli, /\{ encoding: 'utf8', env: environment \}/)
  assert.doesNotMatch(cli, /launchctl[\s\S]*submit/)
  assert.doesNotMatch(cli, /replaceStale/)
})

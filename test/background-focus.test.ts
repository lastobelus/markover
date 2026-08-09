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
    /async function sendManagedReview\(artifact: ReviewArtifact\): Promise<void> \{[\s\S]*?\n\}/
  )?.[0] || ''

  assert.match(managedReview, /sendMainEvent\([\s\S]*'review:opened'/)
  assert.match(managedReview, /createWindow\(\{ show: false \}\)/)
  assert.match(managedReview, /await waitForRendererReady\(window\)/)
  assert.doesNotMatch(managedReview, /\.show\(\)|\.focus\(\)|\.restore\(\)/)
  assert.doesNotMatch(managedReview, /activeManagedReview(Id)? = artifact/)
})

test('native window focus state reaches the renderer without activating Markover', () => {
  const main = read('src/main.ts')
  const preload = read('src/preload.ts')

  assert.match(main, /window\.on\('focus',[\s\S]*mainWindowBlurredAt = null/)
  assert.match(main, /window\.on\('blur',[\s\S]*mainWindowBlurredAt = Date\.now\(\)/)
  assert.match(main, /privilegedIpc\.handle\('window:focus-state:get', currentWindowFocusState\)/)
  assert.match(preload, /getWindowFocusState:.*window:focus-state:get/)
  assert.match(preload, /onWindowFocusChanged:[\s\S]*window:focus-state/)
})

test('incoming reviews are listed before the activation policy runs', () => {
  const renderer = read('src/renderer.ts')
  const handler = renderer.match(
    /async function handleIncomingReview\([\s\S]*?\n\}/
  )?.[0] || ''

  assert.match(handler, /addManagedReview\(managedReviewDocument\(reviewDocument\), false\)/)
  assert.match(handler, /incomingReviewAction\(\{/)
  assert.match(handler, /if \(action === 'warn'\)[\s\S]*showIncomingReviewWarning/)
  assert.match(handler, /if \(action === 'notify'\)[\s\S]*showIncomingReviewNotice/)
  assert.match(handler, /activateIncomingReview\(session\.reviewId, windowFocusState\.focused\)/)
})

test('warning and notice UI keep the current review safe and target the latest arrival', () => {
  const renderer = read('src/renderer.ts')
  const html = read('src/index.html')

  assert.match(html, /id="incoming-review-dialog-keep"[\s\S]*>Keep Current</)
  assert.match(html, /id="incoming-review-dialog-open"[\s\S]*>Open New Review</)
  assert.match(html, /id="incoming-review-notice-open"[^>]*>Open</)
  assert.match(renderer, /appendIncomingReview\([\s\S]*incomingReviewWarningId = batch\.latestReviewId/)
  assert.match(renderer, /incomingReviewDialogKeep\.focus\(\)/)
  assert.match(renderer, /const reviewId = incomingReviewWarningId[\s\S]*activateIncomingReview\(reviewId, true\)/)
  assert.match(renderer, /const reviewId = incomingReviewNoticeId[\s\S]*activateIncomingReview\(reviewId, true\)/)
  assert.match(renderer, /if \(!windowFocusState\.focused \|\| elements\.incomingReviewNotice\.hidden\) return/)
  assert.match(
    renderer,
    /if \(outcome === 'blocked'\)[\s\S]*return\s*\}[\s\S]*hideIncomingReviewNotice\(\)/
  )
  assert.match(
    renderer,
    /if \(elements\.settingsDialog\.open \|\| elements\.incomingReviewDialog\.open\) return/
  )
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
    /const checkoutDirectory = addressedInstance\.checkout/
  )
  assert.match(
    main,
    /!app\.isPackaged && !smokeMode && checkoutDirectory\) \{\s*await importLegacyReviews\(\s*path\.join\(checkoutDirectory, '\.markover', 'reviews'\),\s*path\.join\(addressedInstance\.stateRoot, 'reviews'\)/
  )
})

test('successful smoke output flushes before exercising graceful quit', () => {
  const main = read('src/main.ts')
  const smokeResult = main.match(
    /privilegedIpc\.handle\('smoke:result',[\s\S]*?\n {4}\}\)/
  )?.[0] || ''

  assert.match(
    smokeResult,
    /process\.stdout\.write\(`\$\{JSON\.stringify\(output\)\}\\n`, \(\) => \{\s*if \(checksPassed\) app\.quit\(\)\s*else app\.exit\(1\)/
  )
  assert.doesNotMatch(smokeResult, /setImmediate/)
})

test('every pre-ready failure blocks readiness and closes the service', () => {
  const main = read('src/main.ts')
  const termination = main.match(
    /webContents\.on\('render-process-gone',[\s\S]*?\n {2}\}\)/
  )?.[0] || ''
  const readiness = main.match(
    /privilegedIpc\.handle\('startup:renderer-initialized',[\s\S]*?\n {4}\}\)/
  )?.[0] || ''

  assert.match(
    termination,
    /const failedDuringStartup = !startupReady\s*markRendererStartupFailed\(\)\s*void/
  )
  assert.match(
    readiness,
    /catch \(error\) \{\s*await stopPublishedService\(\)\s*if \(!rendererDidFailStartup\(\)\)/
  )
})

test('renderer fallback preserves a classified main-process failure', () => {
  const main = read('src/main.ts')
  const failureHandler = main.match(
    /privilegedIpc\.handle\('startup:failure',[\s\S]*?\n {4}\}\)/
  )?.[0] || ''

  assert.match(
    failureHandler,
    /snapshot\(\)\.status === 'starting'[\s\S]*failStartup\('renderer-initialization'/
  )
})

test('native startup failure dialogs survive diagnostic write failures', () => {
  const main = read('src/main.ts')
  const bestEffort = main.match(
    /async function failStartupBestEffort\([\s\S]*?\n\}/
  )?.[0] || ''
  const createWindow = main.slice(
    main.indexOf('function createWindow('),
    main.indexOf('function repositoryRoot(')
  )

  assert.match(
    bestEffort,
    /try \{[\s\S]*await failStartup\([\s\S]*catch \(diagnosticError\)[\s\S]*process\.stderr\.write/
  )
  assert.equal(
    createWindow.match(/await failStartupBestEffort\(/g)?.length,
    4
  )
  assert.equal(
    createWindow.match(/await showStartupFailureDialog\(\)/g)?.length,
    4
  )
  assert.doesNotMatch(createWindow, /await failStartup\(/)
})

test('startup diagnostic exists before build identity validation', () => {
  const main = read('src/main.ts')
  const startup = main.match(
    /app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*?await beginMainStartupPhase\('preparing-interface'\)/
  )?.[0] || ''

  assert.match(
    startup,
    /new StartupDiagnostic\([\s\S]*await startupDiagnostic\.start\(\)[\s\S]*await loadBuildIdentity\(\)[\s\S]*setBuildIdentity\(build\)/
  )
})

test('lock-free review processes use isolated startup diagnostics', () => {
  const main = read('src/main.ts')

  assert.match(
    main,
    /reviewMode\s*\? `startup-diagnostic-review-\$\{String\(process\.pid\)\}\.json`\s*: 'startup-diagnostic\.json'/
  )
  assert.match(
    main,
    /reviewMode &&\s*startupDiagnostic\?\.snapshot\(\)\.status === 'ready'[\s\S]*rmSync\(startupDiagnosticPath, \{ force: true \}\)/
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
  assert.match(cli, /packagedApp,[\s\S]*'--args',[\s\S]*'--markover-server'/)
  assert.match(cli, /\['start', '--', '--instance', selector, '--markover-server'\]/)
  assert.match(cli, /\{ encoding: 'utf8', env: environment \}/)
  assert.doesNotMatch(cli, /launchctl[\s\S]*submit/)
  assert.doesNotMatch(cli, /replaceStale/)
})

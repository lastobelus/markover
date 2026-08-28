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

  assert.match(
    managedReview,
    /projectContextForReview\(artifact, true\)\.then\(async \(context\) => \{[\s\S]*requireReviewStore\(\)\.load\(artifact\.review\.id\)[\s\S]*pendingManagedReviewNotifications\.set\([\s\S]*managedDocument\(latestArtifact, context\)/
  )
  assert.match(managedReview, /createWindow\(\{ show: false \}\)/)
  assert.match(managedReview, /flushPendingManagedReviewNotifications\(\)/)
  assert.doesNotMatch(managedReview, /\.show\(\)|\.focus\(\)|\.restore\(\)/)
  assert.doesNotMatch(managedReview, /activeManagedReview(Id)? = artifact/)

  assert.match(
    main,
    /function flushPendingManagedReviewNotifications[\s\S]*rendererReadyWebContentsId !== window\.webContents\.id[\s\S]*sendMainEvent\([\s\S]*'review:opened'[\s\S]*pendingManagedReviewNotifications\.delete\(reviewId\)/
  )
  assert.match(
    main,
    /function markRendererReady[\s\S]*flushPendingManagedReviewNotifications\(\)/
  )
})

test('persisted review creation does not wait for renderer notification', () => {
  const main = read('src/main.ts')
  const onChange = main.match(
    /async onChange\(artifact, action\) \{[\s\S]*?\n {4}\},/
  )?.[0] || ''

  assert.match(
    onChange,
    /if \(action === 'created'\) \{[\s\S]*sendManagedReview\(artifact\)[\s\S]*return/
  )
  assert.doesNotMatch(onChange, /await sendManagedReview\(artifact\)/)
  assert.match(onChange, /await sendManagedStatus\(artifact\)/)
  assert.match(
    onChange,
    /await sendManagedUpdate\(artifact\)[\s\S]*sendManagedStatus\(artifact\)/
  )
})

test('managed publication refreshes and transports private project context', () => {
  const main = read('src/main.ts')
  assert.match(
    main,
    /function managedDocument[\s\S]*project: context\.project,[\s\S]*projectEvidence: context\.projectEvidence,[\s\S]*sourceState: context\.sourceState/
  )
  assert.match(
    main,
    /function projectContextForReview[\s\S]*refresh = false[\s\S]*if \(refresh\) reviewProjectContexts\.delete\(reviewId\)/
  )
  assert.match(
    main,
    /sendManagedUpdate[\s\S]*projectContextForReview\(artifact, true\)/
  )
  assert.match(
    main,
    /activateManagedReview[\s\S]*projectContextForReview\(artifact, true\)/
  )
  assert.match(
    main,
    /privilegedIpc\.on\('review:activate',[\s\S]*managedStore\.load\(reviewId\)\.then\(async \(artifact\) => \{[\s\S]*await sendManagedUpdate\(artifact\)/
  )
})

test('native window focus state reaches the renderer without activating Markover', () => {
  const main = read('src/main.ts')
  const preload = read('src/preload.ts')
  const renderer = read('src/renderer.ts')

  assert.match(main, /window\.on\('focus',[\s\S]*mainWindowBlurredAt = null/)
  assert.match(main, /window\.on\('blur',[\s\S]*mainWindowBlurredAt = Date\.now\(\)/)
  assert.match(main, /privilegedIpc\.handle\('window:focus-state:get', currentWindowFocusState\)/)
  assert.match(preload, /getWindowFocusState:.*window:focus-state:get/)
  assert.match(preload, /onWindowFocusChanged:[\s\S]*window:focus-state/)
  assert.match(
    renderer,
    /onWindowFocusChanged[\s\S]*windowFocusStateVersion \+= 1[\s\S]*const initialFocusStateVersion = windowFocusStateVersion[\s\S]*await bridge\.getWindowFocusState\(\)[\s\S]*windowFocusStateVersion === initialFocusStateVersion[\s\S]*windowFocusState = initialFocusState/
  )
})

test('development watch replacements appear without activating Markover', () => {
  const main = read('src/main.ts')
  const createWindow = main.slice(
    main.indexOf('function createWindow('),
    main.indexOf('function currentWindowFocusState(')
  )

  assert.match(
    main,
    /developmentWatchMode = process\.env\[DEVELOPMENT_WATCH_ENVIRONMENT\] === '1'/
  )
  assert.match(
    createWindow,
    /showWithoutActivating = show && \([\s\S]*developmentWatchMode \|\| canonicalRefreshWindowMode/
  )
  assert.match(createWindow, /show: show && !showWithoutActivating/)
  assert.match(createWindow, /if \(showWithoutActivating\) window\.showInactive\(\)/)
  assert.doesNotMatch(createWindow, /if \(showWithoutActivating\).*window\.show\(\)/)
})

test('normal macOS activation restores an initially inactive window', () => {
  const main = read('src/main.ts')

  assert.match(
    main,
    /const restoreApplicationWindow = \(\): void => \{[\s\S]*if \(smokeMode\) return[\s\S]*focusMainWindow\(\)[\s\S]*app\.on\('activate', restoreApplicationWindow\)[\s\S]*app\.on\('did-become-active', restoreApplicationWindow\)/
  )
  assert.match(
    main,
    /applicationMenuTemplate\(\{[\s\S]*onBringAllToFront: focusMainWindow/
  )
})

test('incoming reviews are listed before the activation policy runs', () => {
  const renderer = read('src/renderer.ts')
  const handler = renderer.match(
    /async function handleIncomingReview\([\s\S]*?\n\}/
  )?.[0] || ''

  assert.match(handler, /addManagedReview\(managedReviewDocument\(reviewDocument\), false\)/)
  assert.match(
    handler,
    /if \(session\.reviewId === state\.reviewId\) \{[\s\S]*hideIncomingReviewNotice\(\)[\s\S]*clearIncomingReviewWarning\(\)[\s\S]*return/
  )
  assert.match(handler, /incomingReviewAction\(\{/)
  assert.match(handler, /if \(action === 'warn'\)[\s\S]*showIncomingReviewWarning/)
  assert.match(handler, /if \(action === 'notify'\)[\s\S]*showIncomingReviewNotice/)
  assert.match(
    handler,
    /activateIncomingReview\([\s\S]*session\.reviewId,[\s\S]*windowFocusState\.focused,[\s\S]*sequence/
  )
})

test('warning and notice UI keep the current review safe and target the latest arrival', () => {
  const renderer = read('src/renderer.ts')
  const html = read('src/index.html')

  assert.match(html, /id="incoming-review-dialog-keep"[\s\S]*>Keep Current</)
  assert.match(html, /id="incoming-review-dialog-open"[\s\S]*>Open New Review</)
  assert.match(html, /id="incoming-review-notice-open"[^>]*>Open</)
  assert.match(
    renderer,
    /incomingReviewNoticePrompts = appendIncomingReview\([\s\S]*incomingReviewNoticeCount = incomingReviewNoticePrompts\.length[\s\S]*incomingReviewNoticeId = session\.reviewId/
  )
  assert.match(
    renderer,
    /incomingReviewWarningPrompts = appendIncomingReview\([\s\S]*incomingReviewWarningCount = incomingReviewWarningPrompts\.length[\s\S]*incomingReviewWarningId = session\.reviewId/
  )
  assert.match(renderer, /incomingReviewDialogKeep\.focus\(\)/)
  assert.match(
    renderer,
    /const reviewId = incomingReviewWarningId[\s\S]*const sequence = incomingReviewWarningSequence[\s\S]*activateIncomingReview\(reviewId, true, sequence\)/
  )
  assert.match(
    renderer,
    /const reviewId = incomingReviewNoticeId[\s\S]*const sequence = incomingReviewNoticeSequence[\s\S]*activateIncomingReview\(reviewId, true, sequence\)/
  )
  assert.match(
    renderer,
    /!windowFocusState\.focused \|\|[\s\S]*elements\.incomingReviewNotice\.hidden \|\|[\s\S]*elements\.incomingReviewDialog\.open \|\|[\s\S]*elements\.settingsDialog\.open \|\|[\s\S]*elements\.fixedContractDialog\.open \|\|[\s\S]*elements\.imagePreview\.open \|\|[\s\S]*elements\.reviewContextDrawer\.open/
  )
  assert.match(
    renderer,
    /incomingReviewDialog\.addEventListener\('close',[\s\S]*scheduleIncomingReviewNoticeDismissal\(\)/
  )
  assert.match(
    renderer,
    /function showIncomingReviewWarning[\s\S]*showModal\(\)[\s\S]*scheduleIncomingReviewNoticeDismissal\(\)/
  )
  assert.match(
    renderer,
    /function openSettings[\s\S]*showModal\(\)[\s\S]*scheduleIncomingReviewNoticeDismissal\(\)/
  )
  assert.match(
    renderer,
    /settingsDialog\.addEventListener\('close',[\s\S]*scheduleIncomingReviewNoticeDismissal\(\)/
  )
  assert.match(
    renderer,
    /if \(outcome === 'blocked'\)[\s\S]*activationSequence === incomingReviewSequence[\s\S]*showIncomingReviewNotice\(session, activationSequence\)[\s\S]*return outcome[\s\S]*if \(outcome === 'missing'\) return outcome[\s\S]*dismissIncomingPromptsThrough\(activationSequence\)/
  )
  assert.match(
    renderer,
    /function dismissIncomingPromptsThrough[\s\S]*retainIncomingReviewsAfter\([\s\S]*incomingReviewNoticePrompts,[\s\S]*sequence[\s\S]*replaceIncomingReviewNoticePrompts\(noticePrompts\)[\s\S]*retainIncomingReviewsAfter\([\s\S]*incomingReviewWarningPrompts,[\s\S]*sequence[\s\S]*replaceIncomingReviewWarningPrompts\(warningPrompts\)/
  )
  assert.match(
    renderer,
    /incomingReviewNoticeOpen\.addEventListener\([\s\S]*'focus',[\s\S]*scheduleIncomingReviewNoticeDismissal[\s\S]*'blur',[\s\S]*scheduleIncomingReviewNoticeDismissal/
  )
  assert.match(
    renderer,
    /async function activateReview[\s\S]*if \(!reviewSessions\.get\(reviewId\)\) return 'missing'[\s\S]*await reviewMutations\.wait\(currentReviewId\)[\s\S]*if \(!reviewSessions\.get\(reviewId\)\) return 'missing'[\s\S]*reviewSessions\.activate\(reviewId\)/
  )
  assert.match(
    renderer,
    /function removeIncomingPrompts[\s\S]*removeIncomingReview\(incomingReviewNoticePrompts, reviewId\)[\s\S]*replaceIncomingReviewNoticePrompts\(noticePrompts\)[\s\S]*removeIncomingReview\(incomingReviewWarningPrompts, reviewId\)[\s\S]*replaceIncomingReviewWarningPrompts\(warningPrompts\)[\s\S]*async function handleReviewTrashed[\s\S]*removeIncomingPrompts\(reviewId\)[\s\S]*reviewSessions\.remove\(reviewId\)/
  )
  assert.match(
    renderer,
    /async function activateReview[\s\S]*if \(reviewId === state\.reviewId\) \{[\s\S]*removeIncomingPrompts\(reviewId\)[\s\S]*return 'already-active'[\s\S]*renderReviewContext\(\)[\s\S]*removeIncomingPrompts\(reviewId\)[\s\S]*return 'activated'/
  )
  assert.match(
    renderer,
    /async function activateReview[\s\S]*if \(!finishActiveSourceEdit\(\)\) return 'blocked'[\s\S]*if \(elements\.reviewTrashDialog\.open\) \{[\s\S]*completeReviewTrashConfirmation\(false\)[\s\S]*reviewSessions\.activate\(reviewId\)/
  )
  assert.match(
    renderer,
    /function openImagePreview[\s\S]*imagePreview\.showModal\(\)[\s\S]*scheduleIncomingReviewNoticeDismissal\(\)[\s\S]*function closeImagePreview[\s\S]*imagePreview\.close\(\)[\s\S]*scheduleIncomingReviewNoticeDismissal\(\)/
  )
  assert.match(
    renderer,
    /function openReviewContext[\s\S]*reviewContextDrawer\.showModal\(\)[\s\S]*scheduleIncomingReviewNoticeDismissal\(\)[\s\S]*function closeReviewContext[\s\S]*reviewContextDrawer\.close\(\)[\s\S]*scheduleIncomingReviewNoticeDismissal\(\)/
  )
  assert.match(
    renderer,
    /if \([\s\S]*elements\.settingsDialog\.open \|\|[\s\S]*elements\.incomingReviewDialog\.open \|\|[\s\S]*elements\.reviewTrashDialog\.open[\s\S]*\) return/
  )
})

test('completed agent reviews update full content and notify without activation', () => {
  const renderer = read('src/renderer.ts')
  const sessions = read('src/review-sessions.ts')
  assert.match(
    renderer,
    /previousStatus === 'agent-reviewing'[\s\S]*session\.tree\.review\.status === 'reviewed'[\s\S]*showIncomingReviewNotice/
  )
  assert.match(renderer, /Agent review completed — no findings/)
  assert.match(renderer, /Agent review completed —.*finding/)
  assert.match(
    renderer,
    /status === 'reviewed'[\s\S]*This agent review is complete\. Open a new review for another feedback round\./
  )
  assert.match(sessions, /session\.tree = replacement/)
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
    /canonicalRefreshWindowMode = process\.argv\.includes\([\s\S]*--markover-refresh-window[\s\S]*function createWindow\([\s\S]*show = !backgroundServerMode \|\| canonicalRefreshWindowMode[\s\S]*showWithoutActivating = show && \([\s\S]*developmentWatchMode \|\| canonicalRefreshWindowMode[\s\S]*new BrowserWindow\(\{[\s\S]*show: show && !showWithoutActivating[\s\S]*window\.showInactive\(\)/
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

test('development startup does not scan checkout-local review storage', () => {
  const main = read('src/main.ts')

  assert.doesNotMatch(main, /importLegacyReviews|\.markover['"], ['"]reviews/)
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
  const rendererLoadFailure = main.match(
    /function handleRendererLoadFailure\([\s\S]*?\n\}/
  )?.[0] || ''
  const createWindow = main.slice(
    main.indexOf('function createWindow('),
    main.indexOf('function managedDocument(')
  )

  assert.match(
    bestEffort,
    /try \{[\s\S]*await failStartup\([\s\S]*catch \(diagnosticError\)[\s\S]*process\.stderr\.write/
  )
  assert.equal(
    createWindow.match(/await failStartupBestEffort\(/g)?.length,
    2
  )
  assert.equal(
    createWindow.match(/await showStartupFailureDialog\(\)/g)?.length,
    2
  )
  assert.match(
    rendererLoadFailure,
    /const failedDuringStartup = !startupReady[\s\S]*if \(!failedDuringStartup\) \{[\s\S]*Waiting for the next valid development build[\s\S]*return[\s\S]*await failStartupBestEffort\('renderer-load', error\)[\s\S]*await showStartupFailureDialog\(\)/
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

test('the app has one addressed startup and diagnostic lifecycle', () => {
  const main = read('src/main.ts')

  assert.match(main, /applicationDataDirectory,\s*'startup-diagnostic\.json'/)
  assert.doesNotMatch(main, /reviewMode|--markover-review|MARKOVER_REVIEW/)
})

test('automatic startup uses one-shot hidden background LaunchServices flags', () => {
  const cli = read('scripts/markover.ts')

  assert.match(cli, /'\/usr\/bin\/open'/)
  for (const flag of ["'-g'", "'-j'", "'-n'"]) {
    assert.match(cli, new RegExp(flag))
  }
  assert.match(cli, /delete environment\.ELECTRON_RUN_AS_NODE/)
  assert.match(cli, /resolveMarkoverApp/)
  assert.doesNotMatch(cli, /projectDirectory,[\s\S]*'dist',[\s\S]*`Markover-darwin-/)
  assert.match(cli, /packagedApp,[\s\S]*'--args',[\s\S]*'--markover-server'/)
  assert.match(cli, /\['start', '--', '--instance', selector, '--markover-server'\]/)
  assert.match(
    cli,
    /launchCanonicalApplication[\s\S]*RESOLVED_INSTANCE_ENVIRONMENT[\s\S]*spawnProcess\([\s\S]*executablePath,[\s\S]*'--markover-server',[\s\S]*'--markover-refresh-window'/
  )
  assert.match(cli, /\{ encoding: 'utf8', env: environment \}/)
  assert.doesNotMatch(cli, /launchctl[\s\S]*submit/)
  assert.doesNotMatch(cli, /replaceStale/)
})

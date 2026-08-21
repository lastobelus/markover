import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('snapshot protocol distinguishes handoff from shutdown without transient status', () => {
  const contracts = read('src/contracts.ts')
  const preload = read('src/preload.ts')
  const renderer = read('src/renderer.ts')
  const snapshotHandler = renderer.slice(
    renderer.indexOf('bridge.onReviewSnapshotRequested'),
    renderer.indexOf('let reviewDocument: MarkoverDocument')
  )

  assert.match(contracts, /purpose: 'handoff' \| 'shutdown'/)
  assert.match(preload, /const tree = await callback\(request\)/)
  assert.equal(
    preload.match(/purpose: request\.purpose/g)?.length,
    2
  )
  assert.match(
    snapshotHandler,
    /\{ reviewId, purpose \}[\s\S]*if \(purpose === 'handoff'\) \{[\s\S]*updateStatus\(reviewId, 'handoff-in-progress'\)/
  )
  assert.doesNotMatch(
    snapshotHandler,
    /purpose === 'shutdown'[\s\S]*handoff-in-progress/
  )
})

test('managed quit owns the complete ordered durability barrier and escape hatch', () => {
  const main = read('src/main.ts')
  const barrier = main.match(
    /async function runManagedDurabilityShutdown\(\): Promise<void> \{[\s\S]*?\n\}/
  )?.[0] || ''
  const beforeQuit = main.slice(
    main.indexOf("app.on('before-quit'"),
    main.indexOf("app.on('will-quit'")
  )

  assert.match(barrier, /pauseMutations: pauseManagedMutations/)
  assert.match(
    main,
    /async function pauseManagedMutations[\s\S]*setManagedRendererPause\(true\)[\s\S]*managedLocalReviewCreationsBlocked = true[\s\S]*localService\?\.pauseMutations\(\)[\s\S]*managedLocalReviewCreations\.wait\(\)/
  )
  assert.match(
    main,
    /function resumeManagedMutationsUnlessShuttingDown[\s\S]*if \(!managedShutdownStarted\)[\s\S]*managedAttachmentSavesBlocked = false[\s\S]*localService\?\.resumeMutations\(\)/
  )
  assert.match(
    main,
    /review:create-local[\s\S]*if \(managedLocalReviewCreationsBlocked\)[\s\S]*managedLocalReviewCreations\.track\(\(\) => createManagedLocalReview\(tree\)\)/
  )
  assert.match(
    barrier,
    /captureSnapshots: captureEditableManagedReviews,[\s\S]*blockNewAttachments[\s\S]*managedAttachmentMutations\.wait\(\)/
  )
  assert.match(barrier, /requireManagedAutosave\(\)\.flushAll\(\)/)
  assert.match(barrier, /requireWorkspaceStore\(\)\.flush\(\)/)
  assert.match(barrier, /closeService: stopPublishedService/)
  assert.match(beforeQuit, /event\.preventDefault\(\)/)
  assert.match(beforeQuit, /if \(managedShutdownStarted\) return/)
  assert.match(beforeQuit, /finishManagedShutdown\(\)/)
  assert.match(main, /buttons: \['Retry Quit', 'Cancel Quit', 'Quit Anyway'\]/)
  assert.match(main, /cancelId: 1/)
  assert.match(main, /managedShutdownComplete = true[\s\S]*app\.quit\(\)/)
  assert.match(main, /response === 2[\s\S]*app\.exit\(0\)/)
  assert.match(
    main,
    /response === 1[\s\S]*restorePublishedServiceForEditing\(\)[\s\S]*managedShutdownStarted = false[\s\S]*return/
  )
  assert.match(
    main,
    /function resumeManagedMutations[\s\S]*managedLocalReviewCreationsBlocked = false/
  )
  assert.match(
    main,
    /async function moveReviewToTrash[\s\S]*trashReview\(/
  )
  assert.doesNotMatch(main, /privateEnrichmentStore|cleanupThreadAfterTrash/)
  assert.match(
    main,
    /stopPublishedService[\s\S]*closingPublishedService = service[\s\S]*await service\.close\(\)[\s\S]*localService = null/
  )
  assert.match(
    main,
    /restorePublishedServiceForEditing[\s\S]*localService === closingPublishedService[\s\S]*localService = null[\s\S]*await serviceRepairQueue\.catch\(\(\) => \{\}\)[\s\S]*startAndPublishService\(\)/
  )
  assert.match(
    main,
    /repairServiceRecords[\s\S]*localServiceIdentity !== identity \|\| localService !== service[\s\S]*publishServiceConnection/
  )
})

test('autosave storage failures use a dedicated persistent renderer warning', () => {
  const html = read('src/index.html')
  const main = read('src/main.ts')
  const preload = read('src/preload.ts')
  const renderer = read('src/renderer.ts')

  assert.match(
    html,
    /id="durability-warning"[\s\S]*role="status"[\s\S]*aria-live="assertive"[\s\S]*hidden/
  )
  assert.match(
    main,
    /onFailure\(reviewId, error\)[\s\S]*sendManagedAutosaveStatus\(\)[\s\S]*onRecovered\(\)[\s\S]*sendManagedAutosaveStatus\(\)/
  )
  assert.match(
    renderer,
    /onReviewAutosaveStatus\(applyReviewAutosaveStatus\)[\s\S]*await bridge\.getReviewAutosaveStatus\(\)/
  )
  assert.match(
    renderer,
    /autosaveFailureMessage\(failedReviewIds\)[\s\S]*durabilityWarning\.hidden = message === null/
  )
  assert.match(
    preload,
    /getReviewAutosaveStatus[\s\S]*review:autosave-status:get/
  )
  assert.match(
    main,
    /review:autosave-status:get[\s\S]*currentManagedAutosaveStatus/
  )
})

test('renderer mutations drain before main blocks new attachment saves', () => {
  const main = read('src/main.ts')
  const renderer = read('src/renderer.ts')

  assert.match(
    main,
    /setManagedRendererPause\(paused: boolean\)[\s\S]*review:shutdown-state/
  )
  assert.match(
    main,
    /captureSnapshots: captureEditableManagedReviews,[\s\S]*managedAttachmentSavesBlocked = true[\s\S]*managedAttachmentMutations\.wait\(\)/
  )
  assert.match(
    main,
    /if \(managedAttachmentSavesBlocked\)[\s\S]*finishing review saves before quitting/
  )
  assert.match(
    renderer,
    /onReviewShutdownState\(\(paused\)[\s\S]*elements\.appShell\.inert = paused/
  )
})

test('the existing live Electron smoke exits through the durability barrier', () => {
  const main = read('src/main.ts')
  const smokeResult = main.match(
    /privilegedIpc\.handle\('smoke:result',[\s\S]*?\n {4}\}\)/
  )?.[0] || ''
  const beforeQuit = main.slice(
    main.indexOf("app.on('before-quit'"),
    main.indexOf("app.on('will-quit'")
  )

  assert.match(smokeResult, /if \(checksPassed\) app\.quit\(\)/)
  assert.match(smokeResult, /else app\.exit\(1\)/)
  assert.doesNotMatch(beforeQuit, /smokeMode/)
})

test('public guidance states the tested durability contract and its limits', () => {
  const development = read('docs/developer/development.md')
  const guide = read('docs/user/guide/index.html')
  const readme = read('README.md')

  assert.match(
    guide,
    /id="durability"[\s\S]*two-second window by default[\s\S]*reviews already inflight with an agent/
  )
  assert.match(
    guide,
    /Power loss, operating-system or hardware failure, and unhealthy or unusually slow storage are outside it/
  )
  assert.match(
    development,
    /autosaveMaximumDelayMs[\s\S]*integer from `100` through `60000`\s+milliseconds[\s\S]*restart\s+it afterward/
  )
  assert.match(readme, /Autosave and automatic restart recovery/)
})

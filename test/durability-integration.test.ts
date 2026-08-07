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

  assert.match(barrier, /setManagedMutationPause\(true\)/)
  assert.match(barrier, /localService\?\.pauseMutations\(\)/)
  assert.match(barrier, /managedAttachmentMutations\.wait\(\)/)
  assert.match(barrier, /captureEditableManagedReviews/)
  assert.match(barrier, /requireManagedAutosave\(\)\.flushAll\(\)/)
  assert.match(barrier, /closeService: stopPublishedService/)
  assert.match(beforeQuit, /event\.preventDefault\(\)/)
  assert.match(beforeQuit, /if \(managedShutdownStarted\) return/)
  assert.match(beforeQuit, /finishManagedShutdown\(\)/)
  assert.match(main, /buttons: \['Retry Quit', 'Quit Anyway'\]/)
  assert.match(main, /managedShutdownComplete = true[\s\S]*app\.quit\(\)/)
  assert.match(main, /showDurabilityShutdownDialog\(error\) === 1[\s\S]*app\.exit\(0\)/)
})

test('autosave storage failures use a dedicated persistent renderer warning', () => {
  const html = read('src/index.html')
  const main = read('src/main.ts')
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
    /onReviewAutosaveStatus[\s\S]*autosaveFailureMessage\(failedReviewIds\)[\s\S]*durabilityWarning\.hidden = message === null/
  )
})

test('renderer mutation controls pause during each graceful-shutdown attempt', () => {
  const main = read('src/main.ts')
  const renderer = read('src/renderer.ts')

  assert.match(
    main,
    /setManagedMutationPause\(paused: boolean\)[\s\S]*review:shutdown-state/
  )
  assert.match(
    main,
    /if \(reviewId && managedMutationsPaused\)[\s\S]*finishing review saves before quitting/
  )
  assert.match(
    renderer,
    /onReviewShutdownState\(\(paused\)[\s\S]*element\.inert = paused/
  )
})

test('the existing live Electron smoke exits through the durability barrier', () => {
  const main = read('src/main.ts')
  const smokeResult = main.match(
    /ipcMain\.handle\('smoke:result',[\s\S]*?\n {4}\}\)/
  )?.[0] || ''
  const beforeQuit = main.slice(
    main.indexOf("app.on('before-quit'"),
    main.indexOf("app.on('will-quit'")
  )

  assert.match(smokeResult, /if \(checksPassed\) app\.quit\(\)/)
  assert.match(smokeResult, /else app\.exit\(1\)/)
  assert.doesNotMatch(beforeQuit, /smokeMode/)
})

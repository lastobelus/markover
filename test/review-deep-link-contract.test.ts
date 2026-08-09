import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('main captures packaged links early and routes them through acknowledged activation', () => {
  const main = read('src/main.ts')
  const openUrl = main.indexOf("app.on('open-url'")
  const ready = main.indexOf('app.whenReady().then')
  assert.ok(openUrl >= 0 && openUrl < ready)
  assert.match(
    main,
    /parseReviewUrl\(value, CANONICAL_INSTANCE_SCHEME\)[\s\S]*reviewUrlDispatcher\.receive\(parsed\)/
  )
  assert.match(main, /onActivate: activateManagedReview/)
  assert.match(main, /requestRendererActivation\(/)
  assert.match(main, /review:activation-request/)
  assert.match(main, /ACTIVATION_TIMEOUT/)
  assert.match(main, /review:activation-response/)
  assert.match(
    main,
    /await waitForRendererReady\(window\)/
  )
  assert.match(
    main,
    /if \(startupReady\) \{\s*markRendererReady\(event\.sender\.id\)/
  )
  assert.match(
    main,
    /startupReady = true\s*markRendererReady\(event\.sender\.id\)\s*reviewUrlDispatcher\.markReady\(\)/
  )
})

test('preload and renderer acknowledge activation without replacing an existing session', () => {
  const preload = read('src/preload.ts')
  const renderer = read('src/renderer.ts')
  const activationHandler = renderer.match(
    /bridge\.onReviewActivationRequested\([\s\S]*?\n {2}\}\)/
  )?.[0] || ''
  assert.match(preload, /review:activation-request/)
  assert.match(preload, /review:activation-response/)
  assert.match(
    activationHandler,
    /onReviewActivationRequested[\s\S]*if \(!document\)[\s\S]*return 'missing'/
  )
  assert.match(
    activationHandler,
    /if \(!reviewSessions\.get\(reviewId\)\)[\s\S]*addManagedReview\(managedReviewDocument\(document\), false\)/
  )
  assert.match(activationHandler, /return activateReview\(reviewId\)/)
  assert.doesNotMatch(activationHandler, /configureManagedMode\(\)/)
  assert.match(
    renderer,
    /function removeIncomingPrompts[\s\S]*removeIncomingReview\(incomingReviewNoticePrompts, reviewId\)[\s\S]*removeIncomingReview\(incomingReviewWarningPrompts, reviewId\)[\s\S]*async function activateReview[\s\S]*removeIncomingPrompts\(reviewId\)/
  )
  assert.match(
    renderer,
    /if \(reviewId === state\.reviewId\) \{[\s\S]*removeIncomingPrompts\(reviewId\)[\s\S]*return 'already-active'/
  )
  assert.match(
    renderer,
    /if \(!finishActiveSourceEdit\(\)\) return 'blocked'/
  )
})

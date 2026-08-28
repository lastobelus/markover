import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { MenuItemConstructorOptions } from 'electron'

import { applicationMenuTemplate } from '../src/app-menu'
import { PUBLIC_LINKS, type PublicLinkId } from '../src/public-links'

const root = path.resolve(__dirname, '..', '..')

function submenu(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  assert.ok(Array.isArray(item.submenu))
  return item.submenu
}

test('macOS application menu is named Markover and exposes Settings', () => {
  const template = applicationMenuTemplate({ isMac: true })
  const applicationMenu = template[0]
  assert.ok(applicationMenu)
  assert.equal(applicationMenu.label, 'Markover')
  const settings = submenu(applicationMenu).find(
    (item) => item.label === 'Settings…'
  )
  assert.ok(settings)
  assert.equal(settings.accelerator, 'CommandOrControl+,')
  assert.equal(settings.click, undefined)
})

test('macOS application menu delegates About to the native role', () => {
  const template = applicationMenuTemplate({
    appName: 'Markover-63',
    isMac: true
  })
  const applicationMenu = template[0]
  assert.ok(applicationMenu)
  assert.equal(applicationMenu.label, 'Markover-63')
  const items = submenu(applicationMenu)
  const aboutItems = items.filter((item) => item.role === 'about')
  assert.equal(aboutItems.length, 1)
  assert.equal(items[0], aboutItems[0])
  assert.equal(aboutItems[0]?.click, undefined)
})

test('the File menu keeps manual Markdown opening available', () => {
  const onOpen = () => {}
  const template = applicationMenuTemplate({ isMac: true, onOpen })
  const fileMenu = template.find((item) => item.label === 'File')
  assert.ok(fileMenu)
  const openItem = submenu(fileMenu)[0]
  assert.ok(openItem)
  assert.notEqual(openItem.enabled, false)
  assert.equal(openItem.click, onOpen)
})

test('Review menu keeps deletion and cleanup extensible and state-aware', () => {
  const template = applicationMenuTemplate({
    isMac: true,
    canCleanUpAttachments: true,
    canTrashReview: true,
    onBatchSetStatus: () => {},
    onCleanUpAttachments: () => {},
    onTrashReview: () => {}
  })
  const reviewMenu = template.find((item) => item.label === 'Review')
  assert.ok(reviewMenu)
  const items = submenu(reviewMenu)
  const batch = items.find((item) => item.id === 'review.batch-set-status')
  const trash = items.find((item) => item.id === 'review.move-to-trash')
  const cleanup = items.find(
    (item) => item.id === 'review.clean-up-unused-attachments'
  )
  assert.equal(batch?.enabled, true)
  assert.equal(trash?.enabled, true)
  assert.equal(cleanup?.enabled, true)
  assert.equal(typeof batch.click, 'function')
  assert.equal(typeof trash.click, 'function')
  assert.equal(typeof cleanup.click, 'function')

  const disabled = applicationMenuTemplate({ isMac: true })
  const disabledReview = disabled.find((item) => item.label === 'Review')
  assert.ok(disabledReview)
  const disabledItems = submenu(disabledReview)
  assert.equal(
    disabledItems.find((item) => item.id === 'review.batch-set-status')?.enabled,
    false
  )
  assert.equal(
    disabledItems.find((item) => item.id === 'review.move-to-trash')?.enabled,
    false
  )
  assert.equal(
    disabledItems.find(
      (item) => item.id === 'review.clean-up-unused-attachments'
    )?.enabled,
    false
  )
})

test('View menu exposes bounded persistent zoom commands', () => {
  const template = applicationMenuTemplate({
    canResetZoom: true,
    canZoomIn: false,
    canZoomOut: true,
    isMac: true,
    onResetZoom: () => {},
    onZoomIn: () => {},
    onZoomOut: () => {}
  })
  const viewMenu = template.find((item) => item.label === 'View')
  assert.ok(viewMenu)
  const items = submenu(viewMenu)
  const actualSize = items.find((item) => item.id === 'view.actual-size')
  const zoomIn = items.find((item) => item.id === 'view.zoom-in')
  const zoomOut = items.find((item) => item.id === 'view.zoom-out')
  assert.ok(actualSize)
  assert.ok(zoomIn)
  assert.ok(zoomOut)

  assert.equal(actualSize.accelerator, 'CommandOrControl+0')
  assert.equal(actualSize.enabled, true)
  assert.equal(typeof actualSize.click, 'function')
  assert.equal(zoomIn.accelerator, 'CommandOrControl+Plus')
  assert.equal(zoomIn.enabled, false)
  assert.equal(typeof zoomIn.click, 'function')
  assert.equal(zoomOut.accelerator, 'CommandOrControl+-')
  assert.equal(zoomOut.enabled, true)
  assert.equal(typeof zoomOut.click, 'function')
})

test('macOS Bring All to Front delegates to main-window restoration', () => {
  let restored = 0
  const template = applicationMenuTemplate({
    isMac: true,
    onBringAllToFront: () => { restored += 1 }
  })
  const windowMenu = template.find((item) => item.label === 'Window')
  assert.ok(windowMenu)
  const bringAllToFront = submenu(windowMenu).find(
    (item) => item.label === 'Bring All to Front'
  )
  assert.ok(bringAllToFront)
  assert.equal(bringAllToFront.role, undefined)
  const click = bringAllToFront.click as (() => void) | undefined
  assert.ok(click)
  click()
  assert.equal(restored, 1)
})

test('main process applies persisted zoom before and after renderer load', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  assert.match(
    main,
    /applyWindowZoom\(window, startupSettings\.zoomPercent\)[\s\S]*?window\.loadURL/
  )
  assert.match(
    main,
    /webContents\.on\('did-finish-load',[\s\S]*?applyWindowZoom\([\s\S]*?settingsStore\?\.settings\.zoomPercent/
  )
  assert.match(
    main,
    /function applyMainSettings\([\s\S]*?applyWindowZoom\(window, settings\.zoomPercent\)/
  )
  assert.match(
    main,
    /store\.update\(\{ zoomPercent: next \}\)[\s\S]*?installApplicationMenu\(\)/
  )
  assert.match(
    main,
    /function applyWindowZoom\([\s\S]*const bounds = window\.getBounds\(\)[\s\S]*screen\.getDisplayMatching\(bounds\)\.workArea[\s\S]*setMinimumSize\([\s\S]*workArea\.x \+ workArea\.width - width[\s\S]*workArea\.y \+ workArea\.height - height[\s\S]*setBounds\(\{ x, y, width, height \}\)[\s\S]*setZoomFactor\(zoomPercent \/ 100\)/
  )
  assert.match(
    main,
    /let currentDisplayId = screen\.getDisplayMatching\(window\.getBounds\(\)\)\.id[\s\S]*const refitWindowAfterDisplayTransition[\s\S]*if \(display\.id === currentDisplayId\) return[\s\S]*currentDisplayId = display\.id[\s\S]*applyCurrentWindowZoom\(\)[\s\S]*window\.on\('move', refitWindowAfterDisplayTransition\)/
  )
  assert.match(
    main,
    /const refitWindowForDisplayMetrics[\s\S]*if \(display\.id !== currentDisplayId\) return[\s\S]*applyCurrentWindowZoom\(\)[\s\S]*screen\.on\('display-metrics-changed', refitWindowForDisplayMetrics\)[\s\S]*window\.once\('closed',[\s\S]*screen\.removeListener\('display-metrics-changed', refitWindowForDisplayMetrics\)/
  )
})

test('Help uses the native role and exposes the canonical public commands', () => {
  const opened: PublicLinkId[] = []
  const template = applicationMenuTemplate({
    isMac: true,
    onOpenPublicLink: (id) => { opened.push(id) }
  })
  const helpMenu = template.find((item) => item.role === 'help')
  assert.ok(helpMenu)
  assert.equal(helpMenu, template.at(-1))
  const items = submenu(helpMenu)
  assert.deepEqual(
    items.map((item) => ({ id: item.id, label: item.label })),
    PUBLIC_LINKS.map((link) => ({
      id: `help.${link.id}`,
      label: link.label
    }))
  )
  for (const [index, item] of items.entries()) {
    const click = item.click as (() => void) | undefined
    assert.ok(click)
    click()
    assert.equal(opened.at(-1), PUBLIC_LINKS[index]?.id)
  }
})

test('Help places the exact Markdown limitations destination between user and privacy help', () => {
  assert.deepEqual(PUBLIC_LINKS.slice(0, 3), [
    {
      id: 'user-guide',
      label: 'User Guide',
      url: 'https://lastobelus.github.io/markover/guide/'
    },
    {
      id: 'markdown-support-and-limitations',
      label: 'Markdown Support and Limitations',
      url: 'https://lastobelus.github.io/markover/limitations/'
    },
    {
      id: 'privacy-and-local-data',
      label: 'Privacy and Local Data',
      url: 'https://lastobelus.github.io/markover/privacy/'
    }
  ])
})

test('non-macOS Help preserves Settings after the public commands', () => {
  const template = applicationMenuTemplate({ isMac: false })
  const helpMenu = template.find((item) => item.role === 'help')
  assert.ok(helpMenu)
  const items = submenu(helpMenu)
  assert.deepEqual(
    items.slice(0, PUBLIC_LINKS.length).map((item) => item.label),
    PUBLIC_LINKS.map((link) => link.label)
  )
  assert.equal(items[PUBLIC_LINKS.length]?.type, 'separator')
  assert.equal(items[PUBLIC_LINKS.length + 1]?.label, 'Settings…')
})

test('review deletion copy distinguishes review data from the original document', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8')
  const renderer = fs.readFileSync(path.join(root, 'src/renderer.ts'), 'utf8')
  assert.match(
    html,
    /id="review-trash-safety"[^>]*>Your original Markdown document will not be changed or deleted\.</
  )
  assert.match(
    renderer,
    /The entire \$\{request\.reviewId\} review directory, including its feedback and review attachments, will move to the macOS Trash\. Existing review links will no longer open the review\./
  )
  assert.match(main, /requestReviewTrashConfirmation\([\s\S]*policy === 'pending-agent'/)
  const confirmation = /async function confirmReviewTrash\([\s\S]*?\n}/.exec(main)?.[0]
  assert.ok(confirmation)
  assert.doesNotMatch(confirmation, /dialog\.showMessageBox/)
})

test('review deletion confirms before pausing or saving managed mutations', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  const moveReviewToTrash = /async function moveReviewToTrash\([\s\S]*?\n}\n\nasync function confirmUnusedAttachmentCleanup/.exec(main)?.[0]
  assert.ok(moveReviewToTrash)

  const confirmation = moveReviewToTrash.indexOf(
    'const confirmedPolicy = await confirmReviewTrash(reviewId)'
  )
  const mutationPause = moveReviewToTrash.indexOf(
    'await withManagedMutationsPaused'
  )
  assert.notEqual(confirmation, -1)
  assert.ok(mutationPause > confirmation)
})

test('review deletion revalidates stale warnings before saving drafts', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  const pauseBarrier = /async function withManagedMutationsPaused\([\s\S]*?\n}\n\nasync function confirmReviewTrash/.exec(main)?.[0]
  const moveReviewToTrash = /async function moveReviewToTrash\([\s\S]*?\n}\n\nasync function confirmUnusedAttachmentCleanup/.exec(main)?.[0]
  assert.ok(pauseBarrier)
  assert.ok(moveReviewToTrash)

  const pause = pauseBarrier.indexOf('await pauseManagedMutations()')
  const revalidation = pauseBarrier.indexOf(
    'if (confirmBeforeSaving && !await confirmBeforeSaving()) return'
  )
  const snapshot = pauseBarrier.indexOf('await requestRendererSnapshot')
  assert.ok(pause !== -1 && revalidation > pause && snapshot > revalidation)
  assert.match(
    moveReviewToTrash,
    /currentPolicy === confirmedPolicy[\s\S]*?confirmReviewTrash\(reviewId\)/
  )
})

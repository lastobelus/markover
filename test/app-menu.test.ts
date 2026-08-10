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
    onCleanUpAttachments: () => {},
    onTrashReview: () => {}
  })
  const reviewMenu = template.find((item) => item.label === 'Review')
  assert.ok(reviewMenu)
  const items = submenu(reviewMenu)
  const trash = items.find((item) => item.id === 'review.move-to-trash')
  const cleanup = items.find(
    (item) => item.id === 'review.clean-up-unused-attachments'
  )
  assert.equal(trash?.enabled, true)
  assert.equal(cleanup?.enabled, true)
  assert.equal(typeof trash.click, 'function')
  assert.equal(typeof cleanup.click, 'function')

  const disabled = applicationMenuTemplate({ isMac: true })
  const disabledReview = disabled.find((item) => item.label === 'Review')
  assert.ok(disabledReview)
  assert.equal(submenu(disabledReview)[0]?.enabled, false)
  assert.equal(submenu(disabledReview)[2]?.enabled, false)
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

test('main process applies persisted zoom before and after renderer load', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  assert.match(
    main,
    /window\.webContents\.setZoomFactor\(startupSettings\.zoomPercent \/ 100\)[\s\S]*?window\.loadURL/
  )
  assert.match(
    main,
    /webContents\.on\('did-finish-load',[\s\S]*?webContents\.setZoomFactor\([\s\S]*?settingsStore\?\.settings\.zoomPercent/
  )
  assert.match(
    main,
    /function applyMainSettings\([\s\S]*?webContents\.setZoomFactor\(settings\.zoomPercent \/ 100\)/
  )
  assert.match(
    main,
    /store\.update\(\{ zoomPercent: next \}\)[\s\S]*?installApplicationMenu\(\)/
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
  assert.match(
    main,
    /message: \[[\s\S]*?'Your original Markdown document will not be changed or deleted\.'[\s\S]*?\]\.join\('\\n'\)/
  )
  assert.doesNotMatch(
    main,
    /detail: \[[\s\S]*?'Your original Markdown document will not be changed or deleted\.'/
  )
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

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { MenuItemConstructorOptions } from 'electron'

import { applicationMenuTemplate } from '../src/app-menu'

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

test('review mode disables opening an unrelated Markdown document', () => {
  const template = applicationMenuTemplate({ isMac: true, reviewMode: true })
  const fileMenu = template.find((item) => item.label === 'File')
  assert.ok(fileMenu)
  const openItem = submenu(fileMenu)[0]
  assert.ok(openItem)
  assert.equal(openItem.enabled, false)
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
    'if (!await confirmReviewTrash(reviewId)) return'
  )
  const mutationPause = moveReviewToTrash.indexOf(
    'await withManagedMutationsPaused'
  )
  assert.notEqual(confirmation, -1)
  assert.ok(mutationPause > confirmation)
})

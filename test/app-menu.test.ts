import assert from 'node:assert/strict'
import test from 'node:test'

import type { MenuItemConstructorOptions } from 'electron'

import { applicationMenuTemplate } from '../src/app-menu'

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

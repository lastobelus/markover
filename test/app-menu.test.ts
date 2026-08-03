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

test('review mode disables opening an unrelated Markdown document', () => {
  const template = applicationMenuTemplate({ isMac: true, reviewMode: true })
  const fileMenu = template.find((item) => item.label === 'File')
  assert.ok(fileMenu)
  const openItem = submenu(fileMenu)[0]
  assert.ok(openItem)
  assert.equal(openItem.enabled, false)
})

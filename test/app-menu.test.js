const test = require('node:test')
const assert = require('node:assert/strict')
const { applicationMenuTemplate } = require('../src/app-menu')

test('macOS application menu is named Markover and exposes Settings', () => {
  const template = applicationMenuTemplate({ isMac: true })
  assert.equal(template[0].label, 'Markover')
  assert.deepEqual(
    template[0].submenu.find((item) => item.label === 'Settings…'),
    {
      label: 'Settings…',
      accelerator: 'CommandOrControl+,',
      click: undefined
    }
  )
})

test('review mode disables opening an unrelated Markdown document', () => {
  const template = applicationMenuTemplate({ isMac: true, reviewMode: true })
  const fileMenu = template.find((item) => item.label === 'File')
  assert.equal(fileMenu.submenu[0].enabled, false)
})

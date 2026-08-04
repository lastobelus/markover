import type { MenuItemConstructorOptions } from 'electron'

interface ApplicationMenuOptions {
  appName?: string
  isMac?: boolean
  onOpen?: () => void
  onSettings?: () => void
  reviewMode?: boolean
}

export function applicationMenuTemplate({
  appName = 'Markover',
  isMac = process.platform === 'darwin',
  onOpen,
  onSettings,
  reviewMode = false
}: ApplicationMenuOptions = {}): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []
  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CommandOrControl+,',
          ...(onSettings ? { click: onSettings } : {})
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push({
    label: 'File',
    submenu: [
      {
        label: 'Open Markdown…',
        accelerator: 'CommandOrControl+O',
        enabled: !reviewMode,
        ...(onOpen ? { click: onOpen } : {})
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  })
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  })
  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  })
  const windowSubmenu: MenuItemConstructorOptions[] = [
    { role: 'minimize' },
    { role: 'zoom' }
  ]
  if (isMac) {
    windowSubmenu.push({ type: 'separator' }, { role: 'front' })
  }
  template.push({
    label: 'Window',
    submenu: windowSubmenu
  })
  if (!isMac) {
    template.push({
      label: 'Help',
      submenu: [{
        label: 'Settings…',
        ...(onSettings ? { click: onSettings } : {})
      }]
    })
  }
  return template
}

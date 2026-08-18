import type { MenuItemConstructorOptions } from 'electron'

import { PUBLIC_LINKS, type PublicLinkId } from './public-links'

interface ApplicationMenuOptions {
  appName?: string
  canCleanUpAttachments?: boolean
  canResetZoom?: boolean
  canTrashReview?: boolean
  canZoomIn?: boolean
  canZoomOut?: boolean
  isMac?: boolean
  onBringAllToFront?: () => void
  onBatchSetStatus?: () => void
  onCleanUpAttachments?: () => void
  onOpen?: () => void
  onOpenPublicLink?: (id: PublicLinkId) => void
  onResetZoom?: () => void
  onSettings?: () => void
  onTrashReview?: () => void
  onZoomIn?: () => void
  onZoomOut?: () => void
}

export function applicationMenuTemplate({
  appName = 'Markover',
  canCleanUpAttachments = false,
  canResetZoom = false,
  canTrashReview = false,
  canZoomIn = true,
  canZoomOut = true,
  isMac = process.platform === 'darwin',
  onBringAllToFront,
  onBatchSetStatus,
  onCleanUpAttachments,
  onOpen,
  onOpenPublicLink,
  onResetZoom,
  onSettings,
  onTrashReview,
  onZoomIn,
  onZoomOut
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
    label: 'Review',
    submenu: [
      {
        id: 'review.batch-set-status',
        label: 'Batch Set Status…',
        enabled: Boolean(onBatchSetStatus),
        ...(onBatchSetStatus ? { click: onBatchSetStatus } : {})
      },
      { type: 'separator' },
      {
        id: 'review.move-to-trash',
        label: 'Move Review to Trash…',
        enabled: canTrashReview,
        ...(onTrashReview ? { click: onTrashReview } : {})
      },
      { type: 'separator' },
      {
        id: 'review.clean-up-unused-attachments',
        label: 'Clean Up Unused Attachments…',
        enabled: canCleanUpAttachments,
        ...(onCleanUpAttachments ? { click: onCleanUpAttachments } : {})
      }
    ]
  })
  template.push({
    label: 'View',
    submenu: [
      {
        id: 'view.actual-size',
        label: 'Actual Size',
        accelerator: 'CommandOrControl+0',
        enabled: canResetZoom,
        ...(onResetZoom ? { click: onResetZoom } : {})
      },
      {
        id: 'view.zoom-in',
        label: 'Zoom In',
        accelerator: 'CommandOrControl+Plus',
        enabled: canZoomIn,
        ...(onZoomIn ? { click: onZoomIn } : {})
      },
      {
        id: 'view.zoom-out',
        label: 'Zoom Out',
        accelerator: 'CommandOrControl+-',
        enabled: canZoomOut,
        ...(onZoomOut ? { click: onZoomOut } : {})
      },
      { type: 'separator' },
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
    windowSubmenu.push(
      { type: 'separator' },
      onBringAllToFront
        ? { label: 'Bring All to Front', click: onBringAllToFront }
        : { role: 'front' }
    )
  }
  template.push({
    label: 'Window',
    submenu: windowSubmenu
  })
  const helpSubmenu: MenuItemConstructorOptions[] = PUBLIC_LINKS.map((link) => ({
    id: `help.${link.id}`,
    label: link.label,
    ...(onOpenPublicLink
      ? { click: () => { onOpenPublicLink(link.id) } }
      : {})
  }))
  if (!isMac) {
    helpSubmenu.push(
      { type: 'separator' },
      {
        label: 'Settings…',
        ...(onSettings ? { click: onSettings } : {})
      }
    )
  }
  template.push({ role: 'help', submenu: helpSubmenu })
  return template
}

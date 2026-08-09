import type { WebContents, WebPreferences } from 'electron'

export const hardenedRendererWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  webviewTag: false
} satisfies Pick<
  WebPreferences,
  | 'contextIsolation'
  | 'nodeIntegration'
  | 'sandbox'
  | 'webSecurity'
  | 'webviewTag'
>

export const rendererContentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "font-src 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "img-src 'self' data: blob: file:",
  "media-src 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  // Pierre components inject shadow-root styles and measured scrollbar rules.
  "style-src-elem 'self' 'unsafe-inline'",
  "worker-src 'none'"
].join('; ')

export function installRendererSecurityBoundaries(
  contents: WebContents
): void {
  const preventNavigation = (event: Electron.Event): void => {
    event.preventDefault()
  }
  contents.on('will-navigate', preventNavigation)
  contents.on('will-frame-navigate', preventNavigation)
  contents.on('will-redirect', preventNavigation)
  contents.on('will-attach-webview', preventNavigation)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const rendererSession = contents.session
  rendererSession.setPermissionCheckHandler(() => false)
  rendererSession.setPermissionRequestHandler((
    _webContents,
    _permission,
    callback
  ) => {
    callback(false)
  })
  rendererSession.setDevicePermissionHandler(() => false)
}

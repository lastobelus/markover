import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  hardenedRendererWebPreferences,
  installRendererSecurityBoundaries,
  rendererContentSecurityPolicy
} from '../src/renderer-security'

const root = path.resolve(__dirname, '../..')

test('main installs renderer boundaries before loading local content', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  assert.ok(
    main.indexOf('protocol.registerSchemesAsPrivileged(') <
      main.indexOf('app.whenReady()')
  )
  const createWindow = main.slice(
    main.indexOf('function createWindow('),
    main.indexOf('function repositoryRoot(')
  )
  assert.match(
    createWindow,
    /webPreferences: \{\s*preload:[^}]+\.\.\.hardenedRendererWebPreferences/
  )
  assert.ok(
    createWindow.indexOf('installRendererSecurityBoundaries(') <
      createWindow.indexOf('window.loadURL(')
  )
  assert.doesNotMatch(createWindow, /loadFile/)
})

test('renderer preferences use the exact hardened capability profile', () => {
  assert.deepEqual(hardenedRendererWebPreferences, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false
  })
})

test('renderer CSP allows only the required bundled and image surfaces', () => {
  assert.deepEqual(rendererContentSecurityPolicy.split('; '), [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'none'",
    "font-src 'self'",
    "form-action 'none'",
    "frame-src 'none'",
    "img-src 'self' data: blob:",
    "media-src 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "style-src-elem 'self' 'unsafe-inline'",
    "worker-src 'none'"
  ])
})

test('renderer boundaries deny navigation, windows, webviews, and permissions', () => {
  const listeners = new Map<string, (event: Electron.Event) => void>()
  const handlers: {
    devicePermission?: () => boolean
    openWindow?: () => { action: string }
    permissionCheck?: () => boolean
    permissionRequest?: (
      webContents: unknown,
      permission: string,
      callback: (granted: boolean) => void
    ) => void
  } = {}
  const contents = {
    on(name: string, listener: (event: Electron.Event) => void) {
      listeners.set(name, listener)
    },
    setWindowOpenHandler(handler: () => { action: string }) {
      handlers.openWindow = handler
    },
    session: {
      setPermissionCheckHandler(handler: () => boolean) {
        handlers.permissionCheck = handler
      },
      setPermissionRequestHandler(handler: NonNullable<
        typeof handlers.permissionRequest
      >) {
        handlers.permissionRequest = handler
      },
      setDevicePermissionHandler(handler: () => boolean) {
        handlers.devicePermission = handler
      }
    }
  }

  installRendererSecurityBoundaries(
    contents as unknown as Parameters<
      typeof installRendererSecurityBoundaries
    >[0]
  )

  for (const eventName of [
    'will-navigate',
    'will-frame-navigate',
    'will-redirect',
    'will-attach-webview'
  ]) {
    let prevented = false
    listeners.get(eventName)?.({
      preventDefault() { prevented = true }
    } as Electron.Event)
    assert.equal(prevented, true, `${eventName} must be denied`)
  }
  assert.deepEqual(handlers.openWindow?.(), { action: 'deny' })
  assert.equal(handlers.permissionCheck?.(), false)
  let granted: boolean | null = null
  handlers.permissionRequest?.(
    null,
    'notifications',
    (value: boolean) => { granted = value }
  )
  assert.equal(granted, false)
  assert.equal(handlers.devicePermission?.(), false)
})

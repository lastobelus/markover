import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { IpcMain } from 'electron'

import {
  assertMainEventArguments,
  assertRendererInvokeArguments,
  assertRendererInvokeResult,
  assertRendererSendArguments
} from '../src/ipc-contract'
import {
  isExpectedRendererEntryUrl,
  PrivilegedIpc,
  type IpcRejectionReason,
  type RendererIpcEntry
} from '../src/ipc-security'
import { MARKOVER_RENDERER_ENTRY_URL } from '../src/internal-url'
import { smokeReviewTree } from '../src/smoke-fixture'

const root = path.resolve(__dirname, '../..')

const entry: RendererIpcEntry = {
  url: MARKOVER_RENDERER_ENTRY_URL,
  query: {
    palette: 'ember',
    appearance: 'dark',
    colorization: 'low',
    instanceBadge: 'PR 98'
  }
}

function entryUrl(overrides: Record<string, string> = {}): string {
  const url = new URL(entry.url)
  for (const [key, value] of Object.entries({ ...entry.query, ...overrides })) {
    url.searchParams.set(key, value)
  }
  return url.href
}

test('renderer entry validation requires the exact internal URL and startup query', () => {
  assert.equal(isExpectedRendererEntryUrl(entryUrl(), entry), true)
  assert.equal(isExpectedRendererEntryUrl(entryUrl({ palette: 'ocean' }), entry), false)

  const extra = new URL(entryUrl())
  extra.searchParams.set('unexpected', 'value')
  assert.equal(isExpectedRendererEntryUrl(extra.href, entry), false)

  const duplicate = new URL(entryUrl())
  duplicate.searchParams.append('palette', 'ember')
  assert.equal(isExpectedRendererEntryUrl(duplicate.href, entry), false)
  assert.equal(
    isExpectedRendererEntryUrl('https://example.test/index.html', entry),
    false
  )
})

test('settings IPC accepts supported zoom levels only', () => {
  assert.doesNotThrow(() => {
    assertRendererInvokeArguments('settings:update', [{ zoomPercent: 80 }])
  })
  assert.doesNotThrow(() => {
    assertRendererInvokeArguments('settings:update', [{ zoomPercent: 150 }])
  })
  assert.throws(
    () => {
      assertRendererInvokeArguments('settings:update', [{ zoomPercent: 120 }])
    },
    /Invalid renderer-to-main invoke IPC contract for settings:update/
  )
})

test('privileged IPC rejects forged senders, subframes, URLs, and arguments', () => {
  type Listener = (event: unknown, ...args: unknown[]) => unknown
  const invokes = new Map<string, Listener>()
  const sends = new Map<string, Listener>()
  const fakeIpcMain = {
    handle(channel: string, listener: Listener) { invokes.set(channel, listener) },
    on(channel: string, listener: Listener) { sends.set(channel, listener) }
  } as unknown as IpcMain
  const frame = { url: entryUrl() }
  const contents = {
    isDestroyed: () => false,
    mainFrame: frame
  }
  const diagnostics: Array<{ channel: string, reason: IpcRejectionReason }> = []
  const privileged = new PrivilegedIpc(fakeIpcMain, {
    activeWebContents: () => contents as never,
    diagnose(channel, reason) { diagnostics.push({ channel, reason }) },
    expectedEntry: () => entry
  })
  let writes = 0
  privileged.handle(
    'document:checksum',
    (_event, source: string) => source.length
  )
  privileged.on('clipboard:write', () => { writes += 1 })

  const invoke = invokes.get('document:checksum')
  const send = sends.get('clipboard:write')
  assert.ok(invoke)
  assert.ok(send)
  const event = { sender: contents, senderFrame: frame }
  assert.equal(invoke(event, 'source'), 6)
  send(event, 'copy')
  assert.equal(writes, 1)

  assert.throws(
    () => invoke({ sender: {}, senderFrame: frame }, 'source'),
    /Rejected privileged IPC request/
  )
  assert.throws(
    () => invoke({ sender: contents, senderFrame: { url: entryUrl() } }, 'source'),
    /Rejected privileged IPC request/
  )
  frame.url = 'markover-app://app/src/other.html'
  assert.throws(
    () => invoke(event, 'source'),
    /Rejected privileged IPC request/
  )
  frame.url = entryUrl()
  assert.throws(
    () => invoke(event, 'source', 'extra'),
    /Rejected privileged IPC request/
  )

  send({ sender: {}, senderFrame: frame }, 'copy')
  send(event, 42)
  assert.equal(writes, 1)
  assert.deepEqual(diagnostics.map(({ reason }) => reason), [
    'inactive-sender',
    'non-main-frame',
    'unexpected-url',
    'invalid-payload',
    'inactive-sender',
    'invalid-payload'
  ])
})

test('IPC payload contracts enforce exact current and handed-off schemas', () => {
  const tree = smokeReviewTree('/tmp/markover.svg')
  const managedTree: ReviewTree = {
    ...tree,
    review: { id: 'mko_abcdef', status: 'editing' }
  }
  const document: MarkoverDocument = {
    reviewId: 'mko_abcdef',
    name: tree.sourceDocument.name,
    path: tree.sourceDocument.path,
    source: tree.sourceDocument.content,
    checksum: tree.sourceDocument.checksum,
    tree: managedTree
  }
  assert.doesNotThrow(() => {
    assertRendererInvokeArguments('document:checksum', ['source'])
    assertRendererInvokeArguments('review:create-local', [tree])
    assertRendererInvokeArguments('attachment:save', [{
      bytes: new Uint8Array([1]),
      mimeType: 'image/png'
    }, 'mko_abcdef'])
    assertRendererSendArguments('review:autosave', ['mko_abcdef', managedTree])
    assertRendererInvokeResult('review:create-local', {
      reviewId: 'mko_abcdef',
      name: tree.sourceDocument.name,
      path: tree.sourceDocument.path,
      source: tree.sourceDocument.content,
      checksum: tree.sourceDocument.checksum,
      tree: managedTree
    })
    assertRendererSendArguments('review:snapshot-response', [{
      requestId: 'snapshot-1',
      reviewId: 'mko_abcdef',
      purpose: 'shutdown',
      tree
    }])
    assertRendererSendArguments('review:snapshot-response', [{
      requestId: 'snapshot-1',
      reviewId: 'mko_abcdef',
      purpose: 'shutdown',
      error: 'Snapshot failed.'
    }])
    assertMainEventArguments('review:shutdown-state', [true])
    assertRendererInvokeArguments('window:focus-state:get', [])
    assertRendererInvokeResult('window:focus-state:get', {
      focused: false,
      blurredAt: 1
    })
    assertMainEventArguments('window:focus-state', [{
      focused: true,
      blurredAt: null
    }])
    assertMainEventArguments('review:activation-request', [{
      requestId: 'activation-1',
      reviewId: 'mko_abcdef',
      document,
      focusState: { focused: false, blurredAt: 1 }
    }])
    assertRendererSendArguments('review:activation-response', [{
      requestId: 'activation-1',
      reviewId: 'mko_abcdef',
      outcome: 'deferred'
    }])
    assertRendererInvokeArguments('review:context-menu:open', [{
      reviewId: 'mko_abcdef'
    }])
    assertRendererInvokeArguments('attachment:remove', [{
      reviewId: 'mko_abcdef',
      attachmentId: 'img-1',
      tree
    }])
    assertMainEventArguments('review:trashed', [{ reviewId: 'mko_abcdef' }])
    assertRendererInvokeResult('attachment:remove', {
      reviewId: 'mko_abcdef',
      attachmentId: 'img-1',
      outcome: 'trashed'
    })
  })

  assert.throws(() => {
    assertRendererInvokeArguments('document:checksum', ['source', 'extra'])
  })
  assert.throws(() => {
    assertRendererInvokeArguments('review:context-menu:open', [{
      reviewId: 'mko_abcdef',
      path: '/tmp/private'
    }])
  })
  assert.throws(() => {
    assertRendererInvokeArguments('attachment:remove', [{
      reviewId: 'mko_abcdef',
      attachmentId: '../review.json',
      tree
    }])
  })
  assert.throws(() => {
    assertRendererSendArguments('review:autosave', [null, { ...tree, extra: true }])
  })
  assert.throws(() => {
    assertRendererInvokeArguments('attachment:save', [{
      bytes: new Uint8Array([1]),
      mimeType: 'image/png'
    }, null])
  })
  assert.throws(() => {
    assertMainEventArguments('review:trashed', [{
      reviewId: 'mko_abcdef',
      path: '/tmp/private'
    }])
  })
  assert.throws(() => {
    assertMainEventArguments('review:activation-request', [{
      requestId: 'activation-1',
      reviewId: 'mko_abcdef',
      document
    }])
  })
})

test('application IPC uses only the centralized registration and bridge paths', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'src/preload.ts'), 'utf8')
  assert.doesNotMatch(main, /ipcMain\.(?:handle|on)\(/)
  assert.doesNotMatch(main, /\.webContents\.send\(/)
  assert.equal(preload.match(/ipcRenderer\.invoke\(/g)?.length, 1)
  assert.equal(preload.match(/ipcRenderer\.send\(/g)?.length, 1)
  assert.equal(preload.match(/ipcRenderer\.on\(/g)?.length, 1)

  const registrations = [...main.matchAll(
    /privilegedIpc\.(?:handle|on)\(\s*'([^']+)'/g
  )].map((match) => match[1]).sort()
  assert.deepEqual(registrations, [
    'attachment:remove',
    'attachment:save',
    'brand:assets',
    'clipboard:read-image',
    'clipboard:write',
    'document:checksum',
    'document:open',
    'review:activate',
    'review:activation-response',
    'review:autosave',
    'review:autosave-status:get',
    'review:context-menu:open',
    'review:create-local',
    'review:initial-document',
    'review:list',
    'review:snapshot-response',
    'review:status-response',
    'settings:get',
    'settings:update',
    'smoke:result',
    'startup:copy-diagnostic',
    'startup:failure',
    'startup:info',
    'startup:phase',
    'startup:quit',
    'startup:renderer-initialized',
    'startup:reveal-diagnostic',
    'window:focus-state:get'
  ])
})

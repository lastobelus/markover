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
import { defaultWorkspaceState } from '../src/workspace-state'

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

test('T3 title IPC accepts only the strict private snapshot', () => {
  assert.doesNotThrow(() => {
    assertRendererInvokeArguments('review:t3-thread-titles:get', [])
    assertRendererInvokeResult('review:t3-thread-titles:get', {
      status: 'available',
      detail: 'One title is available.',
      titles: [{ threadId: 't3-thread-1', title: 'Renamed thread' }]
    })
  })
  assert.throws(() => {
    assertRendererInvokeResult('review:t3-thread-titles:get', {
      status: 'unavailable',
      detail: 'Unavailable.',
      titles: [{ threadId: 't3-thread-1', title: 'Stale title' }]
    })
  })
  assert.throws(() => {
    assertRendererInvokeResult('review:t3-thread-titles:get', {
      status: 'available',
      detail: 'Available.',
      titles: [],
      databasePath: '/private/t3.sqlite'
    })
  })
})

test('workspace IPC accepts only the exact private workspace format', () => {
  const workspace = defaultWorkspaceState()
  assert.doesNotThrow(() => {
    assertRendererInvokeArguments('workspace:get', [])
    assertRendererInvokeArguments('workspace:update', [workspace])
    assertRendererInvokeResult('workspace:get', workspace)
    assertRendererInvokeResult('workspace:update', workspace)
  })
  assert.throws(() => {
    assertRendererInvokeArguments('workspace:update', [{
      ...workspace,
      review: { portable: true }
    }])
  }, /Invalid renderer-to-main invoke IPC contract for workspace:update/)
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

test('IPC payload contracts share the additive v1 review decoder', () => {
  const tree = smokeReviewTree('/tmp/markover.svg')
  const managedTree: ReviewTree = {
    ...tree,
    review: {
      id: 'mko_abcdef',
      status: 'editing',
      origin: 'agent',
      createdAt: '2026-08-11T20:00:00.000Z',
      updatedAt: '2026-08-11T20:00:00.000Z',
      attentionRequestedAt: '2026-08-11T20:00:00.000Z',
      contextSummary: 'Exercise IPC boundaries.',
      agentThread: null,
      git: null,
      pullRequest: null,
      agentGuidance: {
        fixedContract: 'Interpret feedback by intent.',
        interpretationPolicy: 'Use your judgment.'
      }
    }
  }
  const document: MarkoverDocument = {
    reviewId: 'mko_abcdef',
    name: tree.sourceDocument.name,
    path: tree.sourceDocument.path,
    source: tree.sourceDocument.content,
    checksum: tree.sourceDocument.checksum,
    project: {
      key: 'remote:github.com/lastobelus/markover',
      name: 'markover',
      root: '/tmp/markover'
    },
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
    assertMainEventArguments('review:status', [{
      requestId: 'status-1',
      reviewId: 'mko_abcdef',
      status: 'revised'
    }])
    assertMainEventArguments('review:status', [{
      requestId: 'status-2',
      reviewId: 'mko_abcdef',
      status: 'done'
    }])
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
      reviewId: 'mko_abcdef',
      x: 120,
      y: 240
    }])
    assertRendererInvokeResult('review:context-menu:open', {
      outcome: 'copied'
    })
    assertRendererInvokeResult('review:context-menu:open', {
      outcome: 'copy-cancelled'
    })
    assertRendererInvokeResult('review:context-menu:open', {
      outcome: 'dismissed'
    })
    assertRendererInvokeArguments('review:project-favicon:get', ['mko_abcdef'])
    assertRendererInvokeArguments('review:pull-request:open', ['mko_abcdef'])
    assertRendererInvokeResult('review:project-favicon:get', null)
    assertRendererInvokeResult(
      'review:project-favicon:get',
      'data:image/png;base64,iVBORw0KGgo='
    )
    assertRendererInvokeResult('review:pull-request:open', undefined)
    assertMainEventArguments('review:updated', [document])
    const additiveDocument = structuredClone(document)
    Reflect.set(additiveDocument.tree as object, 'futureOptionalField', {
      preserved: true
    })
    assertRendererInvokeResult('review:create-local', additiveDocument)
    assertRendererInvokeArguments('attachment:remove', [{
      reviewId: 'mko_abcdef',
      attachmentId: 'img-1',
      tree: managedTree
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
      x: 120,
      y: 240,
      path: '/tmp/private'
    }])
  })
  assert.throws(() => {
    assertRendererInvokeArguments('review:context-menu:open', [{
      reviewId: 'mko_abcdef',
      x: -1,
      y: 240
    }])
  })
  assert.throws(() => {
    assertRendererInvokeArguments('review:context-menu:open', [{
      reviewId: 'mko_abcdef',
      x: Number.MAX_SAFE_INTEGER + 1,
      y: 240
    }])
  })
  assert.throws(() => {
    assertRendererInvokeResult('review:context-menu:open', {
      outcome: 'future-action'
    })
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

  const futureTree = { ...tree, version: 2 }
  const futureDocument = { ...document, tree: futureTree }
  assert.throws(() => {
    assertRendererInvokeArguments('review:create-local', [futureTree])
  })
  assert.throws(() => {
    assertRendererSendArguments('review:autosave', ['mko_abcdef', futureTree])
  })
  assert.throws(() => {
    assertRendererSendArguments('review:snapshot-response', [{
      requestId: 'snapshot-1',
      reviewId: 'mko_abcdef',
      purpose: 'handoff',
      tree: futureTree
    }])
  })
  assert.throws(() => {
    assertRendererInvokeArguments('attachment:remove', [{
      reviewId: 'mko_abcdef',
      attachmentId: 'img-1',
      tree: futureTree
    }])
  })
  assert.throws(() => {
    assertRendererInvokeResult('review:create-local', futureDocument)
  })
  assert.throws(() => {
    assertRendererInvokeResult('review:initial-document', futureDocument)
  })
  assert.throws(() => {
    assertRendererInvokeResult('review:list', [futureDocument])
  })
  assert.doesNotThrow(() => {
    assertRendererInvokeResult('review:list', [{
      kind: 'incompatible-review',
      reviewId: 'mko_abcdef',
      format: 'markover-review',
      version: '2',
      compatibilityUrl: 'https://lastobelus.github.io/markover/compatibility/?format=markover-review&version=2'
    }])
  })
  assert.throws(() => {
    assertRendererInvokeResult('review:list', [{
      kind: 'incompatible-review',
      reviewId: 'mko_abcdef',
      format: 'markover-review',
      version: '2',
      compatibilityUrl: 'https://example.test/compatibility/'
    }])
  })
  assert.throws(() => {
    assertMainEventArguments('review:opened', [futureDocument])
  })
  assert.throws(() => {
    assertMainEventArguments('review:updated', [futureDocument])
  })
  assert.throws(() => {
    assertMainEventArguments('review:activation-request', [{
      requestId: 'activation-1',
      reviewId: 'mko_abcdef',
      document: futureDocument,
      focusState: { focused: false, blurredAt: 1 }
    }])
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
    'review:project-favicon:get',
    'review:pull-request:open',
    'review:snapshot-response',
    'review:status-response',
    'review:t3-thread-titles:get',
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
    'window:focus-state:get',
    'workspace:get',
    'workspace:update'
  ])
})

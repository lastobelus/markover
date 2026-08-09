import {
  contextBridge,
  ipcRenderer
} from 'electron'

import {
  assertMainEventArguments,
  assertRendererInvokeArguments,
  assertRendererInvokeResult,
  assertRendererSendArguments,
  type MainEventArguments,
  type MainEventChannel,
  type RendererInvokeArguments,
  type RendererInvokeChannel,
  type RendererInvokeResults,
  type RendererSendArguments,
  type RendererSendChannel
} from './ipc-contract'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function invoke<C extends RendererInvokeChannel>(
  channel: C,
  ...args: RendererInvokeArguments[C]
): Promise<RendererInvokeResults[C]> {
  assertRendererInvokeArguments(channel, args)
  const result: unknown = await ipcRenderer.invoke(channel, ...args)
  assertRendererInvokeResult(channel, result)
  return result as RendererInvokeResults[C]
}

function send<C extends RendererSendChannel>(
  channel: C,
  ...args: RendererSendArguments[C]
): void {
  assertRendererSendArguments(channel, args)
  ipcRenderer.send(channel, ...args)
}

function listen<C extends MainEventChannel>(
  channel: C,
  callback: (...args: MainEventArguments[C]) => void
): void {
  ipcRenderer.on(channel, (_event, ...args) => {
    try {
      assertMainEventArguments(channel, args)
    } catch {
      console.error(`Markover rejected an invalid main-process event on ${channel}.`)
      return
    }
    callback(...args as unknown as MainEventArguments[C])
  })
}

async function respondToReviewStatus(
  callback: (status: ReviewStatusRequest) => void | Promise<void>,
  status: ReviewStatusRequest
): Promise<void> {
  try {
    await callback(status)
    send('review:status-response', {
      requestId: status.requestId
    } satisfies ReviewStatusResponse)
  } catch (error) {
    send('review:status-response', {
      requestId: status.requestId,
      error: errorMessage(error)
    } satisfies ReviewStatusResponse)
  }
}

async function respondToReviewSnapshot(
  callback: (
    request: ReviewSnapshotRequest
  ) => ReviewTree | null | Promise<ReviewTree | null>,
  request: ReviewSnapshotRequest
): Promise<void> {
  try {
    const tree = await callback(request)
    send('review:snapshot-response', {
      requestId: request.requestId,
      reviewId: request.reviewId,
      purpose: request.purpose,
      tree
    } satisfies ReviewSnapshotResponse)
  } catch (error) {
    send('review:snapshot-response', {
      requestId: request.requestId,
      reviewId: request.reviewId,
      purpose: request.purpose,
      error: errorMessage(error)
    } satisfies ReviewSnapshotResponse)
  }
}

async function respondToReviewActivation(
  callback: (
    request: ReviewActivationRequest
  ) => ReviewActivationOutcome | Promise<ReviewActivationOutcome>,
  request: ReviewActivationRequest
): Promise<void> {
  try {
    const outcome = await callback(request)
    send('review:activation-response', {
      requestId: request.requestId,
      reviewId: request.reviewId,
      outcome
    } satisfies ReviewActivationResponse)
  } catch (error) {
    send('review:activation-response', {
      requestId: request.requestId,
      reviewId: request.reviewId,
      error: errorMessage(error)
    } satisfies ReviewActivationResponse)
  }
}

const bridge = {
  getStartupInfo: () => invoke('startup:info'),
  reportStartupPhase: (event) => invoke('startup:phase', event),
  reportRendererInitialized: (initialization) => (
    invoke('startup:renderer-initialized', initialization)
  ),
  reportStartupFailure: (failure) => (
    invoke('startup:failure', failure)
  ),
  copyStartupDiagnostic: () => invoke('startup:copy-diagnostic'),
  revealStartupDiagnostic: () => invoke('startup:reveal-diagnostic'),
  quitStartup: () => {
    send('startup:quit')
  },
  reportSmokeResult: (result) => invoke('smoke:result', result),
  getBrandAssets: () => invoke('brand:assets'),
  openMarkdown: () => invoke('document:open'),
  onOpenMarkdownRequested: (callback) => {
    listen('document:open-request', () => {
      callback()
    })
  },
  checksum: (source) => invoke('document:checksum', source),
  copyText: (text) => {
    send('clipboard:write', text)
  },
  readClipboardImage: () => (
    invoke('clipboard:read-image')
  ),
  saveAttachment: (attachment, reviewId) => (
    invoke('attachment:save', attachment, reviewId)
  ),
  getInitialReview: () => (
    invoke('review:initial-document')
  ),
  getReviews: () => invoke('review:list'),
  onReviewOpened: (callback) => {
    listen(
      'review:opened',
      (document: MarkoverDocument) => {
        void callback(document)
      }
    )
  },
  onReviewStatus: (callback) => {
    listen('review:status', (status: ReviewStatusRequest) => {
      void respondToReviewStatus(callback, status)
    })
  },
  onReviewSnapshotRequested: (callback) => {
    listen('review:snapshot-request', (request: ReviewSnapshotRequest) => {
      void respondToReviewSnapshot(callback, request)
    })
  },
  onReviewAutosaveStatus: (callback) => {
    listen('review:autosave-status', (status: ReviewAutosaveStatus) => {
      callback(status)
    })
  },
  getReviewAutosaveStatus: () => (
    invoke('review:autosave-status:get')
  ),
  onReviewShutdownState: (callback) => {
    listen('review:shutdown-state', (paused: boolean) => {
      callback(paused)
    })
  },
  onReviewActivationRequested: (callback) => {
    listen('review:activation-request', (request: ReviewActivationRequest) => {
      void respondToReviewActivation(callback, request)
    })
  },
  activateReview: (reviewId) => {
    send('review:activate', reviewId)
  },
  autosaveReview: (reviewId, tree) => {
    send('review:autosave', reviewId, tree)
  },
  finishReview: (tree) => {
    send('review:done', tree)
  },
  cancelReview: () => {
    send('review:cancel')
  },
  getSettings: () => invoke('settings:get'),
  updateSettings: (patch) => (
    invoke('settings:update', patch)
  ),
  onSettingsOpen: (callback) => {
    listen('settings:open', () => {
      callback()
    })
  },
  onSettingsChanged: (callback) => {
    listen(
      'settings:changed',
      (settings: MarkoverSettingsEnvelope) => {
        callback(settings)
      }
    )
  }
} satisfies MarkoverBridge

contextBridge.exposeInMainWorld('markover', bridge)

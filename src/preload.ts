import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent
} from 'electron'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function respondToReviewStatus(
  callback: (status: ReviewStatusRequest) => void | Promise<void>,
  status: ReviewStatusRequest
): Promise<void> {
  try {
    await callback(status)
    ipcRenderer.send('review:status-response', {
      requestId: status.requestId
    } satisfies ReviewStatusResponse)
  } catch (error) {
    ipcRenderer.send('review:status-response', {
      requestId: status.requestId,
      error: errorMessage(error)
    } satisfies ReviewStatusResponse)
  }
}

async function respondToReviewSnapshot(
  callback: (
    reviewId: string
  ) => ReviewTree | null | Promise<ReviewTree | null>,
  request: ReviewSnapshotRequest
): Promise<void> {
  try {
    const tree = await callback(request.reviewId)
    ipcRenderer.send('review:snapshot-response', {
      requestId: request.requestId,
      reviewId: request.reviewId,
      tree
    } satisfies ReviewSnapshotResponse)
  } catch (error) {
    ipcRenderer.send('review:snapshot-response', {
      requestId: request.requestId,
      reviewId: request.reviewId,
      error: errorMessage(error)
    } satisfies ReviewSnapshotResponse)
  }
}

const bridge = {
  getBrandAssets: () => ipcRenderer.invoke('brand:assets'),
  openMarkdown: () => ipcRenderer.invoke('document:open'),
  onOpenMarkdownRequested: (callback) => {
    ipcRenderer.on('document:open-request', () => {
      callback()
    })
  },
  checksum: (source) => ipcRenderer.invoke('document:checksum', source),
  copyText: (text) => {
    ipcRenderer.send('clipboard:write', text)
  },
  readClipboardImage: () => ipcRenderer.invoke('clipboard:read-image'),
  saveAttachment: (attachment, reviewId) => (
    ipcRenderer.invoke('attachment:save', attachment, reviewId)
  ),
  getInitialReview: () => ipcRenderer.invoke('review:initial-document'),
  getReviews: () => ipcRenderer.invoke('review:list'),
  onReviewOpened: (callback) => {
    ipcRenderer.on(
      'review:opened',
      (_event: IpcRendererEvent, document: MarkoverDocument) => {
        void callback(document)
      }
    )
  },
  onReviewStatus: (callback) => {
    ipcRenderer.on('review:status', (
      _event: IpcRendererEvent,
      status: ReviewStatusRequest
    ) => {
      void respondToReviewStatus(callback, status)
    })
  },
  onReviewSnapshotRequested: (callback) => {
    ipcRenderer.on('review:snapshot-request', (
      _event: IpcRendererEvent,
      request: ReviewSnapshotRequest
    ) => {
      void respondToReviewSnapshot(callback, request)
    })
  },
  activateReview: (reviewId) => {
    ipcRenderer.send('review:activate', reviewId)
  },
  autosaveReview: (reviewId, tree) => {
    ipcRenderer.send('review:autosave', reviewId, tree)
  },
  finishReview: (tree) => {
    ipcRenderer.send('review:done', tree)
  },
  cancelReview: () => {
    ipcRenderer.send('review:cancel')
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  onSettingsOpen: (callback) => {
    ipcRenderer.on('settings:open', () => {
      callback()
    })
  },
  onSettingsChanged: (callback) => {
    ipcRenderer.on(
      'settings:changed',
      (_event: IpcRendererEvent, settings: MarkoverSettingsEnvelope) => {
        callback(settings)
      }
    )
  }
} satisfies MarkoverBridge

contextBridge.exposeInMainWorld('markover', bridge)

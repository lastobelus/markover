const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('markover', {
  openMarkdown: () => ipcRenderer.invoke('document:open'),
  onOpenMarkdownRequested: (callback) => {
    ipcRenderer.on('document:open-request', () => callback())
  },
  checksum: (source) => ipcRenderer.invoke('document:checksum', source),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:read-image'),
  saveAttachment: (attachment, reviewId) => (
    ipcRenderer.invoke('attachment:save', attachment, reviewId)
  ),
  getInitialReview: () => ipcRenderer.invoke('review:initial-document'),
  getReviews: () => ipcRenderer.invoke('review:list'),
  onReviewOpened: (callback) => {
    ipcRenderer.on('review:opened', (_event, document) => callback(document))
  },
  onReviewStatus: (callback) => {
    ipcRenderer.on('review:status', async (_event, status) => {
      try {
        await callback(status)
        ipcRenderer.send('review:status-response', {
          requestId: status.requestId
        })
      } catch (error) {
        ipcRenderer.send('review:status-response', {
          requestId: status.requestId,
          error: error.message
        })
      }
    })
  },
  onReviewSnapshotRequested: (callback) => {
    ipcRenderer.on('review:snapshot-request', async (_event, request) => {
      try {
        const tree = await callback(request.reviewId)
        ipcRenderer.send('review:snapshot-response', {
          requestId: request.requestId,
          reviewId: request.reviewId,
          tree
        })
      } catch (error) {
        ipcRenderer.send('review:snapshot-response', {
          requestId: request.requestId,
          reviewId: request.reviewId,
          error: error.message
        })
      }
    })
  },
  activateReview: (reviewId) => ipcRenderer.send('review:activate', reviewId),
  autosaveReview: (reviewId, tree) => (
    ipcRenderer.send('review:autosave', reviewId, tree)
  ),
  finishReview: (tree) => ipcRenderer.send('review:done', tree),
  cancelReview: () => ipcRenderer.send('review:cancel'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  onSettingsOpen: (callback) => {
    ipcRenderer.on('settings:open', () => callback())
  },
  onSettingsChanged: (callback) => {
    ipcRenderer.on('settings:changed', (_event, settings) => callback(settings))
  }
})

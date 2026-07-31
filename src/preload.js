const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('markover', {
  openMarkdown: () => ipcRenderer.invoke('document:open'),
  checksum: (source) => ipcRenderer.invoke('document:checksum', source),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:read-image'),
  saveAttachment: (attachment, reviewId) => (
    ipcRenderer.invoke('attachment:save', attachment, reviewId)
  ),
  getInitialReview: () => ipcRenderer.invoke('review:initial-document'),
  onReviewOpened: (callback) => {
    ipcRenderer.on('review:opened', (_event, document) => callback(document))
  },
  onReviewStatus: (callback) => {
    ipcRenderer.on('review:status', (_event, status) => callback(status))
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
  autosaveReview: (reviewId, tree) => (
    ipcRenderer.send('review:autosave', reviewId, tree)
  ),
  finishReview: (tree) => ipcRenderer.send('review:done', tree),
  cancelReview: () => ipcRenderer.send('review:cancel')
})

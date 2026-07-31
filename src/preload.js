const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('markover', {
  openMarkdown: () => ipcRenderer.invoke('document:open'),
  checksum: (source) => ipcRenderer.invoke('document:checksum', source),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:read-image'),
  saveAttachment: (attachment) => ipcRenderer.invoke('attachment:save', attachment),
  getInitialReview: () => ipcRenderer.invoke('review:initial-document'),
  autosaveReview: (tree) => ipcRenderer.send('review:autosave', tree),
  finishReview: (tree) => ipcRenderer.send('review:done', tree),
  cancelReview: () => ipcRenderer.send('review:cancel')
})

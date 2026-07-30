const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('markover', {
  openMarkdown: () => ipcRenderer.invoke('document:open'),
  checksum: (source) => ipcRenderer.invoke('document:checksum', source),
  copyText: (text) => ipcRenderer.send('clipboard:write', text)
})

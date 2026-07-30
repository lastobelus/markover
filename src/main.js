const { app, BrowserWindow, clipboard, dialog, ipcMain } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

function checksum(source) {
  return `sha256:${crypto.createHash('sha256').update(source, 'utf8').digest('hex')}`
}

async function openMarkdown() {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  const source = await fs.readFile(filePath, 'utf8')
  return {
    name: path.basename(filePath),
    path: filePath,
    source,
    checksum: checksum(source)
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#f4f1ea',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(() => {
  ipcMain.handle('document:open', openMarkdown)
  ipcMain.handle('document:checksum', (_event, source) => checksum(source))
  ipcMain.on('clipboard:write', (_event, text) => clipboard.writeText(text))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

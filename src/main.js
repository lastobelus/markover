const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage
} = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

function argumentValue(option) {
  const index = process.argv.indexOf(option)
  return index === -1 ? null : process.argv[index + 1] || null
}

const reviewConfigPath = argumentValue('--markover-review-config')
const reviewMode = process.argv.includes('--markover-review') || Boolean(reviewConfigPath)
let reviewDocumentPromise = null
let reviewFinished = false
let reviewConfigPromise = null
let attachmentDirectoryPromise = null
let attachmentSequence = 0
let pendingAutosave = null
let autosaveWriter = null

function checksum(source) {
  return `sha256:${crypto.createHash('sha256').update(source, 'utf8').digest('hex')}`
}

function bufferChecksum(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`
}

function readClipboardImage() {
  const image = clipboard.readImage()
  if (image.isEmpty()) return null

  return {
    bytes: image.toPNG(),
    mimeType: 'image/png'
  }
}

async function loadReviewConfig() {
  if (!reviewConfigPromise) {
    reviewConfigPromise = reviewConfigPath
      ? fs.readFile(reviewConfigPath, 'utf8').then(JSON.parse)
      : Promise.resolve({
          inputPath: process.env.MARKOVER_REVIEW_INPUT_PATH,
          name: process.env.MARKOVER_REVIEW_NAME,
          originalPath: process.env.MARKOVER_REVIEW_ORIGINAL_PATH || null,
          attachmentsDirectory: process.env.MARKOVER_ATTACHMENTS_DIR,
          autosavePath: null,
          durable: false
        })
  }
  return reviewConfigPromise
}

async function atomicWrite(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  await fs.writeFile(temporaryPath, contents, 'utf8')
  await fs.rename(temporaryPath, filePath)
}

function startAutosaveWriter() {
  autosaveWriter = (async () => {
    const config = await loadReviewConfig()
    if (!config.autosavePath) {
      pendingAutosave = null
      return
    }

    while (pendingAutosave !== null) {
      const contents = pendingAutosave
      pendingAutosave = null
      await atomicWrite(config.autosavePath, contents)
    }
  })().finally(() => {
    autosaveWriter = null
    if (pendingAutosave !== null) startAutosaveWriter()
  })
}

function queueReviewAutosave(tree) {
  if (!reviewMode) return Promise.resolve()

  pendingAutosave = JSON.stringify(tree, null, 2)
  if (!autosaveWriter) startAutosaveWriter()
  return autosaveWriter
}

async function flushReviewAutosave() {
  while (autosaveWriter) await autosaveWriter
}

async function attachmentDirectory() {
  if (!attachmentDirectoryPromise) {
    attachmentDirectoryPromise = loadReviewConfig().then(async (config) => {
      const baseDirectory = path.resolve(
        config.attachmentsDirectory ||
        path.join(app.getAppPath(), '.markover', 'attachments')
      )
      await fs.mkdir(baseDirectory, { recursive: true })

      if (config.durable) {
        const entries = await fs.readdir(baseDirectory)
        attachmentSequence = entries.reduce((maximum, entry) => {
          const match = /^img-(\d+)\./.exec(entry)
          return match ? Math.max(maximum, Number(match[1])) : maximum
        }, 0)
        return baseDirectory
      }

      return fs.mkdtemp(path.join(baseDirectory, 'review-'))
    })
  }
  return attachmentDirectoryPromise
}

async function saveAttachment(_event, attachment) {
  const extensions = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png']
  ])
  const extension = extensions.get(attachment.mimeType)
  if (!extension) {
    throw new Error(`Unsupported pasted image type: ${attachment.mimeType}`)
  }

  const buffer = Buffer.from(attachment.bytes)
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) throw new Error('The pasted image could not be decoded.')

  attachmentSequence += 1
  const id = `img-${attachmentSequence}`
  const directory = await attachmentDirectory()
  const filePath = path.join(directory, `${id}.${extension}`)
  await fs.writeFile(filePath, buffer)

  const size = image.getSize()
  return {
    id,
    type: 'image',
    mimeType: attachment.mimeType,
    path: filePath,
    checksum: bufferChecksum(buffer),
    width: size.width,
    height: size.height,
    label: ''
  }
}

async function loadReviewDocument() {
  const config = await loadReviewConfig()
  const filePath = config.inputPath
  if (!filePath) throw new Error('Missing MARKOVER_REVIEW_INPUT_PATH')

  if (config.autosavePath) {
    try {
      const tree = JSON.parse(await fs.readFile(config.autosavePath, 'utf8'))
      return {
        name: tree.sourceDocument.name || config.name || path.basename(filePath),
        path: tree.sourceDocument.path || config.originalPath || null,
        source: tree.sourceDocument.content,
        checksum: tree.sourceDocument.checksum,
        tree,
        durable: Boolean(config.durable),
        autosavePath: config.autosavePath
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  const source = await fs.readFile(filePath, 'utf8')
  return {
    name: config.name || path.basename(filePath),
    path: config.originalPath || null,
    source,
    checksum: checksum(source),
    durable: Boolean(config.durable),
    autosavePath: config.autosavePath || null
  }
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

  if (reviewMode) {
    window.on('close', (event) => {
      if (reviewFinished) return
      event.preventDefault()
      reviewFinished = true
      flushReviewAutosave().finally(() => app.exit(2))
    })
  }
}

app.whenReady().then(() => {
  if (reviewMode) reviewDocumentPromise = loadReviewDocument()

  ipcMain.handle('document:open', openMarkdown)
  ipcMain.handle('document:checksum', (_event, source) => checksum(source))
  ipcMain.handle('attachment:save', saveAttachment)
  ipcMain.handle('clipboard:read-image', readClipboardImage)
  ipcMain.handle('review:initial-document', () => reviewDocumentPromise)
  ipcMain.on('clipboard:write', (_event, text) => clipboard.writeText(text))
  ipcMain.on('review:autosave', (_event, tree) => {
    queueReviewAutosave(tree).catch((error) => {
      process.stderr.write(`markover autosave: ${error.message}\n`)
    })
  })
  ipcMain.on('review:done', async (_event, tree) => {
    if (!reviewMode || reviewFinished) return
    reviewFinished = true
    await queueReviewAutosave(tree)
    await flushReviewAutosave()
    process.stdout.write(`${JSON.stringify(tree)}\n`, () => app.exit(0))
  })
  ipcMain.on('review:cancel', () => {
    if (!reviewMode || reviewFinished) return
    reviewFinished = true
    app.exit(2)
  })

  createWindow()

  app.on('activate', () => {
    if (!reviewMode && BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (reviewMode) {
    if (!reviewFinished) app.exit(2)
    return
  }
  if (process.platform !== 'darwin') app.quit()
})

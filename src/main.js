const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme
} = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { applicationMenuTemplate } = require('./app-menu')
const { startLocalService } = require('./local-service')
const { discoverRepositoryRoot } = require('./metadata-discovery')
const { ReviewStore } = require('./review-store')
const { SettingsStore } = require('./settings-store')
const { DEFAULT_SETTINGS, windowBackground } = require('./settings')

app.setName('Markover')
process.title = 'Markover'

function argumentValue(option) {
  const index = process.argv.indexOf(option)
  return index === -1 ? null : process.argv[index + 1] || null
}

const reviewConfigPath = argumentValue('--markover-review-config')
const reviewMode = process.argv.includes('--markover-review') || Boolean(reviewConfigPath)
const projectDirectory = path.resolve(__dirname, '..')
const markoverDirectory = path.join(projectDirectory, '.markover')
const endpointPath = path.join(markoverDirectory, 'service.json')
const reviewStore = reviewMode
  ? null
  : new ReviewStore(path.join(markoverDirectory, 'reviews'))
const hasSingleInstanceLock = reviewMode || app.requestSingleInstanceLock()
let reviewDocumentPromise = null
let reviewFinished = false
let reviewConfigPromise = null
let attachmentDirectoryPromise = null
let attachmentSequence = 0
let mainWindow = null
let activeManagedReview = null
let activeManagedReviewId = null
let localService = null
let settingsStore = null
let settingsUnsubscribe = null
let pendingAutosave = null
let autosaveWriter = null
let snapshotSequence = 0
let statusSequence = 0
let brandAssetsPromise = null
const pendingSnapshots = new Map()
const pendingStatuses = new Map()
const projectRoots = new Map()

function settingsEnvelope(settings) {
  return {
    ...settings,
    resolvedAppearance: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }
}

function loadBrandAssets() {
  brandAssetsPromise ||= Promise.all([
    fs.readFile(path.join(__dirname, '../design/brand/markover-mark.svg'), 'utf8'),
    fs.readFile(path.join(__dirname, '../design/brand/markover-logotype.svg'), 'utf8'),
    fs.readFile(path.join(__dirname, '../design/brand/markover-lockup.svg'), 'utf8')
  ]).then(([mark, logotype, lockup]) => ({ mark, logotype, lockup }))
  return brandAssetsPromise
}

function applyMainSettings(settings, broadcast = true) {
  nativeTheme.themeSource = settings.appearance
  const envelope = settingsEnvelope(settings)
  mainWindow?.setBackgroundColor(
    windowBackground(settings, envelope.resolvedAppearance)
  )
  if (broadcast) mainWindow?.webContents.send('settings:changed', envelope)
  return envelope
}

function sendRendererEvent(channel, value) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  const send = () => mainWindow?.webContents.send(channel, value)
  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', send)
  } else {
    send()
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function installApplicationMenu() {
  const template = applicationMenuTemplate({
    appName: 'Markover',
    reviewMode,
    onOpen: () => sendRendererEvent('document:open-request'),
    onSettings: () => sendRendererEvent('settings:open')
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

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
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`
  )
  try {
    await fs.writeFile(temporaryPath, contents, {
      encoding: 'utf8',
      flag: 'wx',
      flush: true
    })
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
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

async function saveAttachment(_event, attachment, reviewId = null) {
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

  let id
  let directory
  if (reviewId && reviewStore) {
    const saved = await reviewStore.saveAttachmentFile(
      reviewId,
      extension,
      buffer
    )
    id = saved.id
    directory = path.dirname(saved.path)
  } else {
    attachmentSequence += 1
    id = `img-${attachmentSequence}`
    directory = await attachmentDirectory()
  }
  const filePath = path.join(directory, `${id}.${extension}`)
  if (!reviewId || !reviewStore) await fs.writeFile(filePath, buffer)

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
  const startupSettings = settingsEnvelope(
    settingsStore?.settings || DEFAULT_SETTINGS
  )
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: windowBackground(
      startupSettings,
      startupSettings.resolvedAppearance
    ),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'index.html'), {
    query: {
      palette: startupSettings.palette,
      appearance: startupSettings.resolvedAppearance,
      colorization: startupSettings.darkColorization
    }
  })
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.setTitle(reviewMode ? 'Markover Review' : 'Markover Inbox')
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (reviewMode) {
    mainWindow.on('close', (event) => {
      if (reviewFinished) return
      event.preventDefault()
      reviewFinished = true
      flushReviewAutosave().finally(() => app.exit(2))
    })
  }
  return mainWindow
}

function managedDocument(artifact, projectRoot = null) {
  return {
    reviewId: artifact.review.id,
    name: artifact.sourceDocument.name,
    path: artifact.sourceDocument.path,
    source: artifact.sourceDocument.content,
    checksum: artifact.sourceDocument.checksum,
    projectRoot: artifact.review.git?.repositoryRoot || projectRoot,
    tree: artifact,
    durable: true
  }
}

async function managedDocuments(artifacts) {
  return Promise.all(artifacts.map(async (artifact) => {
    const existingRoot = artifact.review.git?.repositoryRoot
    const sourcePath = artifact.sourceDocument.path
    if (existingRoot || !sourcePath) return managedDocument(artifact)

    const sourceDirectory = path.dirname(path.resolve(sourcePath))
    if (!projectRoots.has(sourceDirectory)) {
      projectRoots.set(
        sourceDirectory,
        discoverRepositoryRoot(sourcePath).catch(() => null)
      )
    }
    return managedDocument(artifact, await projectRoots.get(sourceDirectory))
  }))
}

function sendManagedReview(artifact) {
  activeManagedReview = artifact
  activeManagedReviewId = artifact.review.id
  if (!mainWindow) createWindow()
  const send = () => {
    mainWindow?.webContents.send('review:opened', managedDocument(artifact))
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  }
  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function sendManagedStatus(artifact) {
  if (activeManagedReviewId === artifact.review.id) {
    activeManagedReview = artifact
  }
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve()

  statusSequence += 1
  const requestId = `status-${statusSequence}`
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingStatuses.delete(requestId)
      reject(new Error(`Timed out updating review ${artifact.review.id}.`))
    }, 5000)
    pendingStatuses.set(requestId, { reject, resolve, timeout })
    mainWindow.webContents.send('review:status', {
      requestId,
      reviewId: artifact.review.id,
      status: artifact.review.status
    })
  })
}

function requestRendererSnapshot(reviewId) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    return Promise.resolve(null)
  }

  snapshotSequence += 1
  const requestId = `snapshot-${snapshotSequence}`
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingSnapshots.delete(requestId)
      reject(new Error(`Timed out capturing review ${reviewId}.`))
    }, 5000)
    pendingSnapshots.set(requestId, { reject, resolve, reviewId, timeout })
    mainWindow.webContents.send('review:snapshot-request', {
      requestId,
      reviewId
    })
  })
}

async function flushManagedReview(reviewId) {
  try {
    const tree = await requestRendererSnapshot(reviewId)
    if (tree) await reviewStore.updateTree(reviewId, tree)
  } catch (error) {
    try {
      await sendManagedStatus(await reviewStore.load(reviewId))
    } catch {}
    throw error
  }
  return async () => {
    await sendManagedStatus(await reviewStore.load(reviewId))
  }
}

async function removeOwnEndpoint() {
  try {
    const endpoint = JSON.parse(await fs.readFile(endpointPath, 'utf8'))
    if (endpoint.pid === process.pid) await fs.unlink(endpointPath)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      process.stderr.write(`markover service cleanup: ${error.message}\n`)
    }
  }
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  if (!reviewMode) {
    app.on('second-instance', () => {
      if (!mainWindow) createWindow()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    })
  }

  app.whenReady().then(async () => {
    if (reviewMode) reviewDocumentPromise = loadReviewDocument()

    settingsStore = new SettingsStore(
      path.join(app.getPath('userData'), 'settings.json')
    )
    const initialSettings = await settingsStore.load()
    nativeTheme.themeSource = initialSettings.appearance
    settingsUnsubscribe = await settingsStore.subscribe((settings) => {
      applyMainSettings(settings)
    })
    installApplicationMenu()

    ipcMain.handle('document:open', openMarkdown)
    ipcMain.handle('brand:assets', loadBrandAssets)
    ipcMain.handle('document:checksum', (_event, source) => checksum(source))
    ipcMain.handle('attachment:save', saveAttachment)
    ipcMain.handle('clipboard:read-image', readClipboardImage)
    ipcMain.handle('settings:get', () => settingsEnvelope(settingsStore.settings))
    ipcMain.handle('settings:update', async (_event, patch) => {
      const settings = await settingsStore.update(patch)
      return applyMainSettings(settings)
    })
    ipcMain.handle('review:initial-document', () => (
      reviewMode
        ? reviewDocumentPromise
        : activeManagedReview && managedDocument(activeManagedReview)
    ))
    ipcMain.handle('review:list', async () => (
      reviewMode
        ? []
        : managedDocuments(await reviewStore.list())
    ))
    ipcMain.on('review:snapshot-response', (_event, response) => {
      const pending = pendingSnapshots.get(response.requestId)
      if (!pending || pending.reviewId !== response.reviewId) return
      clearTimeout(pending.timeout)
      pendingSnapshots.delete(response.requestId)
      if (response.error) pending.reject(new Error(response.error))
      else pending.resolve(response.tree)
    })
    ipcMain.on('review:status-response', (_event, response) => {
      const pending = pendingStatuses.get(response.requestId)
      if (!pending) return
      clearTimeout(pending.timeout)
      pendingStatuses.delete(response.requestId)
      if (response.error) pending.reject(new Error(response.error))
      else pending.resolve()
    })
    ipcMain.on('clipboard:write', (_event, text) => clipboard.writeText(text))
    ipcMain.on('review:activate', (_event, reviewId) => {
      if (reviewMode) return
      activeManagedReviewId = reviewId
      reviewStore.load(reviewId).then((artifact) => {
        if (activeManagedReviewId === reviewId) {
          activeManagedReview = artifact
        }
      }).catch((error) => {
        process.stderr.write(`markover activate: ${error.message}\n`)
      })
    })
    ipcMain.on('review:autosave', (_event, reviewId, tree) => {
      const autosave = reviewMode
        ? queueReviewAutosave(tree)
        : reviewStore.updateTree(reviewId, tree).then((artifact) => {
            if (activeManagedReviewId === reviewId) {
              activeManagedReview = artifact
            }
          })
      autosave.catch((error) => {
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

    nativeTheme.on('updated', () => {
      const envelope = settingsEnvelope(settingsStore.settings)
      mainWindow?.setBackgroundColor(
        windowBackground(settingsStore.settings, envelope.resolvedAppearance)
      )
      mainWindow?.webContents.send('settings:changed', envelope)
    })

    if (!reviewMode) {
      localService = await startLocalService({
        store: reviewStore,
        beforeAction: flushManagedReview,
        async onChange(artifact, action) {
          if (action === 'created') sendManagedReview(artifact)
          else await sendManagedStatus(artifact)
        }
      })
      await atomicWrite(endpointPath, `${JSON.stringify({
        version: 1,
        port: localService.port,
        pid: process.pid
      }, null, 2)}\n`)
    }

    app.on('activate', () => {
      if (!reviewMode && BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((error) => {
    process.stderr.write(`markover: ${error.stack || error.message}\n`)
    app.quit()
  })

  app.on('before-quit', () => {
    settingsUnsubscribe?.()
    if (localService) localService.close().catch(() => {})
    removeOwnEndpoint()
  })

  app.on('window-all-closed', () => {
    if (reviewMode) {
      if (!reviewFinished) app.exit(2)
      return
    }
    if (process.platform !== 'darwin') app.quit()
  })
}

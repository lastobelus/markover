import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { applicationMenuTemplate } from './app-menu'
import { startLocalService, type LocalService } from './local-service'
import { discoverRepositoryRoot } from './metadata-discovery'
import { importLegacyReviews } from './review-migration'
import { ReviewAutosave } from './review-autosave'
import { ReviewStore, type ReviewArtifact } from './review-store'
import {
  createServiceIdentity,
  publishServiceConnection,
  reviewsDirectory,
  secureServiceDirectory,
  serviceDirectory,
  serviceEndpointPath,
  type ServiceIdentity
} from './service-endpoint'
import { SettingsStore } from './settings-store'
import './settings'

const {
  darkColorization,
  DEFAULT_SETTINGS,
  windowBackground
} = globalThis.MarkoverSettings

interface ReviewConfig {
  inputPath: string | undefined
  name: string | undefined
  originalPath: string | null
  attachmentsDirectory: string | undefined
  autosavePath: string | null
  durable: boolean
}

interface PendingSnapshot {
  reject: (reason?: unknown) => void
  resolve: (tree: ReviewTree | null) => void
  reviewId: string
  timeout: ReturnType<typeof setTimeout>
}

interface PendingStatus {
  reject: (reason?: unknown) => void
  resolve: () => void
  timeout: ReturnType<typeof setTimeout>
}

function errorProperty(
  error: unknown,
  key: 'code' | 'message' | 'stack'
): unknown {
  return error !== null && typeof error === 'object'
    ? Reflect.get(error, key)
    : null
}

function errorMessage(error: unknown): string {
  const message = errorProperty(error, 'message')
  return typeof message === 'string' ? message : String(error)
}

app.setName('Markover')
process.title = 'Markover'

function argumentValue(option: string): string | null {
  const index = process.argv.indexOf(option)
  return index === -1 ? null : process.argv[index + 1] || null
}

const reviewConfigPath = argumentValue('--markover-review-config')
const reviewMode = process.argv.includes('--markover-review') ||
  Boolean(reviewConfigPath)
const projectDirectory = path.resolve(__dirname, '..')
const checkoutDirectory = path.resolve(projectDirectory, '..')
const appIconPath = path.join(projectDirectory, 'design/brand/markover-app-icon.png')
const endpointPath = serviceEndpointPath()
const reviewStore = reviewMode
  ? null
  : new ReviewStore(reviewsDirectory())
const hasSingleInstanceLock = reviewMode || app.requestSingleInstanceLock()
const backgroundServerMode = !reviewMode &&
  process.argv.includes('--markover-server')
let reviewDocumentPromise: Promise<MarkoverDocument> | null = null
let reviewFinished = false
let reviewConfigPromise: Promise<ReviewConfig> | null = null
let attachmentDirectoryPromise: Promise<string> | null = null
let attachmentSequence = 0
let mainWindow: BrowserWindow | null = null
let activeManagedReview: ReviewArtifact | null = null
let activeManagedReviewId: string | null = null
let localService: LocalService | null = null
let localServiceIdentity: ServiceIdentity | null = null
let serviceRepairQueue: Promise<void> = Promise.resolve()
let settingsStore: SettingsStore | null = null
let settingsUnsubscribe: (() => void) | null = null
let managedAutosave: ReviewAutosave | null = null
let pendingAutosave: string | null = null
let autosaveWriter: Promise<void> | null = null
let snapshotSequence = 0
let statusSequence = 0
let brandAssetsPromise: Promise<MarkoverBrandAssets> | null = null
const pendingSnapshots = new Map<string, PendingSnapshot>()
const pendingStatuses = new Map<string, PendingStatus>()
const projectRoots = new Map<string, Promise<string | null>>()

function settingsEnvelope(settings: MarkoverSettings): MarkoverSettingsEnvelope {
  return {
    ...settings,
    resolvedAppearance: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }
}

function loadBrandAssets(): Promise<MarkoverBrandAssets> {
  brandAssetsPromise ||= Promise.all([
    fs.readFile(path.join(__dirname, '../design/brand/markover-mark.svg'), 'utf8'),
    fs.readFile(path.join(__dirname, '../design/brand/markover-logotype.svg'), 'utf8'),
    fs.readFile(path.join(__dirname, '../design/brand/markover-lockup.svg'), 'utf8')
  ]).then(([mark, logotype, lockup]) => ({ mark, logotype, lockup }))
  return brandAssetsPromise
}

function applyMainSettings(
  settings: MarkoverSettings,
  broadcast = true
): MarkoverSettingsEnvelope {
  nativeTheme.themeSource = settings.appearance
  const envelope = settingsEnvelope(settings)
  mainWindow?.setBackgroundColor(
    windowBackground(settings, envelope.resolvedAppearance)
  )
  if (broadcast) mainWindow?.webContents.send('settings:changed', envelope)
  return envelope
}

function sendRendererEvent(
  channel: 'document:open-request' | 'settings:open',
  value?: unknown
): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (!mainWindow) throw new Error('Markover window could not be created.')
  const window = mainWindow
  const send = () => {
    window.webContents.send(channel, value)
  }
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', send)
  } else {
    send()
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function installApplicationMenu(): void {
  const template = applicationMenuTemplate({
    appName: 'Markover',
    reviewMode,
    onOpen: () => {
      sendRendererEvent('document:open-request')
    },
    onSettings: () => {
      sendRendererEvent('settings:open')
    }
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function checksum(source: string): string {
  return `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`
}

function bufferChecksum(buffer: Uint8Array): string {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`
}

function readClipboardImage(): MarkoverClipboardImage | null {
  const image = clipboard.readImage()
  if (image.isEmpty()) return null

  return {
    bytes: image.toPNG(),
    mimeType: 'image/png'
  }
}

async function loadReviewConfig(): Promise<ReviewConfig> {
  if (!reviewConfigPromise) {
    reviewConfigPromise = reviewConfigPath
      ? fs.readFile(reviewConfigPath, 'utf8').then((source) => (
          JSON.parse(source) as ReviewConfig
        ))
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

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}-${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`
  )
  try {
    await fs.writeFile(temporaryPath, contents, {
      encoding: 'utf8',
      flag: 'wx',
      flush: true
    })
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.unlink(temporaryPath).catch((error: unknown) => {
      if (errorProperty(error, 'code') !== 'ENOENT') throw error
    })
  }
}

function startAutosaveWriter(): void {
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

function queueReviewAutosave(tree: unknown): Promise<void> {
  if (!reviewMode) return Promise.resolve()

  pendingAutosave = JSON.stringify(tree, null, 2)
  if (!autosaveWriter) startAutosaveWriter()
  return autosaveWriter || Promise.resolve()
}

async function flushReviewAutosave(): Promise<void> {
  while (autosaveWriter) await autosaveWriter
}

async function finishReview(tree: ReviewTree): Promise<void> {
  if (!reviewMode || reviewFinished) return
  reviewFinished = true
  await queueReviewAutosave(tree)
  await flushReviewAutosave()
  process.stdout.write(`${JSON.stringify(tree)}\n`, () => {
    app.exit(0)
  })
}

async function attachmentDirectory(): Promise<string> {
  if (!attachmentDirectoryPromise) {
    attachmentDirectoryPromise = loadReviewConfig().then(async (config) => {
      const baseDirectory = path.resolve(
        config.attachmentsDirectory ||
        path.join(app.getAppPath(), '.markover', 'attachments')
      )
      await fs.mkdir(baseDirectory, { recursive: true })

      if (config.durable) {
        const entries = await fs.readdir(baseDirectory)
        attachmentSequence = entries.reduce((maximum: number, entry: string) => {
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

async function saveAttachment(
  _event: IpcMainInvokeEvent,
  attachment: MarkoverClipboardImage,
  reviewId: string | null = null
): Promise<ReviewAttachment> {
  const extensions = new Map<string, string>([
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

  let id: string
  let directory: string
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
    id = `img-${String(attachmentSequence)}`
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

async function loadReviewDocument(): Promise<MarkoverDocument> {
  const config = await loadReviewConfig()
  const filePath = config.inputPath
  if (!filePath) throw new Error('Missing MARKOVER_REVIEW_INPUT_PATH')

  if (config.autosavePath) {
    try {
      const tree = JSON.parse(
        await fs.readFile(config.autosavePath, 'utf8')
      ) as ReviewTree
      return {
        name: tree.sourceDocument.name || config.name || path.basename(filePath),
        path: tree.sourceDocument.path || config.originalPath || null,
        source: tree.sourceDocument.content,
        checksum: tree.sourceDocument.checksum,
        tree,
        durable: config.durable,
        autosavePath: config.autosavePath
      }
    } catch (error) {
      if (errorProperty(error, 'code') !== 'ENOENT') throw error
    }
  }

  const source = await fs.readFile(filePath, 'utf8')
  return {
    name: config.name || path.basename(filePath),
    path: config.originalPath || null,
    source,
    checksum: checksum(source),
    durable: config.durable,
    autosavePath: config.autosavePath || null
  }
}

async function openMarkdown(): Promise<MarkoverDocument | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  if (!filePath) return null
  const source = await fs.readFile(filePath, 'utf8')
  return {
    name: path.basename(filePath),
    path: filePath,
    source,
    checksum: checksum(source)
  }
}

function createWindow(
  { show = !backgroundServerMode }: { show?: boolean } = {}
): BrowserWindow {
  const startupSettings = settingsEnvelope(
    settingsStore?.settings || DEFAULT_SETTINGS
  )
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show,
    backgroundColor: windowBackground(
      startupSettings,
      startupSettings.resolvedAppearance
    ),
    icon: appIconPath,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  void mainWindow.loadFile(path.join(__dirname, 'index.html'), {
    query: {
      palette: startupSettings.palette,
      appearance: startupSettings.resolvedAppearance,
      colorization: darkColorization(startupSettings.palette)
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
      void flushReviewAutosave().finally(() => {
        app.exit(2)
      })
    })
  }
  return mainWindow
}

function repositoryRoot(artifact: ReviewArtifact): string | null {
  const git = artifact.review.git
  if (!git || typeof git !== 'object' || Array.isArray(git)) return null
  const root: unknown = Reflect.get(git, 'repositoryRoot')
  return typeof root === 'string' && root ? root : null
}

function managedDocument(
  artifact: ReviewArtifact,
  projectRoot: string | null = null
): MarkoverDocument {
  return {
    reviewId: artifact.review.id,
    name: artifact.sourceDocument.name,
    path: artifact.sourceDocument.path,
    source: artifact.sourceDocument.content,
    checksum: artifact.sourceDocument.checksum,
    projectRoot: repositoryRoot(artifact) || projectRoot,
    tree: artifact,
    durable: true
  }
}

async function managedDocuments(
  artifacts: ReviewArtifact[]
): Promise<MarkoverDocument[]> {
  return Promise.all(artifacts.map(async (artifact) => {
    const existingRoot = repositoryRoot(artifact)
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

function sendManagedReview(artifact: ReviewArtifact): void {
  activeManagedReview = artifact
  activeManagedReviewId = artifact.review.id
  if (!mainWindow) createWindow({ show: false })
  if (!mainWindow) throw new Error('Markover window could not be created.')
  const window = mainWindow
  const send = () => {
    window.webContents.send('review:opened', managedDocument(artifact))
  }
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function sendManagedStatus(artifact: ReviewArtifact): Promise<void> {
  if (activeManagedReviewId === artifact.review.id) {
    activeManagedReview = artifact
  }
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve()

  statusSequence += 1
  const requestId = `status-${String(statusSequence)}`
  const window = mainWindow
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingStatuses.delete(requestId)
      reject(new Error(`Timed out updating review ${artifact.review.id}.`))
    }, 5000)
    pendingStatuses.set(requestId, { reject, resolve, timeout })
    window.webContents.send('review:status', {
      requestId,
      reviewId: artifact.review.id,
      status: artifact.review.status
    })
  })
}

function requestRendererSnapshot(reviewId: string): Promise<ReviewTree | null> {
  if (
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    return Promise.resolve(null)
  }

  snapshotSequence += 1
  const requestId = `snapshot-${String(snapshotSequence)}`
  const window = mainWindow
  return new Promise<ReviewTree | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingSnapshots.delete(requestId)
      reject(new Error(`Timed out capturing review ${reviewId}.`))
    }, 5000)
    pendingSnapshots.set(requestId, { reject, resolve, reviewId, timeout })
    window.webContents.send('review:snapshot-request', {
      requestId,
      reviewId
    })
  })
}

function requireReviewStore(): ReviewStore {
  if (!reviewStore) throw new Error('Managed review storage is unavailable.')
  return reviewStore
}

function requireManagedAutosave(): ReviewAutosave {
  if (!managedAutosave) throw new Error('Managed autosave is unavailable.')
  return managedAutosave
}

async function flushManagedReview(
  reviewId: string,
  action: 'handoff' | 'edit'
): Promise<() => Promise<void>> {
  const store = requireReviewStore()
  try {
    const tree = await requestRendererSnapshot(reviewId)
    if (tree && action === 'handoff') {
      await requireManagedAutosave().saveNow(reviewId, tree)
    }
  } catch (error) {
    try {
      await sendManagedStatus(await store.load(reviewId))
    } catch {
      // Preserve the original snapshot failure when status recovery also fails.
    }
    throw error
  }
  return async () => {
    await sendManagedStatus(await store.load(reviewId))
  }
}

function repairServiceRecords(): Promise<void> {
  const identity = localServiceIdentity
  const service = localService
  if (!identity || !service) return Promise.resolve()
  serviceRepairQueue = serviceRepairQueue.catch(() => {}).then(() => (
    publishServiceConnection({
      endpointPath,
      identity,
      port: service.port
    })
  ))
  return serviceRepairQueue
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  if (!reviewMode) {
    app.on('second-instance', (_event, commandLine) => {
      if (commandLine.includes('--markover-server')) {
        repairServiceRecords().catch((error: unknown) => {
          process.stderr.write(
            `markover service recovery: ${errorMessage(error)}\n`
          )
        })
        return
      }
      if (!mainWindow) createWindow()
      const window = mainWindow
      if (!window) throw new Error('Markover window could not be created.')
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    })
  }

  app.whenReady().then(async () => {
    if (!reviewMode) await secureServiceDirectory(serviceDirectory())
    if (process.platform === 'darwin' && !app.isPackaged) {
      if (!app.dock) {
        throw new Error('The macOS application dock is unavailable.')
      }
      app.dock.setIcon(appIconPath)
    }
    if (reviewMode) reviewDocumentPromise = loadReviewDocument()
    else if (!app.isPackaged) await importLegacyReviews(
      path.join(checkoutDirectory, '.markover', 'reviews'),
      reviewsDirectory()
    )

    const store = new SettingsStore(
      path.join(app.getPath('userData'), 'settings.json')
    )
    settingsStore = store
    const initialSettings = await store.load()
    if (!reviewMode) {
      managedAutosave = new ReviewAutosave(requireReviewStore(), {
        maximumDelayMs: initialSettings.autosaveMaximumDelayMs,
        onFailure(reviewId, error) {
          process.stderr.write(
            `markover autosave ${reviewId}: ${errorMessage(error)}\n`
          )
        },
        onSaved(artifact) {
          if (activeManagedReviewId === artifact.review.id) {
            activeManagedReview = artifact
          }
        }
      })
    }
    nativeTheme.themeSource = initialSettings.appearance
    settingsUnsubscribe = await store.subscribe((settings) => {
      applyMainSettings(settings)
    })
    installApplicationMenu()

    ipcMain.handle('document:open', openMarkdown)
    ipcMain.handle('brand:assets', loadBrandAssets)
    ipcMain.handle('document:checksum', (
      _event: IpcMainInvokeEvent,
      source: string
    ) => checksum(source))
    ipcMain.handle('attachment:save', saveAttachment)
    ipcMain.handle('clipboard:read-image', readClipboardImage)
    ipcMain.handle('settings:get', () => settingsEnvelope(store.settings))
    ipcMain.handle('settings:update', async (
      _event: IpcMainInvokeEvent,
      patch: unknown
    ) => {
      const settings = await store.update(patch)
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
        : managedDocuments(await requireReviewStore().list())
    ))
    ipcMain.on('review:snapshot-response', (
      _event: IpcMainEvent,
      response: ReviewSnapshotResponse
    ) => {
      const pending = pendingSnapshots.get(response.requestId)
      if (!pending || pending.reviewId !== response.reviewId) return
      clearTimeout(pending.timeout)
      pendingSnapshots.delete(response.requestId)
      if (response.error) pending.reject(new Error(response.error))
      else pending.resolve(response.tree ?? null)
    })
    ipcMain.on('review:status-response', (
      _event: IpcMainEvent,
      response: ReviewStatusResponse
    ) => {
      const pending = pendingStatuses.get(response.requestId)
      if (!pending) return
      clearTimeout(pending.timeout)
      pendingStatuses.delete(response.requestId)
      if (response.error) pending.reject(new Error(response.error))
      else pending.resolve()
    })
    ipcMain.on('clipboard:write', (_event: IpcMainEvent, text: string) => {
      clipboard.writeText(text)
    })
    ipcMain.on('review:activate', (
      _event: IpcMainEvent,
      reviewId: string
    ) => {
      if (reviewMode) return
      const managedStore = requireReviewStore()
      activeManagedReviewId = reviewId
      managedStore.load(reviewId).then((artifact) => {
        if (activeManagedReviewId === reviewId) {
          activeManagedReview = artifact
        }
      }).catch((error: unknown) => {
        process.stderr.write(`markover activate: ${errorMessage(error)}\n`)
      })
    })
    ipcMain.on('review:autosave', (
      _event: IpcMainEvent,
      reviewId: string,
      tree: ReviewTree
    ) => {
      if (reviewMode) {
        queueReviewAutosave(tree).catch((error: unknown) => {
          process.stderr.write(`markover autosave: ${errorMessage(error)}\n`)
        })
      } else {
        requireManagedAutosave().queue(reviewId, tree)
      }
    })
    ipcMain.on('review:done', (
      _event: IpcMainEvent,
      tree: ReviewTree
    ) => {
      void finishReview(tree)
    })
    ipcMain.on('review:cancel', () => {
      if (!reviewMode || reviewFinished) return
      reviewFinished = true
      app.exit(2)
    })

    createWindow()

    nativeTheme.on('updated', () => {
      const envelope = settingsEnvelope(store.settings)
      mainWindow?.setBackgroundColor(
        windowBackground(store.settings, envelope.resolvedAppearance)
      )
      mainWindow?.webContents.send('settings:changed', envelope)
    })

    if (!reviewMode) {
      const managedStore = requireReviewStore()
      const identity = createServiceIdentity()
      const startedService = await startLocalService({
        identity,
        store: managedStore,
        interpretationPolicy: () => store.settings.agentInterpretationPolicy,
        beforeAction: flushManagedReview,
        importReviews: (sourceDirectory) => importLegacyReviews(
          sourceDirectory,
          managedStore.directory
        ),
        async onChange(artifact, action) {
          if (action === 'created') sendManagedReview(artifact)
          else await sendManagedStatus(artifact)
        },
        onUnauthorized(event) {
          if (!store.settings.logRejectedApiRequests) return
          process.stderr.write(
            `markover authorization: ${event.method} ${event.pathname} (${event.reason})\n`
          )
        }
      })
      try {
        await publishServiceConnection({
          endpointPath,
          identity,
          port: startedService.port
        })
        localService = startedService
        localServiceIdentity = identity
      } catch (error) {
        await startedService.close()
        throw error
      }
    }

    app.on('activate', () => {
      if (reviewMode) return
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      mainWindow?.show()
      mainWindow?.focus()
    })
  }).catch((error: unknown) => {
    const stack = errorProperty(error, 'stack')
    process.stderr.write(
      `markover: ${typeof stack === 'string' ? stack : errorMessage(error)}\n`
    )
    app.quit()
  })

  app.on('before-quit', () => {
    settingsUnsubscribe?.()
    if (localService) localService.close().catch(() => {
      // Shutdown is already in progress.
    })
  })

  app.on('window-all-closed', () => {
    if (reviewMode) {
      if (!reviewFinished) app.exit(2)
      return
    }
    if (process.platform !== 'darwin') app.quit()
  })
}

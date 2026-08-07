import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
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
import { smokeReviewTree } from './smoke-fixture'
import {
  developmentStartupControls,
  isStartupPhase,
  isStartupWarning,
  type BuildIdentity,
  type RendererSmokeResult,
  type StartupFailureCategory,
  type StartupInfo,
  type StartupPhase,
  type StartupReady,
  type StartupWarning
} from './startup-contract'
import { StartupDiagnostic } from './startup-diagnostic'
import {
  darkColorization,
  DEFAULT_SETTINGS,
  windowBackground
} from './settings'

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
const checkoutDirectory = path.resolve(projectDirectory, '../..')
const appIconPath = path.join(projectDirectory, 'design/brand/markover-app-icon.png')
const smokeMode = process.argv.includes('--smoke')
const smokeStateDirectory = smokeMode
  ? path.join(os.tmpdir(), `markover-smoke-${String(process.pid)}`)
  : null
if (smokeStateDirectory) {
  mkdirSync(smokeStateDirectory)
  app.setPath('userData', smokeStateDirectory)
}
const applicationDataDirectory = smokeStateDirectory || serviceDirectory()
const endpointPath = smokeStateDirectory
  ? path.join(smokeStateDirectory, 'service.json')
  : serviceEndpointPath()
const startupDiagnosticPath = path.join(
  applicationDataDirectory,
  'startup-diagnostic.json'
)
const reviewStore = reviewMode
  ? null
  : new ReviewStore(
      smokeStateDirectory
        ? path.join(smokeStateDirectory, 'reviews')
        : reviewsDirectory()
    )
const hasSingleInstanceLock = reviewMode || smokeMode ||
  app.requestSingleInstanceLock()
const backgroundServerMode = smokeMode || (!reviewMode &&
  process.argv.includes('--markover-server')
  )
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
let startupDiagnostic: StartupDiagnostic | null = null
let startupBuildIdentity: BuildIdentity | null = null
let startupInfo: StartupInfo | null = null
let startupReady = false
let rendererInitializationHandled = false
let rendererStartupFailed = false
let activeStartupPhase: StartupPhase | null = null
const startupWarnings: StartupWarning[] = []
let startupFailureDialogShown = false
const pendingSnapshots = new Map<string, PendingSnapshot>()
const pendingStatuses = new Map<string, PendingStatus>()
const projectRoots = new Map<string, Promise<string | null>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isRendererSmokeResult(value: unknown): value is RendererSmokeResult {
  if (
    !isRecord(value) ||
    value.format !== 'markover-renderer-smoke' ||
    value.version !== 1 ||
    !isRecord(value.checks)
  ) return false
  const checks = value.checks
  const keys = Object.keys(checks).sort()
  return (
    keys.join(',') === 'cleanRuntime,documentsList,markdown,sourceDiff,yaml' &&
    keys.every((key) => typeof checks[key] === 'boolean')
  )
}

async function loadBuildIdentity(): Promise<BuildIdentity> {
  const value: unknown = JSON.parse(await fs.readFile(
    path.join(projectDirectory, 'build-identity.json'),
    'utf8'
  ))
  if (
    !isRecord(value) ||
    typeof value.version !== 'string' ||
    (value.commit !== null && typeof value.commit !== 'string') ||
    typeof value.dirty !== 'boolean' ||
    typeof value.rendererSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.rendererSha256)
  ) {
    throw new Error('Markover build identity is invalid.')
  }
  return {
    version: value.version,
    commit: value.commit,
    dirty: value.dirty,
    rendererSha256: value.rendererSha256
  }
}

function requireStartupDiagnostic(): StartupDiagnostic {
  if (!startupDiagnostic) throw new Error('Startup diagnostic is unavailable.')
  return startupDiagnostic
}

function recordStartupWarnings(warnings: StartupWarning[]): Promise<void> {
  const keys = new Set(startupWarnings.map((warning) => (
    `${warning.category}\0${warning.subject}`
  )))
  for (const warning of warnings) {
    const key = `${warning.category}\0${warning.subject}`
    if (!keys.has(key)) {
      startupWarnings.push(warning)
      keys.add(key)
    }
  }
  return requireStartupDiagnostic().warnings(startupWarnings)
}

async function applyMainStartupControl(phase: StartupPhase): Promise<void> {
  const info = startupInfo
  if (info?.failPhase === phase) {
    throw new Error(`Development startup failure at ${phase}.`)
  }
  if (info?.holdPhase === phase) {
    await new Promise<void>(() => {})
  }
}

async function beginMainStartupPhase(phase: StartupPhase): Promise<void> {
  activeStartupPhase = phase
  process.stderr.write(`markover startup: ${phase}\n`)
  await requireStartupDiagnostic().begin(phase)
  await applyMainStartupControl(phase)
}

async function failStartup(
  category: StartupFailureCategory,
  error: unknown,
  crashed = false
): Promise<void> {
  await startupDiagnostic?.fail(category, error, crashed)
}

function mainStartupFailureCategory(): StartupFailureCategory {
  if (activeStartupPhase === 'preparing-interface') {
    return 'interface-preparation'
  }
  if (activeStartupPhase === 'loading-settings') return 'settings-access'
  return 'unexpected-main-error'
}

function rendererDidFailStartup(): boolean {
  return rendererStartupFailed
}

function markRendererStartupFailed(): void {
  if (!startupReady) rendererStartupFailed = true
}

function requireActiveRendererStartup(): void {
  if (rendererDidFailStartup()) {
    throw new Error('Renderer failed before startup completed.')
  }
}

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
    focusable: !smokeMode,
    skipTaskbar: smokeMode,
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
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    markRendererStartupFailed()
    void (async () => {
      await failStartup(
        'renderer-load',
        new Error(`Preload failed (${path.basename(preloadPath)}): ${error.message}`)
      )
      await showStartupFailureDialog()
    })()
  })
  mainWindow.webContents.on('did-fail-load', (
    _event,
    errorCode,
    errorDescription,
    _validatedUrl,
    isMainFrame
  ) => {
    if (!isMainFrame || errorCode === -3) return
    markRendererStartupFailed()
    void (async () => {
      await failStartup(
        'renderer-load',
        new Error(`Renderer load failed (${String(errorCode)}): ${errorDescription}`)
      )
      await showStartupFailureDialog()
    })()
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const failedDuringStartup = !startupReady
    markRendererStartupFailed()
    void (async () => {
      await failStartup(
        failedDuringStartup ? 'renderer-load' : 'renderer-terminated',
        new Error(`Renderer process terminated: ${details.reason}.`),
        !failedDuringStartup
      )
      if (failedDuringStartup) await showStartupFailureDialog()
    })()
  })
  mainWindow.on('unresponsive', () => {
    if (startupReady) return
    markRendererStartupFailed()
    void (async () => {
      await failStartup(
        'renderer-load',
        new Error('Renderer became unresponsive during startup.')
      )
      await showStartupFailureDialog()
    })()
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

async function startAndPublishService(): Promise<void> {
  if (reviewMode || smokeMode) return
  const managedStore = requireReviewStore()
  const store = settingsStore
  if (!store) throw new Error('Settings are unavailable for service startup.')
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

async function stopPublishedService(): Promise<void> {
  const service = localService
  localService = null
  localServiceIdentity = null
  if (service) await service.close()
}

async function copyStartupDiagnostic(): Promise<void> {
  clipboard.writeText(await fs.readFile(startupDiagnosticPath, 'utf8'))
}

async function showStartupFailureDialog(): Promise<void> {
  if (startupFailureDialogShown) return
  startupFailureDialogShown = true
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      buttons: ['Copy details', 'Show diagnostic', 'Quit Markover'],
      cancelId: 2,
      defaultId: 2,
      noLink: true,
      message: 'Markover couldn’t start.',
      detail: `A sanitized diagnostic is available at:\n${startupDiagnosticPath}`
    })
    if (response === 0) await copyStartupDiagnostic()
    else if (response === 1) shell.showItemInFolder(startupDiagnosticPath)
    else {
      app.quit()
      return
    }
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
    const build = await loadBuildIdentity()
    startupBuildIdentity = build
    const controls = developmentStartupControls(
      process.argv,
      app.isPackaged,
      smokeMode
    )
    startupInfo = {
      development: !app.isPackaged,
      diagnosticPath: startupDiagnosticPath,
      smoke: smokeMode,
      ...controls
    }
    startupDiagnostic = new StartupDiagnostic({
      appDirectory: projectDirectory,
      build,
      filePath: startupDiagnosticPath
    })
    await startupDiagnostic.start()
    await beginMainStartupPhase('preparing-interface')
    if (!reviewMode) await secureServiceDirectory(applicationDataDirectory)
    if (process.platform === 'darwin' && !app.isPackaged && !smokeMode) {
      if (!app.dock) {
        throw new Error('The macOS application dock is unavailable.')
      }
      app.dock.setIcon(appIconPath)
    }
    if (reviewMode) reviewDocumentPromise = loadReviewDocument()
    else if (!app.isPackaged && !smokeMode) await importLegacyReviews(
      path.join(checkoutDirectory, '.markover', 'reviews'),
      reviewsDirectory()
    )
    await startupDiagnostic.complete('preparing-interface')

    await beginMainStartupPhase('loading-settings')
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
    if (store.lastRecoveryWarning) {
      await recordStartupWarnings([{
        category: 'settings-recovered',
        subject: 'settings.json'
      }])
    }
    await startupDiagnostic.complete('loading-settings')
    installApplicationMenu()

    if (smokeMode) {
      await requireReviewStore().create({
        tree: smokeReviewTree(),
        contextSummary: 'Fixed renderer smoke fixture.'
      })
    }

    ipcMain.handle('startup:info', () => startupInfo)
    ipcMain.handle('startup:phase', async (
      _event: IpcMainInvokeEvent,
      phaseEvent: unknown
    ) => {
      if (
        !isRecord(phaseEvent) ||
        !isStartupPhase(phaseEvent.phase) ||
        (phaseEvent.state !== 'begin' && phaseEvent.state !== 'complete')
      ) {
        throw new Error('Invalid startup phase event.')
      }
      if (phaseEvent.state === 'begin') {
        activeStartupPhase = phaseEvent.phase
        process.stderr.write(`markover startup: ${phaseEvent.phase}\n`)
        await requireStartupDiagnostic().begin(phaseEvent.phase)
      } else {
        await requireStartupDiagnostic().complete(phaseEvent.phase)
      }
    })
    ipcMain.handle('startup:renderer-initialized', async (
      _event: IpcMainInvokeEvent,
      initialization: unknown
    ): Promise<StartupReady> => {
      if (
        rendererInitializationHandled ||
        rendererStartupFailed ||
        !isRecord(initialization) ||
        !Array.isArray(initialization.warnings) ||
        !initialization.warnings.every(isStartupWarning)
      ) {
        throw new Error('Invalid or duplicate renderer initialization.')
      }
      rendererInitializationHandled = true
      await recordStartupWarnings(initialization.warnings)
      try {
        await beginMainStartupPhase('publishing-service')
        await startAndPublishService()
        requireActiveRendererStartup()
        await requireStartupDiagnostic().complete('publishing-service')
        requireActiveRendererStartup()
        await beginMainStartupPhase('ready')
        requireActiveRendererStartup()
        await requireStartupDiagnostic().complete('ready')
        requireActiveRendererStartup()
        await requireStartupDiagnostic().ready()
        requireActiveRendererStartup()
        startupReady = true
        return { warnings: [...startupWarnings] }
      } catch (error) {
        if (rendererDidFailStartup()) {
          await stopPublishedService()
        } else {
          await failStartup('service-publication', error)
        }
        throw error
      }
    })
    ipcMain.handle('startup:failure', async (
      _event: IpcMainInvokeEvent,
      failure: unknown
    ) => {
      if (
        !isRecord(failure) ||
        startupReady ||
        rendererStartupFailed ||
        failure.category !== 'renderer-initialization' ||
        typeof failure.message !== 'string' ||
        (failure.stack !== null && typeof failure.stack !== 'string')
      ) {
        throw new Error('Invalid renderer startup failure.')
      }
      rendererStartupFailed = true
      if (requireStartupDiagnostic().snapshot().status === 'starting') {
        await failStartup('renderer-initialization', {
          message: failure.message,
          stack: failure.stack
        })
      }
    })
    ipcMain.handle('startup:copy-diagnostic', copyStartupDiagnostic)
    ipcMain.handle('startup:reveal-diagnostic', () => {
      shell.showItemInFolder(startupDiagnosticPath)
    })
    ipcMain.on('startup:quit', () => {
      app.quit()
    })
    ipcMain.handle('smoke:result', (
      _event: IpcMainInvokeEvent,
      result: unknown
    ) => {
      if (!smokeMode || !isRendererSmokeResult(result) || !startupBuildIdentity) {
        throw new Error('Invalid renderer smoke result.')
      }
      const checksPassed = Object.values(result.checks).every(Boolean)
      const output = {
        format: 'markover-smoke',
        version: 1,
        ok: checksPassed,
        build: startupBuildIdentity,
        checks: result.checks,
        phases: requireStartupDiagnostic().snapshot().phases
      }
      process.stdout.write(`${JSON.stringify(output)}\n`, () => {
        app.exit(checksPassed ? 0 : 1)
      })
    })
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
    ipcMain.handle('review:list', async () => {
      if (reviewMode) return []
      try {
        const result = await requireReviewStore().listWithWarnings()
        if (result.warnings.length) {
          await recordStartupWarnings(result.warnings.map((warning) => ({
            category: 'review-skipped',
            subject: `${warning.reviewId} (${warning.reason})`
          })))
        }
        return await managedDocuments(result.reviews)
      } catch (error) {
        await failStartup('review-storage-access', error)
        throw error
      }
    })
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

    app.on('activate', () => {
      if (reviewMode || smokeMode) return
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      mainWindow?.show()
      mainWindow?.focus()
    })
  }).catch((error: unknown) => {
    void (async () => {
      const stack = errorProperty(error, 'stack')
      process.stderr.write(
        `markover: ${typeof stack === 'string' ? stack : errorMessage(error)}\n`
      )
      if (startupDiagnostic?.snapshot().status === 'starting') {
        await failStartup(mainStartupFailureCategory(), error)
      }
      await showStartupFailureDialog()
    })()
  })

  app.on('before-quit', () => {
    settingsUnsubscribe?.()
    if (localService) localService.close().catch(() => {
      // Shutdown is already in progress.
    })
  })

  app.on('will-quit', () => {
    if (
      smokeStateDirectory &&
      process.env.MARKOVER_SMOKE_RUNNER !== '1'
    ) {
      rmSync(smokeStateDirectory, { recursive: true, force: true })
    }
  })

  app.on('window-all-closed', () => {
    if (reviewMode) {
      if (!reviewFinished) app.exit(2)
      return
    }
    if (smokeMode) {
      app.quit()
      return
    }
    if (process.platform !== 'darwin') app.quit()
  })
}

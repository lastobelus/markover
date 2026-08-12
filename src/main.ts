import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { aboutPanelOptions } from './about-panel'
import { applicationMenuTemplate } from './app-menu'
import { AsyncMutationTracker } from './async-mutation-tracker'
import {
  DEVELOPMENT_WATCH_ENVIRONMENT,
  isDevelopmentControlQuit
} from './development-control'
import { loadDevelopmentConfig } from './development-config'
import {
  persistReviewSnapshots,
  runDurabilityShutdown
} from './durability-shutdown'
import {
  CANONICAL_INSTANCE_SCHEME,
  runtimeInstanceFromEnvironment
} from './instance'
import {
  InternalAttachmentAllowlist,
  resolveInternalRequestFile
} from './internal-protocol'
import {
  internalRendererEntryUrl,
  MARKOVER_INTERNAL_SCHEME,
  MARKOVER_INTERNAL_SCHEME_PRIVILEGES,
  MARKOVER_RENDERER_ENTRY_URL
} from './internal-url'
import {
  assertMainEventArguments,
  type AttachmentRemoveRequest,
  type AttachmentRemoveResult,
  type MainEventChannel,
  type ReviewContextMenuRequest,
  type ReviewContextMenuResult
} from './ipc-contract'
import {
  PrivilegedIpc,
  type RendererIpcEntry
} from './ipc-security'
import { startLocalService, type LocalService } from './local-service'
import { createLocalReview as persistLocalReview } from './local-review'
import { openPublicLinkCommand } from './public-link-opener'
import { type PublicLink, type PublicLinkId } from './public-links'
import { discoverProjectFavicon } from './project-favicon'
import { reviewPullRequestIdentity } from './pull-request'
import { ReviewAutosave } from './review-autosave'
import { discoverVerifiedReviewProjectRoot } from './review-project-context'
import { copyCanonicalReviewLink } from './review-link-copy'
import {
  registerProtocolOnFirstLaunch,
  SUPPRESS_PROTOCOL_REGISTRATION_ENVIRONMENT
} from './protocol-registration'
import {
  reviewDeletionPolicy,
  ReviewStore,
  type ReviewArtifact,
  type ReviewDeletionPolicy,
  type UnusedAttachmentScan
} from './review-store'
import { parseReviewUrl, type ReviewUrl } from './review-url'
import { ReviewUrlDispatcher } from './review-url-dispatcher'
import {
  hardenedRendererWebPreferences,
  installRendererSecurityBoundaries
} from './renderer-security'
import {
  createServiceIdentity,
  publishServiceConnection,
  secureServiceDirectory,
  type ServiceIdentity
} from './service-endpoint'
import { SettingsStore } from './settings-store'
import { WorkspaceStore } from './workspace-store'
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
  adjacentZoomPercent,
  darkColorization,
  DEFAULT_SETTINGS,
  windowBackground,
  ZOOM_LEVELS
} from './settings'

protocol.registerSchemesAsPrivileged([{
  scheme: MARKOVER_INTERNAL_SCHEME,
  privileges: MARKOVER_INTERNAL_SCHEME_PRIVILEGES
}])

interface PendingSnapshot {
  purpose: ReviewSnapshotRequest['purpose']
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

interface PendingActivation {
  reject: (reason?: unknown) => void
  resolve: (outcome: ReviewActivationOutcome) => void
  reviewId: string
  timeout: ReturnType<typeof setTimeout>
}

interface PendingReviewUrl {
  focusState: MarkoverWindowFocusState
  parsed: ReviewUrl
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

const addressedInstance = runtimeInstanceFromEnvironment()
app.setName(addressedInstance.branding.appName)
process.title = addressedInstance.branding.appName
process.on('message', (message) => {
  if (isDevelopmentControlQuit(message)) app.quit()
})

const projectDirectory = path.resolve(__dirname, '..')
const checkoutDirectory = addressedInstance.checkout
const appIconPath = path.isAbsolute(addressedInstance.branding.iconPngPath)
  ? addressedInstance.branding.iconPngPath
  : path.join(projectDirectory, addressedInstance.branding.iconPngPath)
const smokeMode = process.argv.includes('--smoke')
const developmentWatchMode = process.env[DEVELOPMENT_WATCH_ENVIRONMENT] === '1'
const smokeStateDirectory = smokeMode
  ? path.join(os.tmpdir(), `markover-smoke-${String(process.pid)}`)
  : null
if (smokeStateDirectory) {
  mkdirSync(smokeStateDirectory)
  app.setPath('userData', smokeStateDirectory)
} else {
  app.setPath('userData', addressedInstance.stateRoot)
}
const applicationDataDirectory = smokeStateDirectory || addressedInstance.stateRoot
const endpointPath = smokeStateDirectory
  ? path.join(smokeStateDirectory, 'service.json')
  : addressedInstance.service.endpointPath
const startupDiagnosticPath = path.join(
  applicationDataDirectory,
  'startup-diagnostic.json'
)
const reviewStore = new ReviewStore(
  smokeStateDirectory
    ? path.join(smokeStateDirectory, 'reviews')
    : path.join(addressedInstance.stateRoot, 'reviews')
)
const internalAttachments = new InternalAttachmentAllowlist(reviewStore.directory)
const hasSingleInstanceLock = smokeMode || app.requestSingleInstanceLock()
const backgroundServerMode = smokeMode || process.argv.includes('--markover-server')
let mainWindow: BrowserWindow | null = null
let mainWindowBlurredAt: number | null = Date.now()
let activeManagedReview: ReviewArtifact | null = null
let activeManagedReviewId: string | null = null
let pendingLocalReviewCandidate: MarkoverDocument | null = null
let localService: LocalService | null = null
let closingPublishedService: LocalService | null = null
let localServiceIdentity: ServiceIdentity | null = null
let serviceRepairQueue: Promise<void> = Promise.resolve()
let settingsStore: SettingsStore | null = null
let settingsUnsubscribe: (() => void) | null = null
let workspaceStore: WorkspaceStore | null = null
let zoomWriter: Promise<void> = Promise.resolve()
let managedAutosave: ReviewAutosave | null = null
let snapshotSequence = 0
let statusSequence = 0
let activationSequence = 0
let brandAssetsPromise: Promise<MarkoverBrandAssets> | null = null
let startupDiagnostic: StartupDiagnostic | null = null
let startupBuildIdentity: BuildIdentity | null = null
let startupInfo: StartupInfo | null = null
let startupReady = false
let rendererInitializationHandled = false
let rendererStartupFailed = false
let rendererReadyWebContentsId: number | null = null
let rendererReadyPromise: Promise<void> = Promise.resolve()
let resolveRendererReady: (() => void) | null = null
let rendererIpcEntry: RendererIpcEntry | null = null
let managedAttachmentSavesBlocked = false
let managedLocalReviewCreationsBlocked = false
let managedShutdownComplete = false
let managedShutdownStarted = false
let activeStartupPhase: StartupPhase | null = null
const startupWarnings: StartupWarning[] = []
let startupFailureDialogShown = false
const pendingSnapshots = new Map<string, PendingSnapshot>()
const pendingStatuses = new Map<string, PendingStatus>()
const pendingActivations = new Map<string, PendingActivation>()
const pendingManagedReviewNotifications = new Map<string, MarkoverDocument>()
const reviewProjectRoots = new Map<string, Promise<string | null>>()
const projectFavicons = new Map<string, Promise<string | null>>()
const managedAttachmentMutations = new AsyncMutationTracker()
const managedLocalReviewCreations = new AsyncMutationTracker()
const reviewUrlDispatcher = new ReviewUrlDispatcher<PendingReviewUrl>(
  async ({ focusState, parsed }) => {
    await activateManagedReview(parsed.reviewId, focusState)
  },
  (error) => {
    process.stderr.write(`markover review link: ${errorMessage(error)}\n`)
  }
)
const privilegedIpc = new PrivilegedIpc(ipcMain, {
  activeWebContents: () => (
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow.webContents
      : null
  ),
  diagnose(channel, reason) {
    process.stderr.write(`markover ipc: rejected ${channel} (${reason})\n`)
  },
  expectedEntry: () => rendererIpcEntry
})

if (process.platform === 'darwin' && app.isPackaged && !smokeMode) {
  app.on('open-url', (event, value) => {
    event.preventDefault()
    const parsed = parseReviewUrl(value, CANONICAL_INSTANCE_SCHEME)
    if (!parsed) return
    reviewUrlDispatcher.receive({
      focusState: currentWindowFocusState(),
      parsed
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isReviewActivationOutcome(
  value: unknown
): value is ReviewActivationOutcome {
  return value === 'activated' ||
    value === 'already-active' ||
    value === 'blocked' ||
    value === 'deferred' ||
    value === 'missing'
}

function isRendererSmokeResult(value: unknown): value is RendererSmokeResult {
  if (
    !isRecord(value) ||
    value.format !== 'markover-renderer-smoke' ||
    value.version !== 1 ||
    !Array.isArray(value.diagnostics) ||
    !value.diagnostics.every((item) => typeof item === 'string') ||
    !isRecord(value.checks)
  ) return false
  const checks = value.checks
  const keys = Object.keys(checks).sort()
  return (
    keys.join(',') === [
      'attachmentImage',
      'blobImage',
      'cleanRuntime',
      'dataImage',
      'documentsList',
      'markdown',
      'navigationDenied',
      'permissionDenied',
      'sandboxedRenderer',
      'sourceDiff',
      'webviewDenied',
      'windowOpenDenied',
      'yaml'
    ].join(',') &&
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

async function configureAboutPanel(build: BuildIdentity): Promise<void> {
  const packageManifest: unknown = JSON.parse(await fs.readFile(
    path.join(projectDirectory, 'package.json'),
    'utf8'
  ))
  app.setAboutPanelOptions(aboutPanelOptions(
    addressedInstance.branding.appName,
    build,
    packageManifest
  ))
}

function provisionalBuildIdentity(): BuildIdentity {
  return {
    version: app.getVersion(),
    commit: null,
    dirty: true,
    rendererSha256: '0'.repeat(64)
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

async function failStartupBestEffort(
  category: StartupFailureCategory,
  error: unknown,
  crashed = false
): Promise<void> {
  try {
    await failStartup(category, error, crashed)
  } catch (diagnosticError) {
    process.stderr.write(
      `markover diagnostic: ${errorMessage(diagnosticError)}\n`
    )
  }
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
  const window = mainWindow
  if (window && !window.isDestroyed()) {
    window.setBackgroundColor(
      windowBackground(settings, envelope.resolvedAppearance)
    )
    window.webContents.setZoomFactor(settings.zoomPercent / 100)
  }
  if (broadcast && window && !window.isDestroyed()) {
    sendMainEvent(window.webContents, 'settings:changed', envelope)
  }
  return envelope
}

function requestZoomPercent(
  resolveNext: (current: ZoomPercent) => ZoomPercent
): void {
  const operation = zoomWriter.catch(() => undefined).then(async () => {
    const store = settingsStore
    if (!store) throw new Error('Markover settings are unavailable.')
    const next = resolveNext(store.settings.zoomPercent)
    if (next === store.settings.zoomPercent) return
    const settings = await store.update({ zoomPercent: next })
    applyMainSettings(settings)
    installApplicationMenu()
  })
  zoomWriter = operation.then(() => undefined, () => undefined)
  void operation.catch(showZoomOperationError)
}

function sendMainEvent(
  webContents: WebContents,
  channel: MainEventChannel,
  ...args: unknown[]
): void {
  assertMainEventArguments(channel, args)
  webContents.send(channel, ...args)
}

function sendRendererEvent(
  channel: 'document:open-request' | 'settings:open'
): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (!mainWindow) throw new Error('Markover window could not be created.')
  const window = mainWindow
  const send = () => {
    sendMainEvent(window.webContents, channel)
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
  const zoomPercent = settingsStore?.settings.zoomPercent ??
    DEFAULT_SETTINGS.zoomPercent
  const zoomIndex = ZOOM_LEVELS.indexOf(zoomPercent)
  const template = applicationMenuTemplate({
    appName: addressedInstance.branding.appName,
    canCleanUpAttachments: true,
    canResetZoom: zoomPercent !== DEFAULT_SETTINGS.zoomPercent,
    canTrashReview: activeManagedReviewId !== null,
    canZoomIn: zoomIndex < ZOOM_LEVELS.length - 1,
    canZoomOut: zoomIndex > 0,
    onCleanUpAttachments: () => {
      void cleanUpUnusedAttachments().catch(showReviewOperationError)
    },
    onOpen: () => {
      sendRendererEvent('document:open-request')
    },
    onOpenPublicLink: (id) => {
      void openPublicLink(id).catch((error: unknown) => {
        process.stderr.write(
          `markover public link: ${errorMessage(error)}\n`
        )
      })
    },
    onResetZoom: () => {
      requestZoomPercent(() => DEFAULT_SETTINGS.zoomPercent)
    },
    onSettings: () => {
      sendRendererEvent('settings:open')
    },
    onTrashReview: () => {
      if (activeManagedReviewId) {
        void moveReviewToTrash(activeManagedReviewId).catch(
          showReviewOperationError
        )
      }
    },
    onZoomIn: () => {
      requestZoomPercent((current) => adjacentZoomPercent(current, 1))
    },
    onZoomOut: () => {
      requestZoomPercent((current) => adjacentZoomPercent(current, -1))
    }
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function restoreMainWindowFocus(): void {
  const window = mainWindow
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

async function showPublicLinkFailure(
  link: PublicLink,
  error: unknown
): Promise<'copy' | 'dismiss'> {
  process.stderr.write(
    `markover public link ${link.id}: ${errorMessage(error)}\n`
  )
  const options = {
    type: 'error' as const,
    buttons: ['Copy Link', 'OK'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: `Markover could not open ${link.label}.`,
    detail: `${link.url}\n\nCopy the link and open it manually in a browser.`
  }
  const window = mainWindow
  const result = window && !window.isDestroyed()
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response === 0 ? 'copy' : 'dismiss'
}

async function openPublicLink(id: PublicLinkId): Promise<void> {
  await openPublicLinkCommand(id, {
    copyText: (text) => { clipboard.writeText(text) },
    openExternal: (url) => shell.openExternal(url),
    restoreFocus: restoreMainWindowFocus,
    showFailure: showPublicLinkFailure
  })
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`
}

function resumeManagedMutationsUnlessShuttingDown(): void {
  if (!managedShutdownStarted) resumeManagedMutations()
}

async function showReviewOperationError(error: unknown): Promise<void> {
  process.stderr.write(`markover review cleanup: ${errorMessage(error)}\n`)
  const options = {
    type: 'error' as const,
    buttons: ['OK'],
    defaultId: 0,
    noLink: true,
    message: 'Markover could not complete that review operation.',
    detail: errorMessage(error)
  }
  const window = mainWindow
  if (window && !window.isDestroyed()) await dialog.showMessageBox(window, options)
  else await dialog.showMessageBox(options)
}

async function showZoomOperationError(error: unknown): Promise<void> {
  process.stderr.write(`markover zoom: ${errorMessage(error)}\n`)
  const options = {
    type: 'error' as const,
    buttons: ['OK'],
    defaultId: 0,
    noLink: true,
    message: 'Markover could not save the zoom level.',
    detail: errorMessage(error)
  }
  const window = mainWindow
  if (window && !window.isDestroyed()) await dialog.showMessageBox(window, options)
  else await dialog.showMessageBox(options)
}

async function withManagedMutationsPaused(
  operation: () => Promise<void>,
  reviewId: string | null = null,
  confirmBeforeSaving: (() => Promise<boolean>) | null = null
): Promise<void> {
  if (managedShutdownStarted) {
    throw new Error('Managed review changes are unavailable right now.')
  }
  try {
    await pauseManagedMutations()
    if (confirmBeforeSaving && !await confirmBeforeSaving()) return
    if (reviewId) {
      const artifact = await requireReviewStore().load(reviewId)
      if (artifact.review.status === 'editing') {
        const tree = await requestRendererSnapshot(reviewId, 'shutdown')
        if (tree) await requireManagedAutosave().saveNow(reviewId, tree)
      }
    } else {
      await captureEditableManagedReviews()
    }
    managedAttachmentSavesBlocked = true
    await managedAttachmentMutations.wait()
    await requireManagedAutosave().flushAll()
    await operation()
  } finally {
    resumeManagedMutationsUnlessShuttingDown()
  }
}

async function confirmReviewTrash(
  reviewId: string
): Promise<ReviewDeletionPolicy | null> {
  const artifact = await requireReviewStore().load(reviewId)
  const policy = reviewDeletionPolicy(artifact.review.status)
  const pendingAgent = policy === 'pending-agent'
  const options = {
    type: 'warning' as const,
    buttons: ['Move to Trash', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: [
      pendingAgent
        ? 'Move this review to Trash while it is with the agent?'
        : 'Move this review to Trash?',
      '',
      'Your original Markdown document will not be changed or deleted.'
    ].join('\n'),
    detail: [
      pendingAgent
        ? 'The agent may still be using this review. Its next read or update will fail.'
        : 'This removes the review from Markover.',
      '',
      `The entire ${reviewId} review directory, including its feedback and review attachments, will move to the macOS Trash. Existing review links will no longer open the review.`
    ].join('\n')
  }
  const window = mainWindow
  const result = window && !window.isDestroyed()
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response === 0 ? policy : null
}

async function moveReviewToTrash(reviewId: string): Promise<void> {
  const confirmedPolicy = await confirmReviewTrash(reviewId)
  if (!confirmedPolicy) return
  await withManagedMutationsPaused(async () => {
    await requireReviewStore().trashReview(
      reviewId,
      (target) => shell.trashItem(target)
    )
    internalAttachments.removeReview(reviewId)
    if (activeManagedReviewId === reviewId) {
      activeManagedReviewId = null
      activeManagedReview = null
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      sendMainEvent(mainWindow.webContents, 'review:trashed', { reviewId })
    }
    installApplicationMenu()
  }, reviewId, async () => {
    const artifact = await requireReviewStore().load(reviewId)
    const currentPolicy = reviewDeletionPolicy(artifact.review.status)
    if (currentPolicy === confirmedPolicy) return true
    return await confirmReviewTrash(reviewId) !== null
  })
}

async function confirmUnusedAttachmentCleanup(
  scan: UnusedAttachmentScan
): Promise<boolean> {
  const skipped = new Set(scan.warnings.map((warning) => warning.reviewId)).size
  if (!scan.candidates.length) {
    const detail = skipped
      ? `No unused attachments were found. ${String(skipped)} review(s) could not be inspected and were left untouched.`
      : 'No unused attachments were found.'
    const options = {
      type: 'info' as const,
      buttons: ['OK'],
      message: 'Review attachments are already clean.',
      detail
    }
    const window = mainWindow
    if (window && !window.isDestroyed()) await dialog.showMessageBox(window, options)
    else await dialog.showMessageBox(options)
    return false
  }
  const detail = [
    `${String(scan.candidates.length)} unreferenced attachment file(s), ${formatByteCount(scan.totalBytes)}, will move to the macOS Trash.`,
    skipped
      ? `${String(skipped)} invalid or unreadable review(s) could not be inspected and will be left untouched.`
      : null
  ].filter((line): line is string => line !== null).join('\n\n')
  const options = {
    type: 'warning' as const,
    buttons: ['Move Attachments to Trash', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: 'Clean up unused review attachments?',
    detail
  }
  const window = mainWindow
  const result = window && !window.isDestroyed()
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response === 0
}

async function cleanUpUnusedAttachments(): Promise<void> {
  await withManagedMutationsPaused(async () => {
    const scan = await requireReviewStore().scanUnusedAttachments()
    if (!await confirmUnusedAttachmentCleanup(scan)) return
    await requireReviewStore().trashUnusedAttachments(
      scan,
      (target) => shell.trashItem(target)
    )
  })
}

async function removeManagedAttachment(
  request: AttachmentRemoveRequest
): Promise<AttachmentRemoveResult> {
  if (managedAttachmentSavesBlocked) {
    throw new Error('Markover is finishing review saves before another change.')
  }
  const confirmRemoval = settingsStore?.settings.confirmAttachmentRemoval ??
    DEFAULT_SETTINGS.confirmAttachmentRemoval
  if (confirmRemoval) {
    const options = {
      type: 'warning' as const,
      buttons: ['Remove Attachment', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: `Remove ${request.attachmentId} from this review?`,
      detail: 'The updated review will be saved first, then the attachment file will move to the macOS Trash.'
    }
    const window = mainWindow
    const result = window && !window.isDestroyed()
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    if (result.response !== 0) {
      return {
        reviewId: request.reviewId,
        attachmentId: request.attachmentId,
        outcome: 'cancelled'
      }
    }
  }

  await requireManagedAutosave().flush(request.reviewId)
  const artifact = await requireReviewStore().removeAttachment(
    request.reviewId,
    request.attachmentId,
    request.tree,
    (target) => shell.trashItem(target)
  )
  internalAttachments.remove(request.reviewId, request.attachmentId)
  if (activeManagedReviewId === request.reviewId) activeManagedReview = artifact
  return {
    reviewId: request.reviewId,
    attachmentId: request.attachmentId,
    outcome: 'trashed'
  }
}

async function openReviewContextMenu(
  event: IpcMainInvokeEvent,
  request: ReviewContextMenuRequest
): Promise<ReviewContextMenuResult> {
  await requireReviewStore().load(request.reviewId)
  let copyOperation: Promise<ReviewContextMenuResult> | null = null
  const menu = Menu.buildFromTemplate([
    {
      label: 'Copy Review Link',
      click: () => {
        copyOperation = copyCanonicalReviewLink(request.reviewId, {
          writeText: (text) => { clipboard.writeText(text) },
          chooseAfterFailure: async (failure) => {
            const options = {
              type: 'error' as const,
              buttons: ['Try Again', 'Cancel'],
              defaultId: 0,
              cancelId: 1,
              noLink: true,
              message: 'Markover could not copy the review link.',
              detail: `${failure.message}\n\n${failure.url}`
            }
            const window = BrowserWindow.fromWebContents(event.sender)
            const result = window && !window.isDestroyed()
              ? await dialog.showMessageBox(window, options)
              : await dialog.showMessageBox(options)
            return result.response === 0 ? 'retry' : 'cancel'
          }
        }).then((outcome) => ({
          outcome: outcome === 'copied' ? 'copied' : 'copy-cancelled'
        }))
      }
    },
    { type: 'separator' },
    {
      label: 'Move Review to Trash…',
      click: () => {
        void moveReviewToTrash(request.reviewId).catch(showReviewOperationError)
      }
    }
  ])
  const window = BrowserWindow.fromWebContents(event.sender)
  return await new Promise((resolve, reject) => {
    menu.popup({
      ...(window ? { window } : {}),
      x: request.x,
      y: request.y,
      callback: () => {
        if (!copyOperation) {
          resolve({ outcome: 'dismissed' })
          return
        }
        copyOperation.then(resolve, reject)
      }
    })
  })
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

async function saveAttachment(
  attachment: MarkoverClipboardImage,
  reviewId: string
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

  const saved = await reviewStore.saveAttachmentFile(reviewId, extension, buffer)
  internalAttachments.register(reviewId, saved.id, saved.path)

  const size = image.getSize()
  return {
    id: saved.id,
    type: 'image',
    mimeType: attachment.mimeType,
    path: saved.path,
    checksum: bufferChecksum(buffer),
    width: size.width,
    height: size.height,
    label: ''
  }
}

async function openMarkdown(): Promise<MarkoverDocument | null> {
  pendingLocalReviewCandidate = null
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
  const candidate = {
    name: path.basename(filePath),
    path: filePath,
    source,
    checksum: checksum(source)
  }
  pendingLocalReviewCandidate = candidate
  return candidate
}

async function createManagedLocalReview(
  tree: ReviewTree
): Promise<MarkoverDocument> {
  const candidate = pendingLocalReviewCandidate
  pendingLocalReviewCandidate = null
  if (!candidate) {
    throw new Error('Choose a Markdown file before creating a local review.')
  }
  if (!settingsStore) throw new Error('Settings are unavailable.')
  const artifact = await persistLocalReview(candidate, tree, reviewStore, {
    interpretationPolicy: settingsStore.settings.agentInterpretationPolicy
  })
  return managedDocument(artifact, await projectRootForReview(artifact))
}

function createWindow(
  { show = !backgroundServerMode }: { show?: boolean } = {}
): BrowserWindow {
  const showWithoutActivating = show && developmentWatchMode
  const startupSettings = settingsEnvelope(
    settingsStore?.settings || DEFAULT_SETTINGS
  )
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show: show && !showWithoutActivating,
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
      ...hardenedRendererWebPreferences
    }
  })
  mainWindow = window
  window.webContents.setZoomFactor(startupSettings.zoomPercent / 100)
  mainWindowBlurredAt = window.isFocused()
    ? null
    : mainWindowBlurredAt ?? Date.now()
  rendererReadyWebContentsId = null
  rendererReadyPromise = new Promise<void>((resolve) => {
    resolveRendererReady = resolve
  })

  const query = {
    palette: startupSettings.palette,
    appearance: startupSettings.resolvedAppearance,
    colorization: darkColorization(startupSettings.palette),
    instanceBadge: addressedInstance.branding.headerBadge || ''
  }
  rendererIpcEntry = { url: MARKOVER_RENDERER_ENTRY_URL, query }
  installRendererSecurityBoundaries(window.webContents)
  void window.loadURL(internalRendererEntryUrl(query))
  window.webContents.on('did-finish-load', () => {
    window.webContents.setZoomFactor(
      (settingsStore?.settings.zoomPercent ?? DEFAULT_SETTINGS.zoomPercent) / 100
    )
    mainWindow?.setTitle(`${addressedInstance.branding.appName} Inbox`)
  })
  const publishWindowFocusState = (): void => {
    if (mainWindow !== window || window.isDestroyed()) return
    sendMainEvent(
      window.webContents,
      'window:focus-state',
      currentWindowFocusState()
    )
  }
  window.on('focus', () => {
    mainWindowBlurredAt = null
    publishWindowFocusState()
  })
  window.on('blur', () => {
    mainWindowBlurredAt = Date.now()
    publishWindowFocusState()
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    markRendererStartupFailed()
    void (async () => {
      await failStartupBestEffort(
        'renderer-load',
        new Error(`Preload failed (${path.basename(preloadPath)}): ${error.message}`)
      )
      await showStartupFailureDialog()
    })()
  })
  window.webContents.on('did-fail-load', (
    _event,
    errorCode,
    errorDescription,
    _validatedUrl,
    isMainFrame
  ) => {
    if (!isMainFrame || errorCode === -3) return
    markRendererStartupFailed()
    void (async () => {
      await failStartupBestEffort(
        'renderer-load',
        new Error(`Renderer load failed (${String(errorCode)}): ${errorDescription}`)
      )
      await showStartupFailureDialog()
    })()
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    const failedDuringStartup = !startupReady
    markRendererStartupFailed()
    void (async () => {
      await failStartupBestEffort(
        failedDuringStartup ? 'renderer-load' : 'renderer-terminated',
        new Error(`Renderer process terminated: ${details.reason}.`),
        !failedDuringStartup
      )
      if (failedDuringStartup) await showStartupFailureDialog()
    })()
  })
  window.on('unresponsive', () => {
    if (startupReady) return
    markRendererStartupFailed()
    void (async () => {
      await failStartupBestEffort(
        'renderer-load',
        new Error('Renderer became unresponsive during startup.')
      )
      await showStartupFailureDialog()
    })()
  })
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindowBlurredAt = Date.now()
      mainWindow = null
      rendererIpcEntry = null
    }
  })

  if (showWithoutActivating) window.showInactive()

  return window
}

function currentWindowFocusState(): MarkoverWindowFocusState {
  const focused = mainWindow?.isFocused() === true
  return {
    focused,
    blurredAt: focused ? null : mainWindowBlurredAt
  }
}

function managedDocument(
  artifact: ReviewArtifact,
  projectRoot: string | null = null
): MarkoverDocument {
  internalAttachments.replaceReview(artifact.review.id, artifact)
  return {
    reviewId: artifact.review.id,
    name: artifact.sourceDocument.name,
    path: artifact.sourceDocument.path,
    source: artifact.sourceDocument.content,
    checksum: artifact.sourceDocument.checksum,
    projectRoot,
    tree: artifact
  }
}

function projectRootForReview(
  artifact: ReviewArtifact
): Promise<string | null> {
  const reviewId = artifact.review.id
  if (!reviewProjectRoots.has(reviewId)) {
    reviewProjectRoots.set(
      reviewId,
      discoverVerifiedReviewProjectRoot(artifact)
    )
  }
  return reviewProjectRoots.get(reviewId) as Promise<string | null>
}

async function projectFavicon(reviewId: string): Promise<string | null> {
  const artifact = await requireReviewStore().load(reviewId)
  const root = await projectRootForReview(artifact)
  if (!root) return null
  const resolvedRoot = path.resolve(root)
  if (!projectFavicons.has(resolvedRoot)) {
    projectFavicons.set(
      resolvedRoot,
      discoverProjectFavicon(resolvedRoot).catch((error: unknown) => {
        projectFavicons.delete(resolvedRoot)
        throw error
      })
    )
  }
  return await projectFavicons.get(resolvedRoot) as string | null
}

async function openReviewPullRequest(reviewId: string): Promise<void> {
  const artifact = await requireReviewStore().load(reviewId)
  const identity = reviewPullRequestIdentity(
    artifact.review.pullRequest,
    artifact.review.git
  )
  if (!identity) {
    throw new Error(`Review ${reviewId} has no valid GitHub pull request.`)
  }
  await shell.openExternal(identity.url)
}

async function managedDocuments(
  artifacts: ReviewArtifact[]
): Promise<MarkoverDocument[]> {
  return Promise.all(artifacts.map(async (artifact) => {
    return managedDocument(artifact, await projectRootForReview(artifact))
  }))
}

function flushPendingManagedReviewNotifications(): void {
  const window = mainWindow
  if (
    !window ||
    window.isDestroyed() ||
    rendererReadyWebContentsId !== window.webContents.id
  ) {
    return
  }
  for (const [reviewId, document] of pendingManagedReviewNotifications) {
    try {
      sendMainEvent(
        window.webContents,
        'review:opened',
        document
      )
      pendingManagedReviewNotifications.delete(reviewId)
    } catch (error) {
      process.stderr.write(
        `markover review notification ${reviewId}: ${errorMessage(error)}\n`
      )
      return
    }
  }
}

function sendManagedReview(artifact: ReviewArtifact): void {
  void projectRootForReview(artifact).then(async (projectRoot) => {
    const latestArtifact = await requireReviewStore().load(artifact.review.id)
    pendingManagedReviewNotifications.set(
      artifact.review.id,
      managedDocument(latestArtifact, projectRoot)
    )
    installApplicationMenu()
    if (!mainWindow) createWindow({ show: false })
    if (!mainWindow) throw new Error('Markover window could not be created.')
    flushPendingManagedReviewNotifications()
  }).catch((error: unknown) => {
    process.stderr.write(
      `markover review notification ${artifact.review.id}: ${errorMessage(error)}\n`
    )
  })
}

async function sendManagedUpdate(artifact: ReviewArtifact): Promise<void> {
  if (activeManagedReviewId === artifact.review.id) {
    activeManagedReview = artifact
  }
  if (!mainWindow || mainWindow.isDestroyed()) return
  sendMainEvent(
    mainWindow.webContents,
    'review:updated',
    managedDocument(artifact, await projectRootForReview(artifact))
  )
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
    sendMainEvent(window.webContents, 'review:status', {
      requestId,
      reviewId: artifact.review.id,
      status: artifact.review.status
    })
  })
}

function sendManagedAutosaveStatus(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  sendMainEvent(
    mainWindow.webContents,
    'review:autosave-status',
    currentManagedAutosaveStatus()
  )
}

function currentManagedAutosaveStatus(): ReviewAutosaveStatus {
  return {
    failedReviewIds: managedAutosave?.failedReviewIds() || []
  }
}

function setManagedRendererPause(paused: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  sendMainEvent(mainWindow.webContents, 'review:shutdown-state', paused)
}

function focusMainWindow(): void {
  if (!mainWindow) createWindow()
  const window = mainWindow
  if (!window) throw new Error('Markover window could not be created.')
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function markRendererReady(webContentsId: number): void {
  rendererReadyWebContentsId = webContentsId
  resolveRendererReady?.()
  resolveRendererReady = null
  flushPendingManagedReviewNotifications()
}

async function waitForRendererReady(window: BrowserWindow): Promise<void> {
  if (rendererReadyWebContentsId === window.webContents.id) return
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(Object.assign(
        new Error('Markover renderer is not ready for review activation.'),
        { code: 'ACTIVATION_NOT_READY' }
      ))
    }, 5000)
    void rendererReadyPromise.then(() => {
      clearTimeout(timeout)
      resolve()
    })
  })
  if (rendererReadyWebContentsId !== window.webContents.id) {
    throw Object.assign(
      new Error('Markover renderer changed before review activation.'),
      { code: 'ACTIVATION_NOT_READY' }
    )
  }
}

async function requestRendererActivation(
  reviewId: string,
  document: MarkoverDocument | null,
  focusState: MarkoverWindowFocusState
): Promise<ReviewActivationOutcome> {
  if (!mainWindow || mainWindow.isDestroyed() || !startupReady) {
    return Promise.reject(Object.assign(
      new Error('Markover renderer is not ready for review activation.'),
      { code: 'ACTIVATION_NOT_READY' }
    ))
  }

  const window = mainWindow
  await waitForRendererReady(window)
  activationSequence += 1
  const requestId = `activation-${String(activationSequence)}`
  return new Promise<ReviewActivationOutcome>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingActivations.delete(requestId)
      reject(Object.assign(
        new Error(`Timed out activating review ${reviewId}.`),
        { code: 'ACTIVATION_TIMEOUT' }
      ))
    }, 5000)
    pendingActivations.set(requestId, { reject, resolve, reviewId, timeout })
    sendMainEvent(window.webContents, 'review:activation-request', {
      requestId,
      reviewId,
      document,
      focusState
    } satisfies ReviewActivationRequest)
  })
}

async function activateManagedReview(
  reviewId: string,
  focusState = currentWindowFocusState()
): Promise<ReviewActivationResult> {
  const store = requireReviewStore()
  let artifact: ReviewArtifact | null = null
  try {
    artifact = await store.load(reviewId)
  } catch (error) {
    if (errorProperty(error, 'code') !== 'NOT_FOUND') throw error
  }

  focusMainWindow()
  const outcome = await requestRendererActivation(
    reviewId,
    artifact
      ? managedDocument(artifact, await projectRootForReview(artifact))
      : null,
    focusState
  )
  if (artifact && (outcome === 'activated' || outcome === 'already-active')) {
    activeManagedReview = artifact
    activeManagedReviewId = reviewId
    installApplicationMenu()
  }
  if (
    (artifact === null && outcome !== 'missing') ||
    (artifact !== null && outcome === 'missing')
  ) {
    throw new Error(`Renderer returned an invalid activation outcome for ${reviewId}.`)
  }
  return { reviewId, outcome }
}

function requestRendererSnapshot(
  reviewId: string,
  purpose: ReviewSnapshotRequest['purpose']
): Promise<ReviewTree | null> {
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
    pendingSnapshots.set(requestId, {
      purpose,
      reject,
      resolve,
      reviewId,
      timeout
    })
    sendMainEvent(window.webContents, 'review:snapshot-request', {
      requestId,
      reviewId,
      purpose
    } satisfies ReviewSnapshotRequest)
  })
}

function requireReviewStore(): ReviewStore {
  return reviewStore
}

function requireManagedAutosave(): ReviewAutosave {
  if (!managedAutosave) throw new Error('Managed autosave is unavailable.')
  return managedAutosave
}

function requireWorkspaceStore(): WorkspaceStore {
  if (!workspaceStore) throw new Error('Workspace state is unavailable.')
  return workspaceStore
}

async function flushManagedReview(
  reviewId: string,
  action: 'handoff' | 'edit' | 'done'
): Promise<() => Promise<void>> {
  const store = requireReviewStore()
  try {
    const tree = await requestRendererSnapshot(reviewId, 'handoff')
    if (tree && action !== 'edit') {
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

async function captureEditableManagedReviews(): Promise<void> {
  const reviewIds = (await requireReviewStore().list())
    .filter((artifact) => artifact.review.status === 'editing')
    .map((artifact) => artifact.review.id)
  await persistReviewSnapshots(
    reviewIds,
    (reviewId) => requestRendererSnapshot(reviewId, 'shutdown'),
    (reviewId, tree) => requireManagedAutosave().saveNow(reviewId, tree)
  )
}

async function startAndPublishService(): Promise<void> {
  if (smokeMode) return
  const managedStore = requireReviewStore()
  const store = settingsStore
  if (!store) throw new Error('Settings are unavailable for service startup.')
  const identity = createServiceIdentity()
  const startedService = await startLocalService({
    identity,
    store: managedStore,
    interpretationPolicy: () => store.settings.agentInterpretationPolicy,
    beforeAction: flushManagedReview,
    onActivate: activateManagedReview,
    onQuit() {
      app.quit()
    },
    async onChange(artifact, action) {
      if (action === 'created') {
        try {
          sendManagedReview(artifact)
        } catch (error) {
          process.stderr.write(
            `markover review notification ${artifact.review.id}: ${errorMessage(error)}\n`
          )
        }
        return
      }
      if (action === 'observed') {
        await sendManagedUpdate(artifact)
        return
      }
      await sendManagedStatus(artifact)
      await sendManagedUpdate(artifact)
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
  if (!service) return
  closingPublishedService = service
  await service.close()
  if (closingPublishedService === service) {
    closingPublishedService = null
  }
  if (localService === service) {
    localService = null
    localServiceIdentity = null
  }
}

async function restorePublishedServiceForEditing(): Promise<void> {
  if (
    closingPublishedService &&
    localService === closingPublishedService
  ) {
    localService = null
    localServiceIdentity = null
  }
  await serviceRepairQueue.catch(() => {})
  if (!localService) await startAndPublishService()
}

function resumeManagedMutations(): void {
  managedAttachmentSavesBlocked = false
  managedLocalReviewCreationsBlocked = false
  localService?.resumeMutations()
  setManagedRendererPause(false)
}

async function pauseManagedMutations(): Promise<void> {
  setManagedRendererPause(true)
  managedLocalReviewCreationsBlocked = true
  await localService?.pauseMutations()
  await managedLocalReviewCreations.wait()
}

async function runManagedDurabilityShutdown(): Promise<void> {
  await runDurabilityShutdown({
    pauseMutations: pauseManagedMutations,
    captureSnapshots: captureEditableManagedReviews,
    blockNewAttachments() {
      managedAttachmentSavesBlocked = true
      return Promise.resolve()
    },
    waitForAttachments: () => managedAttachmentMutations.wait(),
    flushAutosaves: async () => {
      await requireManagedAutosave().flushAll()
      await requireWorkspaceStore().flush()
    },
    closeService: stopPublishedService,
    resumeMutations: resumeManagedMutations
  })
}

function stopSettingsSubscription(): void {
  settingsUnsubscribe?.()
  settingsUnsubscribe = null
}

async function showDurabilityShutdownDialog(error: unknown): Promise<number> {
  const options = {
    type: 'warning' as const,
    buttons: ['Retry Quit', 'Cancel Quit', 'Quit Anyway'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: 'Markover could not finish saving review work.',
    detail: [
      errorMessage(error),
      '',
      'Retry waits for storage again. Cancel Quit returns to editing. ' +
        'Quit Anyway uses the latest completed autosave.'
    ].join('\n')
  }
  const window = mainWindow
  const result = window && !window.isDestroyed()
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response
}

async function finishManagedShutdown(): Promise<void> {
  for (;;) {
    let failure: unknown
    try {
      await runManagedDurabilityShutdown()
      managedShutdownComplete = true
      stopSettingsSubscription()
      app.quit()
      return
    } catch (error) {
      failure = error
    }

    for (;;) {
      process.stderr.write(`markover shutdown: ${errorMessage(failure)}\n`)
      const response = await showDurabilityShutdownDialog(failure)
      if (response === 2) {
        stopSettingsSubscription()
        app.exit(0)
        return
      }
      if (response === 1) {
        try {
          await restorePublishedServiceForEditing()
          managedShutdownStarted = false
          return
        } catch (error) {
          failure = error
          continue
        }
      }
      break
    }
  }
}

async function copyStartupDiagnostic(): Promise<void> {
  clipboard.writeText(await fs.readFile(startupDiagnosticPath, 'utf8'))
}

async function showStartupFailureDialog(): Promise<void> {
  if (startupFailureDialogShown) return
  startupFailureDialogShown = true
  let diagnosticUnavailable = false
  for (;;) {
    const diagnosticAvailable = !diagnosticUnavailable &&
      startupDiagnostic?.available === true &&
      await fs.access(startupDiagnosticPath).then(
        () => true,
        () => false
      )
    const { response } = await dialog.showMessageBox({
      type: 'error',
      buttons: diagnosticAvailable
        ? ['Copy details', 'Show diagnostic', 'Quit Markover']
        : ['Quit Markover'],
      cancelId: diagnosticAvailable ? 2 : 0,
      defaultId: diagnosticAvailable ? 2 : 0,
      noLink: true,
      message: 'Markover couldn’t start.',
      detail: diagnosticAvailable
        ? `A sanitized diagnostic is available at:\n${startupDiagnosticPath}`
        : 'The startup diagnostic could not be written. Details were sent to the terminal log.'
    })
    if (!diagnosticAvailable || response === 2) {
      app.quit()
      return
    }
    if (response === 0) {
      try {
        await copyStartupDiagnostic()
      } catch (error) {
        diagnosticUnavailable = true
        process.stderr.write(
          `markover diagnostic copy: ${errorMessage(error)}\n`
        )
      }
    } else shell.showItemInFolder(startupDiagnosticPath)
  }
}

function repairServiceRecords(): Promise<void> {
  const identity = localServiceIdentity
  const service = localService
  if (!identity || !service) return Promise.resolve()
  serviceRepairQueue = serviceRepairQueue.catch(() => {}).then(() => {
    if (localServiceIdentity !== identity || localService !== service) return
    return publishServiceConnection({
      endpointPath,
      identity,
      port: service.port
    })
  })
  return serviceRepairQueue
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
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

  app.whenReady().then(async () => {
    protocol.handle(MARKOVER_INTERNAL_SCHEME, async (request) => {
      const resolved = await resolveInternalRequestFile(
        request.url,
        projectDirectory,
        internalAttachments
      )
      if (!resolved.ok) {
        return new Response('Not found.', {
          status: resolved.status,
          headers: {
            'cache-control': 'no-store',
            'content-type': 'text/plain; charset=utf-8'
          }
        })
      }
      return net.fetch(pathToFileURL(resolved.filePath).href)
    })
    const provisionalBuild = provisionalBuildIdentity()
    startupBuildIdentity = provisionalBuild
    startupDiagnostic = new StartupDiagnostic({
      appDirectory: projectDirectory,
      build: provisionalBuild,
      filePath: startupDiagnosticPath
    })
    await startupDiagnostic.start()
    const build = await loadBuildIdentity()
    startupBuildIdentity = build
    await startupDiagnostic.setBuildIdentity(build)
    await configureAboutPanel(build)
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
    await beginMainStartupPhase('preparing-interface')
    await secureServiceDirectory(applicationDataDirectory)
    if (
      process.platform === 'darwin' &&
      app.isPackaged &&
      !smokeMode
    ) {
      await registerProtocolOnFirstLaunch({
        client: app,
        recordPath: path.join(
          applicationDataDirectory,
          'protocol-registration.json'
        ),
        scheme: CANONICAL_INSTANCE_SCHEME,
        suppressed: process.env[SUPPRESS_PROTOCOL_REGISTRATION_ENVIRONMENT] === '1'
      })
    }
    if (process.platform === 'darwin' && !app.isPackaged && !smokeMode) {
      if (!app.dock) {
        throw new Error('The macOS application dock is unavailable.')
      }
      app.dock.setIcon(appIconPath)
    }
    await startupDiagnostic.complete('preparing-interface')

    await beginMainStartupPhase('loading-settings')
    const instanceDefaults = addressedInstance.identity.kind === 'development' &&
      checkoutDirectory
      ? (await loadDevelopmentConfig(checkoutDirectory)).settings
      : DEFAULT_SETTINGS
    const store = new SettingsStore(
      path.join(app.getPath('userData'), 'settings.json'),
      instanceDefaults
    )
    settingsStore = store
    const initialSettings = await store.load()
    const privateWorkspaceStore = new WorkspaceStore(
      path.join(app.getPath('userData'), 'workspace.json')
    )
    workspaceStore = privateWorkspaceStore
    await privateWorkspaceStore.load()
    managedAutosave = new ReviewAutosave(requireReviewStore(), {
      maximumDelayMs: initialSettings.autosaveMaximumDelayMs,
      onFailure(reviewId, error) {
        process.stderr.write(
          `markover autosave ${reviewId}: ${errorMessage(error)}\n`
        )
        sendManagedAutosaveStatus()
      },
      onRecovered() {
        sendManagedAutosaveStatus()
      },
      onSaved(artifact) {
        internalAttachments.replaceReview(artifact.review.id, artifact)
        if (activeManagedReviewId === artifact.review.id) {
          activeManagedReview = artifact
        }
      }
    })
    nativeTheme.themeSource = initialSettings.appearance
    settingsUnsubscribe = await store.subscribe((settings) => {
      applyMainSettings(settings)
      installApplicationMenu()
    })
    if (store.lastRecoveryWarning) {
      await recordStartupWarnings([{
        category: 'settings-recovered',
        subject: 'settings.json'
      }])
    }
    if (privateWorkspaceStore.lastRecoveryWarning) {
      await recordStartupWarnings([{
        category: 'workspace-recovered',
        subject: 'workspace.json'
      }])
    }
    await startupDiagnostic.complete('loading-settings')
    installApplicationMenu()

    if (smokeMode) {
      const imagePath = path.join(
        projectDirectory,
        'design/brand/markover-mark.svg'
      )
      const artifact = await requireReviewStore().create({
        tree: smokeReviewTree(imagePath),
        contextSummary: 'Fixed renderer smoke fixture.'
      })
      const saved = await requireReviewStore().saveAttachmentFile(
        artifact.review.id,
        'svg',
        await fs.readFile(imagePath)
      )
      const attachment = artifact.root.children
        .flatMap((node) => node.attachments || [])
        .find((candidate) => candidate.id === saved.id)
      if (!attachment) throw new Error('Renderer smoke attachment is invalid.')
      attachment.path = saved.path
      await requireReviewStore().updateTree(artifact.review.id, artifact)
    }

    privilegedIpc.handle('startup:info', () => startupInfo)
    privilegedIpc.handle('startup:phase', async (
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
      if (startupReady) return
      if (phaseEvent.state === 'begin') {
        activeStartupPhase = phaseEvent.phase
        process.stderr.write(`markover startup: ${phaseEvent.phase}\n`)
        await requireStartupDiagnostic().begin(phaseEvent.phase)
      } else {
        await requireStartupDiagnostic().complete(phaseEvent.phase)
      }
    })
    privilegedIpc.handle('startup:renderer-initialized', async (
      event: IpcMainInvokeEvent,
      initialization: unknown
    ): Promise<StartupReady> => {
      if (
        !isRecord(initialization) ||
        !Array.isArray(initialization.warnings) ||
        !initialization.warnings.every(isStartupWarning)
      ) {
        throw new Error('Invalid renderer initialization.')
      }
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event.sender.id !== mainWindow.webContents.id
      ) {
        throw new Error('Renderer initialization came from an inactive window.')
      }
      if (startupReady) {
        markRendererReady(event.sender.id)
        return { warnings: [...startupWarnings] }
      }
      if (rendererInitializationHandled || rendererStartupFailed) {
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
        markRendererReady(event.sender.id)
        reviewUrlDispatcher.markReady()
        return { warnings: [...startupWarnings] }
      } catch (error) {
        await stopPublishedService()
        if (!rendererDidFailStartup()) {
          await failStartup('service-publication', error)
        }
        throw error
      }
    })
    privilegedIpc.handle('startup:failure', async (
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
      return {
        diagnosticAvailable: requireStartupDiagnostic().available
      }
    })
    privilegedIpc.handle('startup:copy-diagnostic', copyStartupDiagnostic)
    privilegedIpc.handle('startup:reveal-diagnostic', () => {
      shell.showItemInFolder(startupDiagnosticPath)
    })
    privilegedIpc.on('startup:quit', () => {
      app.quit()
    })
    privilegedIpc.handle('smoke:result', (
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
        diagnostics: result.diagnostics,
        checks: result.checks,
        phases: requireStartupDiagnostic().snapshot().phases
      }
      process.stdout.write(`${JSON.stringify(output)}\n`, () => {
        if (checksPassed) app.quit()
        else app.exit(1)
      })
    })
    privilegedIpc.handle('document:open', openMarkdown)
    privilegedIpc.handle('review:create-local', (
      _event: IpcMainInvokeEvent,
      tree: ReviewTree
    ) => {
      if (managedLocalReviewCreationsBlocked) {
        throw new Error('Markover is finishing review saves before quitting.')
      }
      return managedLocalReviewCreations.track(() => createManagedLocalReview(tree))
    })
    privilegedIpc.handle('brand:assets', loadBrandAssets)
    privilegedIpc.handle('document:checksum', (
      _event: IpcMainInvokeEvent,
      source: string
    ) => checksum(source))
    privilegedIpc.handle('attachment:save', (
      _event: IpcMainInvokeEvent,
      attachment: MarkoverClipboardImage,
      reviewId: string
    ) => {
      if (managedAttachmentSavesBlocked) {
        throw new Error('Markover is finishing review saves before quitting.')
      }
      return managedAttachmentMutations.track(() => (
        saveAttachment(attachment, reviewId)
      ))
    })
    privilegedIpc.handle('attachment:remove', (
      _event: IpcMainInvokeEvent,
      request: AttachmentRemoveRequest
    ) => managedAttachmentMutations.track(() => removeManagedAttachment(request)))
    privilegedIpc.handle('clipboard:read-image', readClipboardImage)
    privilegedIpc.handle(
      'review:autosave-status:get',
      currentManagedAutosaveStatus
    )
    privilegedIpc.handle('settings:get', () => settingsEnvelope(store.settings))
    privilegedIpc.handle('settings:update', async (
      _event: IpcMainInvokeEvent,
      patch: unknown
    ) => {
      const settings = await store.update(patch)
      const envelope = applyMainSettings(settings)
      installApplicationMenu()
      return envelope
    })
    privilegedIpc.handle('workspace:get', () => privateWorkspaceStore.state)
    privilegedIpc.handle('workspace:update', (
      _event: IpcMainInvokeEvent,
      state: MarkoverWorkspaceState
    ) => privateWorkspaceStore.replace(state))
    privilegedIpc.handle('window:focus-state:get', currentWindowFocusState)
    privilegedIpc.handle('review:initial-document', async () => (
      activeManagedReview && managedDocument(
        activeManagedReview,
        await projectRootForReview(activeManagedReview)
      )
    ))
    privilegedIpc.handle('review:list', async () => {
      try {
        const result = await requireReviewStore().listWithWarnings()
        if (result.warnings.length) {
          await recordStartupWarnings(result.warnings.map((warning) => ({
            category: 'review-skipped',
            subject: warning.detail
              ? `${warning.reviewId} (${warning.reason}): ${warning.detail}`
              : `${warning.reviewId} (${warning.reason})`
          })))
        }
        return [
          ...await managedDocuments(result.reviews),
          ...result.incompatible.map((review) => ({
            kind: 'incompatible-review' as const,
            ...review
          }))
        ]
      } catch (error) {
        await failStartup('review-storage-access', error)
        throw error
      }
    })
    privilegedIpc.handle('review:project-favicon:get', (
      _event: IpcMainInvokeEvent,
      reviewId: string
    ) => projectFavicon(reviewId))
    privilegedIpc.handle('review:pull-request:open', (
      _event: IpcMainInvokeEvent,
      reviewId: string
    ) => openReviewPullRequest(reviewId))
    privilegedIpc.handle('review:context-menu:open', (
      event: IpcMainInvokeEvent,
      request: ReviewContextMenuRequest
    ) => openReviewContextMenu(event, request))
    privilegedIpc.on('review:snapshot-response', (
      _event: IpcMainEvent,
      response: ReviewSnapshotResponse
    ) => {
      const pending = pendingSnapshots.get(response.requestId)
      if (
        !pending ||
        pending.reviewId !== response.reviewId ||
        pending.purpose !== response.purpose
      ) return
      clearTimeout(pending.timeout)
      pendingSnapshots.delete(response.requestId)
      if (response.error) pending.reject(new Error(response.error))
      else pending.resolve(response.tree ?? null)
    })
    privilegedIpc.on('review:status-response', (
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
    privilegedIpc.on('review:activation-response', (
      _event: IpcMainEvent,
      response: ReviewActivationResponse
    ) => {
      const pending = pendingActivations.get(response.requestId)
      if (!pending || pending.reviewId !== response.reviewId) return
      clearTimeout(pending.timeout)
      pendingActivations.delete(response.requestId)
      if (response.error) pending.reject(new Error(response.error))
      else if (isReviewActivationOutcome(response.outcome)) {
        pending.resolve(response.outcome)
      }
      else pending.reject(new Error('Renderer omitted the activation outcome.'))
    })
    privilegedIpc.on('clipboard:write', (_event: IpcMainEvent, text: string) => {
      clipboard.writeText(text)
    })
    privilegedIpc.on('review:activate', (
      _event: IpcMainEvent,
      reviewId: string
    ) => {
      const managedStore = requireReviewStore()
      activeManagedReviewId = reviewId
      managedStore.load(reviewId).then((artifact) => {
        if (activeManagedReviewId === reviewId) {
          activeManagedReview = artifact
          installApplicationMenu()
        }
      }).catch((error: unknown) => {
        process.stderr.write(`markover activate: ${errorMessage(error)}\n`)
      })
    })
    privilegedIpc.on('review:autosave', (
      _event: IpcMainEvent,
      reviewId: string,
      tree: ReviewTree
    ) => {
      requireManagedAutosave().queue(reviewId, tree)
    })

    createWindow()

    nativeTheme.on('updated', () => {
      const envelope = settingsEnvelope(store.settings)
      mainWindow?.setBackgroundColor(
        windowBackground(store.settings, envelope.resolvedAppearance)
      )
      if (mainWindow) {
        sendMainEvent(mainWindow.webContents, 'settings:changed', envelope)
      }
    })

    app.on('activate', () => {
      if (smokeMode) return
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
        await failStartupBestEffort(mainStartupFailureCategory(), error)
      }
      await showStartupFailureDialog()
    })()
  })

  app.on('before-quit', (event) => {
    if (
      !startupReady ||
      managedShutdownComplete ||
      !managedAutosave
    ) {
      stopSettingsSubscription()
      if (localService) void stopPublishedService().catch(() => {
        // Startup failure shutdown is already in progress.
      })
      return
    }

    event.preventDefault()
    if (managedShutdownStarted) return
    managedShutdownStarted = true
    void finishManagedShutdown()
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
    if (smokeMode) {
      app.quit()
      return
    }
    if (process.platform !== 'darwin') app.quit()
  })
}

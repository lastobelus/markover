import MarkdownIt from 'markdown-it'

import type { DiffRenderer, SyntaxHighlightToken } from './contracts'
import type {
  StartupInfo,
  StartupPhase,
  StartupWarning
} from './startup-contract'
import type { IncomingReviewPrompt } from './incoming-review-policy'
import { userFacingStartupWarnings } from './startup-contract'
import * as MarkoverAgentGuidance from './agent-guidance'
import * as MarkoverAnnotationBlock from './annotation-block'
import * as MarkoverAnnotations from './annotations'
import { autosaveFailureMessage } from './durability-status'
import {
  installDevelopmentElementCallouts,
  type DevelopmentElementCallouts
} from './development-element'
import {
  appendIncomingReview,
  incomingReviewAction,
  removeIncomingReview,
  retainIncomingReviewsAfter
} from './incoming-review-policy'
import * as MarkoverImagePreview from './image-preview'
import { internalAttachmentUrl } from './internal-url'
import {
  markoverIcon,
  replaceMarkoverIcon,
  type MarkoverIconName
} from './lucide-icons'
import * as MarkoverNavigation from './navigation'
import {
  isReviewContextMenuKey,
  keyboardContextMenuPoint,
  pointerContextMenuPoint,
  reviewContextMenuFocusKey,
  type ReviewContextMenuSurface
} from './review-context-menu'
import {
  providerIcon,
  threadHostIcon,
  type ReviewRegistryIcon
} from './review-icon-registry'
import {
  projectReviewInbox,
  reviewMatchesFilter,
  reviewMetadataInventory,
  reviewResolutionLabel,
  reviewStatusLabel,
  type ReviewMetadataField,
  type ReviewInboxFilter,
  type ReviewInboxProject,
  type ReviewInboxRow,
  type ReviewInboxThread
} from './review-inbox'
import * as MarkoverReviewSessions from './review-sessions'
import * as MarkoverSettings from './settings'
import * as MarkoverSourceEdits from './source-edits'
import * as MarkoverTree from './tree'
import {
  defaultWorkspaceState,
  reconcileWorkspaceState
} from './workspace-state'

interface RendererState {
  attachmentPreviewUrls: Map<string, string>
  documentName: string
  documentPath: string | null
  finishAttachmentLabelEdit: ((commit?: boolean) => void) | null
  hoveredId: string | null
  reviewId: string | null
  selectedId: string | null
  annotatedOnly: boolean
  annotationView: 'selected' | 'list'
  sourceCollapsed: boolean
  collapsedBlockIds: Set<string>
  sourceDrafts: Map<string, string>
  sourceEditingId: string | null
  tree: ReviewTree | null
}

function requiredElement<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Required element not found: ${selector}`)
  return element
}

function currentTree(): ReviewTree {
  if (!state.tree) throw new Error('No document is active.')
  return state.tree
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isReviewStatus(value: unknown): value is ReviewSessionStatus {
  return value === 'editing' ||
    value === 'pending-agent' ||
    value === 'agent-reviewing' ||
    value === 'reviewed' ||
    value === 'revised' ||
    value === 'done' ||
    value === 'handoff-in-progress'
}

function isReviewSessionTree(tree: ReviewTree): tree is ReviewSessionTree {
  const review = tree.review
  return isRecord(review) &&
    typeof review.id === 'string' &&
    isReviewStatus(review.status)
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string
): string | null {
  const value = metadata[key]
  return typeof value === 'string' ? value : null
}

const elements = {
  appShell: requiredElement('#app-shell'),
  appHeader: requiredElement('#app-header'),
  annotationCount: requiredElement('#annotation-count'),
  annotationGuidance: requiredElement('#annotation-guidance'),
  annotationInput: requiredElement<HTMLTextAreaElement>('#annotation-input'),
  annotationList: requiredElement('#annotation-list'),
  annotationListView: requiredElement('#annotation-list-view'),
  rightPane: requiredElement('#right-pane'),
  rightPaneResizer: requiredElement('#right-pane-resizer'),
  annotationReadonly: requiredElement('#annotation-readonly'),
  annotationSneakPeek: requiredElement('#annotation-sneak-peek'),
  annotationState: requiredElement('#annotation-state'),
  annotationViewList: requiredElement<HTMLButtonElement>('#annotation-view-list'),
  annotationViewSelected: requiredElement<HTMLButtonElement>('#annotation-view-selected'),
  attachmentList: requiredElement('#attachment-list'),
  brandLogotype: requiredElement<HTMLImageElement>('#brand-logotype'),
  brandMark: requiredElement<HTMLImageElement>('#brand-mark'),
  checksum: requiredElement('#document-checksum'),
  copyTreeButton: requiredElement<HTMLButtonElement>('#copy-tree-button'),
  emptyOpenButton: requiredElement<HTMLButtonElement>('#empty-open-button'),
  appEmptyState: requiredElement('#app-empty-state'),
  documentReviewId: requiredElement<HTMLButtonElement>('#document-review-id'),
  durabilityWarning: requiredElement('#durability-warning'),
  imagePreview: requiredElement<HTMLDialogElement>('#image-preview'),
  imagePreviewClose: requiredElement<HTMLButtonElement>('#image-preview-close'),
  imagePreviewContent: requiredElement<HTMLImageElement>('#image-preview-content'),
  imagePreviewLabel: requiredElement('#image-preview-label'),
  incomingReviewDialog: requiredElement<HTMLDialogElement>('#incoming-review-dialog'),
  incomingReviewDialogKeep: requiredElement<HTMLButtonElement>('#incoming-review-dialog-keep'),
  incomingReviewDialogMessage: requiredElement('#incoming-review-dialog-message'),
  incomingReviewDialogOpen: requiredElement<HTMLButtonElement>('#incoming-review-dialog-open'),
  incomingReviewNotice: requiredElement('#incoming-review-notice'),
  incomingReviewNoticeMessage: requiredElement('#incoming-review-notice-message'),
  incomingReviewNoticeOpen: requiredElement<HTMLButtonElement>('#incoming-review-notice-open'),
  keyboardHelp: requiredElement('.keyboard-help'),
  name: requiredElement('#document-name'),
  sourceState: requiredElement('#document-source-state'),
  openButton: requiredElement<HTMLButtonElement>('#open-button'),
  parseStatus: requiredElement('#parse-status'),
  pinnedSelection: requiredElement('#pinned-selection'),
  centerPane: requiredElement('#center-pane'),
  selectedLocation: requiredElement<HTMLButtonElement>('#selected-location'),
  selectedAnnotationView: requiredElement('#selected-annotation-view'),
  selectedSource: requiredElement('#selected-source'),
  selectedTitle: requiredElement('#selected-title'),
  scrollbarRowCover: requiredElement('#scrollbar-row-cover'),
  hoverScrollbarRowCover: requiredElement('#hover-scrollbar-row-cover'),
  sourceCancel: requiredElement<HTMLButtonElement>('#source-cancel'),
  sourceContent: requiredElement('#source-content'),
  sourceDiff: requiredElement('#source-diff'),
  sourceDiffStats: requiredElement('#source-diff-stats'),
  sourceEdit: requiredElement<HTMLButtonElement>('#source-edit'),
  sourceEditor: requiredElement<HTMLTextAreaElement>('#source-editor'),
  sourceErrorTooltip: requiredElement('#source-error-tooltip'),
  sourcePanel: requiredElement('.source-panel'),
  sourceRevert: requiredElement<HTMLButtonElement>('#source-revert'),
  sourceSave: requiredElement<HTMLButtonElement>('#source-save'),
  sourceSaveBar: requiredElement('#source-save-bar'),
  sourceToggle: requiredElement<HTMLButtonElement>('#source-toggle'),
  sourceToggleIcon: requiredElement('#source-toggle-icon'),
  statusAnnouncer: requiredElement('#status-announcer'),
  toast: requiredElement('#toast'),
  tree: requiredElement('#tree'),
  treeViewAll: requiredElement<HTMLButtonElement>('#tree-view-all'),
  treeViewAnnotated: requiredElement<HTMLButtonElement>('#tree-view-annotated'),
  reviewContextButton: requiredElement<HTMLButtonElement>('#review-context-button'),
  reviewContextClose: requiredElement<HTMLButtonElement>('#review-context-close'),
  reviewContextDrawer: requiredElement<HTMLDialogElement>('#review-context-drawer'),
  reviewContextFields: requiredElement('#review-context-fields'),
  reviewContextIssues: requiredElement('#review-context-issues'),
  reviewContextSummary: requiredElement('#review-context-summary'),
  reviewContextTitle: requiredElement('#review-context-title'),
  reviewHoverCard: requiredElement('#review-hover-card'),
  leftPaneCollapse: requiredElement<HTMLButtonElement>('#left-pane-collapse'),
  leftPaneOpen: requiredElement<HTMLButtonElement>('#left-pane-open'),
  leftPaneResizer: requiredElement('#left-pane-resizer'),
  leftPane: requiredElement('#left-pane'),
  documentsListTree: requiredElement('#documents-list-tree'),
  reviewInboxCount: requiredElement('#review-inbox-count'),
  reviewBatchAccept: requiredElement<HTMLButtonElement>('#review-batch-accept'),
  reviewBatchActions: requiredElement('#review-batch-actions'),
  reviewBatchClose: requiredElement<HTMLButtonElement>('#review-batch-close'),
  reviewBatchCount: requiredElement('#review-batch-count'),
  reviewBatchNoNotes: requiredElement<HTMLButtonElement>('#review-batch-no-notes'),
  reviewFilter: requiredElement<HTMLSelectElement>('#review-filter'),
  reviewIdActivation: requiredElement<HTMLFormElement>('#review-id-activation'),
  reviewIdInput: requiredElement<HTMLInputElement>('#review-id-input'),
  reviewListCount: requiredElement('#review-list-count'),
  reviewNavigationInbox: requiredElement<HTMLButtonElement>('#review-navigation-inbox'),
  reviewNavigationProjects: requiredElement<HTMLButtonElement>('#review-navigation-projects'),
  reviewResolutionCancel: requiredElement<HTMLButtonElement>('#review-resolution-cancel'),
  reviewResolutionConfirm: requiredElement<HTMLButtonElement>('#review-resolution-confirm'),
  reviewResolutionDialog: requiredElement<HTMLDialogElement>('#review-resolution-dialog'),
  reviewResolutionMessage: requiredElement('#review-resolution-message'),
  reviewResolutionSummaries: requiredElement('#review-resolution-summaries'),
  reviewResolutionTitle: requiredElement('#review-resolution-title'),
  reviewTabStrip: requiredElement('#review-tab-strip'),
  appEmptyStateLockup: requiredElement<HTMLImageElement>('#app-empty-state-lockup'),
  fixedContractClose: requiredElement<HTMLButtonElement>('#fixed-contract-close'),
  fixedContractDialog: requiredElement<HTMLDialogElement>('#fixed-contract-dialog'),
  fixedContractDone: requiredElement<HTMLButtonElement>('#fixed-contract-done'),
  fixedContractList: requiredElement<HTMLOListElement>('#fixed-contract-list'),
  fixedContractOpen: requiredElement<HTMLButtonElement>('#fixed-contract-open'),
  reviewStateBanner: requiredElement('#review-state-banner'),
  settingsClose: requiredElement<HTMLButtonElement>('#settings-close'),
  settingsDialog: requiredElement<HTMLDialogElement>('#settings-dialog'),
  settingsForm: requiredElement<HTMLFormElement>('#settings-form'),
  settingsReset: requiredElement<HTMLButtonElement>('#settings-reset'),
  codexThreadTitleStatus: requiredElement('#codex-thread-title-status'),
  codexThreadTitlesRefresh: requiredElement<HTMLButtonElement>('#codex-thread-titles-refresh'),
  claudeThreadTitleStatus: requiredElement('#claude-thread-title-status'),
  claudeThreadTitlesRefresh: requiredElement<HTMLButtonElement>('#claude-thread-titles-refresh'),
  t3ThreadTitleStatus: requiredElement('#t3-thread-title-status'),
  t3ThreadTitlesRefresh: requiredElement<HTMLButtonElement>('#t3-thread-titles-refresh'),
  paneLayout: requiredElement('#pane-layout')
}

replaceMarkoverIcon(elements.leftPaneCollapse, 'panel-left-close')
replaceMarkoverIcon(elements.leftPaneOpen, 'panel-left')

const state: RendererState = {
  attachmentPreviewUrls: new Map<string, string>(),
  documentName: 'sample.md',
  documentPath: null,
  finishAttachmentLabelEdit: null,
  hoveredId: null,
  reviewId: null,
  selectedId: null,
  annotatedOnly: false,
  annotationView: 'selected',
  sourceCollapsed: false,
  collapsedBlockIds: new Set<string>(),
  sourceDrafts: new Map<string, string>(),
  sourceEditingId: null,
  tree: null
}
const reviewSessions = new MarkoverReviewSessions.ReviewSessions()
const reviewMutations = new MarkoverReviewSessions.ReviewMutationTracker()
let incompatibleReviews: MarkoverIncompatibleReview[] = []
const INBOX_HISTORY_PAGE_SIZE = 10
let documentsListClockTimer: ReturnType<typeof setTimeout> | null = null
let reviewHoverTimer: ReturnType<typeof setTimeout> | null = null
let leftPaneCollapsed = false
let localOpenInProgress = false
let leftPaneWidth = 390
let rightPaneWidth: number | null = null
let reviewNavigationMode: 'inbox' | 'projects' = 'inbox'
let reviewFilter: ReviewInboxFilter = 'needs-me'
let batchResolutionMode = false
const selectedReviewIds = new Set<string>()
let inboxHistoryLimit = INBOX_HISTORY_PAGE_SIZE
const projectExpansion = new Map<string, boolean>()
const threadExpansion = new Map<string, boolean>()
const projectFaviconLoads = new Map<string, Promise<string | null>>()
let workspaceStateReady = false
let brandAssetSources: MarkoverBrandAssets | null = null
let brandAssetLoad: Promise<MarkoverBrandAssets | null> | null = null
let brandFallbackUsed = false
let sourceDiffCleanup: (() => void) | null = null
let sourceDiffModule: Promise<DiffRenderer> | null = null
let sourceDiffRenderer: DiffRenderer | null = null
let paneResizeLayoutFrame: number | null = null
let developmentElementCallouts: DevelopmentElementCallouts | null = null
let statusAnnouncementFrame: number | null = null
let imagePreviewReturnFocus: HTMLElement | null = null
let resolutionDialogCompletion: ((confirmed: boolean) => void) | null = null
let preferences = MarkoverSettings.normalizeSettings()
let resolvedAppearance: ResolvedAppearance = 'light'
let t3ThreadTitles: T3ThreadTitleSnapshot = {
  status: 'disabled',
  detail: 'T3 requesting-thread titles are disabled.',
  titles: []
}
let t3ThreadTitleRefresh: Promise<void> = Promise.resolve()
let codexThreadTitles: CodexThreadTitleSnapshot = {
  status: 'disabled',
  detail: 'Codex requesting-thread titles are disabled.',
  titles: []
}
let codexThreadTitleRefresh: Promise<void> = Promise.resolve()
let claudeThreadTitles: ClaudeThreadTitleSnapshot = {
  status: 'disabled',
  detail: 'Claude Code requesting-thread titles are disabled.',
  titles: []
}
let claudeThreadTitleRefresh: Promise<void> = Promise.resolve()
let requestingThreadTitleRefresh: Promise<void> = Promise.resolve()
let windowFocusState: MarkoverWindowFocusState = {
  focused: false,
  blurredAt: Date.now()
}
let windowFocusStateVersion = 0
let incomingReviewQueue: Promise<void> = Promise.resolve()
let incomingReviewSequence = 0
let incomingReviewNoticeCount = 0
let incomingReviewNoticeId: string | null = null
let incomingReviewNoticePrompts: IncomingReviewPrompt[] = []
let incomingReviewNoticeSequence: number | null = null

function reviewInboxProjection(
  sessions = reviewSessions.list(),
  filter: ReviewInboxFilter = reviewFilter,
  alwaysIncludeReviewId: string | null = state.reviewId
): ReturnType<typeof projectReviewInbox> {
  return projectReviewInbox(
    sessions,
    {
      codexThreadTitles: codexThreadTitles.titles,
      codexThreadTitleStatus: codexThreadTitles.status,
      claudeThreadTitles: claudeThreadTitles.titles,
      claudeThreadTitleStatus: claudeThreadTitles.status,
      t3ThreadTitles: t3ThreadTitles.titles,
      t3ThreadTitleStatus: t3ThreadTitles.status,
      titlePreference: preferences.inboxTitlePreference
    },
    filter,
    alwaysIncludeReviewId
  )
}

function threadExpansionKey(projectKey: string, threadKey: string): string {
  return JSON.stringify([projectKey, threadKey])
}

function reviewBlockIds(root: ReviewNode): string[] {
  const ids: string[] = []
  const visit = (node: ReviewNode): void => {
    for (const child of node.children) {
      ids.push(child.id)
      visit(child)
    }
  }
  visit(root)
  return ids
}

function workspaceReviewScopes(): Array<{
  reviewId: string
  projectKey: string
  threadKey: string
  blockIds: string[]
}> {
  const sessions = reviewSessions.list()
  const projection = reviewInboxProjection(sessions, 'all', null)
  const rows = [...projection.editing, ...projection.history]
  const rowById = new Map(rows.map((row) => [row.reviewId, row]))
  return sessions.map((session) => ({
    reviewId: session.reviewId,
    projectKey: session.projectKey,
    threadKey: rowById.get(session.reviewId)?.threadKey || `review:${session.reviewId}`,
    blockIds: reviewBlockIds(session.tree.root)
  }))
}

function normalizeSessionWorkspaceState(session: ReviewSession): void {
  const blockIds = new Set(reviewBlockIds(session.tree.root))
  if (!session.selectedId || !blockIds.has(session.selectedId)) {
    session.selectedId = session.tree.root.children[0]?.id || null
  }
  session.collapsedBlockIds = new Set(
    [...session.collapsedBlockIds].filter((blockId) => blockIds.has(blockId))
  )
  const filter = MarkoverAnnotations.normalizeFilter(
    session.tree.root,
    session.selectedId,
    session.annotatedOnly
  )
  session.selectedId = filter.selectedId
  session.annotatedOnly = filter.enabled
  if (!MarkoverAnnotations.annotatedNodes(session.tree.root).length) {
    session.annotationView = 'selected'
  }
}

function workspaceSnapshot(): MarkoverWorkspaceState {
  captureActiveSession()
  const sessions = reviewSessions.list()
  const projection = reviewInboxProjection(sessions, 'all', null)
  const reviews: Record<string, WorkspaceReviewViewState> = {}
  for (const session of sessions) {
    reviews[session.reviewId] = {
      selectedBlockId: session.selectedId,
      annotatedOnly: session.annotatedOnly,
      annotationView: session.annotationView,
      sourceCollapsed: session.sourceCollapsed,
      collapsedBlockIds: [...session.collapsedBlockIds]
    }
  }
  return {
    ...defaultWorkspaceState(),
    initialized: true,
    navigationMode: reviewNavigationMode,
    projectExpansion: projection.projects.map((project) => ({
      projectKey: project.key,
      expanded: projectExpansion.get(project.key) ?? false
    })),
    threadExpansion: projection.projects.flatMap((project) => (
      project.threads.map((thread) => ({
        projectKey: project.key,
        threadKey: thread.key,
        expanded: threadExpansion.get(
          threadExpansionKey(project.key, thread.key)
        ) ?? false
      }))
    )),
    activeReviewId: state.reviewId && reviewSessions.get(state.reviewId)
      ? state.reviewId
      : null,
    rightPaneWidth: rightPaneWidth === null
      ? null
      : Math.round(rightPaneWidth),
    reviews
  }
}

function persistWorkspaceState(): void {
  if (!workspaceStateReady) return
  const snapshot = workspaceSnapshot()
  void bridge.updateWorkspaceState(snapshot).catch((error: unknown) => {
    console.error('Failed to save private workspace state', error)
    showToast('Could not save workspace state')
  })
}

function applyWorkspaceState(value: MarkoverWorkspaceState): MarkoverWorkspaceState {
  const normalized = reconcileWorkspaceState(value, workspaceReviewScopes())
  const projection = reviewInboxProjection(reviewSessions.list(), 'all', null)
  projectExpansion.clear()
  threadExpansion.clear()
  for (const item of normalized.projectExpansion) {
    projectExpansion.set(item.projectKey, item.expanded)
  }
  for (const item of normalized.threadExpansion) {
    threadExpansion.set(
      threadExpansionKey(item.projectKey, item.threadKey),
      item.expanded
    )
  }
  if (!normalized.initialized) {
    for (const project of projection.projects) {
      projectExpansion.set(project.key, project.editingCount > 0)
      for (const thread of project.threads) {
        threadExpansion.set(
          threadExpansionKey(project.key, thread.key),
          thread.editingCount > 0
        )
      }
    }
  }
  for (const session of reviewSessions.list()) {
    const view = normalized.reviews[session.reviewId]
    if (!view) continue
    session.selectedId = view.selectedBlockId ||
      session.tree.root.children[0]?.id || null
    session.annotatedOnly = view.annotatedOnly
    session.annotationView = view.annotationView
    session.sourceCollapsed = view.sourceCollapsed
    session.collapsedBlockIds = new Set(view.collapsedBlockIds)
    normalizeSessionWorkspaceState(session)
  }
  reviewNavigationMode = normalized.navigationMode
  rightPaneWidth = normalized.rightPaneWidth
  return {
    ...normalized,
    initialized: true,
    projectExpansion: projection.projects.map((project) => ({
      projectKey: project.key,
      expanded: projectExpansion.get(project.key) ?? false
    })),
    threadExpansion: projection.projects.flatMap((project) => (
      project.threads.map((thread) => ({
        projectKey: project.key,
        threadKey: thread.key,
        expanded: threadExpansion.get(
          threadExpansionKey(project.key, thread.key)
        ) ?? false
      }))
    ))
  }
}
let incomingReviewNoticeTimer: ReturnType<typeof setTimeout> | null = null
let incomingReviewWarningCount = 0
let incomingReviewWarningId: string | null = null
let incomingReviewWarningPrompts: IncomingReviewPrompt[] = []
let incomingReviewWarningSequence: number | null = null
let smokeRuntimeClean = true
const smokeRuntimeDiagnostics: string[] = []
const consoleError = console.error.bind(console)
console.error = (...values: unknown[]) => {
  smokeRuntimeClean = false
  smokeRuntimeDiagnostics.push(
    `console.error: ${values.map((value) => String(value)).join(' ')}`
  )
  consoleError(...values)
}
window.addEventListener('error', (event) => {
  smokeRuntimeClean = false
  smokeRuntimeDiagnostics.push(`error: ${event.message}`)
}, true)
window.addEventListener('securitypolicyviolation', (event) => {
  smokeRuntimeClean = false
  smokeRuntimeDiagnostics.push(
    `csp: ${event.violatedDirective} blocked ${event.blockedURI}`
  )
}, true)
window.addEventListener('unhandledrejection', (event) => {
  smokeRuntimeClean = false
  smokeRuntimeDiagnostics.push(`unhandledrejection: ${String(event.reason)}`)
}, true)

const BRIDGE_METHODS = [
  'activateReview',
  'autosaveReview',
  'checksum',
  'copyText',
  'copyStartupDiagnostic',
  'createLocalReview',
  'getBrandAssets',
  'getInitialReview',
  'getReviews',
  'getProjectFavicon',
  'getSettings',
  'getStartupInfo',
  'getWorkspaceState',
  'getWindowFocusState',
  'onOpenMarkdownRequested',
  'onDevelopmentElementCallout',
  'onReviewOpened',
  'onReviewUpdated',
  'onReviewTrashed',
  'onReviewSnapshotRequested',
  'onReviewStatus',
  'onSettingsChanged',
  'onSettingsOpen',
  'onWindowFocusChanged',
  'openMarkdown',
  'openPullRequest',
  'openReviewContextMenu',
  'onReviewResolutionConfirmation',
  'onReviewBatchModeRequested',
  'readClipboardImage',
  'reportRendererInitialized',
  'reportSmokeResult',
  'reportStartupFailure',
  'reportStartupPhase',
  'revealStartupDiagnostic',
  'saveAttachment',
  'removeAttachment',
  'resolveReviews',
  'quitStartup',
  'updateSettings',
  'updateWorkspaceState',
  'unresolveReview'
] as const satisfies ReadonlyArray<keyof MarkoverBridge>

function requireBridge(candidate: MarkoverBridge | undefined): MarkoverBridge {
  if (!candidate) throw new Error('Markover preload bridge is unavailable.')
  const missing = BRIDGE_METHODS.filter(
    (name) => typeof candidate[name] !== 'function'
  )
  if (missing.length) {
    throw new Error(`Markover preload bridge is missing: ${missing.join(', ')}.`)
  }
  return candidate
}

const bridge = requireBridge(window.markover)

function requireStartupUi(candidate: MarkoverStartupUi | undefined): MarkoverStartupUi {
  if (!candidate) throw new Error('Markover startup UI is unavailable.')
  return candidate
}

const startupUi = requireStartupUi(window.markoverStartup)

function loadSourceDiffModule(): Promise<DiffRenderer> {
  sourceDiffModule ??= import('./pierre-diffs-entry.mjs').then((module) => {
    sourceDiffRenderer = module
    return module
  })
  return sourceDiffModule
}

function syntaxTokenElement(token: SyntaxHighlightToken): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'syntax-token'
  if (token.fontStyle & 1) span.classList.add('is-italic')
  if (token.fontStyle & 2) span.classList.add('is-bold')
  if (token.fontStyle & 4) span.classList.add('is-underlined')
  span.style.setProperty('--syntax-light', token.lightColor)
  span.style.setProperty('--syntax-dark', token.darkColor)
  span.textContent = token.content
  return span
}

function highlightCodeBlock(
  code: HTMLElement,
  source: string,
  language: string | null
): void {
  if (!language) return
  void loadSourceDiffModule()
    .then((module) => module.highlight(source, language))
    .then((result) => {
      if (!result || !code.isConnected || code.textContent !== source) return
      const fragment = document.createDocumentFragment()
      result.lines.forEach((line, index) => {
        if (index > 0) fragment.append('\n')
        for (const token of line) fragment.append(syntaxTokenElement(token))
      })
      code.replaceChildren(fragment)
    })
    .catch(() => undefined)
}

const inlineMarkdown = MarkdownIt('commonmark', {
  html: false,
  linkify: false,
  typographer: false
})
inlineMarkdown.enable('table')

inlineMarkdown.renderer.rules.link_open = (tokens, index) => {
  const href = tokens[index]?.attrGet('href') || ''
  return `<span class="inline-link" title="${inlineMarkdown.utils.escapeHtml(href)}">`
}
inlineMarkdown.renderer.rules.link_close = () => '</span>'
inlineMarkdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]
  if (!token) return ''
  const source = token.attrGet('src') || ''
  const alt = token.content || ''
  const label = MarkoverImagePreview.sourceLabel(source, alt)
  const escapedLabel = inlineMarkdown.utils.escapeHtml(label)
  const escapedSource = inlineMarkdown.utils.escapeHtml(source)
  return `<button type="button" class="inline-image" data-image-source="${escapedSource}" data-image-label="${escapedLabel}" title="Preview ${escapedLabel}">▧ ${escapedLabel}</button>`
}

function openSourceImagePreview(source: string, label: string): void {
  const url = MarkoverImagePreview.sourceUrl(source)
  if (!url) {
    showToast('Preview unavailable in this session')
    return
  }
  openImagePreview({
    url,
    label,
    id: MarkoverImagePreview.sourceLabel(source, '')
  })
}

function wireSourceImagePreviews(content: ParentNode): void {
  for (const button of content.querySelectorAll<HTMLElement>('[data-image-source]')) {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const source = button.dataset.imageSource || ''
      openSourceImagePreview(source, button.dataset.imageLabel || '')
    })
  }
}

function sourceDiffStats(node: SourceEditableNode): MarkoverDiffStats | null {
  if (!node.sourceEdit || !sourceDiffRenderer) return null
  return sourceDiffRenderer.stats(node.sourceEdit.original, node.sourceEdit.current)
}

function renderDiffStats(element: HTMLElement, stats: MarkoverDiffStats): void {
  const addition = document.createElement('span')
  addition.className = 'addition'
  addition.textContent = `+${stats.additions}`
  const deletion = document.createElement('span')
  deletion.className = 'deletion'
  deletion.textContent = `−${stats.deletions}`
  element.replaceChildren(addition, ' ', deletion)
}

function nodeKindLabel(node: ReviewNode): string {
  if (node.type === 'frontmatter') return 'YAML'
  if (node.type === 'frontmatter-entry') return '{}'
  if (node.type === 'heading') return `H${node.level}`
  if (
    (node.type === 'ordered-item' || node.type === 'unordered-item') &&
    node.task
  ) return node.checked ? '☑' : '☐'
  if (node.type === 'ordered-item') return node.marker
  if (node.type === 'unordered-item') return '○'
  if (node.type === 'paragraph') return '¶'
  if (node.type === 'blockquote') return '❯'
  if (node.type === 'table') return '▦'
  if (node.type === 'thematic-break') return '—'
  return '</>'
}

function accessibleNodeKind(node: ReviewNode): string {
  if (node.type === 'frontmatter') return 'YAML front matter'
  if (node.type === 'frontmatter-entry') return `YAML field ${node.key}`
  if (node.type === 'heading') return `Heading level ${node.level}`
  if (
    (node.type === 'ordered-item' || node.type === 'unordered-item') &&
    node.task
  ) return node.checked ? 'Checked task' : 'Unchecked task'
  if (node.type === 'ordered-item') return 'Numbered list item'
  if (node.type === 'unordered-item') return 'Bulleted list item'
  if (node.type === 'paragraph') return 'Paragraph'
  if (node.type === 'blockquote') return 'Block quote'
  if (node.type === 'table') return 'Table'
  if (node.type === 'thematic-break') return 'Thematic break'
  if (node.type === 'document') return 'Document'
  return node.language ? `${node.language} code block` : 'Code block'
}

function announceStatus(message: string): void {
  if (statusAnnouncementFrame !== null) {
    cancelAnimationFrame(statusAnnouncementFrame)
  }
  elements.statusAnnouncer.textContent = ''
  statusAnnouncementFrame = requestAnimationFrame(() => {
    statusAnnouncementFrame = null
    elements.statusAnnouncer.textContent = message
  })
}

function announceNodeSelection(node: ReviewNode): void {
  const position = state.annotatedOnly
    ? MarkoverAnnotations.annotationPosition(currentTree().root, node.id)
    : MarkoverTree.nodePosition(currentTree().root, node.id)
  const source = (node.text || node.raw)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120)
  const positionLabel = position.index > 0
    ? `${position.index} of ${position.total}`
    : null
  announceStatus([
    accessibleNodeKind(node),
    selectedLocationText(node),
    positionLabel,
    hasAnnotation(node) ? 'Annotated' : 'Not annotated',
    source
  ].filter(Boolean).join('. '))
}

function nodeDescriptor(node: ReviewNode): string {
  if (node.type === 'frontmatter') return '<yaml-frontmatter>'
  if (node.type === 'frontmatter-entry') return `<yaml:${node.key}>`
  if (node.type === 'heading') return `<h${node.level}>`
  if (
    (node.type === 'ordered-item' || node.type === 'unordered-item') &&
    node.task
  ) {
    return `<task> ${node.listPosition} of ${node.listLength}`
  }
  if (node.type === 'ordered-item') {
    return `<ol> ${node.listPosition} of ${node.listLength}`
  }
  if (node.type === 'unordered-item') {
    return `<ul> ${node.listPosition} of ${node.listLength}`
  }
  if (node.type === 'paragraph') return '<p>'
  if (node.type === 'blockquote') return '<blockquote>'
  if (node.type === 'table') return '<table>'
  if (node.type === 'thematic-break') return '<hr>'
  return node.type === 'code' && node.language
    ? `<code:${node.language}>`
    : '<code>'
}

function createRenderedAnnotation(
  node: ReviewNode,
  options: Pick<
    AnnotationCreateOptions<ReviewNode>,
    'mode' | 'onEdit' | 'onSelect'
  > = {}
): HTMLElement {
  return MarkoverAnnotationBlock.create(document, {
    node,
    context: {
      descriptor: nodeDescriptor(node)
    },
    mode: options.mode,
    attachmentUrl: attachmentPreviewUrl,
    onAttachment: options.mode === 'peek' ? null : openImagePreview,
    onEdit: options.onEdit,
    onSelect: options.onSelect,
    renderTitle: (title) => inlineMarkdown.renderInline(title),
    renderMarkdown: (feedback) => inlineMarkdown.render(feedback)
  })
}

function hideAnnotationSneakPeek(): void {
  elements.annotationSneakPeek.hidden = true
  elements.annotationSneakPeek.replaceChildren()
}

function hideSourceErrorTooltip(): void {
  elements.sourceErrorTooltip.hidden = true
  elements.sourceErrorTooltip.textContent = ''
}

function showSourceErrorTooltip(): void {
  const message = elements.sourcePanel.dataset.yamlError
  if (!message || state.sourceEditingId) return

  elements.sourceErrorTooltip.textContent = message
  elements.sourceErrorTooltip.hidden = false
  const anchor = elements.sourcePanel.getBoundingClientRect()
  const tooltip = elements.sourceErrorTooltip.getBoundingClientRect()
  const position = MarkoverAnnotationBlock.popoverPosition(
    anchor,
    tooltip,
    { width: window.innerWidth, height: window.innerHeight }
  )
  elements.sourceErrorTooltip.style.left = `${position.x}px`
  elements.sourceErrorTooltip.style.top = `${position.y}px`
}

function leaveSourceErrorTooltip(): void {
  if (!elements.sourcePanel.contains(document.activeElement)) {
    hideSourceErrorTooltip()
  }
}

function blurSourceErrorTooltip(event: FocusEvent): void {
  const nextTarget = event.relatedTarget
  if (
    (!(nextTarget instanceof Node) || !elements.sourcePanel.contains(nextTarget)) &&
    !elements.sourcePanel.matches(':hover')
  ) {
    hideSourceErrorTooltip()
  }
}

function showAnnotationSneakPeek(node: ReviewNode, marker: HTMLElement): void {
  elements.annotationSneakPeek.replaceChildren(
    createRenderedAnnotation(node, { mode: 'peek' })
  )
  elements.annotationSneakPeek.hidden = false
  const anchor = marker.getBoundingClientRect()
  const popover = elements.annotationSneakPeek.getBoundingClientRect()
  const position = MarkoverAnnotationBlock.popoverPosition(
    anchor,
    popover,
    { width: window.innerWidth, height: window.innerHeight }
  )
  elements.annotationSneakPeek.style.left = `${position.x}px`
  elements.annotationSneakPeek.style.top = `${position.y}px`
}

function attachmentCountInSubtree(node: ReviewNode): number {
  return (node.attachments || []).length +
    node.children.reduce(
      (count, child) => count + attachmentCountInSubtree(child),
      0
    )
}

function hasAnnotation(node: AnnotationTreeNode): boolean {
  return MarkoverAnnotations.hasAnnotation(node)
}

function isCurrentReviewEditable(): boolean {
  return MarkoverReviewSessions.isTreeEditable(state.tree)
}

function annotatedNodes(): ReviewNode[] {
  return MarkoverAnnotations.annotatedNodes(currentTree().root)
}

function hasFeedbackDescendant(node: ReviewNode): boolean {
  return node.children.some((child) => (
    hasAnnotation(child) || hasFeedbackDescendant(child)
  ))
}

function fullTreeEntry(node: ReviewNode): AnnotationProjection<ReviewNode> {
  return {
    node,
    contextual: false,
    children: node.children.map(fullTreeEntry)
  }
}

function selectNode(id: string, focusPreview = false): void {
  const node = MarkoverTree.findNode(currentTree().root, id)
  if (!node) return
  if (!finishActiveSourceEdit(id)) return
  state.selectedId = id
  renderTree()
  renderAnnotation(node)

  const selectedRow = elements.tree.querySelector(`[data-node-id="${id}"]`)
  selectedRow?.scrollIntoView({ block: 'nearest' })
  if (focusPreview) elements.centerPane.focus()
  announceNodeSelection(node)
  persistWorkspaceState()
}

function setAppEmptyState(empty: boolean): void {
  const incompatibleOnly = empty && incompatibleReviews.length > 0
  elements.appHeader.classList.toggle('is-empty', empty && !incompatibleOnly)
  elements.appEmptyState.hidden = !empty || incompatibleOnly
  elements.paneLayout.hidden = empty && !incompatibleOnly
  elements.paneLayout.classList.toggle('is-incompatible-only', incompatibleOnly)
  elements.reviewTabStrip.hidden = empty || !reviewSessions.list().length
  if (!empty || incompatibleOnly) {
    requestAnimationFrame(() => {
      applyLeftPaneWidth()
      applyRightPaneWidth()
    })
  }
}

function normalizeAnnotatedSelection(): boolean {
  const tree = currentTree()
  const normalized = MarkoverAnnotations.normalizeFilter(
    tree.root,
    state.selectedId,
    state.annotatedOnly
  )
  const changed = normalized.selectedId !== state.selectedId
  state.annotatedOnly = normalized.enabled
  state.selectedId = normalized.selectedId
  return changed
}

function setAnnotatedOnly(enabled: boolean): void {
  if (enabled && !annotatedNodes().length) return
  if (!finishActiveSourceEdit()) return
  state.annotatedOnly = enabled
  normalizeAnnotatedSelection()
  renderTree()
  const selected = MarkoverTree.findNode(currentTree().root, state.selectedId)
  if (selected) renderAnnotation(selected)
  persistWorkspaceState()
}

function selectedLocationText(node: ReviewNode): string {
  return node.lineStart === node.lineEnd
    ? `Line ${node.lineStart}`
    : `Lines ${node.lineStart}–${node.lineEnd}`
}

function updateSelectedLocationControl(): void {
  const selectedRow = elements.tree.querySelector<HTMLElement>(
    `[data-node-id="${state.selectedId}"]`
  )
  const hasVisibleGeometry = Boolean(
    selectedRow?.getClientRects().length && elements.tree.getClientRects().length
  )
  const isOffscreen = selectedRow !== null && (
    !hasVisibleGeometry || MarkoverNavigation.isOutsideViewport(
      elements.tree.getBoundingClientRect(),
      selectedRow.getBoundingClientRect()
    )
  )
  const location = elements.selectedLocation.textContent

  elements.selectedLocation.disabled = !isOffscreen
  elements.selectedLocation.classList.toggle('is-scroll-target', isOffscreen)
  elements.selectedLocation.title = isOffscreen ? `Scroll to ${location.toLowerCase()}` : ''
  elements.selectedLocation.setAttribute(
    'aria-label',
    isOffscreen ? `Scroll to ${location.toLowerCase()}` : location
  )
}

function scrollToSelectedRow(): void {
  const selectedId = state.selectedId
  if (!selectedId) return
  if (elements.selectedLocation.disabled) return
  const revealed = MarkoverAnnotations.revealAnnotation(
    currentTree().root,
    selectedId,
    state.collapsedBlockIds
  )
  if (revealed) {
    renderTree()
    persistWorkspaceState()
  }
  requestAnimationFrame(() => {
    elements.tree
      .querySelector(`[data-node-id="${state.selectedId}"]`)
      ?.scrollIntoView({ block: 'center' })
    updatePinnedSelection()
  })
}

function updatePinnedSelection(): void {
  const selectedRow = elements.tree.querySelector<HTMLElement>(
    `[data-node-id="${state.selectedId}"]`
  )
  updateSelectedLocationControl()
  if (!selectedRow || !selectedRow.getClientRects().length) {
    elements.pinnedSelection.hidden = true
    elements.pinnedSelection.replaceChildren()
    updateScrollbarRowCover()
    return
  }

  const treeTop = elements.tree.getBoundingClientRect().top
  const shouldPin = selectedRow.getBoundingClientRect().top < treeTop
  elements.pinnedSelection.hidden = !shouldPin
  if (!shouldPin) {
    elements.pinnedSelection.replaceChildren()
    updateScrollbarRowCover()
    return
  }

  const pinnedRow = selectedRow.cloneNode(true)
  if (!(pinnedRow instanceof HTMLElement)) return
  pinnedRow.classList.add('is-pinned')
  pinnedRow.removeAttribute('data-node-id')
  pinnedRow.querySelectorAll('button').forEach((button) => {
    button.tabIndex = -1
  })
  elements.pinnedSelection.replaceChildren(pinnedRow)
  updateScrollbarRowCover()
}

function positionScrollbarRowCover(
  cover: HTMLElement,
  row: HTMLElement | null,
  hovered: boolean
): void {
  if (!row || !row.getClientRects().length) {
    cover.hidden = true
    return
  }

  const rowRect = row.getBoundingClientRect()
  const treeRect = elements.tree.getBoundingClientRect()
  if (rowRect.bottom <= treeRect.top || rowRect.top >= treeRect.bottom) {
    cover.hidden = true
    return
  }

  const paneRect = elements.centerPane.getBoundingClientRect()
  cover.className = [
    'scrollbar-row-cover',
    hovered ? 'is-hovered' : '',
    row.querySelector('.block-content.code') ? 'is-code' : ''
  ].filter(Boolean).join(' ')
  cover.style.top = `${rowRect.top - paneRect.top}px`
  cover.style.height = `${rowRect.height}px`
  cover.hidden = false
}

function updateScrollbarRowCover(): void {
  const selectedRow = elements.tree.querySelector<HTMLElement>(
    `[data-node-id="${state.selectedId}"]`
  )
  const hoveredRow = state.hoveredId
    ? elements.tree.querySelector<HTMLElement>(`[data-node-id="${state.hoveredId}"]`)
    : null
  positionScrollbarRowCover(
    elements.scrollbarRowCover,
    elements.pinnedSelection.hidden ? selectedRow : null,
    false
  )
  positionScrollbarRowCover(
    elements.hoverScrollbarRowCover,
    hoveredRow && hoveredRow !== selectedRow ? hoveredRow : null,
    true
  )
}

function renderNode(
  entry: AnnotationProjection<ReviewNode>,
  depth: number
): HTMLElement {
  const node = entry.node
  const wrapper = document.createElement('div')
  wrapper.className = `block${entry.contextual ? ' is-filter-context' : ''}`

  const row = document.createElement('div')
  row.className = `block-row${node.id === state.selectedId ? ' is-selected' : ''}`
  row.dataset.nodeId = node.id
  row.style.setProperty('--depth-indent', `${depth * 18}px`)

  if (entry.children.length && !state.annotatedOnly) {
    const disclosure = document.createElement('button')
    disclosure.className = 'disclosure'
    replaceMarkoverIcon(
      disclosure,
      state.collapsedBlockIds.has(node.id) ? 'chevron-right' : 'chevron-down'
    )
    disclosure.title = state.collapsedBlockIds.has(node.id)
      ? 'Expand block'
      : 'Collapse block'
    disclosure.setAttribute('aria-label', disclosure.title)
    disclosure.setAttribute(
      'aria-expanded',
      String(!state.collapsedBlockIds.has(node.id))
    )
    disclosure.addEventListener('click', (event) => {
      event.stopPropagation()
      const restoreFocus = document.activeElement === disclosure
      if (!state.collapsedBlockIds.delete(node.id)) {
        state.collapsedBlockIds.add(node.id)
      }
      renderTree()
      if (restoreFocus) {
        requestAnimationFrame(() => {
          elements.tree
            .querySelector<HTMLElement>(
              `[data-node-id="${CSS.escape(node.id)}"] .disclosure`
            )
            ?.focus()
        })
      }
      persistWorkspaceState()
    })
    row.append(disclosure)
  } else {
    const placeholder = document.createElement('span')
    placeholder.className = 'disclosure-placeholder'
    row.append(placeholder)
  }

  const kind = document.createElement('span')
  kind.className = 'block-kind'
  kind.textContent = nodeKindLabel(node)
  row.append(kind)

  const content = document.createElement('div')
  if (node.type === 'frontmatter-entry') {
    content.className = `block-content frontmatter-entry${node.sourceEdit ? ' proposed-source' : ''}`
    content.textContent = node.sourceEdit?.current || node.text
  } else if (node.sourceEdit) {
    content.className = 'block-content proposed-source'
    content.innerHTML = inlineMarkdown.render(node.sourceEdit.current)
  } else if (node.type === 'heading') {
    content.className = `block-content heading level-${node.level}`
    content.innerHTML = inlineMarkdown.renderInline(node.text)
  } else if (node.type === 'frontmatter') {
    content.className = 'block-content frontmatter'
    content.textContent = node.text
  } else if (node.type === 'code') {
    content.className = 'block-content code'
    const code = document.createElement('code')
    const source = node.text || '(empty code block)'
    code.textContent = source
    content.append(code)
    highlightCodeBlock(code, source, node.language || null)
  } else if (node.type === 'blockquote' || node.type === 'table') {
    content.className = `block-content ${node.type}`
    content.innerHTML = inlineMarkdown.render(node.raw)
  } else if (node.type === 'thematic-break') {
    content.className = 'block-content thematic-break'
    content.append(document.createElement('hr'))
  } else if (node.type === 'paragraph') {
    content.className = 'block-content paragraph'
    content.innerHTML = inlineMarkdown.renderInline(node.text)
  } else {
    const task = (
      node.type === 'ordered-item' || node.type === 'unordered-item'
    ) && node.task
    content.className = `block-content list-item${task ? ' task-item' : ''}`
    content.innerHTML = inlineMarkdown.renderInline(node.text)
  }
  wireSourceImagePreviews(content)
  row.append(content)

  if (hasAnnotation(node)) {
    const dot = document.createElement('span')
    dot.className = 'annotation-dot'
    dot.title = 'Preview annotation'
    MarkoverAnnotationBlock.bindSneakPeek(dot, node, {
      show: showAnnotationSneakPeek,
      hide: hideAnnotationSneakPeek
    })
    row.append(dot)
  } else {
    row.append(document.createElement('span'))
  }

  if (hasFeedbackDescendant(node)) {
    const descendantDot = document.createElement('span')
    descendantDot.className = 'descendant-annotation-dot'
    descendantDot.title = 'Contains annotated blocks'
    row.append(descendantDot)
  } else {
    row.append(document.createElement('span'))
  }

  const attachmentCount = attachmentCountInSubtree(node)
  if (attachmentCount) {
    const attachmentIndicator = document.createElement('span')
    attachmentIndicator.className = 'attachment-indicator'
    attachmentIndicator.textContent = '▧'
    attachmentIndicator.title = `${attachmentCount} attached image${
      attachmentCount === 1 ? '' : 's'
    } in this block or its descendants`
    row.append(attachmentIndicator)
  } else {
    row.append(document.createElement('span'))
  }

  if (node.sourceEdit) {
    const summary = document.createElement('span')
    summary.className = 'source-edit-summary'
    summary.title = 'Proposed source edit'
    const stats = sourceDiffStats(node)
    if (stats) renderDiffStats(summary, stats)
    row.append(summary)
  }

  row.addEventListener('click', () => {
    selectNode(node.id, true)
  })
  row.addEventListener('mouseenter', () => {
    state.hoveredId = node.id
    updateScrollbarRowCover()
  })
  row.addEventListener('mouseleave', () => {
    if (state.hoveredId === node.id) state.hoveredId = null
    updateScrollbarRowCover()
  })
  row.addEventListener('dblclick', () => {
    if (!state.annotatedOnly && node.children.length) {
      if (!state.collapsedBlockIds.delete(node.id)) {
        state.collapsedBlockIds.add(node.id)
      }
      renderTree()
      persistWorkspaceState()
    }
  })
  wrapper.append(row)

  if (entry.children.length) {
    const children = document.createElement('div')
    children.className = `block-children${
      !state.annotatedOnly && state.collapsedBlockIds.has(node.id)
        ? ' is-collapsed'
        : ''
    }`
    for (const child of entry.children) children.append(renderNode(child, depth + 1))
    wrapper.append(children)
  }

  return wrapper
}

function renderTree(): void {
  const tree = currentTree()
  hideAnnotationSneakPeek()
  elements.tree.replaceChildren()
  const projection = state.annotatedOnly
    ? MarkoverAnnotations.annotatedProjection(tree.root)
    : tree.root.children.map(fullTreeEntry)
  for (const entry of projection) {
    elements.tree.append(renderNode(entry, 0))
  }

  const position = state.annotatedOnly
    ? MarkoverAnnotations.annotationPosition(tree.root, state.selectedId)
    : state.selectedId
      ? MarkoverTree.nodePosition(tree.root, state.selectedId)
      : { index: 0, total: tree.root.children.length }
  const unsupported = tree.unsupported.length
  const annotationCount = annotatedNodes().length
  const annotationCountElement = elements.treeViewAnnotated.querySelector('span')
  if (annotationCountElement) annotationCountElement.textContent = String(annotationCount)
  elements.treeViewAnnotated.disabled = annotationCount === 0
  elements.treeViewAll.classList.toggle('is-active', !state.annotatedOnly)
  elements.treeViewAnnotated.classList.toggle('is-active', state.annotatedOnly)
  elements.treeViewAll.setAttribute('aria-pressed', String(!state.annotatedOnly))
  elements.treeViewAnnotated.setAttribute('aria-pressed', String(state.annotatedOnly))
  const total = document.createElement('span')
  total.textContent = state.annotatedOnly
    ? `${position.total} annotations`
    : `${position.total} blocks`
  if (position.index > 0) {
    const current = document.createElement('span')
    current.textContent = String(position.index)
    const separator = document.createElement('span')
    separator.className = 'status-pill-of'
    separator.textContent = ' of '
    elements.parseStatus.replaceChildren(current, separator, total)
  } else {
    elements.parseStatus.replaceChildren(total)
  }
  if (unsupported) {
    elements.parseStatus.append(` · ${unsupported} omitted`)
  }
  requestAnimationFrame(updatePinnedSelection)
}

function renderTreePreservingScroll(): void {
  const scrollTop = elements.tree.scrollTop
  renderTree()
  elements.tree.scrollTop = scrollTop
  requestAnimationFrame(() => {
    elements.tree.scrollTop = scrollTop
    updatePinnedSelection()
  })
}

function attachmentReference(attachment: ReviewAttachment): string {
  return attachment.label || attachment.id
}

function beginAttachmentLabelEdit(
  node: ReviewNode,
  attachment: ReviewAttachment,
  item: HTMLElement,
  details: HTMLElement
): void {
  if (!isCurrentReviewEditable() || item.classList.contains('is-editing')) return

  state.finishAttachmentLabelEdit?.(true)
  const originReviewId = state.reviewId
  const originTree = state.tree
  const previousReference = attachmentReference(attachment)
  const input = document.createElement('input')
  input.className = 'attachment-label-input'
  input.type = 'text'
  input.value = attachment.label || ''
  input.placeholder = attachment.id
  input.title = `Label for ${attachment.id}`
  item.classList.add('is-editing')
  details.replaceWith(input)

  let finished = false
  function finish(commit = false, tabDirection: -1 | 0 | 1 = 0): void {
    if (finished) return
    finished = true
    const restoreKeyboardFocus = document.activeElement === input
    if (state.finishAttachmentLabelEdit === finish) {
      state.finishAttachmentLabelEdit = null
    }
    if (
      commit &&
      MarkoverReviewSessions.isTreeEditable(originTree)
    ) {
      attachment.label = input.value.trim()
      const nextReference = attachmentReference(attachment)
      node.feedback = node.feedback
        .split(`[!${previousReference}]`)
        .join(`[!${nextReference}]`)
      autosaveTree(originReviewId, originTree)
    }
    if (state.reviewId === originReviewId) {
      elements.annotationInput.value = node.feedback
      renderAttachmentList(node)
      if (restoreKeyboardFocus) {
        requestAnimationFrame(() => {
          const attachmentItem = elements.attachmentList.querySelector<HTMLElement>(
            `[data-attachment-id="${CSS.escape(attachment.id)}"]`
          )
          const focusTarget = tabDirection > 0
            ? attachmentItem?.querySelector<HTMLElement>('.attachment-remove')
            : attachmentItem?.querySelector<HTMLElement>('.attachment-thumbnail')
          focusTarget?.focus()
        })
      }
    }
  }
  state.finishAttachmentLabelEdit = finish

  input.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      finish(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      finish(false)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      finish(true, event.shiftKey ? -1 : 1)
    }
  })
  input.addEventListener('blur', () => {
    finish(true)
  })
  requestAnimationFrame(() => {
    input.focus()
    input.select()
  })
}

function openImagePreview(attachment: ReviewAttachment): void {
  const previewUrl = attachment.url || attachmentPreviewUrl(attachment)
  if (!previewUrl) {
    showToast('Preview unavailable in this session')
    return
  }
  const label = MarkoverImagePreview.labelFor(attachment)
  elements.imagePreviewContent.src = previewUrl
  elements.imagePreviewContent.alt = label
  elements.imagePreviewLabel.textContent = label
  imagePreviewReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  if (!elements.imagePreview.open) elements.imagePreview.showModal()
  elements.imagePreviewClose.focus()
  scheduleIncomingReviewNoticeDismissal()
}

function attachmentPreviewUrl(attachment: ReviewAttachment): string | null {
  const sessionUrl = state.attachmentPreviewUrls.get(attachment.id)
  if (sessionUrl) return sessionUrl
  if (!state.reviewId) return null
  try {
    return internalAttachmentUrl(state.reviewId, attachment.id)
  } catch {
    return null
  }
}

function closeImagePreview(): void {
  if (elements.imagePreview.open) elements.imagePreview.close()
  elements.imagePreviewContent.removeAttribute('src')
  elements.imagePreviewLabel.textContent = ''
  scheduleIncomingReviewNoticeDismissal()
}

function removeAttachmentFromNode(
  node: ReviewNode,
  attachment: ReviewAttachment
): void {
  node.attachments = (node.attachments || []).filter(
    (item) => item.id !== attachment.id
  )
  node.feedback = node.feedback
    .split(`[!${attachmentReference(attachment)}]`)
    .join('')
}

function renderRemovedAttachment(
  node: ReviewNode,
  attachment: ReviewAttachment,
  autosave: boolean
): void {
  const previewUrl = state.attachmentPreviewUrls.get(attachment.id)
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  state.attachmentPreviewUrls.delete(attachment.id)
  closeImagePreview()
  elements.annotationInput.value = node.feedback
  elements.annotationState.textContent = hasAnnotation(node)
    ? 'Annotated'
    : 'Not annotated'
  renderAttachmentList(node)
  const selectionChanged = normalizeAnnotatedSelection()
  renderTree()
  if (selectionChanged) {
    const selected = MarkoverTree.findNode(currentTree().root, state.selectedId)
    if (selected) renderAnnotation(selected)
    persistWorkspaceState()
  }
  updateAnnotationCount()
  if (autosave) autosaveReview()
  announceStatus(`Removed attachment ${attachmentReference(attachment)}.`)
  requestAnimationFrame(focusRightPane)
}

function removeAttachment(node: ReviewNode, attachment: ReviewAttachment): void {
  if (!isCurrentReviewEditable()) return
  removeAttachmentFromNode(node, attachment)
  renderRemovedAttachment(node, attachment, true)
}

async function removeManagedAttachment(
  node: ReviewNode,
  attachment: ReviewAttachment,
  reviewId: string
): Promise<void> {
  elements.paneLayout.inert = true
  try {
    await reviewMutations.waitCurrent(reviewId)
    const session = reviewSessions.get(reviewId)
    if (!session || state.reviewId !== reviewId) return
    const candidate = structuredClone(session.tree)
    const candidateNode = MarkoverTree.findNode(candidate.root, node.id)
    if (!candidateNode) {
      throw new Error(`Cannot find attachment block ${node.id}.`)
    }
    removeAttachmentFromNode(candidateNode, attachment)
    const result = await bridge.removeAttachment({
      reviewId,
      attachmentId: attachment.id,
      tree: candidate
    })
    if (result.outcome !== 'trashed') return
    session.tree = candidate
    const previewUrl = session.attachmentPreviewUrls.get(attachment.id)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    session.attachmentPreviewUrls.delete(attachment.id)
    if (state.reviewId === reviewId) {
      state.tree = candidate
      state.attachmentPreviewUrls = session.attachmentPreviewUrls
      renderRemovedAttachment(candidateNode, attachment, false)
    }
  } finally {
    if (!document.documentElement.classList.contains('is-shutting-down')) {
      elements.paneLayout.inert = false
    }
  }
}

function renderAttachmentList(node: ReviewNode): void {
  elements.attachmentList.replaceChildren()
  const attachments = node.attachments || []
  elements.attachmentList.hidden = attachments.length === 0

  for (const attachment of attachments) {
    const editable = isCurrentReviewEditable()
    const item = document.createElement('div')
    item.className = 'attachment-item'
    item.dataset.attachmentId = attachment.id
    item.setAttribute('role', 'listitem')
    item.title = editable
      ? `${attachment.id} · Control-click anywhere to label`
      : attachment.path || attachment.id
    if (editable) {
      item.addEventListener('pointerdown', (event) => {
        if (!event.ctrlKey) return
        event.preventDefault()
        event.stopPropagation()
        const details = item.querySelector<HTMLElement>('.attachment-details')
        if (details) beginAttachmentLabelEdit(node, attachment, item, details)
      }, true)
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        const details = item.querySelector<HTMLElement>('.attachment-details')
        if (details) beginAttachmentLabelEdit(node, attachment, item, details)
      })
    }

    const thumbnail = document.createElement('button')
    thumbnail.type = 'button'
    thumbnail.className = 'attachment-thumbnail'
    thumbnail.title = editable
      ? `${attachment.id} · click to preview · F2 or Control-click to label`
      : `${attachment.id} · click to preview`
    thumbnail.setAttribute(
      'aria-label',
      `Preview attachment ${attachmentReference(attachment)}`
    )
    if (editable) thumbnail.setAttribute('aria-keyshortcuts', 'F2')

    const previewUrl = attachmentPreviewUrl(attachment)
    if (previewUrl) {
      const image = document.createElement('img')
      image.src = previewUrl
      image.alt = attachment.label || attachment.id
      thumbnail.append(image)
    } else {
      const placeholder = document.createElement('span')
      placeholder.textContent = '▧'
      thumbnail.append(placeholder)
    }

    thumbnail.addEventListener('click', (event) => {
      if (event.ctrlKey && editable) return
      openImagePreview(attachment)
    })
    thumbnail.addEventListener('keydown', (event) => {
      if (!editable || event.key !== 'F2') return
      event.preventDefault()
      const currentDetails = item.querySelector<HTMLElement>('.attachment-details')
      if (currentDetails) {
        beginAttachmentLabelEdit(node, attachment, item, currentDetails)
      }
    })
    item.append(thumbnail)

    const details = document.createElement('span')
    details.className = 'attachment-details'
    details.textContent = attachment.label || attachment.id
    details.title = attachment.path || attachment.id
    item.append(details)

    if (editable) {
      const removeButton = document.createElement('button')
      removeButton.type = 'button'
      removeButton.className = 'attachment-remove'
      removeButton.textContent = '×'
      removeButton.title = `Remove ${attachment.id}`
      removeButton.setAttribute(
        'aria-label',
        `Remove attachment ${attachmentReference(attachment)}`
      )
      removeButton.addEventListener('click', (event) => {
        if (event.ctrlKey) return
        if (state.reviewId) {
          void reviewMutations.track(
            state.reviewId,
            removeManagedAttachment(node, attachment, state.reviewId)
          ).catch((error: unknown) => {
            showToast(error instanceof Error ? error.message : String(error))
          })
          return
        }
        if (
          !MarkoverSettings.confirmScreenshotRemoval(
            preferences,
            attachment.label || attachment.id,
            (message) => window.confirm(message)
          )
        ) return
        removeAttachment(node, attachment)
      })
      item.append(removeButton)
    }

    elements.attachmentList.append(item)
  }
}

function renderReviewEditability(): void {
  const managed = Boolean(state.tree && isReviewSessionTree(state.tree))
  const editable = isCurrentReviewEditable()
  const readonly = managed && !editable
  const paneHadFocus = elements.rightPane.contains(document.activeElement)
  elements.rightPane.classList.toggle('is-read-only', readonly)
  elements.reviewStateBanner.hidden = !readonly
  elements.annotationInput.hidden = readonly
  elements.annotationReadonly.hidden = !readonly

  if (readonly) {
    const status = state.tree && isReviewSessionTree(state.tree)
      ? state.tree.review.status
      : 'pending-agent'
    elements.reviewStateBanner.textContent =
      `${reviewStatusLabel(status)} · Read only`
    elements.annotationGuidance.textContent = status === 'revised'
      ? 'The agent has addressed this review. Open a new review for another feedback round.'
      : status === 'reviewed'
        ? 'This agent review is complete. Open a new review for another feedback round.'
        : status === 'done'
          ? 'This review belongs to merged work and is retained as read-only history.'
          : 'The agent has this review. Ask it to return the review to editing if you need to add more.'
  } else if (managed) {
    elements.annotationGuidance.textContent =
      'Annotations autosave continuously. Ask the agent to check Markover when you’re done.'
  }
  if (paneHadFocus) focusRightPane()
}

function renderReadonlyFeedback(node: ReviewNode): void {
  if (node.feedback.trim()) {
    elements.annotationReadonly.classList.remove('is-empty')
    elements.annotationReadonly.innerHTML = inlineMarkdown.render(node.feedback)
  } else {
    elements.annotationReadonly.classList.add('is-empty')
    elements.annotationReadonly.textContent = 'No feedback on this block.'
  }
}

function focusRightPane(): void {
  elements.rightPane.classList.add('focus-within')
  if (state.annotationView === 'list') elements.annotationListView.focus()
  else if (isCurrentReviewEditable()) elements.annotationInput.focus()
  else elements.annotationReadonly.focus()
}

function renderSourcePanel(node: ReviewNode): void {
  sourceDiffCleanup?.()
  sourceDiffCleanup = null
  elements.sourceDiff.replaceChildren()

  const editable = isCurrentReviewEditable() && node.sourceEditable !== false
  const editing = editable && state.sourceEditingId === node.id
  const draft = state.sourceDrafts.get(node.id)
  const savedSource = MarkoverSourceEdits.savedSource(node)
  const currentDraft = draft ?? savedSource
  const dirty = editing && currentDraft !== savedSource
  const yamlError = !editing && node.type === 'frontmatter-entry' && node.sourceEdit
    ? MarkoverTree.yamlDiagnostic(node.sourceEdit.current)
    : null

  hideSourceErrorTooltip()
  elements.sourcePanel.classList.toggle('has-yaml-error', Boolean(yamlError))
  elements.sourcePanel.dataset.yamlError = yamlError?.message || ''
  if (yamlError) {
    elements.sourceToggle.setAttribute('aria-describedby', 'source-error-tooltip')
    if (elements.sourcePanel.contains(document.activeElement)) {
      requestAnimationFrame(showSourceErrorTooltip)
    }
  } else {
    elements.sourceToggle.removeAttribute('aria-describedby')
  }
  elements.sourceContent.hidden = state.sourceCollapsed
  elements.sourceEdit.hidden = !editable || editing
  elements.sourceEdit.disabled = !editable
  elements.sourceRevert.hidden = !editable || editing || !node.sourceEdit
  elements.sourceDiffStats.hidden = !node.sourceEdit || editing
  elements.sourceSaveBar.hidden = !dirty
  elements.sourceSave.disabled = !currentDraft.trim()
  elements.selectedSource.textContent = node.raw
  elements.selectedSource.hidden = state.sourceCollapsed || editing || Boolean(node.sourceEdit)
  elements.sourceEditor.hidden = state.sourceCollapsed || !editing
  elements.sourceDiff.hidden = state.sourceCollapsed || editing || !node.sourceEdit

  if (node.sourceEdit && !editing) {
    const stats = sourceDiffStats(node)
    if (stats) renderDiffStats(elements.sourceDiffStats, stats)
    if (!state.sourceCollapsed) {
      const renderKey = `${state.reviewId || 'local'}:${node.id}:${node.sourceEdit.current}`
      elements.sourceDiff.dataset.renderKey = renderKey
      elements.sourceDiff.textContent = 'Loading diff…'
      void loadSourceDiffModule().then((diffs) => {
        if (elements.sourceDiff.dataset.renderKey !== renderKey) return
        renderDiffStats(
          elements.sourceDiffStats,
          diffs.stats(node.sourceEdit?.original || '', node.sourceEdit?.current || '')
        )
        sourceDiffCleanup = diffs.render(
          elements.sourceDiff,
          node.sourceEdit?.original || '',
          node.sourceEdit?.current || '',
          `${state.reviewId || 'local'}:${node.id}`
        )
      }).catch((error: unknown) => {
        if (elements.sourceDiff.dataset.renderKey !== renderKey) return
        console.error('Failed to load source diff renderer', error)
        elements.sourceDiff.textContent = `Diff unavailable: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  } else {
    elements.sourceDiffStats.replaceChildren()
  }

  if (editing) {
    elements.sourceEditor.value = currentDraft
  }
}

function beginSourceEdit(node: ReviewNode): void {
  if (!isCurrentReviewEditable()) return
  if (!finishActiveSourceEdit(node.id)) return
  MarkoverSourceEdits.begin(state, node)
  state.sourceCollapsed = false
  persistWorkspaceState()
  elements.sourceToggle.setAttribute('aria-expanded', 'true')
  replaceMarkoverIcon(elements.sourceToggleIcon, 'chevron-down')
  renderSourcePanel(node)
  requestAnimationFrame(() => {
    elements.sourceEditor.focus()
  })
}

function cancelSourceEdit(node: ReviewNode): void {
  const restoreKeyboardFocus = document.activeElement === elements.sourceCancel
  MarkoverSourceEdits.cancel(state, node)
  renderSourcePanel(node)
  if (restoreKeyboardFocus) {
    requestAnimationFrame(() => {
      elements.sourceEdit.focus()
    })
  }
}

function saveSourceEdit(node: ReviewNode): boolean {
  const restoreKeyboardFocus = document.activeElement === elements.sourceSave
  const result = MarkoverSourceEdits.commit(state, node)
  if (!result.ok) {
    showToast('Proposed source cannot be empty')
    return false
  }
  renderTreePreservingScroll()
  renderAnnotation(node)
  if (restoreKeyboardFocus) {
    requestAnimationFrame(() => {
      elements.sourceEdit.focus()
    })
  }
  if (result.changed) {
    autosaveReview()
    announceStatus('Source edit saved.')
  }
  return true
}

function finishActiveSourceEdit(nextId: string | null = null): boolean {
  const editingId = state.sourceEditingId
  if (!editingId || editingId === nextId) return true
  const node = MarkoverTree.findNode(currentTree().root, editingId)
  if (!node) {
    state.sourceDrafts.delete(editingId)
    state.sourceEditingId = null
    return true
  }

  const result = MarkoverSourceEdits.commit(state, node)
  if (!result.ok) {
    state.selectedId = node.id
    persistWorkspaceState()
    renderTreePreservingScroll()
    renderAnnotation(node)
    showToast('Proposed source cannot be empty')
    requestAnimationFrame(() => {
      elements.sourceEditor.focus()
    })
    return false
  }
  if (result.changed) {
    renderTreePreservingScroll()
    autosaveReview()
  }
  if (state.selectedId === node.id) renderAnnotation(node)
  return true
}

function revertSourceEdit(node: ReviewNode): void {
  if (!node.sourceEdit || !isCurrentReviewEditable()) return
  const restoreKeyboardFocus = document.activeElement === elements.sourceRevert
  delete node.sourceEdit
  state.sourceDrafts.delete(node.id)
  if (state.sourceEditingId === node.id) state.sourceEditingId = null
  renderTreePreservingScroll()
  renderAnnotation(node)
  if (restoreKeyboardFocus) {
    requestAnimationFrame(() => {
      elements.sourceEdit.focus()
    })
  }
  autosaveReview()
  announceStatus('Source edit reverted.')
}

function selectAnnotationFromList(node: RenderedAnnotationNode): void {
  const revealed = MarkoverAnnotations.revealAnnotation(
    currentTree().root,
    node.id,
    state.collapsedBlockIds
  )
  selectNode(node.id)
  if (revealed) persistWorkspaceState()
  focusRightPane()
}

function editAnnotationFromList(node: RenderedAnnotationNode): void {
  state.annotationView = 'selected'
  selectAnnotationFromList(node)
}

function renderAnnotationList(): void {
  const nodes = annotatedNodes()
  elements.annotationList.replaceChildren()
  if (!nodes.length) {
    const empty = document.createElement('p')
    empty.className = 'annotation-list-empty'
    empty.textContent = 'No annotations yet.'
    elements.annotationList.append(empty)
    return
  }

  const list = MarkoverAnnotationBlock.createList(document, {
    nodes,
    selectedId: state.selectedId,
    context: (node) => ({ descriptor: nodeDescriptor(node) }),
    attachmentUrl: attachmentPreviewUrl,
    onAttachment: openImagePreview,
    onInlineImage: openSourceImagePreview,
    onSelect: selectAnnotationFromList,
    onEdit: isCurrentReviewEditable() ? editAnnotationFromList : null,
    renderTitle: (title) => inlineMarkdown.renderInline(title),
    renderMarkdown: (feedback) => inlineMarkdown.render(feedback)
  })
  elements.annotationList.replaceChildren(...list.childNodes)

  if (state.annotationView === 'list') {
    requestAnimationFrame(() => {
      MarkoverAnnotationBlock.updateTruncation(elements.annotationList)
      elements.annotationList
        .querySelector('.rendered-annotation.is-selected')
        ?.scrollIntoView({ block: 'nearest' })
    })
  }
}

function renderAnnotationPaneView(node: ReviewNode): void {
  const nodes = annotatedNodes()
  if (state.annotationView === 'list' && !nodes.length) {
    state.annotationView = 'selected'
  }
  const listVisible = state.annotationView === 'list'
  elements.selectedAnnotationView.hidden = listVisible
  elements.annotationListView.hidden = !listVisible
  elements.annotationViewSelected.classList.toggle('is-active', !listVisible)
  elements.annotationViewList.classList.toggle('is-active', listVisible)
  elements.annotationViewSelected.setAttribute('aria-selected', String(!listVisible))
  elements.annotationViewList.setAttribute('aria-selected', String(listVisible))
  elements.annotationViewSelected.tabIndex = listVisible ? -1 : 0
  elements.annotationViewList.tabIndex = listVisible ? 0 : -1
  elements.annotationViewList.disabled = nodes.length === 0
  elements.annotationViewList.textContent = `All Annotations (${nodes.length})`

  if (listVisible) {
    const position = MarkoverAnnotations.annotationPosition(
      currentTree().root,
      state.selectedId
    )
    elements.selectedTitle.textContent = position.index
      ? `${position.index} of ${position.total}`
      : `${position.total} total`
  } else {
    elements.selectedTitle.textContent = nodeDescriptor(node)
  }
  elements.selectedLocation.textContent = selectedLocationText(node)
  updateSelectedLocationControl()
  renderAnnotationList()
}

function setAnnotationView(view: 'selected' | 'list'): void {
  const tree = currentTree()
  if (view === 'list') {
    const nextId = MarkoverAnnotations.nearestAnnotatedId(
      tree.root,
      state.selectedId
    )
    if (!nextId) return
    if (!finishActiveSourceEdit(nextId)) return
    const revealed = MarkoverAnnotations.revealAnnotation(
      tree.root,
      nextId,
      state.collapsedBlockIds
    )
    state.selectedId = nextId
    state.annotationView = 'list'
    renderTree()
    elements.tree
      .querySelector(`[data-node-id="${nextId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
    if (revealed) persistWorkspaceState()
  } else {
    state.annotationView = 'selected'
  }
  const selected = MarkoverTree.findNode(tree.root, state.selectedId)
  if (selected) renderAnnotation(selected)
  focusRightPane()
  persistWorkspaceState()
}

function renderAnnotation(node: ReviewNode): void {
  renderSourcePanel(node)
  elements.annotationInput.value = node.feedback
  renderReadonlyFeedback(node)
  elements.annotationState.textContent = hasAnnotation(node)
    ? 'Annotated'
    : 'Not annotated'
  renderAttachmentList(node)
  renderAnnotationPaneView(node)
  renderReviewEditability()
  updateAnnotationCount()
}

function updateAnnotationCount(): void {
  const count = annotatedNodes().length
  elements.annotationCount.textContent = `${count} annotation${count === 1 ? '' : 's'}`
  elements.annotationViewList.textContent = `All Annotations (${count})`
  elements.annotationViewList.disabled = count === 0
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

function clearToastActionability(): void {
  elements.toast.classList.remove('is-actionable')
  elements.toast.removeAttribute('role')
  elements.toast.tabIndex = -1
  elements.toast.onclick = null
  elements.toast.onkeydown = null
}

function showToast(message: string): void {
  clearToastActionability()
  elements.toast.textContent = message
  announceStatus(message)
  elements.toast.classList.add('is-visible')
  elements.toast.setAttribute('aria-hidden', 'false')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove('is-visible')
    elements.toast.setAttribute('aria-hidden', 'true')
  }, 1500)
}

function hideIncomingReviewNotice(): void {
  if (incomingReviewNoticeTimer) clearTimeout(incomingReviewNoticeTimer)
  incomingReviewNoticeTimer = null
  incomingReviewNoticeCount = 0
  incomingReviewNoticeId = null
  incomingReviewNoticePrompts = []
  incomingReviewNoticeSequence = null
  elements.incomingReviewNotice.hidden = true
}

function scheduleIncomingReviewNoticeDismissal(): void {
  if (incomingReviewNoticeTimer) clearTimeout(incomingReviewNoticeTimer)
  incomingReviewNoticeTimer = null
  if (
    !windowFocusState.focused ||
    elements.incomingReviewNotice.hidden ||
    elements.incomingReviewDialog.open ||
    elements.settingsDialog.open ||
    elements.fixedContractDialog.open ||
    elements.reviewResolutionDialog.open ||
    elements.imagePreview.open ||
    elements.reviewContextDrawer.open ||
    document.activeElement === elements.incomingReviewNoticeOpen
  ) {
    return
  }
  incomingReviewNoticeTimer = setTimeout(hideIncomingReviewNotice, 6000)
}

function renderIncomingReviewNotice(session: ReviewSession): void {
  if (session.tree.review.status === 'reviewed') {
    let findings = 0
    const countFindings = (node: ReviewNode): void => {
      if (node.feedback.trim() || node.sourceEdit) findings += 1
      for (const child of node.children) countFindings(child)
    }
    countFindings(session.tree.root)
    elements.incomingReviewNoticeMessage.textContent = findings === 0
      ? `Agent review completed — no findings: ${session.documentName}`
      : `Agent review completed — ${String(findings)} finding${findings === 1 ? '' : 's'}: ${session.documentName}`
  } else {
    elements.incomingReviewNoticeMessage.textContent = incomingReviewNoticeCount === 1
      ? `Review ready: ${session.documentName}`
      : `${String(incomingReviewNoticeCount)} reviews ready. Latest: ${session.documentName}`
  }
  elements.incomingReviewNotice.hidden = false
  scheduleIncomingReviewNoticeDismissal()
}

function showIncomingReviewNotice(
  session: ReviewSession,
  sequence: number
): void {
  incomingReviewNoticePrompts = appendIncomingReview(
    incomingReviewNoticePrompts,
    session.reviewId,
    sequence
  )
  incomingReviewNoticeCount = incomingReviewNoticePrompts.length
  incomingReviewNoticeId = session.reviewId
  incomingReviewNoticeSequence = sequence
  renderIncomingReviewNotice(session)
}

function clearIncomingReviewWarning(): void {
  incomingReviewWarningCount = 0
  incomingReviewWarningId = null
  incomingReviewWarningPrompts = []
  incomingReviewWarningSequence = null
  if (elements.incomingReviewDialog.open) elements.incomingReviewDialog.close()
}

function renderIncomingReviewWarning(session: ReviewSession): void {
  elements.incomingReviewDialogMessage.textContent =
    incomingReviewWarningCount === 1
      ? `“${session.documentName}” is ready. Open it instead of the current review?`
      : `${String(incomingReviewWarningCount)} reviews are ready. Open the most recent, “${session.documentName}”?`
  if (!elements.incomingReviewDialog.open) {
    elements.incomingReviewDialog.showModal()
    elements.incomingReviewDialogKeep.focus()
  }
  scheduleIncomingReviewNoticeDismissal()
}

function showIncomingReviewWarning(
  session: ReviewSession,
  sequence: number
): void {
  incomingReviewWarningPrompts = appendIncomingReview(
    incomingReviewWarningPrompts,
    session.reviewId,
    sequence
  )
  incomingReviewWarningCount = incomingReviewWarningPrompts.length
  incomingReviewWarningId = session.reviewId
  incomingReviewWarningSequence = sequence
  renderIncomingReviewWarning(session)
}

function replaceIncomingReviewNoticePrompts(
  prompts: IncomingReviewPrompt[]
): void {
  const available = prompts.filter((prompt) => reviewSessions.get(prompt.reviewId))
  const latest = available.at(-1)
  const session = latest ? reviewSessions.get(latest.reviewId) : null
  if (!latest || !session) {
    hideIncomingReviewNotice()
    return
  }
  incomingReviewNoticePrompts = available
  incomingReviewNoticeCount = available.length
  incomingReviewNoticeId = latest.reviewId
  incomingReviewNoticeSequence = latest.sequence
  renderIncomingReviewNotice(session)
}

function replaceIncomingReviewWarningPrompts(
  prompts: IncomingReviewPrompt[]
): void {
  const available = prompts.filter((prompt) => reviewSessions.get(prompt.reviewId))
  const latest = available.at(-1)
  const session = latest ? reviewSessions.get(latest.reviewId) : null
  if (!latest || !session) {
    clearIncomingReviewWarning()
    return
  }
  incomingReviewWarningPrompts = available
  incomingReviewWarningCount = available.length
  incomingReviewWarningId = latest.reviewId
  incomingReviewWarningSequence = latest.sequence
  renderIncomingReviewWarning(session)
}

function removeIncomingPrompts(reviewId: string): void {
  const noticePrompts = removeIncomingReview(incomingReviewNoticePrompts, reviewId)
  if (noticePrompts.length !== incomingReviewNoticePrompts.length) {
    replaceIncomingReviewNoticePrompts(noticePrompts)
  }
  const warningPrompts = removeIncomingReview(incomingReviewWarningPrompts, reviewId)
  if (warningPrompts.length !== incomingReviewWarningPrompts.length) {
    replaceIncomingReviewWarningPrompts(warningPrompts)
  }
}

function dismissIncomingPromptsThrough(sequence: number): void {
  const noticePrompts = retainIncomingReviewsAfter(
    incomingReviewNoticePrompts,
    sequence
  )
  if (noticePrompts.length !== incomingReviewNoticePrompts.length) {
    replaceIncomingReviewNoticePrompts(noticePrompts)
  }
  const warningPrompts = retainIncomingReviewsAfter(
    incomingReviewWarningPrompts,
    sequence
  )
  if (warningPrompts.length !== incomingReviewWarningPrompts.length) {
    replaceIncomingReviewWarningPrompts(warningPrompts)
  }
}

async function activateIncomingReview(
  reviewId: string,
  focusPreview: boolean,
  activationSequence: number
): Promise<ReviewActivationOutcome> {
  const outcome = await activateReview(reviewId)
  if (outcome === 'blocked') {
    const session = reviewSessions.get(reviewId)
    if (session && activationSequence === incomingReviewSequence) {
      showIncomingReviewNotice(session, activationSequence)
    }
    return outcome
  }
  if (outcome === 'missing') return outcome
  dismissIncomingPromptsThrough(activationSequence)
  if (focusPreview && windowFocusState.focused) elements.centerPane.focus()
  return outcome
}

async function handleIncomingReview(
  reviewDocument: MarkoverDocument
): Promise<void> {
  const sequence = ++incomingReviewSequence
  const session = addManagedReview(managedReviewDocument(reviewDocument), false)
  if (session.reviewId === state.reviewId) {
    hideIncomingReviewNotice()
    clearIncomingReviewWarning()
    return
  }
  const action = incomingReviewAction({
    focusState: windowFocusState,
    hasActiveDocument: state.tree !== null,
    idleMinutes: preferences.incomingReviewIdleMinutes,
    now: Date.now(),
    policy: preferences.incomingReviewActivationPolicy
  })
  if (action === 'warn') {
    showIncomingReviewWarning(session, sequence)
    return
  }
  if (action === 'notify') {
    showIncomingReviewNotice(session, sequence)
    return
  }
  await activateIncomingReview(
    session.reviewId,
    windowFocusState.focused,
    sequence
  )
}

async function handleReviewLink(
  reviewDocument: MarkoverDocument,
  focusState: MarkoverWindowFocusState
): Promise<ReviewActivationOutcome> {
  const sequence = ++incomingReviewSequence
  const session = addManagedReview(managedReviewDocument(reviewDocument), false)
  if (session.reviewId === state.reviewId) {
    return activateReview(session.reviewId)
  }
  const action = incomingReviewAction({
    focusState,
    hasActiveDocument: state.tree !== null,
    idleMinutes: preferences.incomingReviewIdleMinutes,
    now: Date.now(),
    policy: preferences.reviewLinkActivationPolicy
  })
  if (action === 'warn') {
    showIncomingReviewWarning(session, sequence)
    return 'deferred'
  }
  if (action === 'notify') {
    showIncomingReviewNotice(session, sequence)
    return 'deferred'
  }
  return activateIncomingReview(session.reviewId, true, sequence)
}

function queueIncomingReview(reviewDocument: MarkoverDocument): Promise<void> {
  incomingReviewQueue = incomingReviewQueue.then(
    async () => {
      await handleIncomingReview(reviewDocument)
      await refreshRequestingThreadTitles()
    },
    async () => {
      await handleIncomingReview(reviewDocument)
      await refreshRequestingThreadTitles()
    }
  ).catch((error: unknown) => {
    console.error('Failed to add incoming review', error)
    showToast('Could not add the incoming review')
  })
  return incomingReviewQueue
}

function autosaveReview(): void {
  autosaveTree(state.reviewId, state.tree)
}

function autosaveTree(
  reviewId: string | null,
  tree: ReviewTree | null
): void {
  if (
    !reviewId ||
    !tree ||
    !MarkoverReviewSessions.isTreeEditable(tree)
  ) return
  bridge.autosaveReview(reviewId, tree)
}

function captureActiveSession(): void {
  const session = reviewSessions.active()
  if (!session || session.reviewId !== state.reviewId) return
  session.selectedId = state.selectedId
  session.annotatedOnly = state.annotatedOnly
  session.annotationView = state.annotationView
  session.sourceCollapsed = state.sourceCollapsed
  session.collapsedBlockIds = state.collapsedBlockIds
  session.sourceDrafts = state.sourceDrafts
  session.sourceEditingId = state.sourceEditingId
  session.attachmentPreviewUrls = state.attachmentPreviewUrls
}

function reviewRowById(reviewId: string): ReviewInboxRow | null {
  const projection = reviewInboxProjection()
  return [...projection.editing, ...projection.history]
    .find((row) => row.reviewId === reviewId) || null
}

function reviewMetadataIcon(field: ReviewMetadataField): MarkoverIconName {
  if (field.key === 'project' || field.key === 'repository') return 'folder'
  if (field.key === 'source-path' || field.key === 'source-state') return 'file-text'
  if (field.key === 'branch') return 'git-branch'
  if (field.key === 'pull-request' || field.key === 'pull-request-status') {
    return 'git-pull-request'
  }
  if (field.key === 'requesting-thread') return 'messages-square'
  if (field.key === 'requesting-thread-title') return 'message-square'
  if (field.key === 'thread-host' || field.key === 'machine') return 'server'
  if (
    field.key === 'review-status' ||
    field.key === 'review-resolution' ||
    field.key === 'created' ||
    field.key === 'updated' ||
    field.key === 'attention-requested'
  ) return 'clock'
  return 'hash'
}

function reviewMetadataVisual(
  field: ReviewMetadataField,
  row: ReviewInboxRow
): Element {
  if (field.key === 'project') {
    return createProjectIcon(row.projectKey, row.projectName, row.reviewId)
  }
  if (field.key === 'provider') return hoverProviderVisual(row)
  return markoverIcon(reviewMetadataIcon(field))
}

function metadataStateLabel(row: ReviewInboxRow): string | null {
  if (row.projectEvidence === 'conflict') return 'Repository conflict'
  if (row.sourceState === 'changed') return 'Source changed'
  if (row.sourceState === 'missing') return 'Source missing'
  if (row.sourceState === 'unavailable') return 'Source unavailable'
  if (row.projectEvidence === 'unavailable') return 'Repository unavailable'
  return null
}

function renderActiveMetadataState(
  row: ReviewInboxRow,
  issues: readonly string[]
): void {
  const stateLabel = metadataStateLabel(row)
  elements.sourceState.hidden = !stateLabel
  elements.sourceState.textContent = stateLabel || ''
  elements.sourceState.title = issues.join(' ')
  elements.reviewContextButton.classList.toggle('has-metadata-error', issues.length > 0)
  elements.reviewContextButton.ariaLabel = issues.length
    ? `Show review context. ${issues.join(' ')}`
    : 'Show review context'
}

function addReviewContextField(
  label: string,
  value: unknown,
  options: { error?: boolean; visual?: Element } = {}
): void {
  if (value === null || value === undefined || value === '') return
  let text: string
  if (typeof value === 'string') text = value
  else if (typeof value === 'number') text = value.toString()
  else if (typeof value === 'boolean') text = value.toString()
  else if (typeof value === 'bigint') text = value.toString()
  else return
  const term = document.createElement('dt')
  if (options.visual) {
    options.visual.classList.add('review-context-field-icon')
    const labelText = document.createElement('span')
    labelText.textContent = label
    term.append(options.visual, labelText)
  } else term.textContent = label
  const description = document.createElement('dd')
  description.textContent = text
  description.classList.toggle('is-error', options.error === true)
  elements.reviewContextFields.append(term, description)
}

function addReviewContextCopyField(
  label: string,
  value: string
): HTMLButtonElement {
  const term = document.createElement('dt')
  const visual = markoverIcon('hash', 'review-context-field-icon')
  const labelText = document.createElement('span')
  labelText.textContent = label
  term.append(visual, labelText)
  const description = document.createElement('dd')
  description.className = 'review-context-copy-value'
  const code = document.createElement('code')
  code.textContent = value
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.textContent = 'Copy'
  copy.ariaLabel = `Copy ${label.toLowerCase()} ${value}`
  copy.addEventListener('click', () => {
    bridge.copyText(value)
    showToast(`${label} copied`)
  })
  description.append(code, copy)
  elements.reviewContextFields.append(term, description)
  return copy
}

function renderReviewContext(): void {
  const tree = state.tree
  const review = tree && isReviewSessionTree(tree) ? tree.review : null
  elements.reviewContextButton.hidden = !review
  elements.documentReviewId.hidden = !review
  if (!review) {
    elements.documentReviewId.textContent = ''
    elements.sourceState.hidden = true
    elements.reviewContextIssues.hidden = true
    elements.reviewContextButton.classList.remove('has-metadata-error')
    closeReviewContext(false)
    return
  }

  const agentReviewer = metadataRecord(review.agentReviewer)
  const reviewerThread = metadataRecord(agentReviewer.agentThread)
  const reviewerThreadHost = metadataRecord(reviewerThread.threadHost)
  elements.reviewContextTitle.textContent = state.documentName
  elements.reviewContextSummary.innerHTML = inlineMarkdown.render(
    review.contextSummary || ''
  )
  const restoreReviewContextCopyFocus =
    document.activeElement instanceof HTMLButtonElement &&
    elements.reviewContextFields.contains(document.activeElement)
  elements.reviewContextFields.replaceChildren()
  elements.documentReviewId.textContent = review.id
  elements.documentReviewId.ariaLabel = `Copy review ID ${review.id}`
  elements.documentReviewId.title = `Copy review ID ${review.id}`
  const reviewIdCopy = addReviewContextCopyField('Review ID', review.id)
  const row = reviewRowById(review.id)
  const inventory = row ? reviewMetadataInventory(row) : null
  if (row && inventory) {
    for (const field of inventory.fields) {
      addReviewContextField(field.label, field.value, {
        error: field.error,
        visual: reviewMetadataVisual(field, row)
      })
    }
    elements.reviewContextIssues.hidden = inventory.issues.length === 0
    elements.reviewContextIssues.textContent = inventory.issues.join(' ')
    renderActiveMetadataState(row, inventory.issues)
  } else {
    elements.reviewContextIssues.hidden = true
    elements.reviewContextIssues.textContent = ''
    elements.sourceState.hidden = true
    elements.reviewContextButton.classList.remove('has-metadata-error')
    elements.reviewContextButton.ariaLabel = 'Show review context'
  }
  if (review.agentReviewer) {
    addReviewContextField('Reviewer', 'Agent')
    addReviewContextField('Agent review mode', metadataString(agentReviewer, 'mode'))
    addReviewContextField('Reviewer thread', metadataString(reviewerThread, 'id'))
    addReviewContextField('Reviewer host', metadataString(reviewerThreadHost, 'kind'))
    addReviewContextField('Review started', metadataString(agentReviewer, 'startedAt'))
    addReviewContextField('Review completed', metadataString(agentReviewer, 'completedAt'))
  }
  if (restoreReviewContextCopyFocus) reviewIdCopy.focus()
}

function openReviewContext(): void {
  if (!state.tree || !isReviewSessionTree(state.tree)) return
  renderReviewContext()
  if (!elements.reviewContextDrawer.open) {
    elements.reviewContextDrawer.showModal()
  }
  elements.reviewContextButton.setAttribute('aria-expanded', 'true')
  elements.reviewContextClose.focus()
  scheduleIncomingReviewNoticeDismissal()
}

function closeReviewContext(restoreFocus = true): void {
  const drawerHadFocus = elements.reviewContextDrawer.contains(
    document.activeElement
  )
  if (elements.reviewContextDrawer.open) elements.reviewContextDrawer.close()
  elements.reviewContextButton.setAttribute('aria-expanded', 'false')
  if (
    restoreFocus &&
    drawerHadFocus &&
    !elements.reviewContextButton.hidden
  ) {
    elements.reviewContextButton.focus()
  }
  scheduleIncomingReviewNoticeDismissal()
}

function documentsListFocusPath(): number[] | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !elements.documentsListTree.contains(active)) {
    return null
  }
  const path: number[] = []
  let current: Element = active
  while (current !== elements.documentsListTree) {
    const parent = current.parentElement
    if (!parent) return null
    path.unshift(Array.from(parent.children).indexOf(current))
    current = parent
  }
  return path
}

function restoreDocumentsListFocus(path: number[]): void {
  let target: Element = elements.documentsListTree
  for (const index of path) {
    const child = target.children.item(index)
    if (!child) return
    target = child
  }
  if (!(target instanceof HTMLElement)) return
  let ancestor = target.parentElement
  while (ancestor && elements.documentsListTree.contains(ancestor)) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
    ancestor = ancestor.parentElement
  }
  target.focus({ preventScroll: true })
}

type DocumentsListReviewFocus = {
  control: 'open' | 'pull-request'
  reviewId: string
}

function documentsListReviewFocus(): DocumentsListReviewFocus | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !elements.documentsListTree.contains(active)) {
    return null
  }
  const review = active.closest<HTMLElement>('[data-review-id]')
  const reviewId = review?.dataset.reviewId
  if (!reviewId) return null
  return {
    control: active.classList.contains('review-list-row-pr')
      ? 'pull-request'
      : 'open',
    reviewId
  }
}

function restoreDocumentsListReviewFocus(focus: DocumentsListReviewFocus): void {
  const review = elements.documentsListTree.querySelector<HTMLElement>(
    `[data-review-id="${CSS.escape(focus.reviewId)}"]`
  )
  if (!review) return
  let ancestor = review.parentElement
  while (ancestor && elements.documentsListTree.contains(ancestor)) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
    ancestor = ancestor.parentElement
  }
  const target = focus.control === 'pull-request'
    ? review.querySelector<HTMLElement>('.review-list-row-pr')
    : review.querySelector<HTMLElement>(
        '.review-list-row-open, .review-project-leaf-open, button'
      )
  target?.focus({ preventScroll: true })
}

function renderDocumentsListPreservingFocus(): void {
  const documentsReviewFocus = documentsListReviewFocus()
  const documentsFocusPath = documentsReviewFocus
    ? null
    : documentsListFocusPath()
  renderDocumentsList()
  if (!documentsReviewFocus && !documentsFocusPath) return
  requestAnimationFrame(() => {
    if (documentsReviewFocus) {
      restoreDocumentsListReviewFocus(documentsReviewFocus)
    } else if (documentsFocusPath) {
      restoreDocumentsListFocus(documentsFocusPath)
    }
  })
}

function scheduleDocumentsListClockRefresh(sessions: ReviewSession[]): void {
  if (documentsListClockTimer) clearTimeout(documentsListClockTimer)
  documentsListClockTimer = null
  const delay = MarkoverReviewSessions.relativeTimeRefreshDelay(
    sessions.flatMap((session) => [
      session.attentionRequestedAt,
      session.lifecycleActivityAt
    ])
  )
  if (delay === null) return
  documentsListClockTimer = setTimeout(() => {
    documentsListClockTimer = null
    const focusPath = documentsListFocusPath()
    renderDocumentsList()
    if (focusPath) {
      requestAnimationFrame(() => {
        restoreDocumentsListFocus(focusPath)
      })
    }
  }, delay)
}


function createRegisteredIcon(
  definition: ReviewRegistryIcon,
  className: string
): HTMLElement {
  const icon = document.createElement('span')
  icon.className = `review-provider-icon ${className}`
  if (definition.kind === 'image') {
    const image = document.createElement('img')
    image.src = definition.source
    image.alt = ''
    icon.append(image)
    return icon
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', definition.viewBox)
  svg.setAttribute('aria-hidden', 'true')
  for (const registeredPath of definition.paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', registeredPath.d)
    path.setAttribute('fill', registeredPath.fill)
    svg.append(path)
  }
  icon.append(svg)
  return icon
}

function registeredIconsMatch(
  left: ReviewRegistryIcon,
  right: ReviewRegistryIcon
): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'image' && right.kind === 'image') {
    return left.source === right.source
  }
  return left.kind === 'vector' && right.kind === 'vector' &&
    left.viewBox === right.viewBox &&
    JSON.stringify(left.paths) === JSON.stringify(right.paths)
}

function createProviderIcon(
  row: Pick<ReviewInboxRow, 'local' | 'provider' | 'threadHostKind'>
): HTMLElement {
  if (row.local) {
    const icon = document.createElement('span')
    icon.className = 'review-provider-icon provider-local'
    icon.textContent = 'md'
    icon.title = 'Local Markdown'
    return icon
  }
  const providerDefinition = providerIcon(row.provider)
  const providerClass = (row.provider || 'unknown').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
  const primary = providerDefinition
    ? createRegisteredIcon(providerDefinition, `provider-${providerClass}`)
    : document.createElement('span')
  if (!providerDefinition) {
    primary.className = `review-provider-icon provider-${providerClass}`
    primary.textContent = row.provider
      ? row.provider.slice(0, 2).toUpperCase()
      : '·'
  }
  const providerLabel = providerDefinition?.label || row.provider || 'Agent'
  const threadHostDefinition = threadHostIcon(row.threadHostKind)
  if (!threadHostDefinition) {
    primary.title = `${providerLabel} provider (${row.provider || 'unknown'})`
    return primary
  }

  const roles = [
    `${providerLabel} provider (${row.provider || 'unknown'})`,
    `${threadHostDefinition.label} thread host (${row.threadHostKind || 'unknown'})`
  ].join('; ')
  if (
    providerDefinition &&
    registeredIconsMatch(providerDefinition, threadHostDefinition)
  ) {
    primary.title = roles
    primary.setAttribute('aria-label', roles)
    return primary
  }

  const stack = document.createElement('span')
  stack.className = 'review-provider-icon-stack has-thread-host'
  stack.title = roles
  stack.setAttribute('aria-label', roles)
  primary.classList.add('is-provider')
  const threadHost = createRegisteredIcon(
    threadHostDefinition,
    'is-thread-host'
  )
  stack.append(primary, threadHost)
  return stack
}

function createProjectIcon(
  projectKey: string,
  projectName: string,
  reviewId: string
): HTMLElement {
  const icon = document.createElement('span')
  icon.className = 'review-project-icon'
  icon.textContent = projectName.slice(0, 1).toUpperCase() || 'M'
  icon.ariaHidden = 'true'
  let load = projectFaviconLoads.get(projectKey)
  if (!load) {
    load = bridge.getProjectFavicon(reviewId)
    projectFaviconLoads.set(projectKey, load)
  }
  void load.then((source) => {
    if (!source || !icon.isConnected) return
    const image = document.createElement('img')
    image.src = source
    image.alt = ''
    icon.replaceChildren(image)
  }).catch(() => {})
  return icon
}

interface ReviewHoverEntry {
  error: boolean
  label: string
  text: string
  visual: Element
}

interface ReviewHoverModel {
  entries: ReviewHoverEntry[]
  issues: string[]
  title: string
}

function hideReviewHoverCard(): void {
  if (reviewHoverTimer) clearTimeout(reviewHoverTimer)
  reviewHoverTimer = null
  elements.reviewHoverCard.hidden = true
  elements.reviewHoverCard.replaceChildren()
}

function showReviewHoverCard(
  anchor: HTMLElement,
  model: ReviewHoverModel
): void {
  if (!anchor.isConnected) return
  const title = document.createElement('strong')
  title.className = 'review-hover-title'
  title.textContent = model.title
  const entries = document.createElement('div')
  entries.className = 'review-hover-entries'
  for (const entry of model.entries) {
    const row = document.createElement('div')
    row.className = 'review-hover-entry'
    row.classList.toggle('is-error', entry.error)
    const visual = entry.visual
    visual.classList.add('review-hover-entry-icon')
    const label = document.createElement('span')
    label.className = 'review-hover-entry-label'
    label.textContent = entry.label
    const value = document.createElement('span')
    value.textContent = entry.text
    row.append(visual, label, value)
    entries.append(row)
  }
  const issues = document.createElement('div')
  issues.className = 'review-hover-issues'
  issues.hidden = model.issues.length === 0
  issues.textContent = model.issues.join(' ')
  elements.reviewHoverCard.replaceChildren(title, entries, issues)
  elements.reviewHoverCard.hidden = false
  const anchorRect = anchor.getBoundingClientRect()
  const hoverRect = elements.reviewHoverCard.getBoundingClientRect()
  const position = MarkoverAnnotationBlock.popoverPosition(
    anchorRect,
    hoverRect,
    { width: window.innerWidth, height: window.innerHeight }
  )
  elements.reviewHoverCard.style.left = `${position.x}px`
  elements.reviewHoverCard.style.top = `${position.y}px`
}

function bindReviewHoverCard(
  anchor: HTMLElement,
  model: () => ReviewHoverModel
): void {
  anchor.setAttribute('aria-describedby', 'review-hover-card')
  anchor.addEventListener('mouseenter', () => {
    if (reviewHoverTimer) clearTimeout(reviewHoverTimer)
    reviewHoverTimer = setTimeout(() => {
      reviewHoverTimer = null
      showReviewHoverCard(anchor, model())
    }, 280)
  })
  anchor.addEventListener('mouseleave', hideReviewHoverCard)
  anchor.addEventListener('focusin', () => {
    hideReviewHoverCard()
    showReviewHoverCard(anchor, model())
  })
  anchor.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Node) || !anchor.contains(event.relatedTarget)) {
      hideReviewHoverCard()
    }
  })
}

function hoverProviderVisual(
  row: Pick<ReviewInboxRow, 'local' | 'provider' | 'threadHostKind'>
): HTMLElement {
  const visual = createProviderIcon(row)
  visual.removeAttribute('title')
  visual.removeAttribute('tabindex')
  return visual
}

function providerDescription(
  provider: string | null,
  threadHostKind: string | null
): string {
  const providerLabel = provider || 'Provider unavailable'
  return threadHostKind
    ? `${providerLabel} via ${threadHostKind}`
    : providerLabel
}

function reviewHoverModel(row: ReviewInboxRow): ReviewHoverModel {
  const inventory = reviewMetadataInventory(row)
  return {
    entries: [
      {
        error: false,
        label: 'Review ID',
        text: row.reviewId,
        visual: markoverIcon('hash')
      },
      ...inventory.fields.map((field) => ({
        error: field.error,
        label: field.label,
        text: field.value,
        visual: reviewMetadataVisual(field, row)
      }))
    ],
    issues: inventory.issues,
    title: row.title
  }
}

function reviewRowContext(row: ReviewInboxRow): string {
  if (row.local) return row.contextPath || row.documentName
  return row.branch || row.contextPath || 'Branch unavailable'
}

function reviewRowPullRequestTitle(row: ReviewInboxRow): string {
  if (!row.pullRequestNumber) return 'No pull request is associated with this review.'
  if (!row.pullRequestStatus || !row.pullRequestStatusObservedAt) {
    return `PR #${row.pullRequestNumber} is linked; its current state has not been observed.`
  }
  return `PR #${row.pullRequestNumber}: ${row.pullRequestStatus}.`
}

function reviewRowTime(row: ReviewInboxRow): string {
  return MarkoverReviewSessions.formatRelativeTime(
    row.status === 'editing'
      ? row.attentionRequestedAt
      : row.lifecycleActivityAt
  )
}

function openReviewContextMenu(
  reviewId: string,
  event: MouseEvent | KeyboardEvent,
  anchor: HTMLElement,
  focusKey: string,
  fallbackFocus?: () => HTMLElement | null
): void {
  event.preventDefault()
  event.stopPropagation()
  const point = event instanceof MouseEvent
    ? pointerContextMenuPoint(event)
    : keyboardContextMenuPoint(anchor.getBoundingClientRect())
  void bridge.openReviewContextMenu({ reviewId, ...point })
    .then((result) => {
      if (result.outcome === 'copied') showToast('Review link copied')
    })
    .catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error))
    })
    .finally(() => {
      const replacement = Array.from(
        document.querySelectorAll<HTMLElement>('[data-review-context-menu-focus]')
      ).find((candidate) => (
        candidate.dataset.reviewContextMenuFocus === focusKey
      ))
      const focusTarget = anchor.isConnected
        ? anchor
        : replacement || fallbackFocus?.()
      focusTarget?.focus({ preventScroll: true })
    })
}

function bindReviewContextMenuKeyboard(
  control: HTMLElement,
  reviewId: string,
  surface: ReviewContextMenuSurface,
  fallbackFocus?: () => HTMLElement | null
): string {
  const focusKey = reviewContextMenuFocusKey(surface, reviewId)
  control.setAttribute('aria-haspopup', 'menu')
  control.dataset.reviewContextMenuFocus = focusKey
  control.addEventListener('keydown', (event) => {
    if (!isReviewContextMenuKey(event)) return
    openReviewContextMenu(reviewId, event, control, focusKey, fallbackFocus)
  })
  return focusKey
}

function createMetadataStateMarker(row: ReviewInboxRow): HTMLElement | null {
  const label = metadataStateLabel(row)
  if (!label) return null
  const marker = document.createElement('span')
  marker.className = 'review-metadata-state-marker'
  marker.title = label
  marker.setAttribute('aria-label', label)
  marker.append(markoverIcon('message-square'))
  return marker
}

function renderReviewBatchActions(): void {
  const count = selectedReviewIds.size
  elements.reviewBatchActions.hidden = !batchResolutionMode
  elements.reviewBatchCount.textContent = `${String(count)} selected`
  elements.reviewBatchNoNotes.disabled = count === 0
  elements.reviewBatchAccept.disabled = count === 0
}

function finishResolutionConfirmation(confirmed: boolean): void {
  const complete = resolutionDialogCompletion
  if (!complete) return
  resolutionDialogCompletion = null
  if (elements.reviewResolutionDialog.open) {
    elements.reviewResolutionDialog.close()
  }
  complete(confirmed)
}

function resolutionBlockPreview(
  block: ReviewResolutionSummaryBlock
): string {
  const feedback = block.feedback.trim().replace(/\s+/g, ' ')
  if (feedback) return feedback.length > 120
    ? `${feedback.slice(0, 117)}…`
    : feedback
  if (block.attachments.length) {
    return `${String(block.attachments.length)} attachment${block.attachments.length === 1 ? '' : 's'}`
  }
  return block.sourceEdit ? 'Source edit proposal' : 'Feedback artifact'
}

function showReviewResolutionConfirmation(
  request: ReviewResolutionConfirmationRequest
): Promise<boolean> {
  if (resolutionDialogCompletion) finishResolutionConfirmation(false)
  elements.reviewResolutionSummaries.replaceChildren()
  const feedbackReviewCount = request.reviews.filter(
    (review) => review.blocks.length > 0
  ).length
  elements.reviewResolutionTitle.textContent = request.reviews.length === 1
    ? 'Complete this review?'
    : `Complete ${String(request.reviews.length)} reviews?`
  elements.reviewResolutionMessage.textContent = feedbackReviewCount
    ? 'The feedback below will remain in completed history as read-only context and will not be sent to the agent for action.'
    : request.outcome === 'reviewed-no-notes'
      ? 'Record that you reviewed the selected reviews and have no notes.'
      : 'Record that the selected reviews were accepted without review.'
  for (const review of request.reviews) {
    const details = document.createElement('details')
    details.className = 'review-resolution-summary'
    details.open = request.reviews.length === 1
    const summary = document.createElement('summary')
    const title = document.createElement('strong')
    title.textContent = review.documentName
    const description = document.createElement('span')
    const preview = review.blocks[0]
      ? resolutionBlockPreview(review.blocks[0])
      : 'No feedback artifacts'
    description.textContent = `${review.contextSummary} · ${String(review.blocks.length)} feedback block${review.blocks.length === 1 ? '' : 's'} · ${preview}`
    summary.append(title, description)
    details.append(summary)
    const blocks = document.createElement('div')
    blocks.className = 'review-resolution-blocks'
    for (const block of review.blocks) {
      const item = document.createElement('section')
      item.className = 'review-resolution-block'
      const heading = document.createElement('strong')
      heading.textContent = block.title
      item.append(heading)
      if (block.feedback.trim()) {
        const feedback = document.createElement('p')
        feedback.textContent = block.feedback
        item.append(feedback)
      }
      if (block.attachments.length) {
        const attachments = document.createElement('p')
        attachments.textContent = `Attachments: ${block.attachments.join(', ')}`
        item.append(attachments)
      }
      if (block.sourceEdit) {
        const sourceEdit = document.createElement('pre')
        sourceEdit.textContent = `Source proposal\n− ${block.sourceEdit.original}\n+ ${block.sourceEdit.current}`
        item.append(sourceEdit)
      }
      blocks.append(item)
    }
    if (!review.blocks.length) {
      blocks.append(createEmptyReviewMessage('No feedback will be abandoned.'))
    }
    details.append(blocks)
    elements.reviewResolutionSummaries.append(details)
  }
  elements.reviewResolutionConfirm.textContent = feedbackReviewCount
    ? `Abandon feedback in ${String(feedbackReviewCount)} review${feedbackReviewCount === 1 ? '' : 's'}`
    : `Resolve ${String(request.reviews.length)} review${request.reviews.length === 1 ? '' : 's'}`
  elements.reviewResolutionDialog.showModal()
  elements.reviewResolutionCancel.focus()
  return new Promise<boolean>((resolve) => {
    resolutionDialogCompletion = resolve
  })
}

function reviewSelectionControl(row: ReviewInboxRow): HTMLInputElement | null {
  if (
    !batchResolutionMode ||
    !reviewMatchesFilter(row, reviewFilter) ||
    (row.status !== 'editing' && row.status !== 'pending-agent')
  ) return null
  const selection = document.createElement('input')
  selection.type = 'checkbox'
  selection.className = 'review-selection'
  selection.checked = selectedReviewIds.has(row.reviewId)
  selection.ariaLabel = `Select ${row.title} for completion`
  selection.title = 'Select for completion'
  selection.addEventListener('click', (event) => {
    event.stopPropagation()
  })
  selection.addEventListener('change', () => {
    if (selection.checked) selectedReviewIds.add(row.reviewId)
    else selectedReviewIds.delete(row.reviewId)
    renderReviewBatchActions()
  })
  return selection
}

function returnToNeedsMeControl(
  row: ReviewInboxRow
): HTMLButtonElement | null {
  const outcome = row.resolution?.outcome
  if (
    row.status !== 'revised' ||
    (outcome !== 'reviewed-no-notes' &&
      outcome !== 'accepted-unreviewed' &&
      outcome !== 'feedback-abandoned')
  ) return null
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'review-return-needs-me'
  button.textContent = 'Needs me'
  button.ariaLabel = `Return ${row.title} to Needs me`
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    void bridge.unresolveReview(row.reviewId).then(() => {
      selectedReviewIds.delete(row.reviewId)
      showToast('Review returned to Needs me')
    }).catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error))
    })
  })
  return button
}

function createReviewListRow(row: ReviewInboxRow): HTMLElement {
  const container = document.createElement('div')
  container.className = [
    'review-list-row',
    row.reviewId === state.reviewId ? 'is-active' : '',
    row.status === 'editing'
      ? 'needs-review'
      : row.status === 'pending-agent'
        ? 'with-agent'
        : `is-${row.status}`
  ].filter(Boolean).join(' ')
  container.dataset.reviewId = row.reviewId

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'review-list-row-open'
  const reviewIdDescription = document.createElement('span')
  reviewIdDescription.id = `review-list-id-${row.reviewId}`
  reviewIdDescription.className = 'visually-hidden'
  reviewIdDescription.textContent = `Review ID ${row.reviewId}`
  button.setAttribute('aria-describedby', reviewIdDescription.id)
  if (row.reviewId === state.reviewId) button.setAttribute('aria-current', 'page')

  const favicon = createProjectIcon(row.projectKey, row.projectName, row.reviewId)
  const icons = document.createElement('span')
  icons.className = 'review-row-icon-stack'
  icons.append(favicon, createProviderIcon(row))

  const content = document.createElement('span')
  content.className = 'review-list-row-content'

  const top = document.createElement('span')
  top.className = 'review-list-row-line review-list-row-meta'
  const identity = document.createElement('span')
  identity.className = 'review-list-row-identity'
  identity.textContent = `${row.projectName} · ${row.local ? 'Local review' : row.documentName}`
  const time = document.createElement('span')
  time.className = [
    'review-list-row-time',
    row.status === 'editing'
      ? ''
      : `review-status-badge is-${row.status}`
  ].filter(Boolean).join(' ')
  time.textContent = row.status === 'editing'
    ? reviewRowTime(row)
    : reviewResolutionLabel(row.resolution) || reviewStatusLabel(row.status)
  time.title = new Date(
    row.status === 'editing' ? row.attentionRequestedAt : row.lifecycleActivityAt
  ).toLocaleString()
  top.append(identity, time)

  const title = document.createElement('span')
  title.className = 'review-list-row-title'
  const titleText = document.createElement('span')
  titleText.textContent = row.title
  title.append(titleText)
  const metadataMarker = createMetadataStateMarker(row)
  if (metadataMarker) title.append(metadataMarker)

  const bottom = document.createElement('span')
  bottom.className = 'review-list-row-line review-list-row-meta'
  const branch = document.createElement('span')
  branch.className = 'review-list-row-context'
  branch.textContent = reviewRowContext(row)
  const pr = document.createElement(row.pullRequestNumber ? 'button' : 'span')
  if (pr instanceof HTMLButtonElement) pr.type = 'button'
  pr.className = [
    'review-list-row-pr',
    row.pullRequestNumber
      ? `is-${row.pullRequestStatus || 'linked'}`
      : ''
  ].filter(Boolean).join(' ')
  pr.textContent = row.pullRequestNumber ? `PR #${row.pullRequestNumber}` : 'PR —'
  pr.title = reviewRowPullRequestTitle(row)
  bottom.append(branch)
  if (!(pr instanceof HTMLButtonElement)) bottom.append(pr)

  content.append(top, title, bottom)
  button.append(icons, content)
  button.addEventListener('click', () => {
    void activateReview(row.reviewId)
  })
  const contextMenuFocusKey = bindReviewContextMenuKeyboard(
    button,
    row.reviewId,
    'review-list'
  )
  container.addEventListener('contextmenu', (event) => {
    openReviewContextMenu(row.reviewId, event, button, contextMenuFocusKey)
  })
  container.append(button, reviewIdDescription)
  const selection = reviewSelectionControl(row)
  if (selection) container.append(selection)
  const returnToNeedsMe = returnToNeedsMeControl(row)
  if (returnToNeedsMe) container.append(returnToNeedsMe)
  if (pr instanceof HTMLButtonElement) {
    container.append(pr)
    pr.addEventListener('click', (event) => {
      event.stopPropagation()
      void bridge.openPullRequest(row.reviewId).catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : String(error))
      })
    })
  }
  bindReviewHoverCard(button, () => reviewHoverModel(row))
  return container
}

function createProjectReviewRow(row: ReviewInboxRow): HTMLElement {
  const container = document.createElement('div')
  container.className = [
    'review-project-leaf',
    `is-${row.status}`,
    row.reviewId === state.reviewId ? 'is-active' : ''
  ].filter(Boolean).join(' ')
  container.dataset.reviewId = row.reviewId

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'review-project-leaf-open'
  const reviewIdDescription = document.createElement('span')
  reviewIdDescription.id = `review-project-id-${row.reviewId}`
  reviewIdDescription.className = 'visually-hidden'
  reviewIdDescription.textContent = `Review ID ${row.reviewId}`
  button.setAttribute('aria-describedby', reviewIdDescription.id)
  if (row.reviewId === state.reviewId) button.setAttribute('aria-current', 'page')

  const status = document.createElement('span')
  status.className = 'review-project-leaf-status'
  status.ariaHidden = 'true'
  status.title = reviewResolutionLabel(row.resolution) || reviewStatusLabel(row.status)

  const title = document.createElement('span')
  title.className = 'review-project-leaf-title'
  const titleText = document.createElement('span')
  titleText.textContent = row.title
  title.append(titleText)
  const metadataMarker = createMetadataStateMarker(row)
  if (metadataMarker) title.append(metadataMarker)

  const age = document.createElement('span')
  age.className = 'review-project-leaf-age'
  age.textContent = reviewRowTime(row)
  age.title = new Date(
    row.status === 'editing' ? row.attentionRequestedAt : row.lifecycleActivityAt
  ).toLocaleString()

  button.append(status, title, age)
  button.addEventListener('click', () => {
    void activateReview(row.reviewId)
  })
  const contextMenuFocusKey = bindReviewContextMenuKeyboard(
    button,
    row.reviewId,
    'project-review-list'
  )
  container.addEventListener('contextmenu', (event) => {
    openReviewContextMenu(row.reviewId, event, button, contextMenuFocusKey)
  })
  container.append(button, reviewIdDescription)
  const selection = reviewSelectionControl(row)
  if (selection) container.append(selection)
  const returnToNeedsMe = returnToNeedsMeControl(row)
  if (returnToNeedsMe) container.append(returnToNeedsMe)
  bindReviewHoverCard(button, () => reviewHoverModel(row))
  return container
}

function createEmptyReviewMessage(message: string): HTMLElement {
  const empty = document.createElement('p')
  empty.className = 'review-list-empty'
  empty.textContent = message
  return empty
}

function renderInboxReviews(
  editing: ReviewInboxRow[],
  history: ReviewInboxRow[],
  filter: ReviewInboxFilter
): DocumentFragment {
  if (filter !== 'all') {
    const fragment = document.createDocumentFragment()
    const heading = document.createElement('div')
    heading.className = 'review-list-section-heading'
    const label = filter === 'needs-me'
      ? 'Needs me'
      : filter === 'with-agent'
        ? 'With agent'
        : 'Completed'
    const rows = [...editing, ...history]
    heading.innerHTML = `<strong>${label}</strong><span>${String(rows.length)} shown</span>`
    fragment.append(heading)
    const list = document.createElement('div')
    list.className = 'review-list-rows'
    list.append(...rows.map(createReviewListRow))
    if (!rows.length) {
      list.append(createEmptyReviewMessage(`No ${label.toLowerCase()} reviews.`))
    }
    fragment.append(list)
    return fragment
  }
  const fragment = document.createDocumentFragment()
  const heading = document.createElement('div')
  heading.className = 'review-list-section-heading'
  heading.innerHTML = '<strong>Needs review</strong><span>Recent first</span>'
  fragment.append(heading)

  const editingList = document.createElement('div')
  editingList.className = 'review-list-rows'
  if (editing.length) {
    editingList.append(...editing.map(createReviewListRow))
  } else {
    editingList.append(createEmptyReviewMessage('Nothing needs review.'))
  }
  fragment.append(editingList)

  const historyGroup = document.createElement('details')
  historyGroup.className = 'review-history-group'
  const historySummary = document.createElement('summary')
  const latestHistory = history.at(0)
  historySummary.innerHTML = `<span>History</span><span>${history.length} reviews${latestHistory ? ` · latest ${reviewRowTime(latestHistory)}` : ''}</span>`
  historyGroup.append(historySummary)
  const visibleHistory = history.slice(0, inboxHistoryLimit)
  const activeHistory = history.find((row) => row.reviewId === state.reviewId)
  if (
    activeHistory &&
    !visibleHistory.some((row) => row.reviewId === activeHistory.reviewId)
  ) visibleHistory.push(activeHistory)
  historyGroup.open = Boolean(activeHistory)
  const historyList = document.createElement('div')
  historyList.className = 'review-list-rows is-history'
  historyList.append(...visibleHistory.map(createReviewListRow))
  if (!history.length) {
    historyList.append(createEmptyReviewMessage('No review history yet.'))
  }
  historyGroup.append(historyList)
  if (inboxHistoryLimit < history.length) {
    const showMore = document.createElement('button')
    showMore.type = 'button'
    showMore.className = 'review-list-more'
    showMore.textContent = `Show ${Math.min(INBOX_HISTORY_PAGE_SIZE, history.length - inboxHistoryLimit)} more`
    showMore.addEventListener('click', () => {
      inboxHistoryLimit += INBOX_HISTORY_PAGE_SIZE
      renderDocumentsList()
      requestAnimationFrame(() => {
        const recreatedHistory = elements.documentsListTree
          .querySelector<HTMLDetailsElement>('.review-history-group')
        if (!recreatedHistory) return
        recreatedHistory.open = true
        recreatedHistory.querySelector<HTMLElement>(
          '.review-list-more'
        )
          ?.focus()
      })
    })
    historyGroup.append(showMore)
  }
  const viewAll = document.createElement('button')
  viewAll.type = 'button'
  viewAll.className = 'review-list-more'
  viewAll.textContent = 'View all in Projects'
  viewAll.addEventListener('click', () => {
    setReviewNavigationMode('projects')
    requestAnimationFrame(focusLeftPane)
  })
  historyGroup.append(viewAll)
  fragment.append(historyGroup)
  return fragment
}

function projectSummary(project: ReviewInboxProject): HTMLElement {
  const summary = document.createElement('summary')
  summary.append(createDetailsDisclosure())
  const label = document.createElement('span')
  label.className = 'review-group-label'
  const iconReviewId = project.threads[0]?.reviews[0]?.reviewId || ''
  const icon = createProjectIcon(project.key, project.name, iconReviewId)
  const name = document.createElement('strong')
  name.textContent = project.name
  label.append(icon, name)
  const rollup = document.createElement('span')
  rollup.className = project.editingCount ? 'review-count-badge' : 'review-group-age'
  rollup.textContent = project.editingCount
    ? `${project.editingCount} need review`
    : MarkoverReviewSessions.formatRelativeTime(project.latestActivityAt)
  summary.append(label, rollup)
  bindReviewHoverCard(summary, () => projectHoverModel(project))
  return summary
}

function projectHoverModel(project: ReviewInboxProject): ReviewHoverModel {
  const reviewCount = project.threads.reduce(
    (count, thread) => count + thread.reviews.length,
    0
  )
  const entries: ReviewHoverEntry[] = []
  if (project.root) entries.push({
    error: false,
    label: 'Project root',
    text: project.root,
    visual: markoverIcon('folder')
  })
  entries.push({
    error: false,
    label: 'Contents',
    text: `${project.threads.length} thread${project.threads.length === 1 ? '' : 's'} · ${reviewCount} review${reviewCount === 1 ? '' : 's'}`,
    visual: markoverIcon('list-tree')
  })
  entries.push({
    error: false,
    label: 'Activity',
    text: `${project.editingCount} need review · latest ${MarkoverReviewSessions.formatRelativeTime(project.latestActivityAt)}`,
    visual: markoverIcon('clock')
  })
  return { entries, issues: [], title: project.name }
}

function createDetailsDisclosure(): HTMLElement {
  const disclosure = document.createElement('span')
  disclosure.className = 'review-details-disclosure'
  disclosure.append(
    markoverIcon('chevron-right', 'is-closed'),
    markoverIcon('chevron-down', 'is-open')
  )
  return disclosure
}

function threadHoverModel(
  thread: ReviewInboxThread,
  project: ReviewInboxProject
): ReviewHoverModel {
  const iconReviewId = thread.reviews[0]?.reviewId || ''
  const entries: ReviewHoverEntry[] = [
    {
      error: false,
      label: 'Project',
      text: project.name,
      visual: createProjectIcon(project.key, project.name, iconReviewId)
    }
  ]
  if (thread.requestingThreadId) {
    entries.push({
      error: false,
      label: 'Requesting thread',
      text: thread.requestingThreadId,
      visual: markoverIcon('message-square')
    })
  }
  if (thread.machine) entries.push({
    error: false,
    label: 'Machine',
    text: thread.machine,
    visual: markoverIcon('server')
  })
  entries.push({
    error: false,
    label: 'Provider',
    text: providerDescription(thread.provider, thread.threadHostKind),
    visual: hoverProviderVisual(thread)
  })
  entries.push({
    error: false,
    label: 'Reviews',
    text: `${thread.reviews.length} review${thread.reviews.length === 1 ? '' : 's'} · ${thread.editingCount} need review`,
    visual: markoverIcon('list-tree')
  })
  entries.push({
    error: false,
    label: 'Activity',
    text: `Latest activity ${MarkoverReviewSessions.formatRelativeTime(thread.latestActivityAt)}`,
    visual: markoverIcon('clock')
  })
  return { entries, issues: [], title: thread.title }
}

function threadSummary(
  thread: ReviewInboxThread,
  project: ReviewInboxProject
): HTMLElement {
  const summary = document.createElement('summary')
  summary.append(createDetailsDisclosure())
  const label = document.createElement('span')
  label.className = 'review-group-label review-thread-label'
  const icon = markoverIcon('messages-square', 'review-thread-icon')
  const title = document.createElement('strong')
  title.textContent = thread.title
  label.append(icon, title)
  const rollup = document.createElement('span')
  rollup.className = thread.editingCount ? 'review-count-badge' : 'review-group-age'
  rollup.textContent = thread.editingCount
    ? `${thread.editingCount}`
    : MarkoverReviewSessions.formatRelativeTime(thread.latestActivityAt)
  summary.append(label, rollup)
  bindReviewHoverCard(summary, () => threadHoverModel(thread, project))
  return summary
}

function renderProjects(projects: ReviewInboxProject[]): DocumentFragment {
  const fragment = document.createDocumentFragment()
  if (!projects.length) {
    fragment.append(createEmptyReviewMessage('No review projects yet.'))
    return fragment
  }
  const tree = document.createElement('div')
  tree.className = 'review-project-tree'
  for (const project of projects) {
    const projectDetails = document.createElement('details')
    projectDetails.className = 'review-project-group'
    projectDetails.open = projectExpansion.get(project.key) ?? false
    projectDetails.append(projectSummary(project))
    projectDetails.addEventListener('toggle', () => {
      projectExpansion.set(project.key, projectDetails.open)
      persistWorkspaceState()
    })
    const threads = document.createElement('div')
    threads.className = 'review-thread-groups'
    for (const thread of project.threads) {
      const threadDetails = document.createElement('details')
      threadDetails.className = 'review-thread-group'
      const expansionKey = threadExpansionKey(project.key, thread.key)
      threadDetails.open = threadExpansion.get(expansionKey) ?? false
      threadDetails.append(threadSummary(thread, project))
      threadDetails.addEventListener('toggle', () => {
        threadExpansion.set(expansionKey, threadDetails.open)
        persistWorkspaceState()
      })
      const rows = document.createElement('div')
      rows.className = 'review-list-rows review-thread-reviews'
      rows.append(...thread.reviews.map(createProjectReviewRow))
      threadDetails.append(rows)
      threads.append(threadDetails)
    }
    projectDetails.append(threads)
    tree.append(projectDetails)
  }
  fragment.append(tree)
  return fragment
}

function setReviewNavigationMode(
  mode: 'inbox' | 'projects',
  persist = true
): void {
  reviewNavigationMode = mode
  elements.reviewNavigationInbox.classList.toggle('is-active', mode === 'inbox')
  elements.reviewNavigationProjects.classList.toggle('is-active', mode === 'projects')
  elements.reviewNavigationInbox.setAttribute('aria-pressed', String(mode === 'inbox'))
  elements.reviewNavigationProjects.setAttribute('aria-pressed', String(mode === 'projects'))
  renderDocumentsList()
  if (persist) {
    persistWorkspaceState()
    void refreshRequestingThreadTitles()
  }
}

function renderIncompatibleReviews(): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const heading = document.createElement('div')
  heading.className = 'review-list-section-heading'
  const label = document.createElement('strong')
  label.textContent = 'Incompatible'
  const count = document.createElement('span')
  count.textContent = String(incompatibleReviews.length)
  heading.append(label, count)
  fragment.append(heading)

  const rows = document.createElement('div')
  rows.className = 'review-list-rows incompatible-review-list'
  for (const review of incompatibleReviews) {
    const row = document.createElement('div')
    row.className = 'review-list-row incompatible-review-row'

    const content = document.createElement('div')
    content.className = 'incompatible-review-content'
    const identity = document.createElement('strong')
    identity.textContent = review.reviewId
    const requirement = document.createElement('span')
    requirement.textContent = `Requires support for ${review.format} version ${review.version}`
    const catalog = document.createElement('code')
    catalog.textContent = review.compatibilityUrl
    catalog.title = review.compatibilityUrl
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'incompatible-review-copy'
    copy.textContent = 'Copy compatibility link'
    copy.addEventListener('click', () => {
      bridge.copyText(review.compatibilityUrl)
      showToast('Compatibility link copied')
    })
    content.append(identity, requirement, catalog, copy)
    row.append(content)
    rows.append(row)
  }
  fragment.append(rows)
  return fragment
}

function renderDocumentsList(): void {
  hideReviewHoverCard()
  const sessions = reviewSessions.list()
  const hasReviews = sessions.length > 0 || incompatibleReviews.length > 0
  const projection = reviewInboxProjection(sessions)
  const visibleSelectableIds = new Set(
    [...projection.editing, ...projection.history]
      .filter((row) => (
        reviewMatchesFilter(row, reviewFilter) &&
        (row.status === 'editing' || row.status === 'pending-agent')
      ))
      .map((row) => row.reviewId)
  )
  for (const reviewId of selectedReviewIds) {
    if (!visibleSelectableIds.has(reviewId)) selectedReviewIds.delete(reviewId)
  }
  renderReviewBatchActions()
  scheduleDocumentsListClockRefresh(sessions)
  elements.leftPane.hidden = !hasReviews
  elements.leftPaneCollapse.hidden = sessions.length === 0
  elements.leftPaneOpen.hidden = !hasReviews || !leftPaneCollapsed
  elements.paneLayout.classList.toggle('has-left-pane', hasReviews)
  elements.reviewTabStrip.hidden = sessions.length === 0
  elements.reviewInboxCount.textContent = String(projection.filterCounts['needs-me'])
  elements.reviewInboxCount.hidden = projection.filterCounts['needs-me'] === 0
  const filterLabels: Record<ReviewInboxFilter, string> = {
    'needs-me': 'Needs me',
    'with-agent': 'With agent',
    completed: 'Completed',
    all: 'All'
  }
  for (const option of elements.reviewFilter.options) {
    const value = option.value as ReviewInboxFilter
    option.textContent = `${filterLabels[value]} (${String(projection.filterCounts[value])})`
  }
  elements.reviewFilter.value = reviewFilter
  elements.reviewListCount.textContent = reviewNavigationMode === 'inbox'
    ? `${projection.filterCounts[reviewFilter]} ${filterLabels[reviewFilter].toLowerCase()}${incompatibleReviews.length
      ? ` · ${incompatibleReviews.length} incompatible`
      : ''}`
    : `${projection.projects.length} projects${incompatibleReviews.length
      ? ` · ${incompatibleReviews.length} incompatible`
      : ''}`
  applyLeftPaneWidth()
  applyRightPaneWidth()
  elements.documentsListTree.replaceChildren()
  if (sessions.length) {
    elements.documentsListTree.append(
      reviewNavigationMode === 'inbox'
        ? renderInboxReviews(projection.editing, projection.history, reviewFilter)
        : renderProjects(projection.projects)
    )
  }
  if (incompatibleReviews.length) {
    elements.documentsListTree.append(renderIncompatibleReviews())
  }
}

function applyLeftPaneWidth(): void {
  const paneLayoutWidth = elements.paneLayout.clientWidth || window.innerWidth
  leftPaneWidth = MarkoverReviewSessions.clampLeftPaneWidth(
    leftPaneWidth,
    paneLayoutWidth
  )
  elements.paneLayout.style.setProperty(
    '--left-pane-width',
    `${leftPaneWidth}px`
  )
  elements.reviewTabStrip.style.setProperty(
    '--left-pane-width',
    leftPaneCollapsed ? '0px' : `${leftPaneWidth}px`
  )
  elements.leftPaneResizer.setAttribute(
    'aria-valuenow',
    String(Math.round(leftPaneWidth))
  )
  elements.leftPaneResizer.setAttribute(
    'aria-valuemax',
    String(Math.round(MarkoverReviewSessions.clampLeftPaneWidth(
      Number.POSITIVE_INFINITY,
      paneLayoutWidth
    )))
  )
  elements.leftPaneResizer.setAttribute(
    'aria-valuetext',
    `${String(Math.round(leftPaneWidth))} pixels wide`
  )
}

function applyRightPaneWidth(): void {
  const currentWidth = rightPaneWidth ??
    elements.rightPane.getBoundingClientRect().width
  const leftPaneWidthForLayout = elements.leftPane.getBoundingClientRect().width
  const paneLayoutWidth = elements.paneLayout.clientWidth || window.innerWidth
  const clampedWidth = MarkoverReviewSessions.clampRightPaneWidth(
    currentWidth,
    paneLayoutWidth,
    leftPaneWidthForLayout
  )
  const maximumWidth = MarkoverReviewSessions.clampRightPaneWidth(
    Number.POSITIVE_INFINITY,
    paneLayoutWidth,
    leftPaneWidthForLayout
  )
  if (rightPaneWidth !== null) {
    rightPaneWidth = clampedWidth
    elements.paneLayout.style.setProperty(
      '--right-pane-column-width',
      `${rightPaneWidth}px`
    )
  }
  elements.rightPaneResizer.setAttribute(
    'aria-valuenow',
    String(Math.round(clampedWidth))
  )
  elements.rightPaneResizer.setAttribute(
    'aria-valuemax',
    String(Math.round(maximumWidth))
  )
  elements.rightPaneResizer.setAttribute(
    'aria-valuetext',
    `${String(Math.round(clampedWidth))} pixels wide`
  )
}

function schedulePaneLayoutResizeUpdate(): void {
  if (paneResizeLayoutFrame !== null) return
  paneResizeLayoutFrame = requestAnimationFrame(() => {
    paneResizeLayoutFrame = null
    updatePinnedSelection()
    developmentElementCallouts?.reposition()
    MarkoverAnnotationBlock.updateTruncation(elements.annotationList)
  })
}

function setLeftPaneCollapsed(collapsed: boolean): void {
  const restoreKeyboardFocus = document.activeElement === (
    collapsed ? elements.leftPaneCollapse : elements.leftPaneOpen
  )
  leftPaneCollapsed = collapsed
  elements.leftPane.classList.toggle('is-collapsed', collapsed)
  elements.reviewTabStrip.classList.toggle('is-left-pane-collapsed', collapsed)
  applyLeftPaneWidth()
  applyRightPaneWidth()
  schedulePaneLayoutResizeUpdate()
  elements.leftPaneOpen.hidden = !collapsed || reviewSessions.list().length === 0
  elements.leftPaneCollapse.setAttribute(
    'aria-expanded',
    String(!collapsed)
  )
  elements.leftPaneOpen.setAttribute(
    'aria-expanded',
    String(!collapsed)
  )
  if (restoreKeyboardFocus) {
    requestAnimationFrame(() => {
      const target = collapsed
        ? elements.leftPaneOpen
        : elements.leftPaneCollapse
      target.focus()
    })
  }
}

function themedBrandSource(
  source: string,
  primary: string,
  secondary: string
): string {
  const themed = source
    .replaceAll('#c94e1f', primary)
    .replaceAll('#6d211f', secondary)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(themed)}`
}

async function themeBrandAssets(): Promise<void> {
  try {
    brandAssetLoad ||= bridge.getBrandAssets()
    brandAssetSources ||= await brandAssetLoad
    if (!brandAssetSources) {
      brandFallbackUsed = true
      return
    }
    const palette = getComputedStyle(document.documentElement)
    const primary = palette.getPropertyValue('--markover-primary').trim()
    const secondary = palette.getPropertyValue('--markover-secondary').trim()
    elements.brandMark.src = themedBrandSource(
      brandAssetSources.mark,
      primary,
      secondary
    )
    elements.brandLogotype.src = themedBrandSource(
      brandAssetSources.logotype,
      primary,
      secondary
    )
    elements.appEmptyStateLockup.src = themedBrandSource(
      brandAssetSources.lockup,
      primary,
      secondary
    )
  } catch (error) {
    brandFallbackUsed = true
    console.error('Failed to theme brand assets', error)
  } finally {
    document.documentElement.classList.add('is-brand-ready')
  }
}

function updateT3ThreadTitleStatus(refreshing = false): void {
  elements.t3ThreadTitleStatus.textContent = refreshing
    ? 'Refreshing T3 requesting-thread titles…'
    : t3ThreadTitles.detail
  elements.t3ThreadTitleStatus.dataset.status = refreshing
    ? 'refreshing'
    : t3ThreadTitles.status
  elements.t3ThreadTitleStatus.setAttribute('aria-busy', String(refreshing))
  elements.t3ThreadTitlesRefresh.disabled =
    refreshing || !preferences.t3ThreadTitlesEnabled
}

function updateCodexThreadTitleStatus(refreshing = false): void {
  elements.codexThreadTitleStatus.textContent = refreshing
    ? 'Refreshing Codex requesting-thread titles…'
    : codexThreadTitles.detail
  elements.codexThreadTitleStatus.dataset.status = refreshing
    ? 'refreshing'
    : codexThreadTitles.status
  elements.codexThreadTitleStatus.setAttribute('aria-busy', String(refreshing))
  elements.codexThreadTitlesRefresh.disabled =
    refreshing || !preferences.codexThreadTitlesEnabled
}

function updateClaudeThreadTitleStatus(refreshing = false): void {
  elements.claudeThreadTitleStatus.textContent = refreshing
    ? 'Refreshing Claude Code requesting-thread titles…'
    : claudeThreadTitles.detail
  elements.claudeThreadTitleStatus.dataset.status = refreshing
    ? 'refreshing'
    : claudeThreadTitles.status
  elements.claudeThreadTitleStatus.setAttribute('aria-busy', String(refreshing))
  elements.claudeThreadTitlesRefresh.disabled =
    refreshing || !preferences.claudeThreadTitlesEnabled
}

function refreshT3ThreadTitles(): Promise<void> {
  const refresh = async (): Promise<void> => {
    updateT3ThreadTitleStatus(true)
    try {
      t3ThreadTitles = await bridge.getT3ThreadTitles()
    } catch (error) {
      console.error('Failed to refresh T3 requesting-thread titles', error)
      t3ThreadTitles = {
        status: 'unavailable',
        detail: 'T3 metadata is temporarily unavailable.',
        titles: []
      }
    }
    updateT3ThreadTitleStatus()
    renderDocumentsListPreservingFocus()
  }
  t3ThreadTitleRefresh = t3ThreadTitleRefresh.then(refresh, refresh)
  return t3ThreadTitleRefresh
}

function refreshCodexThreadTitles(): Promise<void> {
  const refresh = async (): Promise<void> => {
    updateCodexThreadTitleStatus(true)
    try {
      codexThreadTitles = await bridge.getCodexThreadTitles()
    } catch (error) {
      console.error('Failed to refresh Codex requesting-thread titles', error)
      codexThreadTitles = {
        status: 'unavailable',
        detail: 'Codex app-server is temporarily unavailable.',
        titles: []
      }
    }
    updateCodexThreadTitleStatus()
    renderDocumentsListPreservingFocus()
  }
  codexThreadTitleRefresh = codexThreadTitleRefresh.then(refresh, refresh)
  return codexThreadTitleRefresh
}

function refreshClaudeThreadTitles(): Promise<void> {
  const refresh = async (): Promise<void> => {
    updateClaudeThreadTitleStatus(true)
    try {
      claudeThreadTitles = await bridge.getClaudeThreadTitles()
    } catch (error) {
      console.error('Failed to refresh Claude Code requesting-thread titles', error)
      claudeThreadTitles = {
        status: 'unavailable',
        detail: 'Claude Code session artifacts are temporarily unavailable.',
        titles: []
      }
    }
    updateClaudeThreadTitleStatus()
    renderDocumentsListPreservingFocus()
  }
  claudeThreadTitleRefresh = claudeThreadTitleRefresh.then(refresh, refresh)
  return claudeThreadTitleRefresh
}

function refreshRequestingThreadTitles(): Promise<void> {
  const refresh = async (): Promise<void> => {
    try {
      const documents = captureReviewList(await bridge.getReviews())
      for (const document of documents) {
        const managed = managedReviewDocument(document)
        if (!reviewSessions.updateDocument(managed)) {
          addManagedReview(managed, false)
        }
      }
    } catch (error) {
      console.error('Failed to refresh review metadata', error)
    }
    await Promise.all([
      refreshT3ThreadTitles(),
      refreshCodexThreadTitles(),
      refreshClaudeThreadTitles()
    ])
    if (state.reviewId) renderReviewContext()
  }
  requestingThreadTitleRefresh = requestingThreadTitleRefresh.then(
    refresh,
    refresh
  )
  return requestingThreadTitleRefresh
}

function applySettings(
  next: unknown,
  options: { initial?: boolean } = {}
): void {
  const previous = preferences
  const applied = MarkoverSettings.applySettingsToView(next, {
    root: document.documentElement,
    keyboardHelp: elements.keyboardHelp,
    form: elements.settingsForm
  })
  preferences = applied.preferences
  resolvedAppearance = applied.appearance
  void themeBrandAssets()
  updateT3ThreadTitleStatus()
  updateCodexThreadTitleStatus()
  updateClaudeThreadTitleStatus()

  if (MarkoverSettings.leftPanePreferenceChanged(
    previous,
    preferences,
    options.initial
  )) {
    setLeftPaneCollapsed(!preferences.openLeftPane)
  }
  if (
    !options.initial &&
    previous.inboxTitlePreference !== preferences.inboxTitlePreference
  ) {
    renderDocumentsListPreservingFocus()
  }
  if (
    !options.initial &&
    (
      previous.t3ThreadTitlesEnabled !== preferences.t3ThreadTitlesEnabled ||
      previous.t3MetadataDatabasePath !== preferences.t3MetadataDatabasePath
    )
  ) {
    void refreshT3ThreadTitles()
  }
  if (
    !options.initial &&
    (
      previous.codexThreadTitlesEnabled !== preferences.codexThreadTitlesEnabled ||
      previous.codexExecutablePath !== preferences.codexExecutablePath
    )
  ) {
    void refreshCodexThreadTitles()
  }
  if (
    !options.initial &&
    previous.claudeThreadTitlesEnabled !== preferences.claudeThreadTitlesEnabled
  ) {
    void refreshClaudeThreadTitles()
  }
}

function restoreSettingsForm(): void {
  MarkoverSettings.applySettingsToView(
    { ...preferences, resolvedAppearance },
    {
      root: document.documentElement,
      keyboardHelp: elements.keyboardHelp,
      form: elements.settingsForm
    }
  )
}

function openSettings(): void {
  restoreSettingsForm()
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal()
  scheduleIncomingReviewNoticeDismissal()
  const palette = elements.settingsForm.elements.namedItem('palette')
  if (palette instanceof HTMLElement) palette.focus()
}

function closeFixedContract(): void {
  elements.fixedContractDialog.close()
}

for (const statement of MarkoverAgentGuidance.FIXED_CONTRACT_STATEMENTS) {
  const item = document.createElement('li')
  item.textContent = statement
  elements.fixedContractList.append(item)
}

elements.settingsClose.addEventListener('click', () => {
  elements.settingsDialog.close()
})
elements.settingsDialog.addEventListener('close', () => {
  scheduleIncomingReviewNoticeDismissal()
})
elements.fixedContractOpen.addEventListener('click', () => {
  if (!elements.fixedContractDialog.open) {
    elements.fixedContractDialog.showModal()
  }
  scheduleIncomingReviewNoticeDismissal()
  elements.fixedContractClose.focus()
})
elements.fixedContractClose.addEventListener('click', closeFixedContract)
elements.fixedContractDone.addEventListener('click', closeFixedContract)
elements.fixedContractDialog.addEventListener('close', () => {
  if (elements.settingsDialog.open) elements.fixedContractOpen.focus()
  scheduleIncomingReviewNoticeDismissal()
})
elements.settingsReset.addEventListener('click', () => {
  void bridge.updateSettings(MarkoverSettings.DEFAULT_SETTINGS).then(applySettings)
})
elements.t3ThreadTitlesRefresh.addEventListener('click', () => {
  void refreshRequestingThreadTitles()
})
elements.codexThreadTitlesRefresh.addEventListener('click', () => {
  void refreshRequestingThreadTitles()
})
elements.claudeThreadTitlesRefresh.addEventListener('click', () => {
  void refreshRequestingThreadTitles()
})
elements.settingsForm.addEventListener('change', (event) => {
  const control = event.target
  if (!(
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement ||
    control instanceof HTMLTextAreaElement
  )) {
    return
  }
  if (
    control instanceof HTMLInputElement &&
    control.type === 'number' &&
    (!Number.isFinite(control.valueAsNumber) || !control.checkValidity())
  ) {
    restoreSettingsForm()
    return
  }
  const value = control instanceof HTMLInputElement && control.type === 'checkbox'
    ? control.checked
    : control instanceof HTMLInputElement && control.type === 'number'
      ? control.valueAsNumber
      : control.value
  void bridge.updateSettings({ [control.name]: value })
    .then(applySettings)
    .catch(() => {
      restoreSettingsForm()
      showToast('Could not save setting')
    })
})

elements.incomingReviewDialogKeep.addEventListener('click', () => {
  clearIncomingReviewWarning()
})
elements.incomingReviewDialogOpen.addEventListener('click', () => {
  const reviewId = incomingReviewWarningId
  const sequence = incomingReviewWarningSequence
  clearIncomingReviewWarning()
  if (reviewId && sequence !== null) {
    void activateIncomingReview(reviewId, true, sequence)
  }
})
elements.incomingReviewDialog.addEventListener('close', () => {
  incomingReviewWarningCount = 0
  incomingReviewWarningId = null
  incomingReviewWarningPrompts = []
  incomingReviewWarningSequence = null
  scheduleIncomingReviewNoticeDismissal()
})
elements.incomingReviewNoticeOpen.addEventListener('click', () => {
  const reviewId = incomingReviewNoticeId
  const sequence = incomingReviewNoticeSequence
  hideIncomingReviewNotice()
  if (reviewId && sequence !== null) {
    void activateIncomingReview(reviewId, true, sequence)
  }
})
elements.incomingReviewNoticeOpen.addEventListener(
  'focus',
  scheduleIncomingReviewNoticeDismissal
)
elements.incomingReviewNoticeOpen.addEventListener(
  'blur',
  scheduleIncomingReviewNoticeDismissal
)

function focusedPane(): PaneLayoutPane {
  const active = document.activeElement
  if (elements.leftPane.contains(active)) return 'left'
  if (elements.rightPane.contains(active)) return 'right'
  return 'center'
}

function focusLeftPane(): void {
  const active = state.reviewId
    ? elements.documentsListTree.querySelector<HTMLElement>(
        `[data-review-id="${CSS.escape(state.reviewId)}"]`
      )
    : null
  if (active) {
    let ancestor = active.parentElement
    while (ancestor && elements.documentsListTree.contains(ancestor)) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
      ancestor = ancestor.parentElement
    }
  }
  const target = active?.querySelector<HTMLElement>('button') ||
    elements.documentsListTree.querySelector<HTMLElement>('summary, button')
  target?.focus()
  if (!target) elements.leftPaneCollapse.focus()
}

function focusAfterInactiveReviewTrashed(): void {
  if (!leftPaneCollapsed) {
    focusLeftPane()
    return
  }
  if (!elements.leftPaneOpen.hidden) elements.leftPaneOpen.focus()
}

function focusPane(pane: PaneLayoutPane): void {
  if (pane === 'left') focusLeftPane()
  else if (pane === 'right') focusRightPane()
  else elements.centerPane.focus()
}

function beginLeftPaneResize(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  const paneLayoutLeft = elements.paneLayout.getBoundingClientRect().left
  const pointerId = event.pointerId
  elements.leftPaneResizer.setPointerCapture(pointerId)
  document.body.classList.add('is-resizing-left-pane')

  const resize = (moveEvent: PointerEvent): void => {
    leftPaneWidth = moveEvent.clientX - paneLayoutLeft
    applyLeftPaneWidth()
    applyRightPaneWidth()
    schedulePaneLayoutResizeUpdate()
  }
  const finish = (): void => {
    elements.leftPaneResizer.removeEventListener('pointermove', resize)
    elements.leftPaneResizer.removeEventListener('pointerup', finish)
    elements.leftPaneResizer.removeEventListener('pointercancel', finish)
    document.body.classList.remove('is-resizing-left-pane')
    if (elements.leftPaneResizer.hasPointerCapture(pointerId)) {
      elements.leftPaneResizer.releasePointerCapture(pointerId)
    }
  }

  elements.leftPaneResizer.addEventListener('pointermove', resize)
  elements.leftPaneResizer.addEventListener('pointerup', finish)
  elements.leftPaneResizer.addEventListener('pointercancel', finish)
}

function beginRightPaneResize(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  const paneLayoutRight = elements.paneLayout.getBoundingClientRect().right
  const pointerId = event.pointerId
  rightPaneWidth = elements.rightPane.getBoundingClientRect().width
  elements.rightPaneResizer.setPointerCapture(pointerId)
  document.body.classList.add('is-resizing-right-pane')

  const resize = (moveEvent: PointerEvent): void => {
    rightPaneWidth = paneLayoutRight - moveEvent.clientX
    applyRightPaneWidth()
    schedulePaneLayoutResizeUpdate()
  }
  const finish = (): void => {
    elements.rightPaneResizer.removeEventListener('pointermove', resize)
    elements.rightPaneResizer.removeEventListener('pointerup', finish)
    elements.rightPaneResizer.removeEventListener('pointercancel', finish)
    document.body.classList.remove('is-resizing-right-pane')
    if (elements.rightPaneResizer.hasPointerCapture(pointerId)) {
      elements.rightPaneResizer.releasePointerCapture(pointerId)
    }
    persistWorkspaceState()
  }

  elements.rightPaneResizer.addEventListener('pointermove', resize)
  elements.rightPaneResizer.addEventListener('pointerup', finish)
  elements.rightPaneResizer.addEventListener('pointercancel', finish)
}

function resizeLeftPaneFromKeyboard(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const step = event.shiftKey ? 48 : 16
  leftPaneWidth += event.key === 'ArrowRight' ? step : -step
  applyLeftPaneWidth()
  applyRightPaneWidth()
  schedulePaneLayoutResizeUpdate()
  persistWorkspaceState()
}

function resizeRightPaneFromKeyboard(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const step = event.shiftKey ? 48 : 16
  rightPaneWidth = elements.rightPane.getBoundingClientRect().width + (
    event.key === 'ArrowLeft' ? step : -step
  )
  applyRightPaneWidth()
  schedulePaneLayoutResizeUpdate()
  persistWorkspaceState()
}

function expandReviewAncestors(reviewId: string): void {
  const projection = reviewInboxProjection()
  for (const project of projection.projects) {
    for (const thread of project.threads) {
      if (!thread.reviews.some((review) => review.reviewId === reviewId)) continue
      projectExpansion.set(project.key, true)
      threadExpansion.set(threadExpansionKey(project.key, thread.key), true)
      return
    }
  }
}

type ReviewActivationFocusSurface = 'left' | null

function reviewActivationFocusSurface(): ReviewActivationFocusSurface {
  const active = document.activeElement
  if (elements.documentsListTree.contains(active)) return 'left'
  return null
}

function restoreReviewActivationFocus(
  reviewId: string,
  surface: ReviewActivationFocusSurface
): void {
  if (!surface) return
  requestAnimationFrame(() => {
    const escapedReviewId = CSS.escape(reviewId)
    const target = elements.documentsListTree.querySelector<HTMLElement>(
      `[data-review-id="${escapedReviewId}"] > button, ` +
      `[data-review-id="${escapedReviewId}"] .review-list-row-open`
    )
    if (target) {
      let ancestor = target.parentElement
      while (ancestor && elements.documentsListTree.contains(ancestor)) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
        ancestor = ancestor.parentElement
      }
    }
    target?.focus({ preventScroll: true })
  })
}

async function activateReview(
  reviewId: string,
  { revealAncestors = true }: { revealAncestors?: boolean } = {}
): Promise<ReviewActivationOutcome> {
  const focusSurface = reviewActivationFocusSurface()
  setAppEmptyState(false)
  if (!reviewSessions.get(reviewId)) return 'missing'
  if (revealAncestors) expandReviewAncestors(reviewId)
  if (reviewId === state.reviewId) {
    renderDocumentsList()
    renderReviewContext()
    restoreReviewActivationFocus(reviewId, focusSurface)
    removeIncomingPrompts(reviewId)
    persistWorkspaceState()
    return 'already-active'
  }
  state.finishAttachmentLabelEdit?.(true)
  const currentReviewId = state.reviewId
  if (currentReviewId && reviewMutations.has(currentReviewId)) {
    await reviewMutations.wait(currentReviewId)
    if (!reviewSessions.get(reviewId)) return 'missing'
    if (reviewId === state.reviewId) {
      removeIncomingPrompts(reviewId)
      return 'already-active'
    }
  }
  if (!finishActiveSourceEdit()) return 'blocked'
  configureManagedMode()

  captureActiveSession()
  const session = reviewSessions.activate(reviewId)
  state.reviewId = session.reviewId
  state.documentName = session.documentName
  state.documentPath = session.documentPath
  state.tree = session.tree
  state.selectedId = session.selectedId
  state.annotatedOnly = session.annotatedOnly
  state.annotationView = session.annotationView
  state.sourceCollapsed = session.sourceCollapsed
  state.collapsedBlockIds = session.collapsedBlockIds
  state.sourceDrafts = session.sourceDrafts
  state.sourceEditingId = session.sourceEditingId
  state.attachmentPreviewUrls = session.attachmentPreviewUrls
  state.hoveredId = null
  bridge.activateReview(reviewId)

  elements.name.textContent = session.documentName
  elements.name.title = session.documentPath || session.documentName
  elements.checksum.textContent = session.checksum
  elements.checksum.title = session.checksum
  elements.sourceToggle.setAttribute(
    'aria-expanded',
    String(!state.sourceCollapsed)
  )
  replaceMarkoverIcon(
    elements.sourceToggleIcon,
    state.sourceCollapsed ? 'chevron-right' : 'chevron-down'
  )
  elements.sourceContent.hidden = state.sourceCollapsed
  closeImagePreview()
  renderTree()

  const selected = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (selected) renderAnnotation(selected)
  renderDocumentsList()
  restoreReviewActivationFocus(reviewId, focusSurface)
  renderReviewContext()
  removeIncomingPrompts(reviewId)
  persistWorkspaceState()
  announceStatus(
    `${session.documentName}. ${reviewStatusLabel(session.tree.review.status)} review.`
  )
  return 'activated'
}

async function handleReviewTrashed(reviewId: string): Promise<void> {
  removeIncomingPrompts(reviewId)
  const wasActive = state.reviewId === reviewId
  const removed = reviewSessions.remove(reviewId)
  if (!removed) return
  const deletedName = removed.documentName
  for (const url of removed.attachmentPreviewUrls.values()) {
    URL.revokeObjectURL(url)
  }
  removed.attachmentPreviewUrls.clear()

  if (!wasActive) {
    renderDocumentsList()
    persistWorkspaceState()
    announceStatus(`${deletedName} moved to Trash.`)
    requestAnimationFrame(focusAfterInactiveReviewTrashed)
    return
  }
  state.reviewId = null
  state.tree = null
  state.attachmentPreviewUrls = new Map()
  state.sourceDrafts = new Map()
  state.sourceEditingId = null
  state.collapsedBlockIds = new Set()
  state.finishAttachmentLabelEdit = null
  closeImagePreview()
  const next = reviewSessions.recent(1)[0]
  if (next) {
    await activateReview(next.reviewId)
    requestAnimationFrame(() => { elements.centerPane.focus() })
  } else {
    renderDocumentsList()
    setAppEmptyState(true)
    persistWorkspaceState()
    requestAnimationFrame(() => { elements.emptyOpenButton.focus() })
  }
  announceStatus(`${deletedName} moved to Trash.`)
}

function addManagedReview(
  documentData: ReviewSessionDocument,
  activate = true
): ReviewSession {
  const reviewId = documentData.reviewId || documentData.tree.review.id
  const existed = Boolean(reviewSessions.get(reviewId))
  const session = reviewSessions.add(documentData)
  if (!existed) {
    const normalized = MarkoverAnnotations.normalizeFilter(
      session.tree.root,
      session.selectedId,
      preferences.defaultTreeView === 'annotated'
    )
    session.annotatedOnly = normalized.enabled
    session.selectedId = normalized.selectedId
  }
  if (activate) void activateReview(session.reviewId)
  else renderDocumentsList()
  return session
}

function managedReviewDocument(
  documentData: MarkoverDocument
): ReviewSessionDocument {
  if (
    !documentData.reviewId ||
    !documentData.tree ||
    !isReviewSessionTree(documentData.tree)
  ) {
    throw new Error('Managed review data is missing its review envelope.')
  }
  return {
    reviewId: documentData.reviewId,
    name: documentData.name,
    path: documentData.path,
    checksum: documentData.checksum,
    tree: documentData.tree,
    project: documentData.project || null,
    projectEvidence: documentData.projectEvidence || 'unavailable',
    sourceState: documentData.sourceState || 'unavailable'
  }
}

function configureManagedMode(): void {
  elements.openButton.hidden = true
  elements.annotationGuidance.textContent =
    'Annotations autosave continuously. Ask the agent to check Markover when you’re done.'
}

function captureReviewList(
  items: MarkoverReviewListItem[]
): MarkoverDocument[] {
  incompatibleReviews = items.filter(
    (item): item is MarkoverIncompatibleReview => 'kind' in item
  )
  return items.filter((item): item is MarkoverDocument => !('kind' in item))
}

async function loadDocument(documentData: MarkoverDocument): Promise<void> {
  setAppEmptyState(false)
  const checksum = documentData.checksum || await bridge.checksum(documentData.source)
  if (
    documentData.reviewId &&
    documentData.tree &&
    isReviewSessionTree(documentData.tree)
  ) {
    const session = addManagedReview(managedReviewDocument({
      ...documentData,
      checksum
    }), false)
    await activateReview(session.reviewId)
    return
  }

  state.documentName = documentData.name || 'Untitled'
  state.documentPath = documentData.path || null
  state.tree = documentData.tree || MarkoverTree.parseMarkdown(
    documentData.source,
    checksum,
    {
      name: documentData.name,
      path: documentData.path
    }
  )
  state.reviewId = documentData.reviewId || (
    isReviewSessionTree(state.tree) ? state.tree.review.id : null
  )
  state.selectedId = state.tree.root.children[0]?.id || null
  const normalizedFilter = MarkoverAnnotations.normalizeFilter(
    state.tree.root,
    state.selectedId,
    preferences.defaultTreeView === 'annotated'
  )
  state.annotatedOnly = normalizedFilter.enabled
  state.selectedId = normalizedFilter.selectedId
  state.annotationView = 'selected'
  state.sourceCollapsed = false
  state.sourceDrafts = new Map()
  state.sourceEditingId = null

  elements.name.textContent = state.documentName
  elements.name.title = state.documentPath || state.documentName
  elements.checksum.textContent = checksum
  elements.checksum.title = checksum
  renderTree()

  if (state.selectedId) {
    const selected = MarkoverTree.findNode(state.tree.root, state.selectedId)
    if (selected) renderAnnotation(selected)
  }
  autosaveReview()
}

elements.annotationInput.addEventListener('input', () => {
  if (!isCurrentReviewEditable()) return
  const node = MarkoverTree.findNode(currentTree().root, state.selectedId)
  if (!node) return
  const wasAnnotated = hasAnnotation(node)
  node.feedback = elements.annotationInput.value
  const isAnnotated = hasAnnotation(node)
  if (wasAnnotated !== isAnnotated) {
    elements.annotationState.textContent = isAnnotated
      ? 'Annotated'
      : 'Not annotated'
    const selectionChanged = normalizeAnnotatedSelection()
    renderTreePreservingScroll()
    if (selectionChanged) {
      const selected = MarkoverTree.findNode(currentTree().root, state.selectedId)
      if (selected) renderAnnotation(selected)
      persistWorkspaceState()
    }
  }
  updateAnnotationCount()
  autosaveReview()
  elements.annotationInput.focus()
})

async function pasteImages(event: ClipboardEvent): Promise<void> {
  if (!isCurrentReviewEditable()) {
    event.preventDefault()
    showToast('This review is with the agent and read only')
    return
  }
  const originReviewId = state.reviewId
  const originTree = state.tree
  if (!originTree) return
  const originPreviewUrls = state.attachmentPreviewUrls
  const originSelectedId = state.selectedId
  const node = MarkoverTree.findNode(originTree.root, originSelectedId)
  if (!node) return

  const imageItems = [...(event.clipboardData?.items || [])]
    .filter((item) => item.type.startsWith('image/'))
  const pastedImages: Array<MarkoverClipboardImage & { preview: Blob }> = []

  for (const item of imageItems) {
    const file = item.getAsFile()
    if (!file) continue
    pastedImages.push({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type || item.type,
      preview: file
    })
  }

  if (!pastedImages.length) {
    const clipboardImage = await bridge.readClipboardImage()
    if (clipboardImage) {
      const bytes = new Uint8Array(clipboardImage.bytes)
      pastedImages.push({
        bytes,
        mimeType: clipboardImage.mimeType,
        preview: new Blob([bytes.buffer], { type: clipboardImage.mimeType })
      })
    }
  }

  if (!pastedImages.length) return

  event.preventDefault()
  if (!originReviewId) {
    showToast('Attachments are available in managed reviews')
    return
  }

  let savedImageCount = 0
  for (const pastedImage of pastedImages) {
    try {
      const attachment = await bridge.saveAttachment(
        {
          bytes: pastedImage.bytes,
          mimeType: pastedImage.mimeType
        },
        originReviewId
      )
      const attachments = node.attachments ??= []
      attachments.push(attachment)
      savedImageCount += 1
      originPreviewUrls.set(
        attachment.id,
        URL.createObjectURL(pastedImage.preview)
      )

      const marker = `[!${attachment.id}]`
      const start = elements.annotationInput.selectionStart
      const end = elements.annotationInput.selectionEnd
      elements.annotationInput.setRangeText(marker, start, end, 'end')
      node.feedback = elements.annotationInput.value
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not attach pasted image')
    }
  }

  autosaveTree(originReviewId, originTree)
  if (state.reviewId !== originReviewId) return

  elements.annotationState.textContent = hasAnnotation(node)
    ? 'Annotated'
    : 'Not annotated'
  renderAttachmentList(node)
  renderTree()
  updateAnnotationCount()
  if (savedImageCount > 0) {
    announceStatus(
      `${String(savedImageCount)} screenshot${savedImageCount === 1 ? '' : 's'} attached.`
    )
  }
  focusRightPane()
}

elements.annotationInput.addEventListener('paste', (event) => {
  const reviewId = state.reviewId || 'local'
  reviewMutations.track(reviewId, pasteImages(event)).catch(() => {})
})

async function openMarkdownDocument(): Promise<void> {
  if (localOpenInProgress || !finishActiveSourceEdit()) return
  localOpenInProgress = true
  try {
    const candidate = await bridge.openMarkdown()
    if (!candidate) return
    const tree = MarkoverTree.parseMarkdown(
      candidate.source,
      candidate.checksum,
      { name: candidate.name, path: candidate.path }
    )
    const reviewDocument = await bridge.createLocalReview(tree)
    await loadDocument(reviewDocument)
    elements.centerPane.focus()
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Could not open Markdown')
  } finally {
    localOpenInProgress = false
  }
}

elements.openButton.addEventListener('click', () => {
  void openMarkdownDocument()
})
elements.emptyOpenButton.addEventListener('click', () => {
  void openMarkdownDocument()
})

elements.copyTreeButton.addEventListener('click', () => {
  if (!finishActiveSourceEdit()) return
  bridge.copyText(MarkoverTree.serializeTree(currentTree()))
  showToast('Feedback JSON copied')
})

elements.sourceToggle.addEventListener('click', () => {
  state.sourceCollapsed = !state.sourceCollapsed
  elements.sourceToggle.setAttribute(
    'aria-expanded',
    String(!state.sourceCollapsed)
  )
  replaceMarkoverIcon(
    elements.sourceToggleIcon,
    state.sourceCollapsed ? 'chevron-right' : 'chevron-down'
  )
  const node = MarkoverTree.findNode(currentTree().root, state.selectedId)
  if (node) renderSourcePanel(node)
  persistWorkspaceState()
})

elements.treeViewAll.addEventListener('click', () => {
  setAnnotatedOnly(false)
})
elements.treeViewAnnotated.addEventListener('click', () => {
  setAnnotatedOnly(true)
})
elements.selectedLocation.addEventListener('click', scrollToSelectedRow)
elements.annotationViewSelected.addEventListener('click', () => {
  setAnnotationView('selected')
})
elements.annotationViewList.addEventListener('click', () => {
  setAnnotationView('list')
})
function moveAnnotationViewTabFromKeyboard(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = [elements.annotationViewSelected, elements.annotationViewList]
    .filter((tab) => !tab.disabled)
  const currentIndex = tabs.indexOf(event.currentTarget as HTMLButtonElement)
  if (currentIndex < 0 || tabs.length === 0) return
  const targetIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : event.key === 'ArrowLeft'
        ? (currentIndex - 1 + tabs.length) % tabs.length
        : (currentIndex + 1) % tabs.length
  const target = tabs[targetIndex]
  if (!target) return
  event.preventDefault()
  const direction = target === elements.annotationViewSelected ? 'selected' : 'list'
  setAnnotationView(direction)
  requestAnimationFrame(() => { target.focus() })
}
elements.annotationViewSelected.addEventListener(
  'keydown',
  moveAnnotationViewTabFromKeyboard
)
elements.annotationViewList.addEventListener(
  'keydown',
  moveAnnotationViewTabFromKeyboard
)
MarkoverAnnotationBlock.bindListKeyboard(elements.annotationListView, {
  edit() {
    const selected = elements.annotationList.querySelector<HTMLElement>(
      '.rendered-annotation.is-selected'
    )
    if (!selected) return
    const edit = selected.querySelector<HTMLButtonElement>('.rendered-annotation-edit')
    if (edit) edit.click()
    else setAnnotationView('selected')
  },
  move(offset) {
    const nodes = annotatedNodes()
    const currentId = MarkoverAnnotations.nearestAnnotatedId(
      currentTree().root,
      state.selectedId
    )
    const index = nodes.findIndex((node) => node.id === currentId)
    const next = nodes[Math.max(0, Math.min(nodes.length - 1, index + offset))]
    if (next) selectAnnotationFromList(next)
  }
})
new ResizeObserver(() => {
  MarkoverAnnotationBlock.updateTruncation(elements.annotationList)
}).observe(elements.annotationListView)

elements.sourceEdit.addEventListener('click', () => {
  const node = MarkoverTree.findNode(currentTree().root, state.selectedId)
  if (node) beginSourceEdit(node)
})

elements.sourceRevert.addEventListener('click', () => {
  const node = MarkoverTree.findNode(currentTree().root, state.selectedId)
  if (node) revertSourceEdit(node)
})

elements.sourceCancel.addEventListener('click', () => {
  const node = MarkoverTree.findNode(currentTree().root, state.selectedId)
  if (node) cancelSourceEdit(node)
})

elements.sourceSave.addEventListener('click', () => {
  const node = MarkoverTree.findNode(currentTree().root, state.selectedId)
  if (node) saveSourceEdit(node)
})

elements.sourceEditor.addEventListener('input', () => {
  const node = MarkoverTree.findNode(currentTree().root, state.selectedId)
  if (!node || state.sourceEditingId !== node.id) return
  const current = elements.sourceEditor.value
  MarkoverSourceEdits.update(state, node, current)
  const savedSource = MarkoverSourceEdits.savedSource(node)
  elements.sourceSaveBar.hidden = current === savedSource
  elements.sourceSave.disabled = !current.trim()
})

elements.sourceEditor.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  const node = MarkoverTree.findNode(currentTree().root, state.selectedId)
  if (node) cancelSourceEdit(node)
})

elements.sourcePanel.addEventListener('mouseenter', showSourceErrorTooltip)
elements.sourcePanel.addEventListener('mouseleave', leaveSourceErrorTooltip)
elements.sourcePanel.addEventListener('focusin', showSourceErrorTooltip)
elements.sourcePanel.addEventListener('focusout', blurSourceErrorTooltip)

elements.imagePreviewClose.addEventListener('click', closeImagePreview)
elements.imagePreview.addEventListener('click', (event) => {
  if (event.target === elements.imagePreview) closeImagePreview()
})
elements.imagePreview.addEventListener('close', () => {
  const returnFocus = imagePreviewReturnFocus
  imagePreviewReturnFocus = null
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  scheduleIncomingReviewNoticeDismissal()
})
elements.reviewContextButton.addEventListener('click', () => {
  if (!elements.reviewContextDrawer.open) openReviewContext()
  else closeReviewContext()
})
elements.reviewContextClose.addEventListener('click', () => {
  closeReviewContext()
})
elements.documentReviewId.addEventListener('click', () => {
  if (!state.reviewId) return
  bridge.copyText(state.reviewId)
  showToast('Review ID copied')
})
elements.reviewIdInput.addEventListener('input', () => {
  elements.reviewIdInput.setCustomValidity('')
})
elements.reviewIdActivation.addEventListener('submit', (event) => {
  event.preventDefault()
  const reviewId = elements.reviewIdInput.value.trim()
  elements.reviewIdInput.value = reviewId
  elements.reviewIdInput.setCustomValidity('')
  if (!elements.reviewIdInput.reportValidity()) return
  if (!reviewSessions.get(reviewId)) {
    elements.reviewIdInput.setCustomValidity(
      `No review with ID ${reviewId} is available in this Markover instance.`
    )
    elements.reviewIdInput.reportValidity()
    return
  }
  void activateReview(reviewId).then((outcome) => {
    if (outcome === 'activated' || outcome === 'already-active') {
      elements.reviewIdInput.value = ''
    } else if (outcome === 'blocked') {
      showToast('Finish or cancel the source edit before opening another review')
    }
  })
})
elements.leftPaneCollapse.addEventListener('click', () => {
  setLeftPaneCollapsed(true)
})
elements.leftPaneOpen.addEventListener('click', () => {
  setLeftPaneCollapsed(false)
})
elements.reviewNavigationInbox.addEventListener('click', () => {
  selectedReviewIds.clear()
  setReviewNavigationMode('inbox')
})
elements.reviewNavigationProjects.addEventListener('click', () => {
  selectedReviewIds.clear()
  setReviewNavigationMode('projects')
})
elements.reviewFilter.addEventListener('change', () => {
  const value = elements.reviewFilter.value
  if (
    value !== 'needs-me' &&
    value !== 'with-agent' &&
    value !== 'completed' &&
    value !== 'all'
  ) return
  reviewFilter = value
  selectedReviewIds.clear()
  inboxHistoryLimit = INBOX_HISTORY_PAGE_SIZE
  renderDocumentsList()
  requestAnimationFrame(() => {
    elements.reviewFilter.focus()
  })
})
async function resolveSelectedReviews(
  outcome: ManualReviewResolutionRequestOutcome
): Promise<void> {
  const reviewIds = [...selectedReviewIds]
  if (!reviewIds.length) return
  try {
    const result = await bridge.resolveReviews({ reviewIds, outcome })
    if (result.outcome === 'resolved') {
      selectedReviewIds.clear()
      showToast(`${String(result.reviews.length)} review${result.reviews.length === 1 ? '' : 's'} completed`)
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error))
  }
  renderDocumentsList()
}
elements.reviewBatchNoNotes.addEventListener('click', () => {
  void resolveSelectedReviews('reviewed-no-notes')
})
elements.reviewBatchAccept.addEventListener('click', () => {
  void resolveSelectedReviews('accepted-unreviewed')
})
elements.reviewBatchClose.addEventListener('click', () => {
  batchResolutionMode = false
  selectedReviewIds.clear()
  renderDocumentsList()
  elements.reviewFilter.focus()
})
elements.reviewResolutionCancel.addEventListener('click', () => {
  finishResolutionConfirmation(false)
})
elements.reviewResolutionConfirm.addEventListener('click', () => {
  finishResolutionConfirmation(true)
})
elements.reviewResolutionDialog.addEventListener('close', () => {
  finishResolutionConfirmation(false)
})
elements.leftPaneResizer.addEventListener(
  'pointerdown',
  beginLeftPaneResize
)
elements.leftPaneResizer.addEventListener(
  'keydown',
  resizeLeftPaneFromKeyboard
)
elements.documentsListTree.addEventListener('scroll', hideReviewHoverCard)
elements.rightPaneResizer.addEventListener(
  'pointerdown',
  beginRightPaneResize
)
elements.rightPaneResizer.addEventListener(
  'keydown',
  resizeRightPaneFromKeyboard
)

MarkoverAnnotationBlock.bindDismiss(elements.tree, 'scroll', () => {
  hideAnnotationSneakPeek()
  updatePinnedSelection()
})
window.addEventListener('resize', () => {
  hideAnnotationSneakPeek()
  hideReviewHoverCard()
  if (!elements.sourceErrorTooltip.hidden) showSourceErrorTooltip()
  applyLeftPaneWidth()
  applyRightPaneWidth()
  updatePinnedSelection()
  MarkoverAnnotationBlock.updateTruncation(elements.annotationList)
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Control') {
    document.body.classList.add('is-control-pressed')
  }

  if (elements.settingsDialog.open || elements.incomingReviewDialog.open) return

  if (event.key === 'Escape' && elements.imagePreview.open) {
    event.preventDefault()
    closeImagePreview()
    return
  }
  if (event.key === 'Escape' && elements.reviewContextDrawer.open) {
    event.preventDefault()
    closeReviewContext()
    return
  }
  if (event.key === 'Tab' && event.ctrlKey && reviewSessions.list().length) {
    event.preventDefault()
    if (!state.reviewId) return
    const adjacent = reviewSessions.adjacent(
      state.reviewId,
      event.shiftKey ? -1 : 1
    )
    if (adjacent) void activateReview(adjacent.reviewId)
    return
  }

  if (event.key === 'F6' && state.tree) {
    event.preventDefault()
    const leftPaneVisible = reviewSessions.list().length > 0 && !leftPaneCollapsed
    const currentPane = focusedPane()
    const pane = MarkoverNavigation.nextPane(
      currentPane,
      event.shiftKey ? -1 : 1,
      leftPaneVisible
    )
    elements.rightPane.classList.remove('focus-within')
    focusPane(pane)
    return
  }

  if (
    document.activeElement !== elements.centerPane ||
    !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
  ) {
    return
  }

  event.preventDefault()
  const directionByKey: Partial<Record<string, NavigationDirection>> = {
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up'
  }
  const direction = directionByKey[event.key]
  if (!direction) return
  const tree = currentTree()
  const current = MarkoverTree.findNode(tree.root, state.selectedId)
  if (
    !state.annotatedOnly &&
    direction === 'right' &&
    current?.children.length &&
    state.collapsedBlockIds.has(current.id)
  ) {
    state.collapsedBlockIds.delete(current.id)
    persistWorkspaceState()
  }
  const navigationRoot = state.annotatedOnly
    ? MarkoverAnnotations.navigationRoot(tree.root)
    : tree.root
  const nextId = MarkoverNavigation.move(navigationRoot, state.selectedId, direction)
  if (nextId) selectNode(nextId, true)
})

document.addEventListener('keyup', (event) => {
  if (event.key === 'Control') {
    document.body.classList.remove('is-control-pressed')
  }
})

window.addEventListener('blur', () => {
  document.body.classList.remove('is-control-pressed')
})

elements.centerPane.addEventListener('focus', () => {
  elements.rightPane.classList.remove('focus-within')
})

async function rendererStartupPhase<T>(
  info: StartupInfo,
  phase: StartupPhase,
  operation: () => T | Promise<T>,
  report = true
): Promise<T> {
  startupUi.phase(phase)
  if (report) await bridge.reportStartupPhase({ phase, state: 'begin' })
  if (info.failPhase === phase) {
    throw new Error(`Development startup failure at ${phase}.`)
  }
  if (info.holdPhase === phase) {
    await new Promise<void>(() => {})
  }
  const result = await operation()
  if (report) await bridge.reportStartupPhase({ phase, state: 'complete' })
  return result
}

function showStartupWarnings(warnings: StartupWarning[]): void {
  if (!warnings.length) return
  clearToastActionability()
  elements.toast.textContent = warnings.length === 1
    ? 'Startup recovered one item. Click to show the diagnostic.'
    : `Startup recovered or skipped ${String(warnings.length)} items. Click to show the diagnostic.`
  elements.toast.classList.add('is-visible', 'is-actionable')
  elements.toast.setAttribute('aria-hidden', 'false')
  elements.toast.setAttribute('role', 'button')
  elements.toast.tabIndex = 0
  const reveal = (): void => {
    void bridge.revealStartupDiagnostic()
  }
  elements.toast.onclick = reveal
  const revealFromKeyboard = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    reveal()
  }
  elements.toast.onkeydown = revealFromKeyboard
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}

async function rendererSmokeResult(): Promise<{
  format: 'markover-renderer-smoke'
  version: 1
  diagnostics: string[]
  checks: {
    blobImage: boolean
    cleanRuntime: boolean
    dataImage: boolean
    documentsList: boolean
    attachmentImage: boolean
    markdown: boolean
    navigationDenied: boolean
    permissionDenied: boolean
    sandboxedRenderer: boolean
    sourceDiff: boolean
    webviewDenied: boolean
    windowOpenDenied: boolean
    yaml: boolean
  }
}> {
  await nextFrame()
  const treeText = elements.tree.textContent || ''
  const documentsList = Boolean(
    elements.documentsListTree.querySelector('.review-list-row')
  )
  const sourceNode = MarkoverTree.findNode(currentTree().root, 'smoke-heading')
  let sourceDiff = false
  if (sourceNode?.sourceEdit) {
    await loadSourceDiffModule()
    selectNode(sourceNode.id, false)
    renderSourcePanel(sourceNode)
    await nextFrame()
    sourceDiff = sourceDiffCleanup !== null &&
      elements.sourceDiffStats.textContent.includes('+1') &&
      elements.sourceDiffStats.textContent.includes('−1')
  }
  const attachmentImage = elements.attachmentList.querySelector<HTMLImageElement>(
    'img[alt="Packaged local image"]'
  )
  if (attachmentImage && !attachmentImage.complete) {
    await Promise.race([
      new Promise<void>((resolve) => {
        attachmentImage.addEventListener('load', () => { resolve() }, { once: true })
        attachmentImage.addEventListener('error', () => { resolve() }, { once: true })
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 1000))
    ])
  }
  const blobUrl = URL.createObjectURL(new Blob([
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
  ], { type: 'image/svg+xml' }))
  const blobImage = new Image()
  const blobImageLoaded = await new Promise<boolean>((resolve) => {
    blobImage.addEventListener('load', () => { resolve(true) }, { once: true })
    blobImage.addEventListener('error', () => { resolve(false) }, { once: true })
    blobImage.src = blobUrl
  })
  URL.revokeObjectURL(blobUrl)
  const popup = window.open('https://example.invalid/markover-smoke')
  const windowOpenDenied = popup === null
  popup?.close()
  const webview = document.createElement('webview')
  document.body.append(webview)
  await nextFrame()
  const webviewDenied = !Reflect.has(webview, 'getWebContentsId')
  webview.remove()
  const permissionState = await navigator.permissions.query({
    name: 'geolocation'
  })
  const notificationPermission = await Notification.requestPermission()
  const originalUrl = window.location.href
  window.location.assign('https://example.invalid/markover-smoke-navigation')
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
  return {
    format: 'markover-renderer-smoke',
    version: 1,
    diagnostics: [...smokeRuntimeDiagnostics],
    checks: {
      blobImage: blobImageLoaded,
      cleanRuntime: smokeRuntimeClean,
      dataImage: elements.brandMark.src.startsWith('data:image/svg+xml') &&
        elements.brandMark.complete && elements.brandMark.naturalWidth > 0,
      documentsList,
      attachmentImage: Boolean(
        attachmentImage?.complete && attachmentImage.naturalWidth > 0
      ),
      markdown: treeText.includes('Bundled Markdown renders here.'),
      navigationDenied: window.location.href === originalUrl,
      permissionDenied: permissionState.state === 'denied' &&
        notificationPermission === 'denied',
      sandboxedRenderer: !Reflect.has(globalThis, 'process') &&
        !Reflect.has(globalThis, 'require'),
      sourceDiff,
      webviewDenied,
      windowOpenDenied,
      yaml: Boolean(elements.tree.querySelector('[data-node-id="smoke-yaml-title"]'))
    }
  }
}

async function initialize(): Promise<void> {
  const startupInfo = await bridge.getStartupInfo()
  startupUi.development(startupInfo.development)
  if (startupInfo.elementCallouts) {
    const callouts = installDevelopmentElementCallouts(document, {
      copyText: bridge.copyText,
      notify: showToast
    })
    developmentElementCallouts = callouts
    bridge.onDevelopmentElementCallout((command) => callouts.handle(command))
  }
  bridge.onWindowFocusChanged((focusState) => {
    windowFocusStateVersion += 1
    windowFocusState = focusState
    scheduleIncomingReviewNoticeDismissal()
    if (focusState.focused) void refreshRequestingThreadTitles()
  })
  const initialFocusStateVersion = windowFocusStateVersion
  const initialFocusState = await bridge.getWindowFocusState()
  if (windowFocusStateVersion === initialFocusStateVersion) {
    windowFocusState = initialFocusState
  }
  bridge.onOpenMarkdownRequested(() => {
    void openMarkdownDocument()
  })
  bridge.onSettingsOpen(openSettings)
  bridge.onSettingsChanged((settings) => {
    applySettings(settings)
  })
  await rendererStartupPhase(startupInfo, 'loading-settings', async () => {
    applySettings(await bridge.getSettings(), { initial: true })
  }, false)
  await rendererStartupPhase(startupInfo, 'loading-brand', themeBrandAssets)

  bridge.onReviewOpened((reviewDocument) => {
    return queueIncomingReview(reviewDocument)
  })
  bridge.onReviewUpdated((reviewDocument) => {
    const document = managedReviewDocument(reviewDocument)
    const reviewId = document.reviewId || document.tree.review.id
    const previousStatus = reviewSessions.get(reviewId)?.tree.review.status
    let session = reviewSessions.updateDocument(document)
    if (!session) {
      addManagedReview(document, false)
      session = reviewSessions.get(reviewDocument.reviewId || '')
    }
    if (!session) return
    normalizeSessionWorkspaceState(session)
    renderDocumentsListPreservingFocus()
    void refreshRequestingThreadTitles()
    if (session.reviewId === state.reviewId) {
      state.tree = session.tree
      state.selectedId = session.selectedId
      renderTree()
      const selected = MarkoverTree.findNode(currentTree().root, state.selectedId)
      if (selected) renderAnnotation(selected)
      renderReviewContext()
    } else if (
      previousStatus === 'agent-reviewing' &&
      session.tree.review.status === 'reviewed'
    ) {
      showIncomingReviewNotice(session, ++incomingReviewSequence)
    }
    persistWorkspaceState()
  })
  bridge.onReviewTrashed(({ reviewId }) => {
    void handleReviewTrashed(reviewId).catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error))
    })
  })
  bridge.onReviewActivationRequested(async ({ reviewId, document, focusState }) => {
    if (!document) {
      showToast(`Review ${reviewId} was not found in this Markover instance`)
      return 'missing'
    }
    return handleReviewLink(document, focusState)
  })
  bridge.onReviewResolutionConfirmation((request) => (
    showReviewResolutionConfirmation(request)
  ))
  bridge.onReviewBatchModeRequested(() => {
    if (!batchResolutionMode) {
      batchResolutionMode = true
      selectedReviewIds.clear()
      renderDocumentsList()
    }
    requestAnimationFrame(() => {
      elements.reviewBatchClose.focus()
    })
  })
  bridge.onReviewStatus(async ({ reviewId, status }) => {
    let session = reviewSessions.updateStatus(reviewId, status)
    if (!session) {
      const reviews = captureReviewList(await bridge.getReviews())
      for (const document of reviews) {
        addManagedReview(managedReviewDocument(document), false)
      }
      renderDocumentsList()
      session = reviewSessions.updateStatus(reviewId, status)
    }
    if (!session) {
      throw new Error(`Cannot update missing review ${reviewId}.`)
    }
    renderDocumentsListPreservingFocus()
    if (reviewId === state.reviewId) {
      const selected = MarkoverTree.findNode(currentTree().root, state.selectedId)
      if (selected) renderAnnotation(selected)
      renderReviewContext()
    }
    announceStatus(
      `${session.documentName} is now ${reviewStatusLabel(status)}.`
    )
  })
  const applyReviewAutosaveStatus = ({
    failedReviewIds
  }: ReviewAutosaveStatus): void => {
    const message = autosaveFailureMessage(failedReviewIds)
    elements.durabilityWarning.textContent = message || ''
    elements.durabilityWarning.hidden = message === null
  }
  bridge.onReviewAutosaveStatus(applyReviewAutosaveStatus)
  applyReviewAutosaveStatus(await bridge.getReviewAutosaveStatus())
  bridge.onReviewShutdownState((paused) => {
    elements.appShell.inert = paused
    document.documentElement.classList.toggle('is-shutting-down', paused)
  })
  bridge.onReviewSnapshotRequested(async ({ reviewId, purpose }) => {
    const paneHadFocus = (
      reviewId === state.reviewId &&
      elements.rightPane.contains(document.activeElement)
    )
    if (reviewId === state.reviewId) {
      state.finishAttachmentLabelEdit?.(true)
      if (!finishActiveSourceEdit()) {
        throw new Error(
          purpose === 'handoff'
            ? 'Finish or cancel the empty source edit before handoff.'
            : 'Finish or cancel the empty source edit before Markover can quit.'
        )
      }
    }
    const session = reviewSessions.get(reviewId)
    if (!session) throw new Error(`Cannot snapshot missing review ${reviewId}.`)
    if (purpose === 'handoff') {
      reviewSessions.updateStatus(reviewId, 'handoff-in-progress')
      renderDocumentsList()
      if (reviewId === state.reviewId) {
        const selected = MarkoverTree.findNode(currentTree().root, state.selectedId)
        if (selected) renderAnnotation(selected)
        renderReviewContext()
        if (paneHadFocus) focusRightPane()
      }
    }
    await reviewMutations.wait(reviewId)
    return reviewSessions.snapshot(reviewId)
  })

  let reviewDocument: MarkoverDocument | null = null
  let reviewList: MarkoverReviewListItem[] = []
  await rendererStartupPhase(startupInfo, 'restoring-reviews', async () => {
    reviewDocument = await bridge.getInitialReview()
    if (!reviewDocument || reviewDocument.reviewId) {
      reviewList = await bridge.getReviews()
    }
  })
  await rendererStartupPhase(startupInfo, 'restoring-workspace', async () => {
    const reviews = captureReviewList(reviewList)
    if (reviewList.length) {
      configureManagedMode()
      for (const document of reviews) {
        addManagedReview(managedReviewDocument(document), false)
      }
    }
    const restored = applyWorkspaceState(await bridge.getWorkspaceState())
    setReviewNavigationMode(restored.navigationMode, false)
    const explicitlyActivatedReviewId = reviewDocument?.reviewId &&
      reviewSessions.get(reviewDocument.reviewId)
      ? reviewDocument.reviewId
      : null
    const activeReviewId = explicitlyActivatedReviewId ||
      restored.activeReviewId ||
      reviewSessions.recent(1)[0]?.reviewId ||
      null
    if (activeReviewId) {
      await activateReview(activeReviewId, {
        revealAncestors: explicitlyActivatedReviewId !== null
      })
    } else {
      setAppEmptyState(true)
    }
    applyRightPaneWidth()
    workspaceStateReady = true
    persistWorkspaceState()
    renderDocumentsList()
    void refreshRequestingThreadTitles()
    if (state.reviewId) elements.centerPane.focus()
    else if (incompatibleReviews.length) {
      elements.documentsListTree.querySelector<HTMLButtonElement>(
        '.incompatible-review-copy'
      )?.focus()
    } else elements.emptyOpenButton.focus()
  })

  const warnings: StartupWarning[] = brandFallbackUsed
    ? [{ category: 'brand-fallback', subject: 'canonical brand assets' }]
    : []
  startupUi.phase('publishing-service')
  const ready = await bridge.reportRendererInitialized({ warnings })
  startupUi.phase('ready')
  startupUi.ready()
  showStartupWarnings(userFacingStartupWarnings(ready.warnings))
  if (startupInfo.smoke) {
    if (ready.warnings.length) smokeRuntimeClean = false
    await bridge.reportSmokeResult(await rendererSmokeResult())
  }
}

applyLeftPaneWidth()
applyRightPaneWidth()
void initialize().catch(async (error: unknown) => {
  startupUi.fail()
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack || null : null
  try {
    const failure = await bridge.reportStartupFailure({
      category: 'renderer-initialization',
      message,
      stack
    })
    startupUi.fail(failure.diagnosticAvailable)
  } catch (reportError) {
    console.error('Failed to record renderer startup failure', reportError)
  }
  console.error('Markover renderer startup failed', error)
})

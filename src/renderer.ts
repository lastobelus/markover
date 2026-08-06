interface MarkdownToken {
  attrGet(name: string): string | null
  content: string
}

interface MarkdownParser {
  enable(rule: string): void
  render(value: string): string
  renderInline(value: string): string
  renderer: {
    rules: Record<
      string,
      ((tokens: MarkdownToken[], index: number) => string) | undefined
    >
  }
  utils: { escapeHtml(value: string): string }
}

type MarkdownItFactory = (
  preset: string,
  options: Record<string, boolean>
) => MarkdownParser
type FileTreeModel = InstanceType<MarkoverFileTreeConstructor>

interface Window {
  markdownit: MarkdownItFactory
}

interface RendererState {
  attachmentPreviewUrls: Map<string, string>
  documentName: string
  documentPath: string | null
  durableReview: boolean
  fallbackAttachmentSequence: number
  finishAttachmentLabelEdit: ((commit?: boolean) => void) | null
  hoveredId: string | null
  reviewId: string | null
  reviewMode: boolean
  selectedId: string | null
  annotatedOnly: boolean
  annotationView: 'selected' | 'list'
  sourceCollapsed: boolean
  sourceDrafts: Map<string, string>
  sourceEditingId: string | null
  tree: ReviewTree | null
}

interface DocumentsListProjection {
  decorations: Map<string, string>
  icons: MarkoverFileTreeIcons
  paths: string[]
  pathToReviewId: Map<string, string>
  projectPaths: string[]
  reviewIdToPath: Map<string, string>
  sortOrder: Map<string, number>
  statuses: Map<string, ReviewSessionStatus>
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
    value === 'handoff-in-progress'
}

function isReviewSessionTree(tree: ReviewTree): tree is ReviewSessionTree {
  const review = tree.review
  return isRecord(review) &&
    typeof review.id === 'string' &&
    isReviewStatus(review.status)
}

function isDirectoryHandle(
  item: MarkoverFileTreeItemHandle | null
): item is MarkoverFileTreeDirectoryHandle {
  return item?.isDirectory() === true
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
  appHeader: requiredElement('.app-header'),
  annotationCount: requiredElement('#annotation-count'),
  annotationGuidance: requiredElement('#annotation-guidance'),
  annotationInput: requiredElement<HTMLTextAreaElement>('#annotation-input'),
  annotationList: requiredElement('#annotation-list'),
  annotationListView: requiredElement('#annotation-list-view'),
  annotationPane: requiredElement('#annotation-pane'),
  annotationReadonly: requiredElement('#annotation-readonly'),
  annotationSneakPeek: requiredElement('#annotation-sneak-peek'),
  annotationState: requiredElement('#annotation-state'),
  annotationViewList: requiredElement<HTMLButtonElement>('#annotation-view-list'),
  annotationViewSelected: requiredElement<HTMLButtonElement>('#annotation-view-selected'),
  attachmentList: requiredElement('#attachment-list'),
  brandLogotype: requiredElement<HTMLImageElement>('#brand-logotype'),
  brandMark: requiredElement<HTMLImageElement>('#brand-mark'),
  cancelReviewButton: requiredElement<HTMLButtonElement>('#cancel-review-button'),
  checksum: requiredElement('#document-checksum'),
  copyTreeButton: requiredElement<HTMLButtonElement>('#copy-tree-button'),
  emptyOpenButton: requiredElement<HTMLButtonElement>('#empty-open-button'),
  emptyWorkspace: requiredElement('#empty-workspace'),
  documentTabs: requiredElement('#document-tabs'),
  doneReviewButton: requiredElement<HTMLButtonElement>('#done-review-button'),
  imagePreview: requiredElement('#image-preview'),
  imagePreviewClose: requiredElement<HTMLButtonElement>('#image-preview-close'),
  imagePreviewContent: requiredElement<HTMLImageElement>('#image-preview-content'),
  imagePreviewLabel: requiredElement('#image-preview-label'),
  keyboardHelp: requiredElement('.keyboard-help'),
  name: requiredElement('#document-name'),
  openButton: requiredElement<HTMLButtonElement>('#open-button'),
  parseStatus: requiredElement('#parse-status'),
  pinnedSelection: requiredElement('#pinned-selection'),
  previewPane: requiredElement('#preview-pane'),
  selectedLocation: requiredElement<HTMLButtonElement>('#selected-location'),
  selectedAnnotationView: requiredElement('#selected-annotation-view'),
  selectedSource: requiredElement('#selected-source'),
  selectedTitle: requiredElement('#selected-title'),
  scrollbarRowCover: requiredElement('#scrollbar-row-cover'),
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
  standardActions: requiredElement('#standard-actions'),
  toast: requiredElement('#toast'),
  tree: requiredElement('#tree'),
  treeViewAll: requiredElement<HTMLButtonElement>('#tree-view-all'),
  treeViewAnnotated: requiredElement<HTMLButtonElement>('#tree-view-annotated'),
  reviewActions: requiredElement('#review-actions'),
  reviewContextButton: requiredElement<HTMLButtonElement>('#review-context-button'),
  reviewContextClose: requiredElement<HTMLButtonElement>('#review-context-close'),
  reviewContextDrawer: requiredElement('#review-context-drawer'),
  reviewContextFields: requiredElement('#review-context-fields'),
  reviewContextSummary: requiredElement('#review-context-summary'),
  reviewContextTitle: requiredElement('#review-context-title'),
  documentsListCollapse: requiredElement<HTMLButtonElement>('#documents-list-collapse'),
  documentsListOpen: requiredElement<HTMLButtonElement>('#documents-list-open'),
  documentsListResizer: requiredElement('#documents-list-resizer'),
  documentsListSidebar: requiredElement('#documents-list-sidebar'),
  documentsListTree: requiredElement('#documents-list-tree'),
  emptyWorkspaceLockup: requiredElement<HTMLImageElement>('#empty-workspace-lockup'),
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
  workspace: requiredElement('#workspace')
}

const state: RendererState = {
  attachmentPreviewUrls: new Map<string, string>(),
  documentName: 'sample.md',
  documentPath: null,
  durableReview: false,
  fallbackAttachmentSequence: 0,
  finishAttachmentLabelEdit: null,
  hoveredId: null,
  reviewId: null,
  reviewMode: false,
  selectedId: null,
  annotatedOnly: false,
  annotationView: 'selected',
  sourceCollapsed: false,
  sourceDrafts: new Map<string, string>(),
  sourceEditingId: null,
  tree: null
}
const reviewSessions = new MarkoverReviewSessions.ReviewSessions()
const reviewMutations = new MarkoverReviewSessions.ReviewMutationTracker()
const MAX_VISIBLE_TABS = 6
let DocumentsListFileTree: MarkoverFileTreeConstructor | null = null
let documentsListModel: FileTreeModel | null = null
let documentsListObserver: MutationObserver | null = null
let documentsListClockTimer: ReturnType<typeof setTimeout> | null = null
let documentsListCollapsed = false
let documentsListWidth = 248
let documentsListPathToReviewId = new Map<string, string>()
let documentsListReviewIdToPath = new Map<string, string>()
let documentsListSortOrder = new Map<string, number>()
let documentsListDecorations = new Map<string, string>()
let documentsListProjectPaths: string[] = []
let documentsListStatuses = new Map<string, ReviewSessionStatus>()
let brandAssetSources: MarkoverBrandAssets | null = null
let brandAssetLoad: Promise<MarkoverBrandAssets | null> | null = null
let sourceDiffCleanup: (() => void) | null = null
let preferences = MarkoverSettings.normalizeSettings()
let resolvedAppearance: ResolvedAppearance = 'light'

import('../node_modules/@pierre/trees/dist/index.js')
  .then(({ FileTree }) => {
    DocumentsListFileTree = FileTree
    renderDocumentsList()
  })
  .catch((error: unknown) => {
    console.error('Failed to load documents list tree', error)
    elements.documentsListTree.textContent = `Documents list unavailable: ${error instanceof Error ? error.message : String(error)}`
  })

const fallbackBridge = {
  getBrandAssets() {
    return Promise.resolve(null)
  },
  async checksum(source) {
    const bytes = new TextEncoder().encode(source)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    return `sha256:${hex}`
  },
  openMarkdown() {
    return Promise.resolve(null)
  },
  onOpenMarkdownRequested() {},
  copyText(text) {
    void navigator.clipboard.writeText(text)
  },
  getSettings() {
    return Promise.resolve({
      ...MarkoverSettings.DEFAULT_SETTINGS,
      resolvedAppearance: 'light' as const
    })
  },
  updateSettings(patch) {
    return Promise.resolve({
      ...MarkoverSettings.updateSettings(preferences, patch),
      resolvedAppearance
    })
  },
  onSettingsOpen() {},
  onSettingsChanged() {},
  async saveAttachment(attachment) {
    state.fallbackAttachmentSequence += 1
    const id = `img-${state.fallbackAttachmentSequence}`
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new Uint8Array(attachment.bytes).buffer
    )
    const checksum = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    return {
      id,
      type: 'image',
      mimeType: attachment.mimeType,
      checksum: `sha256:${checksum}`,
      width: null,
      height: null,
      label: ''
    }
  },
  getInitialReview() {
    return Promise.resolve(null)
  },
  getReviews() {
    return Promise.resolve([])
  },
  readClipboardImage() {
    return Promise.resolve(null)
  },
  onReviewOpened() {},
  onReviewSnapshotRequested() {},
  onReviewStatus() {},
  activateReview() {},
  autosaveReview() {},
  finishReview() {},
  cancelReview() {}
} satisfies MarkoverBridge
const bridge: MarkoverBridge = window.markover || fallbackBridge

const inlineMarkdown = window.markdownit('commonmark', {
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
  const url = MarkoverImagePreview.sourceUrl(source, state.documentPath)
  openImagePreview({
    ...(url ? { url } : {}),
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
  if (!node.sourceEdit) return null
  return MarkoverDiffs.stats(node.sourceEdit.original, node.sourceEdit.current)
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
  if (focusPreview) elements.previewPane.focus()
}

function setWorkspaceEmpty(empty: boolean): void {
  elements.appHeader.classList.toggle('is-empty', empty)
  elements.emptyWorkspace.hidden = !empty
  elements.workspace.hidden = empty
  elements.documentTabs.hidden = empty || !reviewSessions.list().length
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
    selectedId
  )
  if (revealed) {
    renderTree()
    autosaveReview()
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

function updateScrollbarRowCover(): void {
  const hoveredRow = state.hoveredId
    ? elements.tree.querySelector<HTMLElement>(`[data-node-id="${state.hoveredId}"]`)
    : null
  const selectedRow = elements.tree.querySelector<HTMLElement>(
    `[data-node-id="${state.selectedId}"]`
  )
  const row = hoveredRow || (
    elements.pinnedSelection.hidden ? selectedRow : null
  )

  if (!row || !row.getClientRects().length) {
    elements.scrollbarRowCover.hidden = true
    return
  }

  const rowRect = row.getBoundingClientRect()
  const treeRect = elements.tree.getBoundingClientRect()
  if (rowRect.bottom <= treeRect.top || rowRect.top >= treeRect.bottom) {
    elements.scrollbarRowCover.hidden = true
    return
  }

  const paneRect = elements.previewPane.getBoundingClientRect()
  const isHovered = Boolean(hoveredRow && hoveredRow !== selectedRow)
  elements.scrollbarRowCover.className = [
    'scrollbar-row-cover',
    isHovered ? 'is-hovered' : '',
    row.querySelector('.block-content.code') ? 'is-code' : ''
  ].filter(Boolean).join(' ')
  elements.scrollbarRowCover.style.top = `${rowRect.top - paneRect.top}px`
  elements.scrollbarRowCover.style.height = `${rowRect.height}px`
  elements.scrollbarRowCover.hidden = false
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
    disclosure.textContent = node.collapsed ? '▶' : '▼'
    disclosure.title = node.collapsed ? 'Expand block' : 'Collapse block'
    disclosure.addEventListener('click', (event) => {
      event.stopPropagation()
      node.collapsed = !node.collapsed
      renderTree()
      autosaveReview()
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
    code.textContent = node.text || '(empty code block)'
    content.append(code)
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
      node.collapsed = !node.collapsed
      renderTree()
      autosaveReview()
    }
  })
  wrapper.append(row)

  if (entry.children.length) {
    const children = document.createElement('div')
    children.className = `block-children${
      !state.annotatedOnly && node.collapsed ? ' is-collapsed' : ''
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
  function finish(commit = false): void {
    if (finished) return
    finished = true
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
  elements.imagePreview.hidden = false
}

function attachmentPreviewUrl(attachment: ReviewAttachment): string | null {
  const sessionUrl = state.attachmentPreviewUrls.get(attachment.id)
  if (sessionUrl) return sessionUrl
  if (!attachment.path?.startsWith('/')) return null
  const encodedPath = attachment.path
    .split('/')
    .map((part: string) => encodeURIComponent(part))
    .join('/')
  return `file://${encodedPath}`
}

function closeImagePreview(): void {
  elements.imagePreview.hidden = true
  elements.imagePreviewContent.removeAttribute('src')
  elements.imagePreviewLabel.textContent = ''
}

function removeAttachment(node: ReviewNode, attachment: ReviewAttachment): void {
  if (!isCurrentReviewEditable()) return
  node.attachments = (node.attachments || []).filter(
    (item) => item.id !== attachment.id
  )
  const previewUrl = state.attachmentPreviewUrls.get(attachment.id)
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  state.attachmentPreviewUrls.delete(attachment.id)
  node.feedback = node.feedback
    .split(`[!${attachmentReference(attachment)}]`)
    .join('')
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
  }
  updateAnnotationCount()
  autosaveReview()
}

function renderAttachmentList(node: ReviewNode): void {
  elements.attachmentList.replaceChildren()
  const attachments = node.attachments || []
  elements.attachmentList.hidden = attachments.length === 0

  for (const attachment of attachments) {
    const editable = isCurrentReviewEditable()
    const item = document.createElement('div')
    item.className = 'attachment-item'
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
      ? `${attachment.id} · click to preview · Control-click to label`
      : `${attachment.id} · click to preview`

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
      removeButton.addEventListener('click', (event) => {
        if (event.ctrlKey) return
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
  const paneHadFocus = elements.annotationPane.contains(document.activeElement)
  elements.annotationPane.classList.toggle('is-read-only', readonly)
  elements.reviewStateBanner.hidden = !readonly
  elements.annotationInput.hidden = readonly
  elements.annotationReadonly.hidden = !readonly

  if (readonly) {
    elements.annotationGuidance.textContent =
      'The agent has this review. Ask it to return the review to editing if you need to add more.'
  } else if (managed) {
    elements.annotationGuidance.textContent =
      'Annotations autosave continuously. Ask the agent to check Markover when you’re done.'
  }
  if (paneHadFocus) focusAnnotationPane()
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

function focusAnnotationPane(): void {
  elements.annotationPane.classList.add('focus-within')
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
      try {
        sourceDiffCleanup = MarkoverDiffs.render(
          elements.sourceDiff,
          node.sourceEdit.original,
          node.sourceEdit.current,
          `${state.reviewId || 'local'}:${node.id}`
        )
      } catch (error) {
        elements.sourceDiff.textContent = `Diff unavailable: ${error instanceof Error ? error.message : String(error)}`
      }
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
  elements.sourceToggle.setAttribute('aria-expanded', 'true')
  elements.sourceToggleIcon.textContent = '▼'
  renderSourcePanel(node)
  requestAnimationFrame(() => {
    elements.sourceEditor.focus()
  })
}

function cancelSourceEdit(node: ReviewNode): void {
  MarkoverSourceEdits.cancel(state, node)
  renderSourcePanel(node)
}

function saveSourceEdit(node: ReviewNode): boolean {
  const result = MarkoverSourceEdits.commit(state, node)
  if (!result.ok) {
    showToast('Proposed source cannot be empty')
    return false
  }
  renderTreePreservingScroll()
  renderAnnotation(node)
  if (result.changed) autosaveReview()
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
  delete node.sourceEdit
  state.sourceDrafts.delete(node.id)
  if (state.sourceEditingId === node.id) state.sourceEditingId = null
  renderTreePreservingScroll()
  renderAnnotation(node)
  autosaveReview()
}

function selectAnnotationFromList(node: RenderedAnnotationNode): void {
  const revealed = MarkoverAnnotations.revealAnnotation(currentTree().root, node.id)
  selectNode(node.id)
  if (revealed) autosaveReview()
  focusAnnotationPane()
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
    const revealed = MarkoverAnnotations.revealAnnotation(tree.root, nextId)
    state.selectedId = nextId
    state.annotationView = 'list'
    renderTree()
    elements.tree
      .querySelector(`[data-node-id="${nextId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
    if (revealed) autosaveReview()
  } else {
    state.annotationView = 'selected'
  }
  const selected = MarkoverTree.findNode(tree.root, state.selectedId)
  if (selected) renderAnnotation(selected)
  focusAnnotationPane()
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

function showToast(message: string): void {
  elements.toast.textContent = message
  elements.toast.classList.add('is-visible')
  elements.toast.setAttribute('aria-hidden', 'false')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove('is-visible')
    elements.toast.setAttribute('aria-hidden', 'true')
  }, 1500)
}

function autosaveReview(): void {
  autosaveTree(state.reviewId, state.tree)
}

function autosaveTree(
  reviewId: string | null,
  tree: ReviewTree | null
): void {
  if (
    !state.reviewMode ||
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
  session.sourceDrafts = state.sourceDrafts
  session.sourceEditingId = state.sourceEditingId
  session.attachmentPreviewUrls = state.attachmentPreviewUrls
}

function reviewStatusLabel(status: ReviewSessionStatus): string {
  if (status === 'handoff-in-progress') return 'Handing off'
  return status === 'pending-agent' ? 'With agent' : 'Editing'
}

function addReviewContextField(label: string, value: unknown): void {
  if (value === null || value === undefined || value === '') return
  let text: string
  if (typeof value === 'string') text = value
  else if (typeof value === 'number') text = value.toString()
  else if (typeof value === 'boolean') text = value.toString()
  else if (typeof value === 'bigint') text = value.toString()
  else return
  const term = document.createElement('dt')
  term.textContent = label
  const description = document.createElement('dd')
  description.textContent = text
  elements.reviewContextFields.append(term, description)
}

function renderReviewContext(): void {
  const tree = state.tree
  const review = tree && isReviewSessionTree(tree) ? tree.review : null
  elements.reviewContextButton.hidden = !review
  if (!review) {
    closeReviewContext(false)
    return
  }

  const git = metadataRecord(review.git)
  const gitSources = metadataRecord(git.sources)
  const pullRequest = metadataRecord(review.pullRequest)
  const agentThread = metadataRecord(review.agentThread)
  elements.reviewContextTitle.textContent = state.documentName
  elements.reviewContextSummary.innerHTML = inlineMarkdown.render(
    review.contextSummary || ''
  )
  elements.reviewContextFields.replaceChildren()
  addReviewContextField('Review ID', review.id)
  addReviewContextField('Status', reviewStatusLabel(review.status))
  addReviewContextField('Source', state.documentPath)
  addReviewContextField('Created', review.createdAt)
  addReviewContextField('Repository root', metadataString(git, 'repositoryRoot'))
  addReviewContextField('Branch', metadataString(git, 'branch'))
  addReviewContextField('Commit', metadataString(git, 'commit'))
  addReviewContextField('Repository', metadataString(git, 'repositoryUrl'))
  addReviewContextField(
    'Git sources',
    [...new Set(Object.values(gitSources).filter(
      (value): value is string => typeof value === 'string'
    ))].join(', ') || null
  )
  const pullRequestNumber = pullRequest.number
  const pullRequestUrl = metadataString(pullRequest, 'url')
  addReviewContextField(
    'Pull request',
    typeof pullRequestNumber === 'number'
      ? `#${pullRequestNumber}`
      : pullRequestUrl
  )
  addReviewContextField('Pull request URL', pullRequestUrl)
  addReviewContextField(
    'Pull request source',
    metadataString(pullRequest, 'discovery')
  )
  const threadId = metadataString(agentThread, 'id')
  const threadProvider = metadataString(agentThread, 'provider')
  addReviewContextField(
    'Agent thread',
    threadId
      ? [threadProvider, threadId].filter(Boolean).join(' · ')
      : null
  )
  addReviewContextField('Thread source', metadataString(agentThread, 'discovery'))
  addReviewContextField('Thread cwd', metadataString(agentThread, 'cwd'))
  addReviewContextField('Session log', metadataString(agentThread, 'logPath'))
  addReviewContextField(
    'Parent thread',
    metadataString(agentThread, 'parentThreadId')
  )
  addReviewContextField(
    'Forked from',
    metadataString(agentThread, 'forkedFromId')
  )
}

function openReviewContext(): void {
  if (!state.tree || !isReviewSessionTree(state.tree)) return
  renderReviewContext()
  elements.reviewContextDrawer.hidden = false
  elements.reviewContextButton.setAttribute('aria-expanded', 'true')
  elements.reviewContextClose.focus()
}

function closeReviewContext(restoreFocus = true): void {
  const drawerHadFocus = elements.reviewContextDrawer.contains(
    document.activeElement
  )
  elements.reviewContextDrawer.hidden = true
  elements.reviewContextButton.setAttribute('aria-expanded', 'false')
  if (
    restoreFocus &&
    drawerHadFocus &&
    !elements.reviewContextButton.hidden
  ) {
    elements.reviewContextButton.focus()
  }
}

function treePathSegment(value: string): string {
  return value
    .replace(/[\\/]/g, '∕')
    // Control characters cannot form a useful user-facing path segment.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .trim() || 'Untitled'
}

const DOCUMENT_STATUS_SPRITE = `
  <svg xmlns="http://www.w3.org/2000/svg" data-icon-sprite aria-hidden="true" width="0" height="0">
    <symbol id="markover-status-editing" viewBox="0 0 10 10">
      <circle cx="5" cy="5" r="4" fill="var(--status-editing)" stroke="var(--status-outline)" stroke-width="0.75" />
    </symbol>
    <symbol id="markover-status-pending" viewBox="0 0 10 10">
      <circle cx="5" cy="5" r="4" fill="var(--status-pending)" stroke="var(--status-outline)" stroke-width="0.75" />
    </symbol>
    <symbol id="markover-status-progress" viewBox="0 0 10 10">
      <circle cx="5" cy="5" r="4" fill="var(--status-progress)" stroke="var(--status-outline)" stroke-width="0.75" />
    </symbol>
    <symbol id="markover-status-other" viewBox="0 0 10 10">
      <circle cx="5" cy="5" r="4" fill="var(--status-other)" stroke="var(--status-outline)" stroke-width="0.75" />
    </symbol>
  </svg>
`

function documentsListStatusIcon(status: ReviewSessionStatus): string {
  if (status === 'editing') return 'markover-status-editing'
  if (status === 'pending-agent') return 'markover-status-pending'
  return 'markover-status-progress'
}

function buildDocumentsListProjection(): DocumentsListProjection {
  const groups = reviewSessions.projectGroups()
  const nameCounts = new Map<string, number>()
  for (const group of groups) {
    nameCounts.set(group.name, (nameCounts.get(group.name) || 0) + 1)
  }
  const duplicateIndices = new Map<string, number>()
  for (const name of nameCounts.keys()) {
    const matches = groups
      .filter((group) => group.name === name)
      .sort((left, right) => left.key.localeCompare(right.key))
    matches.forEach((group, index) => duplicateIndices.set(group.key, index + 1))
  }
  const paths: string[] = []
  const projectPaths: string[] = []
  const pathToReviewId = new Map<string, string>()
  const reviewIdToPath = new Map<string, string>()
  const sortOrder = new Map<string, number>()
  const decorations = new Map<string, string>()
  const statuses = new Map<string, ReviewSessionStatus>()
  const byFileName: Record<string, MarkoverRemappedIcon> = {}

  groups.forEach((group, groupIndex) => {
    const duplicateSuffix = (nameCounts.get(group.name) ?? 0) > 1
      ? ` · ${duplicateIndices.get(group.key)}`
      : ''
    const projectPath = `${treePathSegment(group.name)}${duplicateSuffix}/`
    projectPaths.push(projectPath)
    sortOrder.set(projectPath, groupIndex)

    group.sessions.forEach((session, sessionIndex) => {
      const leaf = `${treePathSegment(session.documentName)} · ${session.reviewId.slice(4)}`
      const path = `${projectPath}${leaf}`
      const status = session.tree.review.status
      paths.push(path)
      pathToReviewId.set(path, session.reviewId)
      reviewIdToPath.set(session.reviewId, path)
      sortOrder.set(path, sessionIndex)
      decorations.set(
        path,
        MarkoverReviewSessions.formatRelativeTime(session.lastViewedAt)
      )
      statuses.set(path, status)
      byFileName[leaf.toLowerCase()] = {
        name: documentsListStatusIcon(status),
        width: 10,
        height: 10,
        viewBox: '0 0 10 10'
      }
    })
  })

  return {
    decorations,
    icons: {
      set: 'minimal',
      colored: false,
      spriteSheet: DOCUMENT_STATUS_SPRITE,
      byFileName
    },
    paths,
    pathToReviewId,
    projectPaths,
    reviewIdToPath,
    sortOrder,
    statuses
  }
}

function documentsListSort(
  left: MarkoverFileTreeSortEntry,
  right: MarkoverFileTreeSortEntry
): number {
  const leftRank = documentsListSortOrder.get(left.path) ?? Number.MAX_SAFE_INTEGER
  const rightRank = documentsListSortOrder.get(right.path) ?? Number.MAX_SAFE_INTEGER
  return leftRank - rightRank || left.basename.localeCompare(right.basename)
}

function applyDocumentsListRowMetadata(): void {
  const shadowRoot = documentsListModel?.getFileTreeContainer()?.shadowRoot
  if (!shadowRoot) return
  for (const row of shadowRoot.querySelectorAll<HTMLElement>(
    'button[data-item-type="file"][data-item-path]'
  )) {
    const itemPath = row.dataset.itemPath
    const status = itemPath ? documentsListStatuses.get(itemPath) : undefined
    const icon = row.querySelector<HTMLElement>('[data-item-section="icon"]')
    const content = row.querySelector<HTMLElement>('[data-item-section="content"]')
    if (icon && status) icon.title = reviewStatusLabel(status)
    if (content) {
      content.dataset.documentsListLabel = row.getAttribute('aria-label') || ''
    }
  }
}

function scheduleDocumentsListRowMetadata(): void {
  requestAnimationFrame(applyDocumentsListRowMetadata)
}

function observeDocumentsListRows(): void {
  if (documentsListObserver) return
  const shadowRoot = documentsListModel?.getFileTreeContainer()?.shadowRoot
  if (!shadowRoot) return
  documentsListObserver = new MutationObserver(
    scheduleDocumentsListRowMetadata
  )
  documentsListObserver.observe(shadowRoot, {
    childList: true,
    subtree: true
  })
}

function scheduleDocumentsListClockRefresh(sessions: ReviewSession[]): void {
  if (documentsListClockTimer) clearTimeout(documentsListClockTimer)
  documentsListClockTimer = null
  const delay = MarkoverReviewSessions.relativeTimeRefreshDelay(
    sessions.map((session) => session.lastViewedAt)
  )
  if (delay === null) return
  documentsListClockTimer = setTimeout(() => {
    documentsListClockTimer = null
    renderDocumentsList()
  }, delay)
}

function selectActiveReviewInDocumentsList(): void {
  if (!documentsListModel || !state.reviewId) return
  const activePath = documentsListReviewIdToPath.get(state.reviewId)
  if (!activePath) return
  const activeProjectPath = activePath.slice(0, activePath.lastIndexOf('/') + 1)
  const activeProject = documentsListModel.getItem(activeProjectPath)
  if (isDirectoryHandle(activeProject) && !activeProject.isExpanded()) {
    activeProject.expand()
  }
  for (const selectedPath of documentsListModel.getSelectedPaths()) {
    if (selectedPath !== activePath) {
      documentsListModel.getItem(selectedPath)?.deselect()
    }
  }
  const activeItem = documentsListModel.getItem(activePath)
  if (!activeItem?.isSelected()) activeItem?.select()
  documentsListModel.scrollToPath(activePath, {
    focus: false,
    offset: 'nearest'
  })
}

function renderDocumentsList(): void {
  const sessions = reviewSessions.list()
  scheduleDocumentsListClockRefresh(sessions)
  elements.documentsListSidebar.hidden = sessions.length === 0
  elements.documentsListOpen.hidden = sessions.length === 0 || !documentsListCollapsed
  elements.workspace.classList.toggle('has-documents-list', sessions.length > 0)
  if (!sessions.length || !DocumentsListFileTree) {
    return
  }

  const projection = buildDocumentsListProjection()
  const newProjectPaths = projection.projectPaths.filter(
    (path) => !documentsListProjectPaths.includes(path)
  )
  const previousModel = documentsListModel
  const previouslyExpanded = previousModel
    ? documentsListProjectPaths.filter((path) => {
        const item = previousModel.getItem(path)
        return isDirectoryHandle(item) && item.isExpanded()
      })
    : projection.projectPaths

  documentsListPathToReviewId = projection.pathToReviewId
  documentsListReviewIdToPath = projection.reviewIdToPath
  documentsListSortOrder = projection.sortOrder
  documentsListDecorations = projection.decorations
  documentsListProjectPaths = projection.projectPaths
  documentsListStatuses = projection.statuses

  if (!documentsListModel) {
    const model = new DocumentsListFileTree({
      density: 'compact',
      flattenEmptyDirectories: false,
      icons: projection.icons,
      initialExpandedPaths: projection.projectPaths,
      itemHeight: 22,
      onSelectionChange(selectedPaths) {
        const selectedPath = selectedPaths.at(-1)
        const reviewId = selectedPath
          ? documentsListPathToReviewId.get(selectedPath)
          : null
        if (reviewId && reviewId !== state.reviewId) activateReview(reviewId)
      },
      paths: projection.paths,
      renderRowDecoration({ row }) {
        const text = documentsListDecorations.get(row.path)
        const reviewId = documentsListPathToReviewId.get(row.path)
        const viewedAt = reviewId
          ? reviewSessions.get(reviewId)?.lastViewedAt
          : null
        return text
          ? {
              text,
              title: viewedAt ? new Date(viewedAt).toLocaleString() : text
            }
          : null
      },
      sort: documentsListSort,
      stickyFolders: true,
      unsafeCSS: `
        :host {
          --trees-bg-override: transparent;
          --trees-bg-muted-override: rgb(var(--accent-rgb) / 9%);
          --trees-border-color-override: transparent;
          --trees-fg-override: var(--muted);
          --trees-fg-muted-override: var(--muted);
          --trees-selected-bg-override: var(--surface);
          --trees-selected-fg-override: var(--ink);
          --trees-selected-focused-border-color-override: transparent;
          --trees-font-family-override: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          --trees-font-size-override: 10.5px;
          --trees-font-weight-semibold-override: 700;
          --trees-icon-width-override: 10px;
          --trees-item-margin-x-override: 3px;
          --trees-item-padding-x-override: 4px;
          --trees-item-row-gap-override: 6px;
          --trees-level-gap-override: 7px;
          --trees-padding-inline-override: 1px;
          --trees-scrollbar-gutter-override: 5px;
        }
        button[data-type='item'] { border-radius: 6px; }
        button[data-item-type='file'] [data-item-section='content'] {
          flex: 1 1 auto;
          margin-right: 7px;
          white-space: nowrap;
        }
        button[data-item-type='file'] [data-item-section='content'] > * {
          display: none;
        }
        button[data-item-type='file'] [data-item-section='content']::before {
          content: attr(data-documents-list-label);
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        [data-item-section='decoration'] {
          flex: 0 0 auto;
          color: var(--muted);
          font-size: 9px;
          white-space: nowrap;
        }
        button[data-item-type='file'] [data-item-section='icon'] {
          cursor: help;
        }
        button[data-item-type='folder'] {
          color: var(--ink);
          font-size: 11.5px;
        }
      `
    })
    documentsListModel = model
    model.subscribe(scheduleDocumentsListRowMetadata)
    model.render({
      containerWrapper: elements.documentsListTree
    })
    observeDocumentsListRows()
  } else {
    documentsListModel.setIcons(projection.icons)
    documentsListModel.resetPaths(projection.paths, {
      initialExpandedPaths: [
        ...previouslyExpanded.filter(
          (path) => projection.projectPaths.includes(path)
        ),
        ...newProjectPaths
      ]
    })
  }

  selectActiveReviewInDocumentsList()
  scheduleDocumentsListRowMetadata()
}

function applyDocumentsListWidth(): void {
  documentsListWidth = MarkoverReviewSessions.clampDocumentsListWidth(
    documentsListWidth,
    elements.workspace.clientWidth || window.innerWidth
  )
  elements.workspace.style.setProperty(
    '--documents-list-width',
    `${documentsListWidth}px`
  )
  elements.documentsListResizer.setAttribute(
    'aria-valuenow',
    String(Math.round(documentsListWidth))
  )
}

function setDocumentsListCollapsed(collapsed: boolean): void {
  documentsListCollapsed = collapsed
  elements.documentsListSidebar.classList.toggle('is-collapsed', collapsed)
  elements.documentsListOpen.hidden = !collapsed || reviewSessions.list().length === 0
  elements.documentsListCollapse.setAttribute(
    'aria-expanded',
    String(!collapsed)
  )
  elements.documentsListOpen.setAttribute(
    'aria-expanded',
    String(!collapsed)
  )
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
    if (!brandAssetSources) return
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
    elements.emptyWorkspaceLockup.src = themedBrandSource(
      brandAssetSources.lockup,
      primary,
      secondary
    )
  } catch (error) {
    console.error('Failed to theme brand assets', error)
  } finally {
    document.documentElement.classList.add('is-brand-ready')
  }
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

  if (MarkoverSettings.sidebarPreferenceChanged(
    previous,
    preferences,
    options.initial
  )) {
    setDocumentsListCollapsed(!preferences.openDocumentsSidebar)
  }
}

function openSettings(): void {
  MarkoverSettings.applySettingsToView(
    { ...preferences, resolvedAppearance },
    {
      root: document.documentElement,
      keyboardHelp: elements.keyboardHelp,
      form: elements.settingsForm
    }
  )
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal()
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
elements.fixedContractOpen.addEventListener('click', () => {
  if (!elements.fixedContractDialog.open) {
    elements.fixedContractDialog.showModal()
  }
  elements.fixedContractClose.focus()
})
elements.fixedContractClose.addEventListener('click', closeFixedContract)
elements.fixedContractDone.addEventListener('click', closeFixedContract)
elements.fixedContractDialog.addEventListener('close', () => {
  if (elements.settingsDialog.open) elements.fixedContractOpen.focus()
})
elements.settingsReset.addEventListener('click', () => {
  void bridge.updateSettings(MarkoverSettings.DEFAULT_SETTINGS).then(applySettings)
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
  const value = control instanceof HTMLInputElement && control.type === 'checkbox'
    ? control.checked
    : control.value
  void bridge.updateSettings({ [control.name]: value }).then(applySettings)
})

function focusedPane(): WorkspacePane {
  const active = document.activeElement
  if (elements.documentsListSidebar.contains(active)) return 'documents'
  if (elements.annotationPane.contains(active)) return 'annotation'
  return 'preview'
}

function focusDocumentsList(): void {
  const activePath = state.reviewId
    ? documentsListReviewIdToPath.get(state.reviewId)
    : null
  if (activePath && documentsListModel) {
    const model = documentsListModel
    model.scrollToPath(activePath, {
      focus: true,
      offset: 'nearest'
    })
    const focusActiveRow = () => {
      const shadowRoot = model.getFileTreeContainer()?.shadowRoot
      const row = [...(shadowRoot?.querySelectorAll<HTMLElement>(
        'button[data-item-path]'
      ) || [])].find((button) => (
        button.dataset.itemPath === activePath &&
        button.dataset.itemParked !== 'true'
      ))
      const target = row || shadowRoot?.querySelector<HTMLElement>('[role="tree"]')
      target?.focus()
    }
    focusActiveRow()
    requestAnimationFrame(focusActiveRow)
    return
  }
  elements.documentsListCollapse.focus()
}

function focusPane(pane: WorkspacePane): void {
  if (pane === 'documents') focusDocumentsList()
  else if (pane === 'annotation') focusAnnotationPane()
  else elements.previewPane.focus()
}

function beginDocumentsListResize(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  const workspaceLeft = elements.workspace.getBoundingClientRect().left
  const pointerId = event.pointerId
  elements.documentsListResizer.setPointerCapture(pointerId)
  document.body.classList.add('is-resizing-documents-list')

  const resize = (moveEvent: PointerEvent): void => {
    documentsListWidth = moveEvent.clientX - workspaceLeft
    applyDocumentsListWidth()
  }
  const finish = (): void => {
    elements.documentsListResizer.removeEventListener('pointermove', resize)
    elements.documentsListResizer.removeEventListener('pointerup', finish)
    elements.documentsListResizer.removeEventListener('pointercancel', finish)
    document.body.classList.remove('is-resizing-documents-list')
    if (elements.documentsListResizer.hasPointerCapture(pointerId)) {
      elements.documentsListResizer.releasePointerCapture(pointerId)
    }
  }

  elements.documentsListResizer.addEventListener('pointermove', resize)
  elements.documentsListResizer.addEventListener('pointerup', finish)
  elements.documentsListResizer.addEventListener('pointercancel', finish)
}

function closeTabOverflow(): void {
  elements.documentTabs
    .querySelector('.document-tab-overflow')
    ?.classList.remove('is-open')
}

function createDocumentTab(session: ReviewSession): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = [
    'document-tab',
    session.reviewId === state.reviewId ? 'is-active' : ''
  ].filter(Boolean).join(' ')
  button.role = 'tab'
  button.ariaSelected = String(session.reviewId === state.reviewId)
  button.tabIndex = session.reviewId === state.reviewId ? 0 : -1
  if (session.reviewId !== state.reviewId) {
    button.title = `${session.documentName}\n${session.checksum}`
  }

  const name = document.createElement('span')
  name.className = 'document-tab-name'
  name.textContent = `${session.documentName} · ${session.reviewId.slice(4)}`
  button.append(name)

  const status = document.createElement('span')
  status.className = [
    'document-tab-status',
    session.tree.review.status !== 'editing' ? 'is-pending' : ''
  ].filter(Boolean).join(' ')
  status.textContent = reviewStatusLabel(session.tree.review.status)
  button.append(status)

  button.addEventListener('click', () => {
    activateReview(session.reviewId)
  })
  button.addEventListener('keydown', (event) => {
    const offset = event.key === 'ArrowLeft'
      ? -1
      : event.key === 'ArrowRight'
        ? 1
        : 0
    if (!offset) return
    event.preventDefault()
    const adjacent = reviewSessions.adjacent(session.reviewId, offset)
    if (!adjacent) return
    activateReview(adjacent.reviewId)
    requestAnimationFrame(() => {
      elements.documentTabs
        .querySelector<HTMLElement>(`[data-review-id="${adjacent.reviewId}"]`)
        ?.focus()
    })
  })
  button.dataset.reviewId = session.reviewId
  return button
}

function renderDocumentTabs(): void {
  const sessions = reviewSessions.recent()
  const visibleSessions = sessions.slice(0, MAX_VISIBLE_TABS)
  const overflowSessions = sessions.slice(MAX_VISIBLE_TABS)
  elements.documentTabs.hidden = sessions.length === 0
  elements.documentTabs.replaceChildren()

  for (const session of visibleSessions) {
    elements.documentTabs.append(createDocumentTab(session))
  }

  if (overflowSessions.length) {
    const overflow = document.createElement('div')
    overflow.className = 'document-tab-overflow'

    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'document-tab-overflow-trigger'
    trigger.textContent = '⋮'
    trigger.title = `${overflowSessions.length} more reviews`
    trigger.ariaLabel = `${overflowSessions.length} more reviews`
    trigger.addEventListener('click', (event) => {
      event.stopPropagation()
      overflow.classList.toggle('is-open')
    })
    overflow.append(trigger)

    const menu = document.createElement('div')
    menu.className = 'document-tab-overflow-menu'
    for (const session of overflowSessions) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'document-tab-overflow-item'
      item.title = session.documentPath || session.documentName

      const label = document.createElement('span')
      label.textContent = `${session.documentName} · ${session.reviewId.slice(4)}`
      item.append(label)

      const context = document.createElement('small')
      context.textContent = `${session.projectName} · ${reviewStatusLabel(session.tree.review.status)}`
      item.append(context)
      item.addEventListener('click', () => {
        activateReview(session.reviewId)
      })
      menu.append(item)
    }
    overflow.append(menu)
    elements.documentTabs.append(overflow)
  }

  renderDocumentsList()
}

function activateReview(reviewId: string): void {
  setWorkspaceEmpty(false)
  if (reviewId === state.reviewId) return
  state.finishAttachmentLabelEdit?.(true)
  const currentReviewId = state.reviewId
  if (currentReviewId && reviewMutations.has(currentReviewId)) {
    void reviewMutations.wait(currentReviewId).then(() => {
      activateReview(reviewId)
    })
    return
  }
  if (!finishActiveSourceEdit()) return

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
  elements.sourceToggleIcon.textContent = state.sourceCollapsed ? '▶' : '▼'
  elements.sourceContent.hidden = state.sourceCollapsed
  closeImagePreview()
  renderTree()

  const selected = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (selected) renderAnnotation(selected)
  renderDocumentTabs()
  renderReviewContext()
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
  if (activate) activateReview(session.reviewId)
  else renderDocumentTabs()
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
    ...(typeof documentData.projectRoot === 'string'
      ? { projectRoot: documentData.projectRoot }
      : {})
  }
}

function configureManagedMode(): void {
  state.reviewMode = true
  state.durableReview = true
  elements.openButton.hidden = true
  elements.standardActions.hidden = false
  elements.reviewActions.hidden = true
  elements.annotationGuidance.textContent =
    'Annotations autosave continuously. Ask the agent to check Markover when you’re done.'
}

async function loadDocument(documentData: MarkoverDocument): Promise<void> {
  setWorkspaceEmpty(false)
  const checksum = documentData.checksum || await bridge.checksum(documentData.source)
  if (
    documentData.reviewId &&
    documentData.tree &&
    isReviewSessionTree(documentData.tree)
  ) {
    addManagedReview({
      reviewId: documentData.reviewId,
      name: documentData.name,
      path: documentData.path,
      checksum,
      tree: documentData.tree,
      ...(typeof documentData.projectRoot === 'string'
        ? { projectRoot: documentData.projectRoot }
        : {})
    })
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
  elements.annotationState.textContent = hasAnnotation(node)
    ? 'Annotated'
    : 'Not annotated'
  if (wasAnnotated !== hasAnnotation(node)) {
    const selectionChanged = normalizeAnnotatedSelection()
    renderTreePreservingScroll()
    if (selectionChanged) {
      const selected = MarkoverTree.findNode(currentTree().root, state.selectedId)
      if (selected) renderAnnotation(selected)
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
  focusAnnotationPane()
}

elements.annotationInput.addEventListener('paste', (event) => {
  const reviewId = state.reviewId || 'local'
  reviewMutations.track(reviewId, pasteImages(event)).catch(() => {})
})

async function openMarkdownDocument(): Promise<void> {
  const documentData = await bridge.openMarkdown()
  if (documentData) {
    if (!finishActiveSourceEdit()) return
    await loadDocument(documentData)
    elements.previewPane.focus()
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

elements.doneReviewButton.addEventListener('click', () => {
  if (!finishActiveSourceEdit()) return
  elements.doneReviewButton.disabled = true
  elements.doneReviewButton.textContent = 'Finishing…'
  bridge.finishReview(currentTree())
})

elements.cancelReviewButton.addEventListener('click', () => {
  elements.cancelReviewButton.disabled = true
  bridge.cancelReview()
})

elements.sourceToggle.addEventListener('click', () => {
  state.sourceCollapsed = !state.sourceCollapsed
  elements.sourceToggle.setAttribute(
    'aria-expanded',
    String(!state.sourceCollapsed)
  )
  elements.sourceToggleIcon.textContent = state.sourceCollapsed ? '▶' : '▼'
  const node = MarkoverTree.findNode(currentTree().root, state.selectedId)
  if (node) renderSourcePanel(node)
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
elements.reviewContextButton.addEventListener('click', () => {
  if (elements.reviewContextDrawer.hidden) openReviewContext()
  else closeReviewContext()
})
elements.reviewContextClose.addEventListener('click', () => {
  closeReviewContext()
})
elements.documentsListCollapse.addEventListener('click', () => {
  setDocumentsListCollapsed(true)
})
elements.documentsListOpen.addEventListener('click', () => {
  setDocumentsListCollapsed(false)
})
elements.documentsListResizer.addEventListener(
  'pointerdown',
  beginDocumentsListResize
)

MarkoverAnnotationBlock.bindDismiss(elements.tree, 'scroll', () => {
  hideAnnotationSneakPeek()
  updatePinnedSelection()
})
window.addEventListener('resize', () => {
  hideAnnotationSneakPeek()
  if (!elements.sourceErrorTooltip.hidden) showSourceErrorTooltip()
  applyDocumentsListWidth()
  updatePinnedSelection()
  MarkoverAnnotationBlock.updateTruncation(elements.annotationList)
})
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Node) || !elements.documentTabs.contains(event.target)) {
    closeTabOverflow()
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Control') {
    document.body.classList.add('is-control-pressed')
  }

  if (elements.settingsDialog.open) return

  if (event.key === 'Escape' && !elements.imagePreview.hidden) {
    closeImagePreview()
    return
  }
  if (event.key === 'Escape' && !elements.reviewContextDrawer.hidden) {
    closeReviewContext()
    return
  }
  if (
    event.key === 'Escape' &&
    elements.documentTabs.querySelector('.document-tab-overflow.is-open')
  ) {
    closeTabOverflow()
    return
  }

  if (event.key === 'Tab' && event.ctrlKey && reviewSessions.list().length) {
    event.preventDefault()
    if (!state.reviewId) return
    const adjacent = reviewSessions.adjacent(
      state.reviewId,
      event.shiftKey ? -1 : 1
    )
    if (adjacent) activateReview(adjacent.reviewId)
    return
  }

  if (event.key === 'Tab' && !elements.reviewContextDrawer.hidden) {
    event.preventDefault()
    elements.reviewContextClose.focus()
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    const documentsVisible = reviewSessions.list().length > 0 && !documentsListCollapsed
    const pane = MarkoverNavigation.nextPane(
      focusedPane(),
      event.shiftKey ? -1 : 1,
      documentsVisible
    )
    elements.annotationPane.classList.remove('focus-within')
    focusPane(pane)
    return
  }

  if (
    document.activeElement !== elements.previewPane ||
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
    current.collapsed
  ) {
    current.collapsed = false
    autosaveReview()
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

elements.previewPane.addEventListener('focus', () => {
  elements.annotationPane.classList.remove('focus-within')
})

async function initialize(): Promise<void> {
  bridge.onOpenMarkdownRequested(() => {
    void openMarkdownDocument()
  })
  bridge.onSettingsOpen(openSettings)
  bridge.onSettingsChanged((settings) => {
    applySettings(settings)
  })
  applySettings(await bridge.getSettings(), { initial: true })

  bridge.onReviewOpened(async (reviewDocument) => {
    configureManagedMode()
    await loadDocument(reviewDocument)
    elements.previewPane.focus()
  })
  bridge.onReviewStatus(async ({ reviewId, status }) => {
    let session = reviewSessions.updateStatus(reviewId, status)
    if (!session) {
      const reviews = await bridge.getReviews()
      for (const document of reviews) {
        addManagedReview(managedReviewDocument(document), false)
      }
      session = reviewSessions.updateStatus(reviewId, status)
    }
    if (!session) {
      throw new Error(`Cannot update missing review ${reviewId}.`)
    }
    renderDocumentTabs()
    if (reviewId === state.reviewId) {
      const selected = MarkoverTree.findNode(currentTree().root, state.selectedId)
      if (selected) renderAnnotation(selected)
      renderReviewContext()
    }
  })
  bridge.onReviewSnapshotRequested(async (reviewId) => {
    const paneHadFocus = (
      reviewId === state.reviewId &&
      elements.annotationPane.contains(document.activeElement)
    )
    if (reviewId === state.reviewId) {
      state.finishAttachmentLabelEdit?.(true)
      if (!finishActiveSourceEdit()) {
        throw new Error('Finish or cancel the empty source edit before handoff.')
      }
    }
    const session = reviewSessions.get(reviewId)
    if (!session) throw new Error(`Cannot snapshot missing review ${reviewId}.`)
    reviewSessions.updateStatus(reviewId, 'handoff-in-progress')
    renderDocumentTabs()
    if (reviewId === state.reviewId) {
      const selected = MarkoverTree.findNode(currentTree().root, state.selectedId)
      if (selected) renderAnnotation(selected)
      renderReviewContext()
      if (paneHadFocus) focusAnnotationPane()
    }
    await reviewMutations.wait(reviewId)
    return reviewSessions.snapshot(reviewId)
  })

  const reviewDocument = await bridge.getInitialReview()
  if (
    reviewDocument?.reviewId &&
    reviewDocument.tree &&
    isReviewSessionTree(reviewDocument.tree)
  ) {
    configureManagedMode()
    const reviews = await bridge.getReviews()
    for (const document of reviews) {
      addManagedReview(managedReviewDocument(document), false)
    }
    await loadDocument(reviewDocument)
  } else if (reviewDocument) {
    state.reviewMode = true
    state.durableReview = Boolean(reviewDocument.durable)
    if (state.durableReview) {
      elements.openButton.hidden = true
      elements.standardActions.hidden = false
      elements.reviewActions.hidden = true
      elements.annotationGuidance.textContent =
        'Annotations autosave continuously. Copy feedback JSON when you’re done.'
    } else {
      elements.standardActions.hidden = true
      elements.reviewActions.hidden = false
      elements.annotationGuidance.textContent =
        'Add feedback to any blocks, then click Done to return the review to the agent.'
    }
    await loadDocument(reviewDocument)
  } else {
    const reviews = await bridge.getReviews()
    if (reviews.length) {
      configureManagedMode()
      for (const document of reviews) {
        addManagedReview(managedReviewDocument(document), false)
      }
      const latestReview = reviews.at(-1)
      if (latestReview?.reviewId) activateReview(latestReview.reviewId)
    } else {
      setWorkspaceEmpty(true)
    }
  }
  if (elements.emptyWorkspace.hidden) elements.previewPane.focus()
  else elements.emptyOpenButton.focus()
}

applyDocumentsListWidth()
void initialize()

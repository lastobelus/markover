const elements = {
  appHeader: document.querySelector('.app-header'),
  annotationCount: document.querySelector('#annotation-count'),
  annotationGuidance: document.querySelector('#annotation-guidance'),
  annotationInput: document.querySelector('#annotation-input'),
  annotationList: document.querySelector('#annotation-list'),
  annotationListView: document.querySelector('#annotation-list-view'),
  annotationPane: document.querySelector('#annotation-pane'),
  annotationReadonly: document.querySelector('#annotation-readonly'),
  annotationSneakPeek: document.querySelector('#annotation-sneak-peek'),
  annotationState: document.querySelector('#annotation-state'),
  annotationViewList: document.querySelector('#annotation-view-list'),
  annotationViewSelected: document.querySelector('#annotation-view-selected'),
  attachmentList: document.querySelector('#attachment-list'),
  brandLogotype: document.querySelector('#brand-logotype'),
  brandMark: document.querySelector('#brand-mark'),
  cancelReviewButton: document.querySelector('#cancel-review-button'),
  checksum: document.querySelector('#document-checksum'),
  copyTreeButton: document.querySelector('#copy-tree-button'),
  emptyOpenButton: document.querySelector('#empty-open-button'),
  emptyWorkspace: document.querySelector('#empty-workspace'),
  documentTabs: document.querySelector('#document-tabs'),
  doneReviewButton: document.querySelector('#done-review-button'),
  imagePreview: document.querySelector('#image-preview'),
  imagePreviewClose: document.querySelector('#image-preview-close'),
  imagePreviewContent: document.querySelector('#image-preview-content'),
  imagePreviewLabel: document.querySelector('#image-preview-label'),
  keyboardHelp: document.querySelector('.keyboard-help'),
  name: document.querySelector('#document-name'),
  openButton: document.querySelector('#open-button'),
  parseStatus: document.querySelector('#parse-status'),
  pinnedSelection: document.querySelector('#pinned-selection'),
  previewPane: document.querySelector('#preview-pane'),
  selectedLocation: document.querySelector('#selected-location'),
  selectedAnnotationView: document.querySelector('#selected-annotation-view'),
  selectedSource: document.querySelector('#selected-source'),
  selectedTitle: document.querySelector('#selected-title'),
  scrollbarRowCover: document.querySelector('#scrollbar-row-cover'),
  sourceCancel: document.querySelector('#source-cancel'),
  sourceContent: document.querySelector('#source-content'),
  sourceDiff: document.querySelector('#source-diff'),
  sourceDiffStats: document.querySelector('#source-diff-stats'),
  sourceEdit: document.querySelector('#source-edit'),
  sourceEditor: document.querySelector('#source-editor'),
  sourceRevert: document.querySelector('#source-revert'),
  sourceSave: document.querySelector('#source-save'),
  sourceSaveBar: document.querySelector('#source-save-bar'),
  sourceToggle: document.querySelector('#source-toggle'),
  sourceToggleIcon: document.querySelector('#source-toggle-icon'),
  standardActions: document.querySelector('#standard-actions'),
  toast: document.querySelector('#toast'),
  tree: document.querySelector('#tree'),
  treeViewAll: document.querySelector('#tree-view-all'),
  treeViewAnnotated: document.querySelector('#tree-view-annotated'),
  reviewActions: document.querySelector('#review-actions'),
  reviewContextButton: document.querySelector('#review-context-button'),
  reviewContextClose: document.querySelector('#review-context-close'),
  reviewContextDrawer: document.querySelector('#review-context-drawer'),
  reviewContextFields: document.querySelector('#review-context-fields'),
  reviewContextSummary: document.querySelector('#review-context-summary'),
  reviewContextTitle: document.querySelector('#review-context-title'),
  documentsListCollapse: document.querySelector('#documents-list-collapse'),
  documentsListOpen: document.querySelector('#documents-list-open'),
  documentsListResizer: document.querySelector('#documents-list-resizer'),
  documentsListSidebar: document.querySelector('#documents-list-sidebar'),
  documentsListTree: document.querySelector('#documents-list-tree'),
  emptyWorkspaceLockup: document.querySelector('#empty-workspace-lockup'),
  reviewStateBanner: document.querySelector('#review-state-banner'),
  settingsClose: document.querySelector('#settings-close'),
  settingsDialog: document.querySelector('#settings-dialog'),
  settingsForm: document.querySelector('#settings-form'),
  settingsReset: document.querySelector('#settings-reset'),
  workspace: document.querySelector('#workspace')
}

const state = {
  attachmentPreviewUrls: new Map(),
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
  sourceDrafts: new Map(),
  sourceEditingId: null,
  tree: null
}
const reviewSessions = new MarkoverReviewSessions.ReviewSessions()
const reviewMutations = new MarkoverReviewSessions.ReviewMutationTracker()
const MAX_VISIBLE_TABS = 6
let DocumentsListFileTree = null
let documentsListModel = null
let documentsListObserver = null
let documentsListClockTimer = null
let documentsListCollapsed = false
let documentsListWidth = 248
let documentsListPathToReviewId = new Map()
let documentsListReviewIdToPath = new Map()
let documentsListSortOrder = new Map()
let documentsListDecorations = new Map()
let documentsListProjectPaths = []
let documentsListStatuses = new Map()
let brandAssetSources = null
let brandAssetLoad = null
let sourceDiffCleanup = null
let preferences = MarkoverSettings.normalizeSettings()
let resolvedAppearance = 'light'

import('../node_modules/@pierre/trees/dist/index.js')
  .then(({ FileTree }) => {
    DocumentsListFileTree = FileTree
    renderDocumentsList()
  })
  .catch((error) => {
    console.error('Failed to load documents list tree', error)
    elements.documentsListTree.textContent = `Documents list unavailable: ${error.message}`
  })

const bridge = window.markover || {
  async getBrandAssets() {
    return null
  },
  async checksum(source) {
    const bytes = new TextEncoder().encode(source)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    return `sha256:${hex}`
  },
  async openMarkdown() {
    return null
  },
  onOpenMarkdownRequested() {},
  copyText(text) {
    navigator.clipboard.writeText(text)
  },
  async getSettings() {
    return { ...MarkoverSettings.DEFAULT_SETTINGS, resolvedAppearance: 'light' }
  },
  async updateSettings(patch) {
    return {
      ...MarkoverSettings.updateSettings(preferences, patch),
      resolvedAppearance
    }
  },
  onSettingsOpen() {},
  onSettingsChanged() {},
  async saveAttachment(attachment) {
    state.fallbackAttachmentSequence += 1
    const id = `img-${state.fallbackAttachmentSequence}`
    const digest = await crypto.subtle.digest('SHA-256', attachment.bytes)
    const checksum = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    return {
      id,
      type: 'image',
      mimeType: attachment.mimeType,
      path: null,
      checksum: `sha256:${checksum}`,
      width: null,
      height: null,
      label: ''
    }
  },
  async getInitialReview() {
    return null
  },
  async getReviews() {
    return []
  },
  onReviewOpened() {},
  onReviewSnapshotRequested() {},
  onReviewStatus() {},
  activateReview() {},
  autosaveReview() {},
  finishReview() {},
  cancelReview() {}
}

const inlineMarkdown = window.markdownit('commonmark', {
  html: false,
  linkify: false,
  typographer: false
})
inlineMarkdown.enable('table')

inlineMarkdown.renderer.rules.link_open = (tokens, index) => {
  const href = tokens[index].attrGet('href') || ''
  return `<span class="inline-link" title="${inlineMarkdown.utils.escapeHtml(href)}">`
}
inlineMarkdown.renderer.rules.link_close = () => '</span>'
inlineMarkdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]
  const source = token.attrGet('src') || ''
  const alt = token.content || ''
  const label = MarkoverImagePreview.sourceLabel(source, alt)
  const escapedLabel = inlineMarkdown.utils.escapeHtml(label)
  const escapedSource = inlineMarkdown.utils.escapeHtml(source)
  return `<button type="button" class="inline-image" data-image-source="${escapedSource}" data-image-label="${escapedLabel}" title="Preview ${escapedLabel}">▧ ${escapedLabel}</button>`
}

function openSourceImagePreview(source, label) {
  openImagePreview({
    url: MarkoverImagePreview.sourceUrl(source, state.documentPath),
    label,
    id: MarkoverImagePreview.sourceLabel(source, '')
  })
}

function wireSourceImagePreviews(content) {
  for (const button of content.querySelectorAll('[data-image-source]')) {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const source = button.dataset.imageSource || ''
      openSourceImagePreview(source, button.dataset.imageLabel)
    })
  }
}

function sourceDiffStats(node) {
  if (!node.sourceEdit) return null
  return MarkoverDiffs.stats(node.sourceEdit.original, node.sourceEdit.current)
}

function renderDiffStats(element, stats) {
  const addition = document.createElement('span')
  addition.className = 'addition'
  addition.textContent = `+${stats.additions}`
  const deletion = document.createElement('span')
  deletion.className = 'deletion'
  deletion.textContent = `−${stats.deletions}`
  element.replaceChildren(addition, ' ', deletion)
}

function nodeKindLabel(node) {
  if (node.type === 'heading') return `H${node.level}`
  if (node.task) return node.checked ? '☑' : '☐'
  if (node.type === 'ordered-item') return node.marker
  if (node.type === 'unordered-item') return '○'
  if (node.type === 'paragraph') return '¶'
  if (node.type === 'blockquote') return '❯'
  if (node.type === 'table') return '▦'
  if (node.type === 'thematic-break') return '—'
  return '</>'
}

function nodeDescriptor(node) {
  if (node.type === 'heading') return `<h${node.level}>`
  if (node.task) {
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
  return node.language ? `<code:${node.language}>` : '<code>'
}

function createRenderedAnnotation(node, options = {}) {
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

function hideAnnotationSneakPeek() {
  elements.annotationSneakPeek.hidden = true
  elements.annotationSneakPeek.replaceChildren()
}

function showAnnotationSneakPeek(node, marker) {
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

function hasAttachments(node) {
  return Array.isArray(node.attachments) && node.attachments.length > 0
}

function attachmentCountInSubtree(node) {
  return (node.attachments || []).length +
    node.children.reduce(
      (count, child) => count + attachmentCountInSubtree(child),
      0
    )
}

function hasAnnotation(node) {
  return MarkoverAnnotations.hasAnnotation(node)
}

function isCurrentReviewEditable() {
  return MarkoverReviewSessions.isTreeEditable(state.tree)
}

function annotatedNodes() {
  return MarkoverAnnotations.annotatedNodes(state.tree.root)
}

function hasFeedbackDescendant(node) {
  return node.children.some((child) => (
    hasAnnotation(child) || hasFeedbackDescendant(child)
  ))
}

function fullTreeEntry(node) {
  return {
    node,
    contextual: false,
    children: node.children.map(fullTreeEntry)
  }
}

function selectNode(id, focusPreview = false) {
  const node = MarkoverTree.findNode(state.tree.root, id)
  if (!node) return
  if (!finishActiveSourceEdit(id)) return
  state.selectedId = id
  renderTree()
  renderAnnotation(node)

  const selectedRow = elements.tree.querySelector(`[data-node-id="${id}"]`)
  selectedRow?.scrollIntoView({ block: 'nearest' })
  if (focusPreview) elements.previewPane.focus()
}

function setWorkspaceEmpty(empty) {
  elements.appHeader.classList.toggle('is-empty', empty)
  elements.emptyWorkspace.hidden = !empty
  elements.workspace.hidden = empty
  elements.documentTabs.hidden = empty || !reviewSessions.list().length
}

function normalizeAnnotatedSelection() {
  const normalized = MarkoverAnnotations.normalizeFilter(
    state.tree.root,
    state.selectedId,
    state.annotatedOnly
  )
  const changed = normalized.selectedId !== state.selectedId
  state.annotatedOnly = normalized.enabled
  state.selectedId = normalized.selectedId
  return changed
}

function setAnnotatedOnly(enabled) {
  if (enabled && !annotatedNodes().length) return
  if (!finishActiveSourceEdit()) return
  state.annotatedOnly = enabled
  normalizeAnnotatedSelection()
  renderTree()
  const selected = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (selected) renderAnnotation(selected)
}

function updatePinnedSelection() {
  const selectedRow = elements.tree.querySelector(
    `[data-node-id="${state.selectedId}"]`
  )
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
  pinnedRow.classList.add('is-pinned')
  pinnedRow.removeAttribute('data-node-id')
  pinnedRow.querySelectorAll('button').forEach((button) => {
    button.tabIndex = -1
  })
  elements.pinnedSelection.replaceChildren(pinnedRow)
  updateScrollbarRowCover()
}

function updateScrollbarRowCover() {
  const hoveredRow = state.hoveredId
    ? elements.tree.querySelector(`[data-node-id="${state.hoveredId}"]`)
    : null
  const selectedRow = elements.tree.querySelector(
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

function renderNode(entry, depth) {
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
  if (node.sourceEdit) {
    content.className = 'block-content proposed-source'
    content.innerHTML = inlineMarkdown.render(node.sourceEdit.current)
  } else if (node.type === 'heading') {
    content.className = `block-content heading level-${node.level}`
    content.innerHTML = inlineMarkdown.renderInline(node.text)
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
    content.className = `block-content list-item${node.task ? ' task-item' : ''}`
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
    renderDiffStats(summary, sourceDiffStats(node))
    row.append(summary)
  }

  row.addEventListener('click', () => selectNode(node.id, true))
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

function renderTree() {
  hideAnnotationSneakPeek()
  elements.tree.replaceChildren()
  const projection = state.annotatedOnly
    ? MarkoverAnnotations.annotatedProjection(state.tree.root)
    : state.tree.root.children.map(fullTreeEntry)
  for (const entry of projection) {
    elements.tree.append(renderNode(entry, 0))
  }

  const position = state.annotatedOnly
    ? MarkoverAnnotations.annotationPosition(state.tree.root, state.selectedId)
    : MarkoverTree.nodePosition(state.tree.root, state.selectedId)
  const unsupported = state.tree.unsupported.length
  const annotationCount = annotatedNodes().length
  elements.treeViewAnnotated.querySelector('span').textContent = String(annotationCount)
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

function renderTreePreservingScroll() {
  const scrollTop = elements.tree.scrollTop
  renderTree()
  elements.tree.scrollTop = scrollTop
  requestAnimationFrame(() => {
    elements.tree.scrollTop = scrollTop
    updatePinnedSelection()
  })
}

function attachmentReference(attachment) {
  return attachment.label || attachment.id
}

function beginAttachmentLabelEdit(node, attachment, item, details) {
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
  function finish(commit) {
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
  input.addEventListener('blur', () => finish(true))
  requestAnimationFrame(() => {
    input.focus()
    input.select()
  })
}

function openImagePreview(attachment) {
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

function attachmentPreviewUrl(attachment) {
  const sessionUrl = state.attachmentPreviewUrls.get(attachment.id)
  if (sessionUrl) return sessionUrl
  if (!attachment.path?.startsWith('/')) return null
  const encodedPath = attachment.path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  return `file://${encodedPath}`
}

function closeImagePreview() {
  elements.imagePreview.hidden = true
  elements.imagePreviewContent.removeAttribute('src')
  elements.imagePreviewLabel.textContent = ''
}

function removeAttachment(node, attachment) {
  if (!isCurrentReviewEditable()) return
  node.attachments = node.attachments.filter((item) => item.id !== attachment.id)
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
    const selected = MarkoverTree.findNode(state.tree.root, state.selectedId)
    if (selected) renderAnnotation(selected)
  }
  updateAnnotationCount()
  autosaveReview()
}

function renderAttachmentList(node) {
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
        const details = item.querySelector('.attachment-details')
        if (details) beginAttachmentLabelEdit(node, attachment, item, details)
      }, true)
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        const details = item.querySelector('.attachment-details')
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
            window.confirm
          )
        ) return
        removeAttachment(node, attachment)
      })
      item.append(removeButton)
    }

    elements.attachmentList.append(item)
  }
}

function renderReviewEditability() {
  const managed = Boolean(state.tree?.review?.id)
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

function renderReadonlyFeedback(node) {
  if (node.feedback.trim()) {
    elements.annotationReadonly.classList.remove('is-empty')
    elements.annotationReadonly.innerHTML = inlineMarkdown.render(node.feedback)
  } else {
    elements.annotationReadonly.classList.add('is-empty')
    elements.annotationReadonly.textContent = 'No feedback on this block.'
  }
}

function focusAnnotationPane() {
  elements.annotationPane.classList.add('focus-within')
  if (state.annotationView === 'list') elements.annotationListView.focus()
  else if (isCurrentReviewEditable()) elements.annotationInput.focus()
  else elements.annotationReadonly.focus()
}

function renderSourcePanel(node) {
  sourceDiffCleanup?.()
  sourceDiffCleanup = null
  elements.sourceDiff.replaceChildren()

  const editable = isCurrentReviewEditable()
  const editing = editable && state.sourceEditingId === node.id
  const draft = state.sourceDrafts.get(node.id)
  const savedSource = MarkoverSourceEdits.savedSource(node)
  const currentDraft = draft ?? savedSource
  const dirty = editing && currentDraft !== savedSource

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
    renderDiffStats(elements.sourceDiffStats, sourceDiffStats(node))
    if (!state.sourceCollapsed) {
      try {
        sourceDiffCleanup = MarkoverDiffs.render(
          elements.sourceDiff,
          node.sourceEdit.original,
          node.sourceEdit.current,
          `${state.reviewId || 'local'}:${node.id}`
        )
      } catch (error) {
        elements.sourceDiff.textContent = `Diff unavailable: ${error.message}`
      }
    }
  } else {
    elements.sourceDiffStats.replaceChildren()
  }

  if (editing) {
    elements.sourceEditor.value = currentDraft
  }
}

function beginSourceEdit(node) {
  if (!isCurrentReviewEditable()) return
  if (!finishActiveSourceEdit(node.id)) return
  MarkoverSourceEdits.begin(state, node)
  state.sourceCollapsed = false
  elements.sourceToggle.setAttribute('aria-expanded', 'true')
  elements.sourceToggleIcon.textContent = '▼'
  renderSourcePanel(node)
  requestAnimationFrame(() => elements.sourceEditor.focus())
}

function cancelSourceEdit(node) {
  MarkoverSourceEdits.cancel(state, node)
  renderSourcePanel(node)
}

function saveSourceEdit(node) {
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

function finishActiveSourceEdit(nextId = null) {
  const editingId = state.sourceEditingId
  if (!editingId || editingId === nextId) return true
  const node = MarkoverTree.findNode(state.tree.root, editingId)
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
    requestAnimationFrame(() => elements.sourceEditor.focus())
    return false
  }
  if (result.changed) {
    renderTreePreservingScroll()
    autosaveReview()
  }
  if (state.selectedId === node.id) renderAnnotation(node)
  return true
}

function revertSourceEdit(node) {
  if (!node.sourceEdit || !isCurrentReviewEditable()) return
  delete node.sourceEdit
  state.sourceDrafts.delete(node.id)
  if (state.sourceEditingId === node.id) state.sourceEditingId = null
  renderTreePreservingScroll()
  renderAnnotation(node)
  autosaveReview()
}

function selectAnnotationFromList(node) {
  const revealed = MarkoverAnnotations.revealAnnotation(state.tree.root, node.id)
  selectNode(node.id)
  if (revealed) autosaveReview()
  focusAnnotationPane()
}

function editAnnotationFromList(node) {
  state.annotationView = 'selected'
  selectAnnotationFromList(node)
}

function renderAnnotationList() {
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

function renderAnnotationPaneView(node) {
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
      state.tree.root,
      state.selectedId
    )
    elements.selectedTitle.textContent = position.index
      ? `${position.index} of ${position.total}`
      : `${position.total} total`
  } else {
    elements.selectedTitle.textContent = nodeDescriptor(node)
  }
  elements.selectedLocation.textContent = node.lineStart === node.lineEnd
    ? `Line ${node.lineStart}`
    : `Lines ${node.lineStart}–${node.lineEnd}`
  renderAnnotationList()
}

function setAnnotationView(view) {
  if (view === 'list') {
    const nextId = MarkoverAnnotations.nearestAnnotatedId(
      state.tree.root,
      state.selectedId
    )
    if (!nextId) return
    if (!finishActiveSourceEdit(nextId)) return
    const revealed = MarkoverAnnotations.revealAnnotation(state.tree.root, nextId)
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
  const selected = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (selected) renderAnnotation(selected)
  focusAnnotationPane()
}

function renderAnnotation(node) {
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

function updateAnnotationCount() {
  const count = annotatedNodes().length
  elements.annotationCount.textContent = `${count} annotation${count === 1 ? '' : 's'}`
  elements.annotationViewList.textContent = `All Annotations (${count})`
  elements.annotationViewList.disabled = count === 0
}

function showToast(message) {
  elements.toast.textContent = message
  elements.toast.classList.add('is-visible')
  elements.toast.setAttribute('aria-hidden', 'false')
  clearTimeout(showToast.timeout)
  showToast.timeout = setTimeout(() => {
    elements.toast.classList.remove('is-visible')
    elements.toast.setAttribute('aria-hidden', 'true')
  }, 1500)
}

function autosaveReview() {
  autosaveTree(state.reviewId, state.tree)
}

function autosaveTree(reviewId, tree) {
  if (
    !state.reviewMode ||
    !tree ||
    !MarkoverReviewSessions.isTreeEditable(tree)
  ) return
  bridge.autosaveReview(reviewId, tree)
}

function captureActiveSession() {
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

function reviewStatusLabel(status) {
  if (status === 'handoff-in-progress') return 'Handing off'
  return status === 'pending-agent' ? 'With agent' : 'Editing'
}

function addReviewContextField(label, value) {
  if (value === null || value === undefined || value === '') return
  const term = document.createElement('dt')
  term.textContent = label
  const description = document.createElement('dd')
  description.textContent = String(value)
  elements.reviewContextFields.append(term, description)
}

function renderReviewContext() {
  const review = state.tree?.review
  elements.reviewContextButton.hidden = !review
  if (!review) {
    closeReviewContext(false)
    return
  }

  elements.reviewContextTitle.textContent = state.documentName
  elements.reviewContextSummary.innerHTML = inlineMarkdown.render(
    review.contextSummary
  )
  elements.reviewContextFields.replaceChildren()
  addReviewContextField('Review ID', review.id)
  addReviewContextField('Status', reviewStatusLabel(review.status))
  addReviewContextField('Source', state.documentPath)
  addReviewContextField('Created', review.createdAt)
  addReviewContextField('Repository root', review.git?.repositoryRoot)
  addReviewContextField('Branch', review.git?.branch)
  addReviewContextField('Commit', review.git?.commit)
  addReviewContextField('Repository', review.git?.repositoryUrl)
  addReviewContextField(
    'Git sources',
    review.git?.sources
      ? [...new Set(Object.values(review.git.sources))].join(', ')
      : null
  )
  addReviewContextField(
    'Pull request',
    review.pullRequest?.number
      ? `#${review.pullRequest.number}`
      : review.pullRequest?.url
  )
  addReviewContextField('Pull request URL', review.pullRequest?.url)
  addReviewContextField(
    'Pull request source',
    review.pullRequest?.discovery
  )
  addReviewContextField(
    'Agent thread',
    review.agentThread?.id
      ? [
          review.agentThread.provider,
          review.agentThread.id
        ].filter(Boolean).join(' · ')
      : null
  )
  addReviewContextField('Thread source', review.agentThread?.discovery)
  addReviewContextField('Thread cwd', review.agentThread?.cwd)
  addReviewContextField('Session log', review.agentThread?.logPath)
  addReviewContextField(
    'Parent thread',
    review.agentThread?.parentThreadId
  )
  addReviewContextField(
    'Forked from',
    review.agentThread?.forkedFromId
  )
}

function openReviewContext() {
  if (!state.tree?.review) return
  renderReviewContext()
  elements.reviewContextDrawer.hidden = false
  elements.reviewContextButton.setAttribute('aria-expanded', 'true')
  elements.reviewContextClose.focus()
}

function closeReviewContext(restoreFocus = true) {
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

function treePathSegment(value) {
  return String(value || '')
    .replace(/[\\/]/g, '∕')
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

function documentsListStatusIcon(status) {
  if (status === 'editing') return 'markover-status-editing'
  if (status === 'pending-agent') return 'markover-status-pending'
  if (status === 'handoff-in-progress') return 'markover-status-progress'
  return 'markover-status-other'
}

function buildDocumentsListProjection() {
  const groups = reviewSessions.projectGroups()
  const nameCounts = new Map()
  for (const group of groups) {
    nameCounts.set(group.name, (nameCounts.get(group.name) || 0) + 1)
  }
  const duplicateIndices = new Map()
  for (const name of nameCounts.keys()) {
    const matches = groups
      .filter((group) => group.name === name)
      .sort((left, right) => left.key.localeCompare(right.key))
    matches.forEach((group, index) => duplicateIndices.set(group.key, index + 1))
  }
  const paths = []
  const projectPaths = []
  const pathToReviewId = new Map()
  const reviewIdToPath = new Map()
  const sortOrder = new Map()
  const decorations = new Map()
  const statuses = new Map()
  const byFileName = {}

  groups.forEach((group, groupIndex) => {
    const duplicateSuffix = nameCounts.get(group.name) > 1
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

function documentsListSort(left, right) {
  const leftRank = documentsListSortOrder.get(left.path) ?? Number.MAX_SAFE_INTEGER
  const rightRank = documentsListSortOrder.get(right.path) ?? Number.MAX_SAFE_INTEGER
  return leftRank - rightRank || left.basename.localeCompare(right.basename)
}

function applyDocumentsListRowMetadata() {
  const shadowRoot = documentsListModel?.getFileTreeContainer()?.shadowRoot
  if (!shadowRoot) return
  for (const row of shadowRoot.querySelectorAll(
    'button[data-item-type="file"][data-item-path]'
  )) {
    const status = documentsListStatuses.get(row.dataset.itemPath)
    const icon = row.querySelector('[data-item-section="icon"]')
    const content = row.querySelector('[data-item-section="content"]')
    if (icon) icon.title = reviewStatusLabel(status)
    if (content) {
      content.dataset.documentsListLabel = row.getAttribute('aria-label') || ''
    }
  }
}

function scheduleDocumentsListRowMetadata() {
  requestAnimationFrame(applyDocumentsListRowMetadata)
}

function observeDocumentsListRows() {
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

function scheduleDocumentsListClockRefresh(sessions) {
  clearTimeout(documentsListClockTimer)
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

function selectActiveReviewInDocumentsList() {
  if (!documentsListModel || !state.reviewId) return
  const activePath = documentsListReviewIdToPath.get(state.reviewId)
  if (!activePath) return
  const activeProjectPath = activePath.slice(0, activePath.lastIndexOf('/') + 1)
  const activeProject = documentsListModel.getItem(activeProjectPath)
  if (activeProject?.isDirectory() && !activeProject.isExpanded()) {
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

function renderDocumentsList() {
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
  const previouslyExpanded = documentsListModel
    ? documentsListProjectPaths.filter((path) => (
        documentsListModel.getItem(path)?.isDirectory() &&
        documentsListModel.getItem(path)?.isExpanded()
      ))
    : projection.projectPaths

  documentsListPathToReviewId = projection.pathToReviewId
  documentsListReviewIdToPath = projection.reviewIdToPath
  documentsListSortOrder = projection.sortOrder
  documentsListDecorations = projection.decorations
  documentsListProjectPaths = projection.projectPaths
  documentsListStatuses = projection.statuses

  if (!documentsListModel) {
    documentsListModel = new DocumentsListFileTree({
      density: 'compact',
      flattenEmptyDirectories: false,
      icons: projection.icons,
      initialExpandedPaths: projection.projectPaths,
      itemHeight: 22,
      onSelectionChange(selectedPaths) {
        const reviewId = documentsListPathToReviewId.get(selectedPaths.at(-1))
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
    documentsListModel.subscribe(scheduleDocumentsListRowMetadata)
    documentsListModel.render({
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

function applyDocumentsListWidth() {
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

function setDocumentsListCollapsed(collapsed) {
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

function themedBrandSource(source, primary, secondary) {
  if (!source) return null
  const themed = source
    .replaceAll('#c94e1f', primary)
    .replaceAll('#6d211f', secondary)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(themed)}`
}

async function themeBrandAssets() {
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

function applySettings(next, options = {}) {
  const previous = preferences
  const applied = MarkoverSettings.applySettingsToView(next, {
    root: document.documentElement,
    keyboardHelp: elements.keyboardHelp,
    form: elements.settingsForm
  })
  preferences = applied.preferences
  resolvedAppearance = applied.appearance
  themeBrandAssets()

  if (MarkoverSettings.sidebarPreferenceChanged(
    previous,
    preferences,
    options.initial
  )) {
    setDocumentsListCollapsed(!preferences.openDocumentsSidebar)
  }
}

function openSettings() {
  MarkoverSettings.applySettingsToView(
    { ...preferences, resolvedAppearance },
    {
      root: document.documentElement,
      keyboardHelp: elements.keyboardHelp,
      form: elements.settingsForm
    }
  )
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal()
  elements.settingsForm.elements.namedItem('palette').focus()
}

elements.settingsClose.addEventListener('click', () => {
  elements.settingsDialog.close()
})
elements.settingsReset.addEventListener('click', async () => {
  applySettings(await bridge.updateSettings(MarkoverSettings.DEFAULT_SETTINGS))
})
elements.settingsForm.addEventListener('change', async (event) => {
  const control = event.target
  const value = control.type === 'checkbox' ? control.checked : control.value
  applySettings(await bridge.updateSettings({ [control.name]: value }))
})

function focusedPane() {
  const active = document.activeElement
  if (elements.documentsListSidebar.contains(active)) return 'documents'
  if (elements.annotationPane.contains(active)) return 'annotation'
  return 'preview'
}

function focusDocumentsList() {
  const activePath = documentsListReviewIdToPath.get(state.reviewId)
  if (activePath && documentsListModel) {
    documentsListModel.scrollToPath(activePath, {
      focus: true,
      offset: 'nearest'
    })
    const focusActiveRow = () => {
      const shadowRoot = documentsListModel.getFileTreeContainer()?.shadowRoot
      const row = [...(shadowRoot?.querySelectorAll(
        'button[data-item-path]'
      ) || [])].find((button) => (
        button.dataset.itemPath === activePath &&
        button.dataset.itemParked !== 'true'
      ))
      const target = row || shadowRoot?.querySelector('[role="tree"]')
      target?.focus()
    }
    focusActiveRow()
    requestAnimationFrame(focusActiveRow)
    return
  }
  elements.documentsListCollapse.focus()
}

function focusPane(pane) {
  if (pane === 'documents') focusDocumentsList()
  else if (pane === 'annotation') focusAnnotationPane()
  else elements.previewPane.focus()
}

function beginDocumentsListResize(event) {
  if (event.button !== 0) return
  event.preventDefault()
  const workspaceLeft = elements.workspace.getBoundingClientRect().left
  const pointerId = event.pointerId
  elements.documentsListResizer.setPointerCapture(pointerId)
  document.body.classList.add('is-resizing-documents-list')

  const resize = (moveEvent) => {
    documentsListWidth = moveEvent.clientX - workspaceLeft
    applyDocumentsListWidth()
  }
  const finish = () => {
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

function closeTabOverflow() {
  elements.documentTabs
    .querySelector('.document-tab-overflow')
    ?.classList.remove('is-open')
}

function createDocumentTab(session) {
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

  button.addEventListener('click', () => activateReview(session.reviewId))
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
        .querySelector(`[data-review-id="${adjacent.reviewId}"]`)
        ?.focus()
    })
  })
  button.dataset.reviewId = session.reviewId
  return button
}

function renderDocumentTabs() {
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
      item.addEventListener('click', () => activateReview(session.reviewId))
      menu.append(item)
    }
    overflow.append(menu)
    elements.documentTabs.append(overflow)
  }

  renderDocumentsList()
}

function activateReview(reviewId) {
  setWorkspaceEmpty(false)
  if (reviewId === state.reviewId) return
  state.finishAttachmentLabelEdit?.(true)
  if (reviewMutations.has(state.reviewId)) {
    reviewMutations.wait(state.reviewId).then(() => activateReview(reviewId))
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

function addManagedReview(documentData, activate = true) {
  const existed = Boolean(reviewSessions.get(documentData.reviewId))
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

function configureManagedMode() {
  state.reviewMode = true
  state.durableReview = true
  elements.openButton.hidden = true
  elements.standardActions.hidden = false
  elements.reviewActions.hidden = true
  elements.annotationGuidance.textContent =
    'Annotations autosave continuously. Ask the agent to check Markover when you’re done.'
}

async function loadDocument(documentData) {
  setWorkspaceEmpty(false)
  const checksum = documentData.checksum || await bridge.checksum(documentData.source)
  if (documentData.reviewId && documentData.tree?.review) {
    addManagedReview({ ...documentData, checksum })
    return
  }

  state.documentName = documentData.name
  state.documentPath = documentData.path || null
  state.tree = documentData.tree || MarkoverTree.parseMarkdown(
    documentData.source,
    checksum,
    {
      name: documentData.name,
      path: documentData.path
    }
  )
  state.reviewId = documentData.reviewId || state.tree.review?.id || null
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
    renderAnnotation(MarkoverTree.findNode(state.tree.root, state.selectedId))
  }
  autosaveReview()
}

elements.annotationInput.addEventListener('input', () => {
  if (!isCurrentReviewEditable()) return
  const node = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (!node) return
  const wasAnnotated = Boolean(hasAnnotation(node))
  node.feedback = elements.annotationInput.value
  elements.annotationState.textContent = hasAnnotation(node)
    ? 'Annotated'
    : 'Not annotated'
  if (wasAnnotated !== Boolean(hasAnnotation(node))) {
    const selectionChanged = normalizeAnnotatedSelection()
    renderTreePreservingScroll()
    if (selectionChanged) {
      const selected = MarkoverTree.findNode(state.tree.root, state.selectedId)
      if (selected) renderAnnotation(selected)
    }
  }
  updateAnnotationCount()
  autosaveReview()
  elements.annotationInput.focus()
})

async function pasteImages(event) {
  if (!isCurrentReviewEditable()) {
    event.preventDefault()
    showToast('This review is with the agent and read only')
    return
  }
  const originReviewId = state.reviewId
  const originTree = state.tree
  const originPreviewUrls = state.attachmentPreviewUrls
  const originSelectedId = state.selectedId
  const node = MarkoverTree.findNode(originTree.root, originSelectedId)
  if (!node) return

  const imageItems = [...(event.clipboardData?.items || [])]
    .filter((item) => item.type.startsWith('image/'))
  const pastedImages = []

  for (const item of imageItems) {
    const file = item.getAsFile()
    if (!file) continue
    pastedImages.push({
      bytes: await file.arrayBuffer(),
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
        preview: new Blob([bytes], { type: clipboardImage.mimeType })
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
      node.attachments ||= []
      node.attachments.push(attachment)
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
      showToast(error.message || 'Could not attach pasted image')
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
  const reviewId = state.reviewId
  reviewMutations.track(reviewId, pasteImages(event)).catch(() => {})
})

async function openMarkdownDocument() {
  const documentData = await bridge.openMarkdown()
  if (documentData) {
    if (!finishActiveSourceEdit()) return
    await loadDocument(documentData)
    elements.previewPane.focus()
  }
}

elements.openButton.addEventListener('click', openMarkdownDocument)
elements.emptyOpenButton.addEventListener('click', openMarkdownDocument)

elements.copyTreeButton.addEventListener('click', () => {
  if (!finishActiveSourceEdit()) return
  bridge.copyText(MarkoverTree.serializeTree(state.tree))
  showToast('Feedback JSON copied')
})

elements.doneReviewButton.addEventListener('click', () => {
  if (!finishActiveSourceEdit()) return
  elements.doneReviewButton.disabled = true
  elements.doneReviewButton.textContent = 'Finishing…'
  bridge.finishReview(state.tree)
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
  const node = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (node) renderSourcePanel(node)
})

elements.treeViewAll.addEventListener('click', () => setAnnotatedOnly(false))
elements.treeViewAnnotated.addEventListener('click', () => setAnnotatedOnly(true))
elements.annotationViewSelected.addEventListener('click', () => {
  setAnnotationView('selected')
})
elements.annotationViewList.addEventListener('click', () => {
  setAnnotationView('list')
})
MarkoverAnnotationBlock.bindListKeyboard(elements.annotationListView, {
  edit() {
    const selected = elements.annotationList.querySelector(
      '.rendered-annotation.is-selected'
    )
    if (!selected) return
    const edit = selected?.querySelector('.rendered-annotation-edit')
    if (edit) edit.click()
    else setAnnotationView('selected')
  },
  move(offset) {
    const nodes = annotatedNodes()
    const currentId = MarkoverAnnotations.nearestAnnotatedId(
      state.tree.root,
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
  const node = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (node) beginSourceEdit(node)
})

elements.sourceRevert.addEventListener('click', () => {
  const node = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (node) revertSourceEdit(node)
})

elements.sourceCancel.addEventListener('click', () => {
  const node = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (node) cancelSourceEdit(node)
})

elements.sourceSave.addEventListener('click', () => {
  const node = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (node) saveSourceEdit(node)
})

elements.sourceEditor.addEventListener('input', () => {
  const node = MarkoverTree.findNode(state.tree.root, state.selectedId)
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
  const node = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (node) cancelSourceEdit(node)
})

elements.imagePreviewClose.addEventListener('click', closeImagePreview)
elements.imagePreview.addEventListener('click', (event) => {
  if (event.target === elements.imagePreview) closeImagePreview()
})
elements.reviewContextButton.addEventListener('click', () => {
  if (elements.reviewContextDrawer.hidden) openReviewContext()
  else closeReviewContext()
})
elements.reviewContextClose.addEventListener('click', () => closeReviewContext())
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
  applyDocumentsListWidth()
  updatePinnedSelection()
  MarkoverAnnotationBlock.updateTruncation(elements.annotationList)
})
document.addEventListener('click', (event) => {
  if (!elements.documentTabs.contains(event.target)) closeTabOverflow()
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
  const direction = event.key.replace('Arrow', '').toLowerCase()
  const current = MarkoverTree.findNode(state.tree.root, state.selectedId)
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
    ? MarkoverAnnotations.navigationRoot(state.tree.root)
    : state.tree.root
  const nextId = MarkoverNavigation.move(navigationRoot, state.selectedId, direction)
  selectNode(nextId, true)
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

async function initialize() {
  bridge.onOpenMarkdownRequested(() => openMarkdownDocument())
  bridge.onSettingsOpen(openSettings)
  bridge.onSettingsChanged((settings) => applySettings(settings))
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
      for (const document of reviews) addManagedReview(document, false)
      session = reviewSessions.updateStatus(reviewId, status)
    }
    if (!session) {
      throw new Error(`Cannot update missing review ${reviewId}.`)
    }
    renderDocumentTabs()
    if (reviewId === state.reviewId) {
      const selected = MarkoverTree.findNode(state.tree.root, state.selectedId)
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
      const selected = MarkoverTree.findNode(state.tree.root, state.selectedId)
      if (selected) renderAnnotation(selected)
      renderReviewContext()
      if (paneHadFocus) focusAnnotationPane()
    }
    await reviewMutations.wait(reviewId)
    return reviewSessions.snapshot(reviewId)
  })

  const reviewDocument = await bridge.getInitialReview()
  if (reviewDocument?.reviewId && reviewDocument.tree?.review) {
    configureManagedMode()
    const reviews = await bridge.getReviews()
    for (const document of reviews) addManagedReview(document, false)
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
      for (const document of reviews) addManagedReview(document, false)
      activateReview(reviews[reviews.length - 1].reviewId)
    } else {
      setWorkspaceEmpty(true)
    }
  }
  if (elements.emptyWorkspace.hidden) elements.previewPane.focus()
  else elements.emptyOpenButton.focus()
}

applyDocumentsListWidth()
initialize()

const SAMPLE_MARKDOWN = `# Prototype review

## Interaction model

- Keyboard-first block navigation
  - Left selects the parent
  - Right selects the first child or next available sibling
- Tab moves between the document and annotation panes

## Data model

1. Parse the Markdown into a deterministic tree
2. Attach annotations directly to block nodes
3. Copy the full feedback tree as JSON

\`\`\`json
{
  "format": "markover-tree",
  "version": 1
}
\`\`\`

## Deliberately deferred

- Annotation persistence
- Rich Markdown rendering
- Direct agent-thread integration
`

const elements = {
  annotationCount: document.querySelector('#annotation-count'),
  annotationGuidance: document.querySelector('#annotation-guidance'),
  annotationInput: document.querySelector('#annotation-input'),
  annotationPane: document.querySelector('#annotation-pane'),
  annotationReadonly: document.querySelector('#annotation-readonly'),
  annotationState: document.querySelector('#annotation-state'),
  attachmentList: document.querySelector('#attachment-list'),
  cancelReviewButton: document.querySelector('#cancel-review-button'),
  checksum: document.querySelector('#document-checksum'),
  copyTreeButton: document.querySelector('#copy-tree-button'),
  documentTabs: document.querySelector('#document-tabs'),
  doneReviewButton: document.querySelector('#done-review-button'),
  imagePreview: document.querySelector('#image-preview'),
  imagePreviewClose: document.querySelector('#image-preview-close'),
  imagePreviewContent: document.querySelector('#image-preview-content'),
  name: document.querySelector('#document-name'),
  openButton: document.querySelector('#open-button'),
  parseStatus: document.querySelector('#parse-status'),
  pinnedSelection: document.querySelector('#pinned-selection'),
  previewPane: document.querySelector('#preview-pane'),
  selectedLocation: document.querySelector('#selected-location'),
  selectedSource: document.querySelector('#selected-source'),
  selectedTitle: document.querySelector('#selected-title'),
  scrollbarRowCover: document.querySelector('#scrollbar-row-cover'),
  sourceToggle: document.querySelector('#source-toggle'),
  sourceToggleIcon: document.querySelector('#source-toggle-icon'),
  standardActions: document.querySelector('#standard-actions'),
  toast: document.querySelector('#toast'),
  tree: document.querySelector('#tree'),
  reviewActions: document.querySelector('#review-actions'),
  reviewStateBanner: document.querySelector('#review-state-banner')
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
  sourceCollapsed: false,
  tree: null
}
const reviewSessions = new MarkoverReviewSessions.ReviewSessions()
const reviewMutations = new MarkoverReviewSessions.ReviewMutationTracker()

const bridge = window.markover || {
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
  copyText(text) {
    navigator.clipboard.writeText(text)
  },
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
  const alt = token.content || 'Image'
  const label = inlineMarkdown.utils.escapeHtml(alt)
  const title = inlineMarkdown.utils.escapeHtml(source)
  return `<span class="inline-image" title="${title}">▧ ${label}</span>`
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

function countNodes() {
  let count = 0
  MarkoverTree.visitNodes(state.tree.root, () => {
    count += 1
  })
  return count
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
  return node.feedback.trim() || hasAttachments(node)
}

function isCurrentReviewEditable() {
  return MarkoverReviewSessions.isTreeEditable(state.tree)
}

function annotatedNodes() {
  const annotated = []
  MarkoverTree.visitNodes(state.tree.root, (node, _parent, ancestors) => {
    if (hasAnnotation(node)) annotated.push({ node, ancestors })
  })
  return annotated
}

function hasFeedbackDescendant(node) {
  return node.children.some((child) => (
    hasAnnotation(child) || hasFeedbackDescendant(child)
  ))
}

function selectNode(id, focusPreview = false) {
  const node = MarkoverTree.findNode(state.tree.root, id)
  if (!node) return
  state.selectedId = id
  renderTree()
  renderAnnotation(node)

  const selectedRow = elements.tree.querySelector(`[data-node-id="${id}"]`)
  selectedRow?.scrollIntoView({ block: 'nearest' })
  if (focusPreview) elements.previewPane.focus()
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

function renderNode(node, depth) {
  const wrapper = document.createElement('div')
  wrapper.className = 'block'

  const row = document.createElement('div')
  row.className = `block-row${node.id === state.selectedId ? ' is-selected' : ''}`
  row.dataset.nodeId = node.id
  row.style.setProperty('--depth-indent', `${depth * 18}px`)

  if (node.children.length) {
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
  if (node.type === 'heading') {
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
  row.append(content)

  if (hasAnnotation(node)) {
    const dot = document.createElement('span')
    dot.className = 'annotation-dot'
    dot.title = 'Annotated'
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
    if (node.children.length) {
      node.collapsed = !node.collapsed
      renderTree()
      autosaveReview()
    }
  })
  wrapper.append(row)

  if (node.children.length) {
    const children = document.createElement('div')
    children.className = `block-children${node.collapsed ? ' is-collapsed' : ''}`
    for (const child of node.children) children.append(renderNode(child, depth + 1))
    wrapper.append(children)
  }

  return wrapper
}

function renderTree() {
  elements.tree.replaceChildren()
  for (const node of state.tree.root.children) {
    elements.tree.append(renderNode(node, 0))
  }

  const count = countNodes()
  const unsupported = state.tree.unsupported.length
  elements.parseStatus.textContent = unsupported
    ? `${count} blocks · ${unsupported} omitted`
    : `${count} blocks`
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
  const previewUrl = attachmentPreviewUrl(attachment)
  if (!previewUrl) {
    showToast('Preview unavailable in this session')
    return
  }
  elements.imagePreviewContent.src = previewUrl
  elements.imagePreviewContent.alt = attachment.label || attachment.id
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
  renderTree()
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
  if (isCurrentReviewEditable()) elements.annotationInput.focus()
  else elements.annotationReadonly.focus()
}

function renderAnnotation(node) {
  elements.selectedTitle.textContent = nodeDescriptor(node)
  elements.selectedLocation.textContent = node.lineStart === node.lineEnd
    ? `Line ${node.lineStart}`
    : `Lines ${node.lineStart}–${node.lineEnd}`
  elements.selectedSource.textContent = node.raw
  elements.annotationInput.value = node.feedback
  renderReadonlyFeedback(node)
  elements.annotationState.textContent = hasAnnotation(node)
    ? 'Annotated'
    : 'Not annotated'
  renderAttachmentList(node)
  renderReviewEditability()
  updateAnnotationCount()
}

function updateAnnotationCount() {
  const count = annotatedNodes().length
  elements.annotationCount.textContent = `${count} annotation${count === 1 ? '' : 's'}`
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
  session.sourceCollapsed = state.sourceCollapsed
  session.attachmentPreviewUrls = state.attachmentPreviewUrls
}

function reviewStatusLabel(status) {
  if (status === 'handoff-in-progress') return 'Handing off'
  return status === 'pending-agent' ? 'With agent' : 'Editing'
}

function renderDocumentTabs() {
  const sessions = reviewSessions.list()
  elements.documentTabs.hidden = sessions.length === 0
  elements.documentTabs.replaceChildren()

  for (const session of sessions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = [
      'document-tab',
      session.reviewId === state.reviewId ? 'is-active' : ''
    ].filter(Boolean).join(' ')
    button.role = 'tab'
    button.ariaSelected = String(session.reviewId === state.reviewId)
    button.tabIndex = session.reviewId === state.reviewId ? 0 : -1
    button.title = `${session.documentName} · ${session.reviewId}`

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
    elements.documentTabs.append(button)
  }
}

function activateReview(reviewId) {
  state.finishAttachmentLabelEdit?.(true)
  if (reviewMutations.has(state.reviewId)) {
    reviewMutations.wait(state.reviewId).then(() => activateReview(reviewId))
    return
  }

  captureActiveSession()
  const session = reviewSessions.activate(reviewId)
  state.reviewId = session.reviewId
  state.documentName = session.documentName
  state.documentPath = session.documentPath
  state.tree = session.tree
  state.selectedId = session.selectedId
  state.sourceCollapsed = session.sourceCollapsed
  state.attachmentPreviewUrls = session.attachmentPreviewUrls
  state.hoveredId = null
  bridge.activateReview(reviewId)

  elements.name.textContent = session.documentName
  elements.name.title = session.documentPath || session.documentName
  elements.checksum.textContent = session.checksum.slice(0, 20) + '…'
  elements.checksum.title = session.checksum
  elements.sourceToggle.setAttribute(
    'aria-expanded',
    String(!state.sourceCollapsed)
  )
  elements.sourceToggleIcon.textContent = state.sourceCollapsed ? '▶' : '▼'
  elements.selectedSource.hidden = state.sourceCollapsed
  closeImagePreview()
  renderTree()

  const selected = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (selected) renderAnnotation(selected)
  renderDocumentTabs()
}

function addManagedReview(documentData, activate = true) {
  const session = reviewSessions.add(documentData)
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

  elements.name.textContent = state.documentName
  elements.name.title = state.documentPath || state.documentName
  elements.checksum.textContent = checksum.slice(0, 20) + '…'
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
    renderTreePreservingScroll()
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

elements.openButton.addEventListener('click', async () => {
  const documentData = await bridge.openMarkdown()
  if (documentData) {
    await loadDocument(documentData)
    elements.previewPane.focus()
  }
})

elements.copyTreeButton.addEventListener('click', () => {
  bridge.copyText(MarkoverTree.serializeTree(state.tree))
  showToast('Feedback JSON copied')
})

elements.doneReviewButton.addEventListener('click', () => {
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
  elements.selectedSource.hidden = state.sourceCollapsed
})

elements.imagePreviewClose.addEventListener('click', closeImagePreview)
elements.imagePreview.addEventListener('click', (event) => {
  if (event.target === elements.imagePreview) closeImagePreview()
})

elements.tree.addEventListener('scroll', updatePinnedSelection)
window.addEventListener('resize', updatePinnedSelection)

document.addEventListener('keydown', (event) => {
  if (event.key === 'Control') {
    document.body.classList.add('is-control-pressed')
  }

  if (event.key === 'Escape' && !elements.imagePreview.hidden) {
    closeImagePreview()
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

  if (event.key === 'Tab') {
    event.preventDefault()
    if (document.activeElement === elements.annotationInput || elements.annotationPane.contains(document.activeElement)) {
      elements.annotationPane.classList.remove('focus-within')
      elements.previewPane.focus()
    } else {
      focusAnnotationPane()
    }
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
  if (direction === 'right' && current?.children.length && current.collapsed) {
    current.collapsed = false
    autosaveReview()
  }
  const nextId = MarkoverNavigation.move(state.tree.root, state.selectedId, direction)
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
    }
  })
  bridge.onReviewSnapshotRequested(async (reviewId) => {
    const paneHadFocus = (
      reviewId === state.reviewId &&
      elements.annotationPane.contains(document.activeElement)
    )
    if (reviewId === state.reviewId) {
      state.finishAttachmentLabelEdit?.(true)
    }
    const session = reviewSessions.get(reviewId)
    if (!session) throw new Error(`Cannot snapshot missing review ${reviewId}.`)
    reviewSessions.updateStatus(reviewId, 'handoff-in-progress')
    renderDocumentTabs()
    if (reviewId === state.reviewId) {
      const selected = MarkoverTree.findNode(state.tree.root, state.selectedId)
      if (selected) renderAnnotation(selected)
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
      await loadDocument({
        name: 'sample.md',
        source: SAMPLE_MARKDOWN
      })
    }
  }
  elements.previewPane.focus()
}

initialize()

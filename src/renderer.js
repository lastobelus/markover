const SAMPLE_MARKDOWN = `# Prototype review

## Interaction model

- Keyboard-first block navigation
  - Left selects the parent
  - Right selects the first child or next available sibling
- Tab moves between the document and annotation panes

## Data model

1. Parse the Markdown into a deterministic tree
2. Attach annotations directly to block nodes
3. Copy concise feedback or the full annotated tree

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
  annotationInput: document.querySelector('#annotation-input'),
  annotationPane: document.querySelector('#annotation-pane'),
  annotationState: document.querySelector('#annotation-state'),
  checksum: document.querySelector('#document-checksum'),
  copyFeedbackButton: document.querySelector('#copy-feedback-button'),
  copyTreeButton: document.querySelector('#copy-tree-button'),
  name: document.querySelector('#document-name'),
  openButton: document.querySelector('#open-button'),
  parseStatus: document.querySelector('#parse-status'),
  previewPane: document.querySelector('#preview-pane'),
  selectedLocation: document.querySelector('#selected-location'),
  selectedSource: document.querySelector('#selected-source'),
  selectedTitle: document.querySelector('#selected-title'),
  toast: document.querySelector('#toast'),
  tree: document.querySelector('#tree')
}

const state = {
  documentName: 'sample.md',
  documentPath: null,
  selectedId: null,
  tree: null
}

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
  }
}

function nodeKindLabel(node) {
  if (node.type === 'heading') return `H${node.level}`
  if (node.type === 'ordered-item') return '1.'
  if (node.type === 'unordered-item') return '•'
  return '</>'
}

function nodeTitle(node) {
  if (node.type === 'heading') return node.text
  if (node.type === 'code') return node.language ? `${node.language} code block` : 'Code block'
  return node.text
}

function countNodes() {
  let count = 0
  MarkoverTree.visitNodes(state.tree.root, () => {
    count += 1
  })
  return count
}

function annotatedNodes() {
  const annotated = []
  MarkoverTree.visitNodes(state.tree.root, (node, _parent, ancestors) => {
    if (node.annotation.trim()) annotated.push({ node, ancestors })
  })
  return annotated
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

function renderNode(node, depth) {
  const wrapper = document.createElement('div')
  wrapper.className = 'block'

  const row = document.createElement('div')
  row.className = `block-row${node.id === state.selectedId ? ' is-selected' : ''}`
  row.dataset.nodeId = node.id
  row.style.marginLeft = `${depth * 18}px`

  if (node.children.length) {
    const disclosure = document.createElement('button')
    disclosure.className = 'disclosure'
    disclosure.textContent = node.collapsed ? '▶' : '▼'
    disclosure.title = node.collapsed ? 'Expand block' : 'Collapse block'
    disclosure.addEventListener('click', (event) => {
      event.stopPropagation()
      node.collapsed = !node.collapsed
      renderTree()
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
    content.textContent = node.text
  } else if (node.type === 'code') {
    content.className = 'block-content code'
    const code = document.createElement('code')
    code.textContent = node.text || '(empty code block)'
    content.append(code)
  } else {
    content.className = 'block-content list-item'
    content.textContent = `${node.marker} ${node.text}`
  }
  row.append(content)

  if (node.annotation.trim()) {
    const dot = document.createElement('span')
    dot.className = 'annotation-dot'
    dot.title = 'Annotated'
    row.append(dot)
  } else {
    row.append(document.createElement('span'))
  }

  row.addEventListener('click', () => selectNode(node.id, true))
  row.addEventListener('dblclick', () => {
    if (node.children.length) {
      node.collapsed = !node.collapsed
      renderTree()
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
}

function renderAnnotation(node) {
  elements.selectedTitle.textContent = nodeTitle(node)
  elements.selectedLocation.textContent = node.lineStart === node.lineEnd
    ? `Line ${node.lineStart}`
    : `Lines ${node.lineStart}–${node.lineEnd}`
  elements.selectedSource.textContent = node.raw
  elements.annotationInput.value = node.annotation
  elements.annotationState.textContent = node.annotation.trim() ? 'Annotated' : 'Not annotated'
  updateAnnotationCount()
}

function updateAnnotationCount() {
  const count = annotatedNodes().length
  elements.annotationCount.textContent = `${count} annotation${count === 1 ? '' : 's'}`
}

function describePath(ancestors, node) {
  return [...ancestors, node]
    .filter((item) => item.type === 'heading' || item.id === node.id)
    .map(nodeTitle)
    .join(' › ')
}

function feedbackMarkdown() {
  const entries = annotatedNodes()
  const heading = [
    `# Feedback for ${state.documentName}`,
    '',
    `Document checksum: \`${state.tree.checksum}\``,
    ''
  ]

  if (!entries.length) {
    return [...heading, '_No annotations._', ''].join('\n')
  }

  const sections = entries.flatMap(({ node, ancestors }) => [
    `## ${describePath(ancestors, node)}`,
    '',
    `Block: \`${node.id}\` · lines ${node.lineStart}–${node.lineEnd}`,
    '',
    '````markdown',
    node.raw,
    '````',
    '',
    node.annotation.trim(),
    ''
  ])

  return [...heading, ...sections].join('\n')
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

async function loadDocument(documentData) {
  const checksum = documentData.checksum || await bridge.checksum(documentData.source)
  state.documentName = documentData.name
  state.documentPath = documentData.path || null
  state.tree = MarkoverTree.parseMarkdown(documentData.source, checksum)
  state.selectedId = state.tree.root.children[0]?.id || null

  elements.name.textContent = state.documentName
  elements.name.title = state.documentPath || state.documentName
  elements.checksum.textContent = checksum.slice(0, 20) + '…'
  elements.checksum.title = checksum
  renderTree()

  if (state.selectedId) {
    renderAnnotation(MarkoverTree.findNode(state.tree.root, state.selectedId))
  }
}

elements.annotationInput.addEventListener('input', () => {
  const node = MarkoverTree.findNode(state.tree.root, state.selectedId)
  if (!node) return
  node.annotation = elements.annotationInput.value
  elements.annotationState.textContent = node.annotation.trim() ? 'Annotated' : 'Not annotated'
  renderTree()
  updateAnnotationCount()
  elements.annotationInput.focus()
})

elements.openButton.addEventListener('click', async () => {
  const documentData = await bridge.openMarkdown()
  if (documentData) {
    await loadDocument(documentData)
    elements.previewPane.focus()
  }
})

elements.copyFeedbackButton.addEventListener('click', () => {
  bridge.copyText(feedbackMarkdown())
  showToast('Feedback copied')
})

elements.copyTreeButton.addEventListener('click', () => {
  bridge.copyText(MarkoverTree.serializeTree(state.tree))
  showToast('Annotated tree copied')
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault()
    if (document.activeElement === elements.annotationInput || elements.annotationPane.contains(document.activeElement)) {
      elements.annotationPane.classList.remove('focus-within')
      elements.previewPane.focus()
    } else {
      elements.annotationPane.classList.add('focus-within')
      elements.annotationInput.focus()
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
  }
  const nextId = MarkoverNavigation.move(state.tree.root, state.selectedId, direction)
  selectNode(nextId, true)
})

elements.previewPane.addEventListener('focus', () => {
  elements.annotationPane.classList.remove('focus-within')
})

loadDocument({
  name: 'sample.md',
  source: SAMPLE_MARKDOWN
}).then(() => elements.previewPane.focus())

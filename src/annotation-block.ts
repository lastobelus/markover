(function exposeAnnotationBlock(globalScope: typeof globalThis) {
  function persistedText(value: unknown): string {
    if (!value) return ''
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map(persistedText).join(',')
    if (typeof value === 'object') return Object.prototype.toString.call(value)
    if (
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'boolean' ||
      typeof value === 'symbol'
    ) return String(value)
    return ''
  }

  function model(
    node: AnnotationModelNode,
    context: AnnotationContext = {}
  ): AnnotationViewModel {
    const editedSource = typeof node.sourceEdit?.current === 'string'
      ? node.sourceEdit.current
      : ''
    const sourceLine = persistedText(
      editedSource || node.text || node.raw || context.descriptor || ''
    )
      .trim()
      .split(/\r?\n/, 1)[0] ?? ''
    const sourceTitle = sourceLine.replace(
      /^ {0,3}(?:#{1,6}\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/,
      ''
    )
    return {
      attachments: (node.attachments || []).map((attachment) => ({
        attachment,
        label: persistedText(attachment.label).trim() || attachment.id
      })),
      feedback: persistedText(node.feedback),
      lineLabel: context.lineLabel || (
        node.lineStart === node.lineEnd
          ? `Line ${String(node.lineStart)}`
          : `Lines ${String(node.lineStart)}–${String(node.lineEnd)}`
      ),
      sourceTitle
    }
  }

  function popoverPosition(
    anchor: { left: number; right: number; top: number },
    popover: { width: number; height: number },
    viewport: { width: number; height: number },
    margin = 10
  ): { x: number; y: number } {
    const right = anchor.right + margin
    const left = anchor.left - popover.width - margin
    const x = right + popover.width <= viewport.width - margin
      ? right
      : Math.max(margin, left)
    const y = Math.min(
      Math.max(margin, anchor.top - 10),
      Math.max(margin, viewport.height - popover.height - margin)
    )
    return { x, y }
  }

  function create<TNode extends RenderedAnnotationNode>(
    document: Document,
    options: AnnotationCreateOptions<TNode>
  ): HTMLElement {
    const view = model(options.node, options.context)
    const article = document.createElement('article')
    article.className = `rendered-annotation rendered-annotation--${options.mode || 'list'}`
    article.dataset.nodeId = options.node.id

    const header = document.createElement('header')
    const identity = document.createElement('div')
    identity.className = 'rendered-annotation-identity'

    const descriptor = document.createElement('strong')
    if (options.renderTitle) descriptor.innerHTML = options.renderTitle(view.sourceTitle)
    else descriptor.textContent = view.sourceTitle
    identity.append(descriptor)

    const location = document.createElement('span')
    location.textContent = view.lineLabel
    identity.append(location)
    header.append(identity)

    article.append(header)

    const body = document.createElement('div')
    body.className = 'rendered-annotation-body'
    const content = document.createElement('div')
    content.className = 'rendered-annotation-content'
    if (view.feedback.trim()) {
      content.innerHTML = options.renderMarkdown(view.feedback)
    } else {
      content.classList.add('is-empty')
      content.textContent = 'Image-only annotation.'
    }
    for (const image of content.querySelectorAll<HTMLElement>(
      '[data-image-source]'
    )) {
      const onInlineImage = options.onInlineImage
      if (onInlineImage) {
        image.addEventListener('click', (event) => {
          event.stopPropagation()
          onInlineImage(
            image.dataset.imageSource || '',
            image.dataset.imageLabel || ''
          )
        })
      } else {
        const label = image.dataset.imageLabel || image.textContent
        const replacement = document.createElement('span')
        replacement.className = `${image.className} is-static`
        replacement.title = label
        replacement.textContent = image.textContent
        image.replaceWith(replacement)
      }
    }
    body.append(content)
    if ((options.mode || 'list') === 'list') {
      const overflow = document.createElement('div')
      overflow.className = 'rendered-annotation-overflow'
      overflow.hidden = true
      overflow.textContent = '…'
      body.append(overflow)
    }
    const onEdit = options.onEdit
    if (onEdit) {
      body.classList.add('has-edit')
      const edit = document.createElement('button')
      edit.className = 'rendered-annotation-edit'
      edit.type = 'button'
      edit.title = 'Edit annotation'
      edit.setAttribute('aria-label', `Edit annotation on ${view.lineLabel}`)
      edit.textContent = '✎'
      edit.addEventListener('click', (event) => {
        event.stopPropagation()
        onEdit(options.node)
      })
      body.append(edit)
    }
    article.append(body)

    if (view.attachments.length) {
      const attachments = document.createElement('div')
      attachments.className = 'rendered-annotation-attachments'
      for (const { attachment, label } of view.attachments) {
        const item = document.createElement(
          options.onAttachment ? 'button' : 'span'
        )
        item.className = 'rendered-annotation-attachment'
        item.title = label
        const onAttachment = options.onAttachment
        if (onAttachment) {
          item.setAttribute('type', 'button')
          item.addEventListener('click', (event) => {
            event.stopPropagation()
            onAttachment(attachment)
          })
        }

        const previewUrl = options.attachmentUrl?.(attachment)
        if (previewUrl) {
          const image = document.createElement('img')
          image.src = previewUrl
          image.alt = label
          item.append(image)
        } else {
          const placeholder = document.createElement('i')
          placeholder.textContent = '▧'
          item.append(placeholder)
        }

        const caption = document.createElement('span')
        caption.textContent = label
        item.append(caption)
        attachments.append(item)
      }
      article.append(attachments)
    }

    const onSelect = options.onSelect
    if (onSelect) {
      article.classList.add('is-selectable')
      article.addEventListener('click', () => {
        onSelect(options.node)
      })
    }
    return article
  }

  function updateTruncation(root: ParentNode): void {
    for (const article of root.querySelectorAll<HTMLElement>(
      '.rendered-annotation--list'
    )) {
      const content = article.querySelector<HTMLElement>(
        '.rendered-annotation-content'
      )
      const overflow = article.querySelector<HTMLElement>(
        '.rendered-annotation-overflow'
      )
      if (!content || !overflow) continue
      overflow.hidden = content.scrollHeight <= content.clientHeight + 1
    }
  }

  function createList<TNode extends RenderedAnnotationNode>(
    document: Document,
    options: AnnotationListOptions<TNode>
  ): HTMLElement {
    const list = document.createElement('div')
    list.className = 'rendered-annotation-list'
    for (const node of options.nodes) {
      const block = create(document, {
        node,
        context: options.context(node),
        mode: 'list',
        attachmentUrl: options.attachmentUrl,
        onAttachment: options.onAttachment,
        onInlineImage: options.onInlineImage,
        onSelect: options.onSelect,
        onEdit: options.onEdit,
        renderTitle: options.renderTitle,
        renderMarkdown: options.renderMarkdown
      })
      block.classList.toggle('is-selected', node.id === options.selectedId)
      list.append(block)
    }
    return list
  }

  function bindSneakPeek<TNode extends AnnotationBlockNode>(
    marker: HTMLElement,
    node: TNode,
    handlers: {
      show: (node: TNode, marker: HTMLElement) => void
      hide: EventListener
    }
  ): () => void {
    const show = (): void => {
      handlers.show(node, marker)
    }
    marker.addEventListener('mouseenter', show)
    marker.addEventListener('mouseleave', handlers.hide)
    return () => {
      marker.removeEventListener('mouseenter', show)
      marker.removeEventListener('mouseleave', handlers.hide)
    }
  }

  function bindDismiss(
    target: EventTarget,
    eventName: string,
    hide: EventListener
  ): () => void {
    target.addEventListener(eventName, hide)
    return () => {
      target.removeEventListener(eventName, hide)
    }
  }

  function bindListKeyboard(
    target: HTMLElement,
    handlers: { edit: () => void; move: (offset: -1 | 1) => void }
  ): () => void {
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') {
        event.preventDefault()
        handlers.edit()
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        handlers.move(event.key === 'ArrowUp' ? -1 : 1)
      }
    }
    target.addEventListener('keydown', keydown)
    return () => {
      target.removeEventListener('keydown', keydown)
    }
  }

  const api = {
    bindDismiss,
    bindListKeyboard,
    bindSneakPeek,
    create,
    createList,
    model,
    popoverPosition,
    updateTruncation
  } satisfies MarkoverAnnotationBlockApi
  globalScope.MarkoverAnnotationBlock = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

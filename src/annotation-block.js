(function exposeAnnotationBlock(globalScope) {
  function model(node, context = {}) {
    return {
      attachmentLabels: (node.attachments || []).map((attachment) => (
        String(attachment.label || '').trim() || attachment.id
      )),
      descriptor: context.descriptor || '',
      excerpt: context.excerpt || node.text || '',
      feedback: String(node.feedback || ''),
      lineLabel: context.lineLabel || (
        node.lineStart === node.lineEnd
          ? `Line ${node.lineStart}`
          : `Lines ${node.lineStart}–${node.lineEnd}`
      )
    }
  }

  function popoverPosition(anchor, popover, viewport, margin = 10) {
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

  function create(document, options) {
    const view = model(options.node, options.context)
    const article = document.createElement('article')
    article.className = `rendered-annotation rendered-annotation--${options.mode || 'list'}`
    article.dataset.nodeId = options.node.id

    const header = document.createElement('header')
    const identity = document.createElement('div')
    identity.className = 'rendered-annotation-identity'

    const descriptor = document.createElement('strong')
    descriptor.textContent = view.descriptor
    identity.append(descriptor)

    const location = document.createElement('span')
    location.textContent = view.lineLabel
    identity.append(location)
    header.append(identity)

    if (options.onEdit) {
      const edit = document.createElement('button')
      edit.className = 'rendered-annotation-edit'
      edit.type = 'button'
      edit.title = 'Edit annotation'
      edit.setAttribute('aria-label', `Edit annotation on ${view.lineLabel}`)
      edit.textContent = '✎'
      edit.addEventListener('click', (event) => {
        event.stopPropagation()
        options.onEdit(options.node)
      })
      header.append(edit)
    }
    article.append(header)

    if (view.excerpt) {
      const excerpt = document.createElement('p')
      excerpt.className = 'rendered-annotation-excerpt'
      excerpt.textContent = view.excerpt.replace(/\s+/g, ' ').trim()
      article.append(excerpt)
    }

    const body = document.createElement('div')
    body.className = 'rendered-annotation-body'
    if (view.feedback.trim()) {
      body.innerHTML = options.renderMarkdown(view.feedback)
    } else {
      body.classList.add('is-empty')
      body.textContent = 'Image-only annotation.'
    }
    article.append(body)

    if (view.attachmentLabels.length) {
      const attachments = document.createElement('div')
      attachments.className = 'rendered-annotation-attachments'
      for (const label of view.attachmentLabels) {
        const item = document.createElement('span')
        item.textContent = `▧ ${label}`
        attachments.append(item)
      }
      article.append(attachments)
    }

    if (options.onSelect) {
      article.classList.add('is-selectable')
      article.addEventListener('click', () => options.onSelect(options.node))
    }
    return article
  }

  function bindSneakPeek(marker, node, handlers) {
    const show = () => handlers.show(node, marker)
    marker.addEventListener('mouseenter', show)
    marker.addEventListener('mouseleave', handlers.hide)
    return () => {
      marker.removeEventListener('mouseenter', show)
      marker.removeEventListener('mouseleave', handlers.hide)
    }
  }

  function bindDismiss(target, eventName, hide) {
    target.addEventListener(eventName, hide)
    return () => target.removeEventListener(eventName, hide)
  }

  const api = { bindDismiss, bindSneakPeek, create, model, popoverPosition }
  globalScope.MarkoverAnnotationBlock = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

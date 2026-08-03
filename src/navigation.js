(function exposeNavigation(globalScope) {
  function findContext(root, id) {
    for (let index = 0; index < root.children.length; index += 1) {
      const node = root.children[index]
      if (node.id === id) return { node, parent: root, index }
      const nested = findContext(node, id)
      if (nested) return nested
    }
    return null
  }

  function move(root, currentId, direction) {
    const context = findContext(root, currentId)
    if (!context) return currentId

    if (direction === 'left') {
      return context.parent.id === root.id ? currentId : context.parent.id
    }

    if (direction === 'right' && context.node.children.length) {
      return context.node.children[0].id
    }

    if (direction === 'up') {
      if (context.index > 0) return context.parent.children[context.index - 1].id
      return context.parent.id === root.id ? currentId : context.parent.id
    }

    if (direction === 'down' || direction === 'right') {
      let cursor = context
      while (cursor) {
        if (cursor.index + 1 < cursor.parent.children.length) {
          return cursor.parent.children[cursor.index + 1].id
        }
        if (cursor.parent.id === root.id) return currentId
        cursor = findContext(root, cursor.parent.id)
      }
    }

    return currentId
  }

  function nextPane(current, direction, documentsVisible) {
    const panes = documentsVisible
      ? ['documents', 'preview', 'annotation']
      : ['preview', 'annotation']
    const currentIndex = panes.indexOf(current)
    const start = currentIndex === -1 ? 0 : currentIndex
    return panes[(start + direction + panes.length) % panes.length]
  }

  function isOutsideViewport(viewport, target) {
    return target.bottom <= viewport.top || target.top >= viewport.bottom
  }

  const api = { findContext, isOutsideViewport, move, nextPane }
  globalScope.MarkoverNavigation = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

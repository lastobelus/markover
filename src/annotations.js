(function exposeAnnotations(globalScope) {
  function hasAnnotation(node) {
    return Boolean(
      String(node?.feedback || '').trim() ||
      (Array.isArray(node?.attachments) && node.attachments.length)
    )
  }

  function documentNodes(root) {
    const nodes = []
    function visit(node) {
      for (const child of node.children || []) {
        nodes.push(child)
        visit(child)
      }
    }
    visit(root)
    return nodes
  }

  function annotatedNodes(root) {
    return documentNodes(root).filter(hasAnnotation)
  }

  function annotatedProjection(root) {
    function project(node) {
      const children = (node.children || [])
        .map(project)
        .filter(Boolean)
      if (!hasAnnotation(node) && !children.length) return null
      return { node, children, contextual: !hasAnnotation(node) }
    }

    return (root.children || []).map(project).filter(Boolean)
  }

  function navigationRoot(root) {
    function navigationNode(entry) {
      return {
        id: entry.node.id,
        children: entry.children.map(navigationNode)
      }
    }
    return {
      id: root.id,
      children: annotatedProjection(root).map(navigationNode)
    }
  }

  function nearestAnnotatedId(root, currentId) {
    const nodes = documentNodes(root)
    const annotated = nodes.filter(hasAnnotation)
    if (!annotated.length) return null
    if (annotated.some((node) => node.id === currentId)) return currentId

    const currentIndex = nodes.findIndex((node) => node.id === currentId)
    if (currentIndex === -1) return annotated[0].id
    return annotated.reduce((nearest, node) => {
      const index = nodes.indexOf(node)
      const distance = Math.abs(index - currentIndex)
      if (!nearest || distance < nearest.distance) return { node, index, distance }
      if (distance === nearest.distance && index > currentIndex) {
        return { node, index, distance }
      }
      return nearest
    }, null).node.id
  }

  function annotationPosition(root, id) {
    const nodes = annotatedNodes(root)
    return {
      index: nodes.findIndex((node) => node.id === id) + 1,
      total: nodes.length
    }
  }

  function revealAnnotation(root, id) {
    let changed = false
    function reveal(node) {
      if (node.id === id) return true
      for (const child of node.children || []) {
        if (!reveal(child)) continue
        if (node !== root && node.collapsed) {
          node.collapsed = false
          changed = true
        }
        return true
      }
      return false
    }
    reveal(root)
    return changed
  }

  function normalizeFilter(root, selectedId, enabled) {
    if (!enabled) return { enabled: false, selectedId }
    const projection = annotatedProjection(root)
    if (!projection.length) return { enabled: false, selectedId }

    function contains(entries) {
      return entries.some((entry) => (
        entry.node.id === selectedId || contains(entry.children)
      ))
    }

    return {
      enabled: true,
      selectedId: contains(projection)
        ? selectedId
        : nearestAnnotatedId(root, selectedId)
    }
  }

  const api = {
    annotatedNodes,
    annotatedProjection,
    annotationPosition,
    hasAnnotation,
    navigationRoot,
    nearestAnnotatedId,
    normalizeFilter,
    revealAnnotation
  }
  globalScope.MarkoverAnnotations = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

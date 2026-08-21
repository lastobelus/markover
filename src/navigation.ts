  function findContext(
    root: NavigationNode,
    id: string | null
  ): NavigationContext | null {
    for (let index = 0; index < root.children.length; index += 1) {
      const node = root.children[index]
      if (!node) continue
      if (node.id === id) return { node, parent: root, index }
      const nested = findContext(node, id)
      if (nested) return nested
    }
    return null
  }

  function move(
    root: NavigationNode,
    currentId: string | null,
    direction: NavigationDirection
  ): string | null {
    const context = findContext(root, currentId)
    if (!context) return currentId

    if (direction === 'left') {
      return context.parent.id === root.id ? currentId : context.parent.id
    }

    if (direction === 'right' && context.node.children.length) {
      return context.node.children[0]?.id ?? currentId
    }

    if (direction === 'up') {
      if (context.index > 0) {
        return context.parent.children[context.index - 1]?.id ?? currentId
      }
      return context.parent.id === root.id ? currentId : context.parent.id
    }

    let cursor: NavigationContext | null = context
    while (cursor) {
      if (cursor.index + 1 < cursor.parent.children.length) {
        return cursor.parent.children[cursor.index + 1]?.id ?? currentId
      }
      if (cursor.parent.id === root.id) return currentId
      cursor = findContext(root, cursor.parent.id)
    }

    return currentId
  }

  function nextPane(
    current: PaneLayoutPane,
    direction: -1 | 1,
    leftPaneVisible: boolean
  ): PaneLayoutPane {
    const panes: PaneLayoutPane[] = leftPaneVisible
      ? ['left', 'center', 'right']
      : ['center', 'right']
    const currentIndex = panes.indexOf(current)
    const start = currentIndex === -1 ? 0 : currentIndex
    const pane = panes[(start + direction + panes.length) % panes.length]
    if (!pane) throw new Error('Pane layout navigation is empty.')
    return pane
  }

  function isOutsideViewport(
    viewport: VerticalBounds,
    target: VerticalBounds
  ): boolean {
    return target.bottom <= viewport.top || target.top >= viewport.bottom
  }

  const api = { findContext, isOutsideViewport, move, nextPane } satisfies
    MarkoverNavigationApi

export { findContext, isOutsideViewport, move, nextPane }
export default api

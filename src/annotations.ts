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

  function hasAnnotation(node?: AnnotationTreeNode | null): boolean {
    return Boolean(persistedText(node?.feedback).trim()) || Boolean(
      Array.isArray(node?.attachments) && node.attachments.length
    )
  }

  function documentNodes<T extends AnnotationTreeNode>(root: T): T[] {
    const nodes: T[] = []
    function visit(node: T): void {
      for (const child of node.children) {
        const typedChild = child as T
        nodes.push(typedChild)
        visit(typedChild)
      }
    }
    visit(root)
    return nodes
  }

  function annotatedNodes<T extends AnnotationTreeNode>(root: T): T[] {
    return documentNodes(root).filter(hasAnnotation)
  }

  function annotatedProjection<T extends AnnotationTreeNode>(
    root: T
  ): AnnotationProjection<T>[] {
    function project(node: T): AnnotationProjection<T> | null {
      const children = node.children
        .map((child) => project(child as T))
        .filter((entry): entry is AnnotationProjection<T> => entry !== null)
      if (!hasAnnotation(node) && !children.length) return null
      return { node, children, contextual: !hasAnnotation(node) }
    }

    return root.children
      .map((child) => project(child as T))
      .filter((entry): entry is AnnotationProjection<T> => entry !== null)
  }

  function navigationRoot(root: AnnotationTreeNode): NavigationNode {
    function navigationNode(entry: AnnotationProjection): NavigationNode {
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

  function nearestAnnotatedId(
    root: AnnotationTreeNode,
    currentId: string | null
  ): string | null {
    const nodes = documentNodes(root)
    const annotated = nodes.filter(hasAnnotation)
    if (!annotated.length) return null
    if (annotated.some((node) => node.id === currentId)) return currentId

    const currentIndex = nodes.findIndex((node) => node.id === currentId)
    if (currentIndex === -1) return annotated[0]?.id ?? null
    let nearest: {
      node: AnnotationTreeNode
      index: number
      distance: number
    } | null = null
    for (const node of annotated) {
      const index = nodes.indexOf(node)
      const distance = Math.abs(index - currentIndex)
      if (!nearest || distance < nearest.distance) {
        nearest = { node, index, distance }
        continue
      }
      if (distance === nearest.distance && index > currentIndex) {
        nearest = { node, index, distance }
      }
    }
    return nearest?.node.id ?? null
  }

  function annotationPosition(
    root: AnnotationTreeNode,
    id: string | null
  ): { index: number; total: number } {
    const nodes = annotatedNodes(root)
    return {
      index: nodes.findIndex((node) => node.id === id) + 1,
      total: nodes.length
    }
  }

  function revealAnnotation(root: AnnotationTreeNode, id: string): boolean {
    let changed = false
    function reveal(node: AnnotationTreeNode): boolean {
      if (node.id === id) return true
      for (const child of node.children) {
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

  function normalizeFilter(
    root: AnnotationTreeNode,
    selectedId: string | null,
    enabled: boolean
  ): { enabled: boolean; selectedId: string | null } {
    if (!enabled) return { enabled: false, selectedId }
    const projection = annotatedProjection(root)
    if (!projection.length) return { enabled: false, selectedId }

    function contains(entries: AnnotationProjection[]): boolean {
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
  } satisfies MarkoverAnnotationsApi

export {
  annotatedNodes,
  annotatedProjection,
  annotationPosition,
  hasAnnotation,
  navigationRoot,
  nearestAnnotatedId,
  normalizeFilter,
  revealAnnotation
}
export default api

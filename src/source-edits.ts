(function exposeSourceEdits(globalScope: typeof globalThis) {
  function savedSource(node: SourceEditableNode): string {
    return node.sourceEdit?.current || node.raw
  }

  function begin(
    state: SourceEditorState,
    node: SourceEditableNode
  ): string {
    if (!state.sourceDrafts.has(node.id)) {
      state.sourceDrafts.set(node.id, savedSource(node))
    }
    state.sourceEditingId = node.id
    return state.sourceDrafts.get(node.id) as string
  }

  function update(
    state: SourceEditorState,
    node: SourceEditableNode,
    value: string
  ): boolean {
    if (state.sourceEditingId !== node.id) return false
    state.sourceDrafts.set(node.id, value)
    return true
  }

  function commit(
    state: SourceEditorState,
    node: SourceEditableNode
  ): SourceEditCommitResult {
    if (state.sourceEditingId !== node.id) {
      return { ok: false, changed: false, reason: 'not-editing' }
    }

    const current = state.sourceDrafts.get(node.id)
    if (typeof current !== 'string' || !current.trim()) {
      return { ok: false, changed: false, reason: 'empty' }
    }

    const changed = current !== savedSource(node)
    if (current === node.raw) delete node.sourceEdit
    else node.sourceEdit = { original: node.raw, current }
    state.sourceDrafts.delete(node.id)
    state.sourceEditingId = null
    return { ok: true, changed, reason: null }
  }

  function cancel(state: SourceEditorState, node: SourceEditableNode): void {
    state.sourceDrafts.delete(node.id)
    if (state.sourceEditingId === node.id) state.sourceEditingId = null
  }

  const api = { begin, cancel, commit, savedSource, update } satisfies
    MarkoverSourceEditsApi
  globalScope.MarkoverSourceEdits = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

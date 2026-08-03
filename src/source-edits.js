(function exposeSourceEdits(globalScope) {
  function savedSource(node) {
    return node.sourceEdit?.current || node.raw
  }

  function begin(state, node) {
    if (!state.sourceDrafts.has(node.id)) {
      state.sourceDrafts.set(node.id, savedSource(node))
    }
    state.sourceEditingId = node.id
    return state.sourceDrafts.get(node.id)
  }

  function update(state, node, value) {
    if (state.sourceEditingId !== node.id) return false
    state.sourceDrafts.set(node.id, value)
    return true
  }

  function commit(state, node) {
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

  function cancel(state, node) {
    state.sourceDrafts.delete(node.id)
    if (state.sourceEditingId === node.id) state.sourceEditingId = null
  }

  const api = { begin, cancel, commit, savedSource, update }
  globalScope.MarkoverSourceEdits = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

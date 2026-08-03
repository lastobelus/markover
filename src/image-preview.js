(function exposeImagePreview(globalScope) {
  function fileUrl(filePath) {
    if (!filePath?.startsWith('/')) return null
    return `file://${filePath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')}`
  }

  function labelFor(image) {
    return image?.label || image?.id || 'Image'
  }

  function sourceLabel(source, alt) {
    if (alt) return alt
    const path = source.split(/[?#]/, 1)[0]
    const basename = path.split('/').filter(Boolean).at(-1)
    return basename || 'Image'
  }

  function sourceUrl(source, documentPath) {
    if (!source) return null
    try {
      const absolute = new URL(source)
      if (['file:', 'http:', 'https:', 'data:'].includes(absolute.protocol)) {
        return absolute.href
      }
      return null
    } catch {
      // Continue by resolving the source as a document-relative path.
    }

    if (source.startsWith('/')) return fileUrl(source)
    const documentUrl = fileUrl(documentPath)
    if (!documentUrl) return null
    return new URL(source, documentUrl).href
  }

  const api = { fileUrl, labelFor, sourceLabel, sourceUrl }
  globalScope.MarkoverImagePreview = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

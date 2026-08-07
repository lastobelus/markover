  function fileUrl(filePath?: string | null): string | null {
    if (!filePath?.startsWith('/')) return null
    return `file://${filePath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')}`
  }

  function labelFor(
    image?: { id?: string; label?: string } | null
  ): string {
    return image?.label || image?.id || 'Image'
  }

  function sourceLabel(source: string, alt: string): string {
    if (alt) return alt
    const sourcePath = source.split(/[?#]/, 1)[0] ?? ''
    const basename = sourcePath.split('/').filter(Boolean).at(-1)
    return basename || 'Image'
  }

  function sourceUrl(
    source: string,
    documentPath?: string | null
  ): string | null {
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

  const api = { fileUrl, labelFor, sourceLabel, sourceUrl } satisfies
    MarkoverImagePreviewApi

export { fileUrl, labelFor, sourceLabel, sourceUrl }
export default api

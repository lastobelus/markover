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

  function sourceUrl(source: string): string | null {
    if (!source) return null
    try {
      const absolute = new URL(source)
      if (absolute.protocol === 'data:') {
        return absolute.href
      }
      return null
    } catch {
      // Relative and malformed sources remain inert.
    }

    return null
  }

  const api = { labelFor, sourceLabel, sourceUrl } satisfies
    MarkoverImagePreviewApi

export { labelFor, sourceLabel, sourceUrl }
export default api

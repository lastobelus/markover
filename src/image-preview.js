(function exposeImagePreview(globalScope) {
  function labelFor(image) {
    return image?.label || image?.id || 'Image'
  }

  const api = { labelFor }
  globalScope.MarkoverImagePreview = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

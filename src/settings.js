(function exposeSettings(globalScope) {
  const DEFAULT_SETTINGS = Object.freeze({
    palette: 'ember',
    appearance: 'system',
    darkColorization: 'high',
    treeDensity: 'comfortable',
    annotationTextSize: 'medium',
    showKeyboardHelp: true,
    openDocumentsSidebar: true,
    defaultTreeView: 'all',
    confirmAttachmentRemoval: true
  })

  const OPTIONS = Object.freeze({
    palette: ['ember', 'ocean', 'olive'],
    appearance: ['system', 'light', 'dark'],
    darkColorization: ['high', 'mid', 'low'],
    treeDensity: ['comfortable', 'compact'],
    annotationTextSize: ['small', 'medium', 'large'],
    defaultTreeView: ['all', 'annotated']
  })

  const WINDOW_BACKGROUNDS = Object.freeze({
    light: Object.freeze({
      ember: '#eee8e0',
      ocean: '#eee8e0',
      olive: '#dde1d2'
    }),
    dark: Object.freeze({
      high: Object.freeze({
        ember: '#1d1816',
        ocean: '#0d1b20',
        olive: '#181b10'
      }),
      mid: Object.freeze({
        ember: '#1b1918',
        ocean: '#171b1d',
        olive: '#1a1b17'
      }),
      low: Object.freeze({
        ember: '#171616',
        ocean: '#151718',
        olive: '#171815'
      })
    })
  })

  function normalizeSettings(value = {}) {
    const normalized = { ...DEFAULT_SETTINGS }
    for (const [key, choices] of Object.entries(OPTIONS)) {
      if (choices.includes(value[key])) normalized[key] = value[key]
    }
    for (const key of [
      'showKeyboardHelp',
      'openDocumentsSidebar',
      'confirmAttachmentRemoval'
    ]) {
      if (typeof value[key] === 'boolean') normalized[key] = value[key]
    }
    return normalized
  }

  function updateSettings(current, patch) {
    return normalizeSettings({ ...normalizeSettings(current), ...patch })
  }

  function windowBackground(settings, resolvedAppearance = 'light') {
    const normalized = normalizeSettings(settings)
    const appearance = resolvedAppearance === 'dark' ? 'dark' : 'light'
    return appearance === 'dark'
      ? WINDOW_BACKGROUNDS.dark[normalized.darkColorization][normalized.palette]
      : WINDOW_BACKGROUNDS.light[normalized.palette]
  }

  function applySettingsToView(settings, view) {
    const normalized = normalizeSettings(settings)
    const appearance = settings.resolvedAppearance || (
      normalized.appearance === 'dark' ? 'dark' : 'light'
    )
    view.root.dataset.palette = normalized.palette
    view.root.dataset.appearance = appearance
    view.root.dataset.colorization = normalized.darkColorization
    view.root.dataset.treeDensity = normalized.treeDensity
    view.root.dataset.annotationTextSize = normalized.annotationTextSize
    view.keyboardHelp.hidden = !normalized.showKeyboardHelp

    for (const [key, value] of Object.entries(normalized)) {
      const control = view.form.elements.namedItem(key)
      if (!control) continue
      if (control.type === 'checkbox') control.checked = value
      else control.value = value
    }
    return { appearance, preferences: normalized }
  }

  function sidebarPreferenceChanged(previous, next, initial = false) {
    return initial || previous.openDocumentsSidebar !== next.openDocumentsSidebar
  }

  function confirmScreenshotRemoval(settings, label, confirmRemoval) {
    return !normalizeSettings(settings).confirmAttachmentRemoval ||
      confirmRemoval(`Remove ${label}?`)
  }

  const api = {
    DEFAULT_SETTINGS,
    OPTIONS,
    WINDOW_BACKGROUNDS,
    normalizeSettings,
    updateSettings,
    windowBackground,
    applySettingsToView,
    sidebarPreferenceChanged,
    confirmScreenshotRemoval
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  globalScope.MarkoverSettings = api
})(typeof window === 'undefined' ? globalThis : window)

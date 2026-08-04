(function exposeSettings(globalScope: typeof globalThis) {
  const DEFAULT_SETTINGS: Readonly<MarkoverSettings> = Object.freeze({
    palette: 'ember',
    appearance: 'system',
    treeDensity: 'comfortable',
    annotationTextSize: 'medium',
    showKeyboardHelp: true,
    openDocumentsSidebar: true,
    defaultTreeView: 'all',
    confirmAttachmentRemoval: true,
    logRejectedApiRequests: false
  })

  const OPTIONS: MarkoverSettingsApi['OPTIONS'] = Object.freeze({
    palette: ['ember', 'ocean', 'olive'],
    appearance: ['system', 'light', 'dark'],
    treeDensity: ['comfortable', 'compact'],
    annotationTextSize: ['small', 'medium', 'large'],
    defaultTreeView: ['all', 'annotated']
  })

  const WINDOW_BACKGROUNDS: Readonly<{
    light: Readonly<Record<Palette, string>>
    dark: Readonly<
      Record<DarkColorization, Readonly<Record<Palette, string>>>
    >
  }> = Object.freeze({
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

  const DARK_COLORIZATION: Readonly<Record<Palette, DarkColorization>> =
    Object.freeze({
      ember: 'low',
      ocean: 'mid',
      olive: 'low'
    })

  function darkColorization(palette: unknown): DarkColorization {
    return palette === 'ember' || palette === 'ocean' || palette === 'olive'
      ? DARK_COLORIZATION[palette]
      : DARK_COLORIZATION.ember
  }

  function normalizeSettings(value: unknown = {}): MarkoverSettings {
    const input = value as Record<string, unknown>
    const normalized: MarkoverSettings = { ...DEFAULT_SETTINGS }
    type ChoiceKey = keyof MarkoverSettingsApi['OPTIONS']
    const assignChoice = <K extends ChoiceKey>(
      key: K,
      target: Pick<MarkoverSettings, K>
    ): void => {
      const candidate = input[key]
      const choices = OPTIONS[key] as readonly unknown[]
      if (choices.includes(candidate)) {
        target[key] = candidate as MarkoverSettings[K]
      }
    }
    for (const key of Object.keys(OPTIONS) as ChoiceKey[]) {
      assignChoice(key, normalized)
    }
    for (const key of [
      'showKeyboardHelp',
      'openDocumentsSidebar',
      'confirmAttachmentRemoval',
      'logRejectedApiRequests'
    ] as const) {
      if (typeof input[key] === 'boolean') normalized[key] = input[key]
    }
    return normalized
  }

  function updateSettings(current: unknown, patch: unknown): MarkoverSettings {
    return normalizeSettings({
      ...normalizeSettings(current),
      ...(patch as Record<string, unknown>)
    })
  }

  function windowBackground(
    settings: unknown,
    resolvedAppearance = 'light'
  ): string {
    const normalized = normalizeSettings(settings)
    const appearance = resolvedAppearance === 'dark' ? 'dark' : 'light'
    return appearance === 'dark'
      ? WINDOW_BACKGROUNDS.dark[darkColorization(normalized.palette)][normalized.palette]
      : WINDOW_BACKGROUNDS.light[normalized.palette]
  }

  function applySettingsToView(
    settings: unknown,
    view: SettingsView
  ): AppliedSettings {
    const normalized = normalizeSettings(settings)
    const input = settings as Record<string, unknown>
    const appearance = (input.resolvedAppearance || (
      normalized.appearance === 'dark' ? 'dark' : 'light'
    )) as ResolvedAppearance
    view.root.dataset.palette = normalized.palette
    view.root.dataset.appearance = appearance
    view.root.dataset.colorization = darkColorization(normalized.palette)
    view.root.dataset.treeDensity = normalized.treeDensity
    view.root.dataset.annotationTextSize = normalized.annotationTextSize
    view.keyboardHelp.hidden = !normalized.showKeyboardHelp

    for (const [key, value] of Object.entries(normalized)) {
      const control = view.form.elements.namedItem(key) as
        | HTMLInputElement
        | HTMLSelectElement
        | null
      if (!control) continue
      if (control.type === 'checkbox') {
        control.checked = value as boolean
      } else {
        control.value = value as string
      }
    }
    return { appearance, preferences: normalized }
  }

  function sidebarPreferenceChanged(
    previous: MarkoverSettings,
    next: MarkoverSettings,
    initial = false
  ): boolean {
    return initial || previous.openDocumentsSidebar !== next.openDocumentsSidebar
  }

  function confirmScreenshotRemoval(
    settings: unknown,
    label: string,
    confirmRemoval: (message: string) => boolean
  ): boolean {
    return !normalizeSettings(settings).confirmAttachmentRemoval ||
      confirmRemoval(`Remove ${label}?`)
  }

  const api = {
    DEFAULT_SETTINGS,
    DARK_COLORIZATION,
    OPTIONS,
    WINDOW_BACKGROUNDS,
    normalizeSettings,
    updateSettings,
    windowBackground,
    applySettingsToView,
    darkColorization,
    sidebarPreferenceChanged,
    confirmScreenshotRemoval
  } satisfies MarkoverSettingsApi
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  globalScope.MarkoverSettings = api
})(typeof window === 'undefined' ? globalThis : window)

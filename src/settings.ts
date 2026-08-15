import * as agentGuidance from './agent-guidance'

  const ZOOM_LEVELS: readonly ZoomPercent[] = Object.freeze([
    80,
    90,
    100,
    110,
    125,
    150
  ])

  const DEFAULT_SETTINGS: Readonly<MarkoverSettings> = Object.freeze({
    palette: 'ember',
    appearance: 'system',
    treeDensity: 'comfortable',
    annotationTextSize: 'medium',
    zoomPercent: 100,
    showKeyboardHelp: true,
    openDocumentsSidebar: true,
    defaultTreeView: 'all',
    confirmAttachmentRemoval: true,
    incomingReviewActivationPolicy: 'never',
    reviewLinkActivationPolicy: 'always',
    incomingReviewIdleMinutes: 5,
    discoverAgentThreadFromLocalSessions: true,
    logRejectedApiRequests: false,
    agentReviewMode: 'annotation-only',
    agentInterpretationPolicy: agentGuidance.DEFAULT_INTERPRETATION_POLICY,
    autosaveMaximumDelayMs: 2000
  })

  const OPTIONS: MarkoverSettingsApi['OPTIONS'] = Object.freeze({
    palette: ['ember', 'ocean', 'olive'],
    appearance: ['system', 'light', 'dark'],
    treeDensity: ['comfortable', 'compact'],
    annotationTextSize: ['small', 'medium', 'large'],
    zoomPercent: ZOOM_LEVELS,
    defaultTreeView: ['all', 'annotated'],
    incomingReviewActivationPolicy: ['never', 'always', 'warn', 'when-idle'],
    reviewLinkActivationPolicy: ['never', 'always', 'warn', 'when-idle'],
    agentReviewMode: [
      'annotation-only',
      'annotations-and-source-proposals'
    ]
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
      'discoverAgentThreadFromLocalSessions',
      'logRejectedApiRequests'
    ] as const) {
      if (typeof input[key] === 'boolean') normalized[key] = input[key]
    }
    if (typeof input.agentInterpretationPolicy === 'string') {
      normalized.agentInterpretationPolicy = input.agentInterpretationPolicy
    }
    const incomingReviewIdleMinutes = input.incomingReviewIdleMinutes
    if (
      typeof incomingReviewIdleMinutes === 'number' &&
      Number.isInteger(incomingReviewIdleMinutes) &&
      incomingReviewIdleMinutes >= 1 &&
      incomingReviewIdleMinutes <= 60
    ) {
      normalized.incomingReviewIdleMinutes = incomingReviewIdleMinutes
    }
    const autosaveMaximumDelayMs = input.autosaveMaximumDelayMs
    if (
      typeof autosaveMaximumDelayMs === 'number' &&
      Number.isInteger(autosaveMaximumDelayMs) &&
      autosaveMaximumDelayMs >= 100 &&
      autosaveMaximumDelayMs <= 60_000
    ) {
      normalized.autosaveMaximumDelayMs = autosaveMaximumDelayMs
    }
    return normalized
  }

  function updateSettings(current: unknown, patch: unknown): MarkoverSettings {
    return normalizeSettings({
      ...normalizeSettings(current),
      ...(patch as Record<string, unknown>)
    })
  }

  function adjacentZoomPercent(
    current: ZoomPercent,
    direction: -1 | 1
  ): ZoomPercent {
    const index = ZOOM_LEVELS.indexOf(current)
    if (index === -1) return DEFAULT_SETTINGS.zoomPercent
    const nextIndex = Math.max(
      0,
      Math.min(ZOOM_LEVELS.length - 1, index + direction)
    )
    return ZOOM_LEVELS[nextIndex] ?? DEFAULT_SETTINGS.zoomPercent
  }

  function minimumWindowSize(
    zoomPercent: ZoomPercent,
    maximum?: { width: number; height: number }
  ): { width: number; height: number } {
    const factor = zoomPercent / 100
    const scaled = {
      width: Math.ceil(760 * factor),
      height: Math.ceil(520 * factor)
    }
    if (!maximum) return scaled
    return {
      width: Math.min(scaled.width, maximum.width),
      height: Math.min(scaled.height, maximum.height)
    }
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
        | HTMLTextAreaElement
        | null
      if (!control) continue
      if ('checked' in control && control.type === 'checkbox') {
        control.checked = value as boolean
      } else {
        control.value = String(value)
      }
    }
    const idleMinutes = view.form.elements.namedItem(
      'incomingReviewIdleMinutes'
    )
    if (idleMinutes && 'disabled' in idleMinutes) {
      idleMinutes.disabled =
        normalized.incomingReviewActivationPolicy !== 'when-idle' &&
        normalized.reviewLinkActivationPolicy !== 'when-idle'
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
    ZOOM_LEVELS,
    DARK_COLORIZATION,
    OPTIONS,
    WINDOW_BACKGROUNDS,
    normalizeSettings,
    updateSettings,
    adjacentZoomPercent,
    windowBackground,
    applySettingsToView,
    darkColorization,
    minimumWindowSize,
    sidebarPreferenceChanged,
    confirmScreenshotRemoval
  } satisfies MarkoverSettingsApi

export {
  adjacentZoomPercent,
  applySettingsToView,
  confirmScreenshotRemoval,
  DARK_COLORIZATION,
  DEFAULT_SETTINGS,
  darkColorization,
  minimumWindowSize,
  normalizeSettings,
  OPTIONS,
  sidebarPreferenceChanged,
  updateSettings,
  WINDOW_BACKGROUNDS,
  windowBackground,
  ZOOM_LEVELS
}
export default api

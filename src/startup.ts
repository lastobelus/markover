const PHASE_LABELS: Readonly<Record<string, string>> = {
  'preparing-interface': 'Preparing interface',
  'loading-settings': 'Loading settings',
  'loading-brand': 'Loading brand',
  'restoring-reviews': 'Restoring reviews',
  'restoring-workspace': 'Restoring workspace',
  'publishing-service': 'Publishing service',
  ready: 'Ready'
}

export interface StartupEnvironment {
  document: Document
  schedule: (callback: () => void, milliseconds: number) => unknown
  window: Window
}

export function installStartup({
  document: startupDocument = document,
  schedule = (callback, milliseconds) => setTimeout(callback, milliseconds),
  window: startupWindow = window
}: Partial<StartupEnvironment> = {}): MarkoverStartupUi {
  const palettes = new Set(['ember', 'ocean', 'olive'])
  const appearances = new Set(['dark', 'light'])
  const colorizations = new Set(['high', 'mid', 'low'])
  const defaultColorization: Readonly<Record<string, string>> = {
    ember: 'low',
    ocean: 'mid',
    olive: 'low'
  }
  const parameters = new URLSearchParams(startupWindow.location.search)
  const inboxPrototypeRequested = parameters.get('inboxPrototype') === '1'
  const bridge = startupWindow.markover
  const requestedPalette = parameters.get('palette') || ''
  const palette = palettes.has(requestedPalette) ? requestedPalette : 'ember'
  const requestedAppearance = parameters.get('appearance') || ''
  const appearance = appearances.has(requestedAppearance)
    ? requestedAppearance
    : 'light'
  const requestedColorization = parameters.get('colorization') || ''
  const colorization = colorizations.has(requestedColorization)
    ? requestedColorization
    : defaultColorization[palette] || 'low'

  startupDocument.documentElement.dataset.palette = palette
  startupDocument.documentElement.dataset.appearance = appearance
  startupDocument.documentElement.dataset.colorization = colorization
  const requestedInstanceBadge = parameters.get('instanceBadge') || ''

  let currentPhase = 'preparing-interface'
  let development = false
  let failed = false
  let earlyFailureReported = false

  const element = (id: string): HTMLElement | null => (
    startupDocument.getElementById(id)
  )
  const refresh = (): void => {
    const status = element('startup-status')
    const detail = element('startup-detail')
    if (status) status.textContent = failed
      ? 'Markover couldn’t start.'
      : 'Starting Markover…'
    if (detail) {
      detail.textContent = development && !failed
        ? PHASE_LABELS[currentPhase] || 'Starting'
        : ''
      detail.hidden = !detail.textContent
    }
  }
  const attach = (): void => {
    const instanceBadge = element('instance-badge')
    if (instanceBadge && /^PR [1-9]\d*$/.test(requestedInstanceBadge)) {
      instanceBadge.textContent = requestedInstanceBadge
      instanceBadge.hidden = false
    }
    refresh()
    for (const [id, action] of [
      ['startup-quit', () => bridge?.quitStartup()],
      ['startup-copy-diagnostic', () => bridge?.copyStartupDiagnostic()],
      ['startup-reveal-diagnostic', () => bridge?.revealStartupDiagnostic()]
    ] as const) {
      element(id)?.addEventListener('click', () => {
        void action()
      })
    }
  }
  if (startupDocument.readyState === 'loading') {
    startupDocument.addEventListener('DOMContentLoaded', attach, { once: true })
  } else {
    attach()
  }

  const api: MarkoverStartupUi = {
    development(value) {
      development = value
      if (development && inboxPrototypeRequested) {
        startupDocument.documentElement.dataset.inboxPrototype = 'true'
      } else {
        delete startupDocument.documentElement.dataset.inboxPrototype
      }
      refresh()
    },
    phase(value) {
      currentPhase = value
      refresh()
    },
    ready() {
      startupDocument.documentElement.dataset.startup = 'ready'
      const screen = element('startup-screen')
      if (screen) screen.hidden = true
    },
    fail(diagnosticAvailable = false) {
      failed = true
      startupDocument.documentElement.dataset.startup = 'failed'
      const screen = element('startup-screen')
      if (screen) screen.hidden = false
      const actions = element('startup-actions')
      if (actions) actions.hidden = !diagnosticAvailable
      element('startup-quit')?.removeAttribute('hidden')
      refresh()
    }
  }
  startupWindow.markoverStartup = api

  const failEarly = (errorEvent: Event): void => {
    if (startupDocument.documentElement.dataset.startup === 'ready') return
    api.fail()
    if (earlyFailureReported || !bridge) return
    earlyFailureReported = true
    const eventError: unknown = Reflect.get(errorEvent, 'error')
    const eventReason: unknown = Reflect.get(errorEvent, 'reason')
    const eventMessage: unknown = Reflect.get(errorEvent, 'message')
    const error = eventError || eventReason || new Error(
      typeof eventMessage === 'string'
        ? eventMessage
        : 'Unknown early renderer failure.'
    )
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown early renderer failure.'
    const stack = error instanceof Error ? error.stack || null : null
    void bridge.reportStartupFailure({
      category: 'renderer-initialization',
      message,
      stack
    }).then(({ diagnosticAvailable }) => {
      api.fail(diagnosticAvailable)
    }).catch(() => {})
  }
  startupWindow.addEventListener('error', failEarly)
  startupWindow.addEventListener('unhandledrejection', failEarly)
  if (inboxPrototypeRequested && !bridge) {
    const revealStandalonePrototype = (): void => {
      api.development(true)
      api.ready()
    }
    if (startupDocument.readyState === 'loading') {
      startupDocument.addEventListener(
        'DOMContentLoaded',
        revealStandalonePrototype,
        { once: true }
      )
    } else {
      revealStandalonePrototype()
    }
  }
  schedule(() => {
    if (startupDocument.documentElement.dataset.startup) return
    const status = element('startup-status')
    if (status) status.textContent = 'Still starting…'
    element('startup-quit')?.removeAttribute('hidden')
  }, 30_000)

  return api
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installStartup()
}

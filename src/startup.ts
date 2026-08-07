(() => {
  const palettes = new Set(['ember', 'ocean', 'olive'])
  const appearances = new Set(['dark', 'light'])
  const colorizations = new Set(['high', 'mid', 'low'])
  const defaultColorization: Readonly<Record<string, string>> = {
    ember: 'low',
    ocean: 'mid',
    olive: 'low'
  }
  const parameters = new URLSearchParams(window.location.search)
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

  document.documentElement.dataset.palette = palette
  document.documentElement.dataset.appearance = appearance
  document.documentElement.dataset.colorization = colorization
})()

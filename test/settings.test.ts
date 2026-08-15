import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import { SettingsStore } from '../src/settings-store'

const {
  adjacentZoomPercent,
  applySettingsToView,
  confirmScreenshotRemoval,
  darkColorization,
  DEFAULT_SETTINGS,
  minimumWindowSize,
  normalizeSettings,
  sidebarPreferenceChanged,
  updateSettings,
  windowBackground,
  ZOOM_LEVELS
} = require('../src/settings') as MarkoverSettingsApi

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): Promise<string> =>
  fs.readFile(path.join(root, relativePath), 'utf8')

function parseRecord(source: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source)
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

test('settings defaults cover the persisted preferences', () => {
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS), [
    'palette',
    'appearance',
    'treeDensity',
    'annotationTextSize',
    'zoomPercent',
    'showKeyboardHelp',
    'openDocumentsSidebar',
    'defaultTreeView',
    'confirmAttachmentRemoval',
    'incomingReviewActivationPolicy',
    'reviewLinkActivationPolicy',
    'incomingReviewIdleMinutes',
    'discoverAgentThreadFromLocalSessions',
    't3ThreadTitlesEnabled',
    't3MetadataDatabasePath',
    'inboxTitlePreference',
    'logRejectedApiRequests',
    'agentReviewMode',
    'agentInterpretationPolicy',
    'autosaveMaximumDelayMs'
  ])
})

test('settings normalization accepts known choices and rejects unknown values', () => {
  assert.deepEqual(normalizeSettings({
    palette: 'ocean',
    appearance: 'dark',
    treeDensity: 'compact',
    annotationTextSize: 'large',
    zoomPercent: 125,
    showKeyboardHelp: false,
    openDocumentsSidebar: false,
    defaultTreeView: 'annotated',
    confirmAttachmentRemoval: false,
    incomingReviewActivationPolicy: 'when-idle',
    reviewLinkActivationPolicy: 'warn',
    incomingReviewIdleMinutes: 12,
    discoverAgentThreadFromLocalSessions: false,
    t3ThreadTitlesEnabled: true,
    t3MetadataDatabasePath: ' /tmp/t3.sqlite ',
    inboxTitlePreference: 'requesting-thread-title',
    logRejectedApiRequests: true,
    agentReviewMode: 'annotations-and-source-proposals',
    agentInterpretationPolicy: 'Follow the checklist.',
    autosaveMaximumDelayMs: 2500,
    unexpected: 'ignored'
  }), {
    palette: 'ocean',
    appearance: 'dark',
    treeDensity: 'compact',
    annotationTextSize: 'large',
    zoomPercent: 125,
    showKeyboardHelp: false,
    openDocumentsSidebar: false,
    defaultTreeView: 'annotated',
    confirmAttachmentRemoval: false,
    incomingReviewActivationPolicy: 'when-idle',
    reviewLinkActivationPolicy: 'warn',
    incomingReviewIdleMinutes: 12,
    discoverAgentThreadFromLocalSessions: false,
    t3ThreadTitlesEnabled: true,
    t3MetadataDatabasePath: '/tmp/t3.sqlite',
    inboxTitlePreference: 'requesting-thread-title',
    logRejectedApiRequests: true,
    agentReviewMode: 'annotations-and-source-proposals',
    agentInterpretationPolicy: 'Follow the checklist.',
    autosaveMaximumDelayMs: 2500
  })

  assert.deepEqual(normalizeSettings({ palette: 'neon', appearance: 42 }), {
    ...DEFAULT_SETTINGS
  })
})

test('zoom levels advance through the supported bounds only', () => {
  assert.deepEqual(ZOOM_LEVELS, [80, 90, 100, 110, 125, 150])
  assert.equal(adjacentZoomPercent(100, 1), 110)
  assert.equal(adjacentZoomPercent(100, -1), 90)
  assert.equal(adjacentZoomPercent(80, -1), 80)
  assert.equal(adjacentZoomPercent(150, 1), 150)
  for (const value of ZOOM_LEVELS) {
    assert.equal(normalizeSettings({ zoomPercent: value }).zoomPercent, value)
  }
  for (const value of [79, 85, 120, 151, '100', null]) {
    assert.equal(normalizeSettings({ zoomPercent: value }).zoomPercent, 100)
  }
})

test('window minimums preserve the usable CSS viewport at every zoom level', () => {
  assert.deepEqual(minimumWindowSize(80), { width: 608, height: 416 })
  assert.deepEqual(minimumWindowSize(100), { width: 760, height: 520 })
  assert.deepEqual(minimumWindowSize(125), { width: 950, height: 650 })
  assert.deepEqual(minimumWindowSize(150), { width: 1140, height: 780 })
  assert.deepEqual(
    minimumWindowSize(150, { width: 900, height: 700 }),
    { width: 900, height: 700 }
  )
})

test('agent review permissions default to annotations and accept only both global modes', () => {
  assert.equal(DEFAULT_SETTINGS.agentReviewMode, 'annotation-only')
  assert.equal(
    normalizeSettings({
      agentReviewMode: 'annotations-and-source-proposals'
    }).agentReviewMode,
    'annotations-and-source-proposals'
  )
  for (const value of ['source-edits', '', 1, null]) {
    assert.equal(normalizeSettings({ agentReviewMode: value }).agentReviewMode, 'annotation-only')
  }
})

test('autosave maximum delay accepts only integer values in the safe range', () => {
  assert.equal(
    normalizeSettings({ autosaveMaximumDelayMs: 100 }).autosaveMaximumDelayMs,
    100
  )
  assert.equal(
    normalizeSettings({ autosaveMaximumDelayMs: 60_000 }).autosaveMaximumDelayMs,
    60_000
  )
  for (const value of [99, 60_001, 2000.5, '2000', null]) {
    assert.equal(
      normalizeSettings({ autosaveMaximumDelayMs: value }).autosaveMaximumDelayMs,
      2000
    )
  }
})

test('incoming review idle time accepts whole minutes from one through sixty', () => {
  assert.equal(
    normalizeSettings({ incomingReviewIdleMinutes: 1 }).incomingReviewIdleMinutes,
    1
  )
  assert.equal(
    normalizeSettings({ incomingReviewIdleMinutes: 60 }).incomingReviewIdleMinutes,
    60
  )
  for (const value of [0, 61, 5.5, '5', null]) {
    assert.equal(
      normalizeSettings({ incomingReviewIdleMinutes: value }).incomingReviewIdleMinutes,
      5
    )
  }
})

test('partial settings updates retain unrelated values', () => {
  const current = updateSettings(DEFAULT_SETTINGS, { palette: 'olive' })
  assert.equal(current.palette, 'olive')
  assert.equal(current.appearance, 'system')
})

test('window backgrounds match palette and resolved appearance before first paint', () => {
  assert.equal(windowBackground({ palette: 'ember' }, 'light'), '#eee8e0')
  assert.equal(windowBackground({ palette: 'ember' }, 'dark'), '#171616')
  assert.equal(windowBackground({ palette: 'ocean' }, 'dark'), '#171b1d')
  assert.equal(windowBackground({ palette: 'olive' }, 'light'), '#dde1d2')
  assert.equal(windowBackground({ palette: 'olive' }, 'dark'), '#171815')
  assert.equal(darkColorization('ember'), 'low')
  assert.equal(darkColorization('ocean'), 'mid')
  assert.equal(darkColorization('olive'), 'low')
})

test('renderer settings apply immediately and reset through the same path', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <form>
      <select name="palette"><option value="ember">Ember</option><option value="ocean">Ocean</option></select>
      <select name="appearance"><option value="system">System</option><option value="dark">Dark</option></select>
      <select name="treeDensity"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select>
      <select name="annotationTextSize"><option value="medium">Medium</option><option value="large">Large</option></select>
      <input name="showKeyboardHelp" type="checkbox">
      <input name="openDocumentsSidebar" type="checkbox">
      <select name="defaultTreeView"><option value="all">All</option><option value="annotated">Annotated</option></select>
      <input name="confirmAttachmentRemoval" type="checkbox">
      <select name="incomingReviewActivationPolicy"><option value="never">Never</option><option value="when-idle">When idle</option></select>
      <select name="reviewLinkActivationPolicy"><option value="always">Always</option><option value="when-idle">When idle</option></select>
      <input name="incomingReviewIdleMinutes" type="number">
      <input name="discoverAgentThreadFromLocalSessions" type="checkbox">
      <input name="t3ThreadTitlesEnabled" type="checkbox">
      <input name="t3MetadataDatabasePath" type="text">
      <select name="inboxTitlePreference"><option value="review-purpose">Purpose</option><option value="requesting-thread-title">Thread</option></select>
      <input name="logRejectedApiRequests" type="checkbox">
      <textarea name="agentInterpretationPolicy"></textarea>
    </form>
    <div class="keyboard-help"></div>
  </body></html>`)
  const form = dom.window.document.querySelector<HTMLFormElement>('form')
  const keyboardHelp = dom.window.document.querySelector<HTMLElement>(
    '.keyboard-help'
  )
  assert.ok(form)
  assert.ok(keyboardHelp)
  const view: SettingsView = {
    root: dom.window.document.documentElement,
    form,
    keyboardHelp
  }

  applySettingsToView({
    ...DEFAULT_SETTINGS,
    palette: 'ocean',
    zoomPercent: 125,
    resolvedAppearance: 'dark',
    treeDensity: 'compact',
    annotationTextSize: 'large',
    showKeyboardHelp: false
  }, view)
  assert.equal(view.root.dataset.palette, 'ocean')
  assert.equal(view.root.dataset.appearance, 'dark')
  assert.equal(view.root.dataset.colorization, 'mid')
  assert.equal(view.root.dataset.treeDensity, 'compact')
  assert.equal(view.root.dataset.annotationTextSize, 'large')
  assert.equal(view.keyboardHelp.hidden, true)
  const paletteControl = view.form.elements.namedItem('palette') as
    | HTMLSelectElement
    | null
  assert.ok(paletteControl)
  assert.equal(paletteControl.value, 'ocean')
  const policyControl = view.form.elements.namedItem('agentInterpretationPolicy') as
    | HTMLTextAreaElement
    | null
  assert.ok(policyControl)
  assert.equal(policyControl.value, DEFAULT_SETTINGS.agentInterpretationPolicy)
  const idleControl = view.form.elements.namedItem('incomingReviewIdleMinutes') as
    | HTMLInputElement
    | null
  assert.ok(idleControl)
  assert.equal(idleControl.value, '5')
  assert.equal(idleControl.disabled, true)
  const t3PathControl = view.form.elements.namedItem('t3MetadataDatabasePath') as
    | HTMLInputElement
    | null
  assert.ok(t3PathControl)
  assert.equal(t3PathControl.disabled, true)

  applySettingsToView({
    ...DEFAULT_SETTINGS,
    t3ThreadTitlesEnabled: true,
    t3MetadataDatabasePath: '/tmp/t3.sqlite',
    resolvedAppearance: 'light'
  }, view)
  assert.equal(t3PathControl.value, '/tmp/t3.sqlite')
  assert.equal(t3PathControl.disabled, false)

  applySettingsToView({
    ...DEFAULT_SETTINGS,
    incomingReviewActivationPolicy: 'when-idle',
    incomingReviewIdleMinutes: 12,
    resolvedAppearance: 'light'
  }, view)
  assert.equal(idleControl.value, '12')
  assert.equal(idleControl.disabled, false)

  applySettingsToView({
    ...DEFAULT_SETTINGS,
    reviewLinkActivationPolicy: 'when-idle',
    resolvedAppearance: 'light'
  }, view)
  assert.equal(idleControl.disabled, false)

  applySettingsToView({ ...DEFAULT_SETTINGS, resolvedAppearance: 'light' }, view)
  assert.equal(view.root.dataset.palette, 'ember')
  assert.equal(view.keyboardHelp.hidden, false)
})

test('behavior settings drive sidebar launch and screenshot confirmation', () => {
  assert.equal(sidebarPreferenceChanged(DEFAULT_SETTINGS, DEFAULT_SETTINGS), false)
  assert.equal(sidebarPreferenceChanged(DEFAULT_SETTINGS, DEFAULT_SETTINGS, true), true)
  assert.equal(sidebarPreferenceChanged(DEFAULT_SETTINGS, {
    ...DEFAULT_SETTINGS,
    openDocumentsSidebar: false
  }), true)

  let prompt = null
  assert.equal(confirmScreenshotRemoval(DEFAULT_SETTINGS, 'diagram', (message) => {
    prompt = message
    return false
  }), false)
  assert.equal(prompt, 'Remove diagram?')
  assert.equal(confirmScreenshotRemoval({
    ...DEFAULT_SETTINGS,
    confirmAttachmentRemoval: false
  }, 'diagram', () => false), true)
})

test('settings store persists normalized settings and recovers malformed JSON', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-settings-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'settings.json')
  const store = new SettingsStore(filePath)

  assert.deepEqual(await store.load(), { ...DEFAULT_SETTINGS })
  await store.update({
    palette: 'ocean',
    zoomPercent: 125,
    showKeyboardHelp: false,
    discoverAgentThreadFromLocalSessions: false,
    incomingReviewActivationPolicy: 'when-idle',
    reviewLinkActivationPolicy: 'warn',
    incomingReviewIdleMinutes: 18,
    agentInterpretationPolicy: 'Use this policy.',
    autosaveMaximumDelayMs: 3500
  })

  const restored = new SettingsStore(filePath)
  assert.equal((await restored.load()).palette, 'ocean')
  assert.equal(restored.settings.zoomPercent, 125)
  assert.equal(restored.settings.showKeyboardHelp, false)
  assert.equal(restored.settings.discoverAgentThreadFromLocalSessions, false)
  assert.equal(restored.settings.incomingReviewActivationPolicy, 'when-idle')
  assert.equal(restored.settings.reviewLinkActivationPolicy, 'warn')
  assert.equal(restored.settings.incomingReviewIdleMinutes, 18)
  assert.equal(restored.settings.agentInterpretationPolicy, 'Use this policy.')
  assert.equal(restored.settings.autosaveMaximumDelayMs, 3500)

  await fs.writeFile(filePath, '{not json', 'utf8')
  assert.deepEqual(await restored.load(), { ...DEFAULT_SETTINGS })
  assert.match(restored.lastRecoveryWarning || '', /preserved/)
  assert.equal(await fs.readFile(filePath, 'utf8'), '{not json')
})

test('settings store uses instance defaults only until settings are persisted', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-settings-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'settings.json')
  const developmentDefaults = {
    ...DEFAULT_SETTINGS,
    palette: 'ocean' as const,
    appearance: 'dark' as const
  }
  const store = new SettingsStore(filePath, developmentDefaults)

  assert.deepEqual(await store.load(), developmentDefaults)
  await store.update({ palette: 'olive' })

  const restored = new SettingsStore(filePath, developmentDefaults)
  assert.equal((await restored.load()).palette, 'olive')
  assert.equal(restored.settings.appearance, 'dark')
})

test('settings store serializes rapid updates without losing the latest values', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-settings-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'settings.json')
  const store = new SettingsStore(filePath)

  await Promise.all([
    store.update({ palette: 'olive' }),
    store.update({ appearance: 'dark' }),
    store.update({ treeDensity: 'compact' })
  ])

  const saved = parseRecord(await fs.readFile(filePath, 'utf8'))
  assert.equal(saved.palette, 'olive')
  assert.equal(saved.appearance, 'dark')
  assert.equal(saved.treeDensity, 'compact')
  assert.deepEqual(await fs.readdir(directory), ['settings.json'])
})

test('settings store loads offline manual edits after restart', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-settings-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'settings.json')
  await fs.writeFile(filePath, `${JSON.stringify({
    ...DEFAULT_SETTINGS,
    autosaveMaximumDelayMs: 4200,
    palette: 'ocean'
  }, null, 2)}\n`, 'utf8')

  const restarted = new SettingsStore(filePath)
  assert.equal((await restarted.load()).autosaveMaximumDelayMs, 4200)
  assert.equal(restarted.settings.palette, 'ocean')

  await restarted.update({ treeDensity: 'compact' })
  const saved = parseRecord(await fs.readFile(filePath, 'utf8'))
  assert.equal(saved.autosaveMaximumDelayMs, 4200)
  assert.equal(saved.palette, 'ocean')
  assert.equal(saved.treeDensity, 'compact')
})

test('settings are discoverable from the native menu and wired to a complete dialog', async () => {
  const [main, preload, renderer, html] = await Promise.all([
    read('src/main.ts'),
    read('src/preload.ts'),
    read('src/renderer.ts'),
    read('src/index.html')
  ])

  assert.match(main, /app\.setName\(addressedInstance\.branding\.appName\)/)
  assert.match(main, /process\.title = addressedInstance\.branding\.appName/)
  assert.match(main, /installApplicationMenu\(\)/)
  assert.match(preload, /getSettings:/)
  assert.match(preload, /onSettingsOpen:/)
  assert.match(renderer, /function applySettings\([\s\S]*next: unknown,[\s\S]*options: \{ initial\?: boolean \} = \{\}[\s\S]*\): void/)
  assert.match(html, /<dialog id="settings-dialog"/)
  assert.match(html, /<h3 class="settings-section-title">Agent Review<\/h3>/)
  assert.match(html, /<select name="agentReviewMode">/)
  assert.match(html, /Annotations only \(default\)/)
  assert.match(html, /Annotations and source proposals/)
  assert.match(html, /id="fixed-contract-open"[^>]*>View fixed contract</)
  assert.match(html, /<dialog id="fixed-contract-dialog"/)
  assert.match(renderer, /MarkoverAgentGuidance\.FIXED_CONTRACT_STATEMENTS/)
  assert.match(renderer, /elements\.fixedContractDialog\.showModal\(\)/)
  assert.match(
    renderer,
    /control\.type === 'number'[\s\S]*!Number\.isFinite\(control\.valueAsNumber\)[\s\S]*!control\.checkValidity\(\)[\s\S]*restoreSettingsForm\(\)[\s\S]*return/
  )
  assert.match(
    renderer,
    /bridge\.updateSettings\([\s\S]*\.catch\(\(\) => \{[\s\S]*restoreSettingsForm\(\)/
  )
  const dialogSettings = Object.keys(DEFAULT_SETTINGS).filter(
    (key) => key !== 'autosaveMaximumDelayMs' && key !== 'zoomPercent'
  )
  for (const key of dialogSettings) {
    assert.match(html, new RegExp(`name="${key}"`))
  }
  assert.doesNotMatch(html, /name="autosaveMaximumDelayMs"/)
  assert.doesNotMatch(html, /name="zoomPercent"/)
})

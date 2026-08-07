import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import { SettingsStore } from '../src/settings-store'

const {
  applySettingsToView,
  confirmScreenshotRemoval,
  darkColorization,
  DEFAULT_SETTINGS,
  normalizeSettings,
  sidebarPreferenceChanged,
  updateSettings,
  windowBackground
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
    'showKeyboardHelp',
    'openDocumentsSidebar',
    'defaultTreeView',
    'confirmAttachmentRemoval',
    'discoverAgentThreadFromLocalSessions',
    'logRejectedApiRequests',
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
    showKeyboardHelp: false,
    openDocumentsSidebar: false,
    defaultTreeView: 'annotated',
    confirmAttachmentRemoval: false,
    discoverAgentThreadFromLocalSessions: false,
    logRejectedApiRequests: true,
    agentInterpretationPolicy: 'Follow the checklist.',
    autosaveMaximumDelayMs: 2500,
    unexpected: 'ignored'
  }), {
    palette: 'ocean',
    appearance: 'dark',
    treeDensity: 'compact',
    annotationTextSize: 'large',
    showKeyboardHelp: false,
    openDocumentsSidebar: false,
    defaultTreeView: 'annotated',
    confirmAttachmentRemoval: false,
    discoverAgentThreadFromLocalSessions: false,
    logRejectedApiRequests: true,
    agentInterpretationPolicy: 'Follow the checklist.',
    autosaveMaximumDelayMs: 2500
  })

  assert.deepEqual(normalizeSettings({ palette: 'neon', appearance: 42 }), {
    ...DEFAULT_SETTINGS
  })
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
      <input name="discoverAgentThreadFromLocalSessions" type="checkbox">
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
    showKeyboardHelp: false,
    discoverAgentThreadFromLocalSessions: false,
    agentInterpretationPolicy: 'Use this policy.',
    autosaveMaximumDelayMs: 3500
  })

  const restored = new SettingsStore(filePath)
  assert.equal((await restored.load()).palette, 'ocean')
  assert.equal(restored.settings.showKeyboardHelp, false)
  assert.equal(restored.settings.discoverAgentThreadFromLocalSessions, false)
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
})

test('separate settings stores merge concurrent partial updates', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-settings-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'settings.json')
  const first = new SettingsStore(filePath)
  const second = new SettingsStore(filePath)
  await Promise.all([first.load(), second.load()])

  await Promise.all([
    first.update({ palette: 'ocean' }),
    second.update({ treeDensity: 'compact' })
  ])

  const saved = parseRecord(await fs.readFile(filePath, 'utf8'))
  assert.equal(saved.palette, 'ocean')
  assert.equal(saved.treeDensity, 'compact')
})

test('settings stores observe changes written by another process', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-settings-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'settings.json')
  const observer = new SettingsStore(filePath)
  const writer = new SettingsStore(filePath)
  await Promise.all([observer.load(), writer.load()])

  let resolveChanged!: (settings: MarkoverSettings) => void
  const changed = new Promise<MarkoverSettings>((resolve) => {
    resolveChanged = resolve
  })
  const stop = await observer.subscribe(resolveChanged)
  t.after(() => { stop() })
  await writer.update({ palette: 'olive' })
  let timeout!: ReturnType<typeof setTimeout>
  const observed = await Promise.race([
    changed,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => { reject(new Error('settings watcher timed out')) },
        1000
      )
    })
  ])
  clearTimeout(timeout)
  assert.equal(observed.palette, 'olive')
})

test('settings subscription reconciles a change made after initial load', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-settings-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'settings.json')
  const observer = new SettingsStore(filePath)
  const writer = new SettingsStore(filePath)
  await observer.load()
  await writer.update({ palette: 'ocean' })

  let observed: MarkoverSettings | undefined
  const stop = await observer.subscribe((settings) => { observed = settings })
  t.after(() => { stop() })

  assert.ok(observed)
  assert.equal(observed.palette, 'ocean')
  assert.equal(observer.settings.palette, 'ocean')
})

test('settings lock cleanup cannot remove a replacement owner lock', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-settings-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'settings.json')
  const lockPath = `${filePath}.lock`
  const deadOwner = '99999999:abandoned'
  const replacementOwner = `${String(process.pid)}:replacement`
  await fs.symlink(deadOwner, lockPath)

  const store = new SettingsStore(filePath)
  const originalRename = fs.rename
  fs.rename = async (...args) => {
    await fs.unlink(lockPath)
    await fs.symlink(replacementOwner, lockPath)
    return originalRename(...args)
  }
  t.after(() => { fs.rename = originalRename })

  await store.update({ palette: 'olive' })
  assert.equal(await fs.readlink(lockPath), replacementOwner)
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
  assert.match(html, /id="fixed-contract-open"[^>]*>View fixed contract</)
  assert.match(html, /<dialog id="fixed-contract-dialog"/)
  assert.match(renderer, /MarkoverAgentGuidance\.FIXED_CONTRACT_STATEMENTS/)
  assert.match(renderer, /elements\.fixedContractDialog\.showModal\(\)/)
  const dialogSettings = Object.keys(DEFAULT_SETTINGS).filter(
    (key) => key !== 'autosaveMaximumDelayMs'
  )
  for (const key of dialogSettings) {
    assert.match(html, new RegExp(`name="${key}"`))
  }
  assert.doesNotMatch(html, /name="autosaveMaximumDelayMs"/)
})

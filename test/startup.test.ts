import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import { installStartup } from '../src/startup'

function view(search = ''): {
  actions: { copied: number; quit: number; reported: number; revealed: number }
  dom: JSDOM
  fireSlow: () => void
  startup: MarkoverStartupUi
} {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section id="startup-screen">
      <p id="startup-status"></p>
      <p id="startup-detail" hidden></p>
      <div id="startup-actions" hidden>
        <button id="startup-copy-diagnostic"></button>
        <button id="startup-reveal-diagnostic"></button>
      </div>
      <button id="startup-quit" hidden></button>
    </section>
    <span id="instance-badge" hidden></span>
  </body></html>`, { url: `file:///app/index.html${search}` })
  const actions = { copied: 0, quit: 0, reported: 0, revealed: 0 }
  ;(dom.window as unknown as Window).markover = {
    copyStartupDiagnostic: () => {
      actions.copied += 1
      return Promise.resolve()
    },
    quitStartup: () => { actions.quit += 1 },
    reportStartupFailure: () => {
      actions.reported += 1
      return Promise.resolve({ diagnosticAvailable: true })
    },
    revealStartupDiagnostic: () => {
      actions.revealed += 1
      return Promise.resolve()
    }
  } as unknown as MarkoverBridge
  let slow: (() => void) | null = null
  const startup = installStartup({
    document: dom.window.document,
    schedule(callback, milliseconds) {
      assert.equal(milliseconds, 30_000)
      slow = callback
      return 1
    },
    window: dom.window as unknown as Window
  })
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'))
  return {
    actions,
    dom,
    fireSlow: () => {
      assert.ok(slow)
      slow()
    },
    startup
  }
}

test('first paint accepts only supported visual tokens', () => {
  const { dom } = view('?palette=bad&appearance=dark&colorization=bad')
  assert.equal(dom.window.document.documentElement.dataset.palette, 'ember')
  assert.equal(dom.window.document.documentElement.dataset.appearance, 'dark')
  assert.equal(dom.window.document.documentElement.dataset.colorization, 'low')
})

test('first paint exposes only a validated PR instance badge', () => {
  const development = view('?instanceBadge=PR%2061')
  const badge = development.dom.window.document.querySelector<HTMLElement>(
    '#instance-badge'
  )
  assert.ok(badge)
  assert.equal(badge.hidden, false)
  assert.equal(badge.textContent, 'PR 61')

  const invalid = view('?instanceBadge=main')
  const invalidBadge = invalid.dom.window.document.querySelector<HTMLElement>(
    '#instance-badge'
  )
  assert.ok(invalidBadge)
  assert.equal(invalidBadge.hidden, true)
})

test('development shows phases while release remains generic', () => {
  const development = view()
  development.startup.development(true)
  development.startup.phase('restoring-reviews')
  assert.equal(
    development.dom.window.document.querySelector('#startup-detail')?.textContent,
    'Restoring reviews'
  )

  const release = view()
  release.startup.phase('restoring-reviews')
  assert.equal(
    release.dom.window.document.querySelector('#startup-detail')?.textContent,
    ''
  )
})

test('slow and failed startup expose bounded user actions', () => {
  const { actions, dom, fireSlow, startup } = view()
  const status = dom.window.document.querySelector('#startup-status')
  const quit = dom.window.document.querySelector<HTMLButtonElement>('#startup-quit')
  fireSlow()
  assert.equal(status?.textContent, 'Still starting…')
  assert.equal(quit?.hidden, false)

  startup.fail(true)
  assert.equal(status.textContent, 'Markover couldn’t start.')
  assert.equal(
    dom.window.document.querySelector<HTMLElement>('#startup-actions')?.hidden,
    false
  )
  startup.ready()
  assert.equal(
    dom.window.document.querySelector<HTMLElement>('#startup-screen')?.hidden,
    true
  )

  dom.window.document.querySelector<HTMLButtonElement>('#startup-quit')?.click()
  dom.window.document.querySelector<HTMLButtonElement>('#startup-copy-diagnostic')?.click()
  dom.window.document.querySelector<HTMLButtonElement>('#startup-reveal-diagnostic')?.click()
  assert.deepEqual(actions, { copied: 1, quit: 1, reported: 0, revealed: 1 })
})

test('failed startup hides diagnostic actions until the latest write succeeds', () => {
  const { dom, startup } = view()
  const diagnosticActions = dom.window.document.querySelector<HTMLElement>(
    '#startup-actions'
  )
  assert.ok(diagnosticActions)

  startup.fail(true)
  assert.equal(diagnosticActions.hidden, false)
  startup.fail()
  assert.equal(diagnosticActions.hidden, true)
})

test('early renderer errors report once before the renderer module loads', async () => {
  const { actions, dom } = view()
  dom.window.dispatchEvent(new dom.window.ErrorEvent('error', {
    error: new Error('renderer import failed'),
    message: 'renderer import failed'
  }))
  dom.window.dispatchEvent(new dom.window.ErrorEvent('error', {
    error: new Error('secondary failure'),
    message: 'secondary failure'
  }))
  await Promise.resolve()
  assert.equal(actions.reported, 1)
  assert.equal(
    dom.window.document.querySelector<HTMLElement>('#startup-actions')?.hidden,
    false
  )
  assert.equal(
    dom.window.document.documentElement.dataset.startup,
    'failed'
  )
})

test('the early trap retires after readiness', async () => {
  const { actions, dom, startup } = view()
  startup.ready()
  dom.window.dispatchEvent(new dom.window.ErrorEvent('error', {
    error: new Error('later runtime error'),
    message: 'later runtime error'
  }))
  await Promise.resolve()
  assert.equal(actions.reported, 0)
  assert.equal(
    dom.window.document.documentElement.dataset.startup,
    'ready'
  )
})

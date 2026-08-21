import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { JSDOM } from 'jsdom'

import {
  developmentElementReference,
  installDevelopmentElementCallouts,
  isDevelopmentElementCalloutCommand,
  isDevelopmentElementReference,
  resolveDevelopmentElementReference
} from '../src/development-element'

const root = path.resolve(__dirname, '../..')

test('one Option-click pins an element and copies its stable reference', () => {
  const dom = new JSDOM('<main id="workspace"><section><button>Choose</button></section></main>')
  const { document, MouseEvent } = dom.window
  const button = document.querySelector('button') as HTMLButtonElement
  button.getBoundingClientRect = () => ({
    bottom: 62,
    height: 42,
    left: 10,
    right: 130,
    toJSON: () => ({}),
    top: 20,
    width: 120,
    x: 10,
    y: 20
  })
  const copied: string[] = []
  const notices: string[] = []
  const callouts = installDevelopmentElementCallouts(document, {
    copyText: (reference) => { copied.push(reference) },
    notify: (message) => { notices.push(message) }
  })
  let ordinaryClicks = 0
  button.addEventListener('click', () => { ordinaryClicks += 1 })

  button.dispatchEvent(new MouseEvent('click', {
    altKey: true,
    bubbles: true,
    button: 0,
    cancelable: true
  }))

  assert.equal(ordinaryClicks, 0)
  assert.equal(copied.length, 1)
  assert.equal(isDevelopmentElementReference(copied[0]), true)
  assert.deepEqual(notices, ['Element reference copied'])
  const overlay = document.querySelector<HTMLElement>('.development-element-callout')
  assert.ok(overlay)
  assert.equal(overlay.hidden, false)
  assert.equal(overlay.style.left, '10px')
  assert.equal(overlay.style.width, '120px')

  const result = callouts.handle({
    action: 'highlight',
    reference: copied[0],
    requestId: 'element-callout-1'
  })
  assert.deepEqual(result, {
    bounds: { height: 42, width: 120, x: 10, y: 20 },
    reference: copied[0],
    requestId: 'element-callout-1',
    status: 'highlighted'
  })
  assert.deepEqual(callouts.handle({
    action: 'clear',
    requestId: 'element-callout-2'
  }), {
    requestId: 'element-callout-2',
    status: 'cleared'
  })
  assert.equal(overlay.hidden, true)
})

test('references fail stale or ambiguous without selecting another element', () => {
  const dom = new JSDOM('<main id="workspace"><section><button>Choose</button></section></main>')
  const { document } = dom.window
  const button = document.querySelector('button') as HTMLButtonElement
  const reference = developmentElementReference(button, document)
  assert.equal(resolveDevelopmentElementReference(reference, document).status, 'found')

  document.querySelector('section')?.remove()
  assert.deepEqual(resolveDevelopmentElementReference(reference, document), {
    status: 'stale'
  })

  const anchored = developmentElementReference(
    document.querySelector('#workspace') as HTMLElement,
    document
  )
  const duplicate = document.createElement('main')
  duplicate.id = 'workspace'
  document.body.append(duplicate)
  assert.deepEqual(resolveDevelopmentElementReference(anchored, document), {
    status: 'ambiguous'
  })
})

test('element commands accept only canonical references and exact actions', () => {
  const dom = new JSDOM('<button id="save">Save</button>')
  const reference = developmentElementReference(
    dom.window.document.querySelector('button') as HTMLButtonElement,
    dom.window.document
  )
  assert.equal(isDevelopmentElementCalloutCommand({
    action: 'highlight',
    reference,
    requestId: 'element-callout-1'
  }), true)
  assert.equal(isDevelopmentElementCalloutCommand({
    action: 'clear',
    requestId: 'element-callout-2'
  }), true)
  assert.equal(isDevelopmentElementCalloutCommand({
    action: 'highlight',
    reference: `${reference}x`,
    requestId: 'element-callout-3'
  }), false)
  assert.equal(isDevelopmentElementCalloutCommand({
    action: 'clear',
    reference,
    requestId: 'element-callout-4'
  }), false)
})

test('picker and service route are live-watch-only and documented', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  const renderer = fs.readFileSync(path.join(root, 'src/renderer.ts'), 'utf8')
  const docs = fs.readFileSync(
    path.join(root, 'docs/developer/development.md'),
    'utf8'
  )
  assert.match(main, /elementCallouts: developmentWatchMode/)
  assert.match(
    main,
    /\.\.\.\(developmentWatchMode[\s\S]*onDevelopmentElementCallout: requestDevelopmentElementCallout/
  )
  assert.match(
    renderer,
    /if \(startupInfo\.elementCallouts\)[\s\S]*installDevelopmentElementCallouts/
  )
  assert.match(docs, /Option-click any rendered element/)
  assert.match(docs, /--instance dev element highlight/)
  assert.match(docs, /--instance dev element clear/)
})

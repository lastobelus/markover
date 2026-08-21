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

test('references reject changed same-tag sibling ordinals', () => {
  const dom = new JSDOM(
    '<main id="workspace"><section><button>First</button><button>Choose</button></section></main>'
  )
  const { document } = dom.window
  const buttons = document.querySelectorAll('button')
  const reference = developmentElementReference(buttons[1] as Element, document)
  const inserted = document.createElement('button')
  inserted.textContent = 'Inserted'
  buttons[1]?.before(inserted)

  assert.deepEqual(resolveDevelopmentElementReference(reference, document), {
    status: 'stale'
  })

  const reorderedDom = new JSDOM(
    '<main id="workspace"><details><summary><span>Alpha</span></summary></details><details><summary><span>Beta</span></summary></details></main>'
  )
  const reorderedDocument = reorderedDom.window.document
  const details = reorderedDocument.querySelectorAll('details')
  const descendant = details[0]?.querySelector('span') as Element
  const reorderedReference = developmentElementReference(
    descendant,
    reorderedDocument
  )
  details[1]?.after(details[0] as Element)
  assert.deepEqual(
    resolveDevelopmentElementReference(reorderedReference, reorderedDocument),
    { status: 'stale' }
  )
})

test('pinned callouts can reposition after application layout changes', () => {
  const dom = new JSDOM('<main id="workspace"><button>Choose</button></main>')
  const { document } = dom.window
  const button = document.querySelector('button') as HTMLButtonElement
  let x = 10
  button.getBoundingClientRect = () => ({
    bottom: 60,
    height: 40,
    left: x,
    right: x + 120,
    toJSON: () => ({}),
    top: 20,
    width: 120,
    x,
    y: 20
  })
  const callouts = installDevelopmentElementCallouts(document, {
    copyText() {},
    notify() {}
  })
  const reference = developmentElementReference(button, document)
  callouts.handle({
    action: 'highlight',
    reference,
    requestId: 'element-callout-1'
  })
  x = 75

  assert.deepEqual(callouts.reposition(), {
    height: 40,
    width: 120,
    x: 75,
    y: 20
  })
  assert.equal(
    document.querySelector<HTMLElement>('.development-element-callout')?.style.left,
    '75px'
  )
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
  assert.match(
    renderer,
    /schedulePaneLayoutResizeUpdate[\s\S]*developmentElementCallouts\?\.reposition\(\)/
  )
  assert.match(
    renderer,
    /function renderDocumentsList\(\)[\s\S]*replaceChildren\(\)[\s\S]*developmentElementCallouts\?\.reposition\(\)/
  )
  assert.match(
    renderer,
    /function renderTree\(\)[\s\S]*elements\.tree\.replaceChildren\(\)[\s\S]*developmentElementCallouts\?\.reposition\(\)/
  )
  assert.match(docs, /Option-click any rendered element/)
  assert.match(docs, /--instance dev element highlight/)
  assert.match(docs, /--instance dev element clear/)
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const {
  bindDismiss,
  bindListKeyboard,
  bindSneakPeek,
  create,
  createList,
  model,
  popoverPosition,
  updateTruncation
} = require('../src/annotation-block') as MarkoverAnnotationBlockApi

function element<T extends Element>(value: T | null): T {
  assert.ok(value)
  return value
}

const styles = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8')

test('builds one annotation view model for previews and list entries', () => {
  assert.deepEqual(model({
    id: 'block-3',
    text: 'The source block text',
    feedback: '**Keep** the real feedback.',
    lineStart: 8,
    lineEnd: 10,
    attachments: [
      { id: 'img-1', label: 'diagram' },
      { id: 'img-2', label: '' }
    ]
  }, { descriptor: '<p>' }), {
    attachments: [
      { attachment: { id: 'img-1', label: 'diagram' }, label: 'diagram' },
      { attachment: { id: 'img-2', label: '' }, label: 'img-2' }
    ],
    feedback: '**Keep** the real feedback.',
    lineLabel: 'Lines 8–10',
    sourceTitle: 'The source block text'
  })

  assert.equal(model({
    text: 'Old heading',
    raw: '## Old heading',
    sourceEdit: {
      original: '## Old heading',
      current: '## New heading\n\nMore detail'
    },
    feedback: '',
    lineStart: 1,
    lineEnd: 1
  }).sourceTitle, 'New heading')
})

test('positions a preview beside its marker and clamps it to the viewport', () => {
  assert.deepEqual(popoverPosition(
    { left: 20, right: 30, top: 50 },
    { width: 200, height: 120 },
    { width: 800, height: 600 }
  ), { x: 40, y: 40 })

  assert.deepEqual(popoverPosition(
    { left: 760, right: 770, top: 580 },
    { width: 220, height: 180 },
    { width: 800, height: 600 }
  ), { x: 530, y: 410 })
})

test('the shared component renders Markdown feedback with concise source context', () => {
  const { document } = (new JSDOM()).window
  const renderedValues: string[] = []
  const block = create(document, {
    node: {
      id: 'block-3',
      text: 'Source context only',
      feedback: '**Actual feedback**',
      lineStart: 8,
      lineEnd: 8,
      attachments: [{ id: 'img-1', label: 'diagram' }]
    },
    context: { descriptor: '<p>' },
    mode: 'peek',
    attachmentUrl: (attachment) => `file:///tmp/${attachment.id}.png`,
    renderTitle: (title) => `<em>${title}</em>`,
    renderMarkdown: (value) => {
      renderedValues.push(value)
      return '<p><strong>Actual feedback</strong></p>'
    }
  })

  assert.deepEqual(renderedValues, ['**Actual feedback**'])
  assert.equal(block.classList.contains('rendered-annotation--peek'), true)
  assert.equal(element(block.querySelector('.rendered-annotation-identity em')).textContent, 'Source context only')
  assert.equal(element(block.querySelector('.rendered-annotation-content strong')).textContent, 'Actual feedback')
  assert.equal(element(block.querySelector('.rendered-annotation-identity strong')).textContent, 'Source context only')
  assert.equal(element(block.querySelector<HTMLImageElement>('.rendered-annotation-attachment img')).src, 'file:///tmp/img-1.png')
  assert.equal(element(block.querySelector('.rendered-annotation-attachment span')).textContent, 'diagram')
})

test('rendering safely coerces unvalidated persisted feedback', () => {
  const { document } = (new JSDOM()).window
  const renderedValues: string[] = []
  const block = create(document, {
    node: {
      id: 'block-persisted',
      text: 'Persisted source',
      feedback: { invalid: true },
      lineStart: 2,
      lineEnd: 2
    },
    renderMarkdown: (value) => {
      renderedValues.push(value)
      return `<p>${value}</p>`
    }
  })

  assert.deepEqual(renderedValues, ['[object Object]'])
  assert.equal(
    element(block.querySelector('.rendered-annotation-content')).textContent,
    '[object Object]'
  )
})

test('inline Markdown images are static in peeks and interactive when requested', () => {
  const { document } = (new JSDOM()).window
  const node = {
    id: 'block-3',
    text: 'Source',
    feedback: '![diagram](diagram.png)',
    lineStart: 8,
    lineEnd: 8
  }
  const renderMarkdown = () => (
    '<button class="inline-image" data-image-source="diagram.png" data-image-label="diagram">▧ diagram</button>'
  )
  const peek = create(document, {
    node,
    mode: 'peek',
    renderMarkdown
  })
  assert.equal(peek.querySelector('button.inline-image'), null)
  assert.equal(element(peek.querySelector('span.inline-image.is-static')).textContent, '▧ diagram')

  const calls: string[] = []
  const list = create(document, {
    node,
    mode: 'list',
    onInlineImage: (source, label) => calls.push(`${source}:${label}`),
    renderMarkdown
  })
  const button = element(
    list.querySelector<HTMLButtonElement>('button.inline-image')
  )
  assert.equal(list.querySelector('img'), null)
  assert.equal(button.getAttribute('src'), null)
  assert.deepEqual(calls, [])
  button.click()
  assert.deepEqual(calls, ['diagram.png:diagram'])
})

test('only a bound own marker opens a preview and leave or scroll closes it', () => {
  const { window } = new JSDOM('<div id="tree"><i id="own"></i><i id="descendant"></i></div>')
  const own = element(window.document.querySelector<HTMLElement>('#own'))
  const descendant = element(window.document.querySelector<HTMLElement>('#descendant'))
  const tree = element(window.document.querySelector<HTMLElement>('#tree'))
  const calls: string[] = []
  const node = { id: 'block-3' }
  const hide = () => calls.push('hide')

  bindSneakPeek(own, node, {
    show: (shownNode, marker) => {
      calls.push(`show:${shownNode.id}:${marker.id}`)
    },
    hide
  })
  bindDismiss(tree, 'scroll', hide)

  descendant.dispatchEvent(new window.Event('mouseenter'))
  assert.deepEqual(calls, [])
  own.dispatchEvent(new window.Event('mouseenter'))
  own.dispatchEvent(new window.Event('mouseleave'))
  tree.dispatchEvent(new window.Event('scroll'))
  assert.deepEqual(calls, ['show:block-3:own', 'hide', 'hide'])
})

test('list keyboard navigation moves selection and Enter fires the edit button', () => {
  const { window } = new JSDOM('<section tabindex="0"><button>Edit</button></section>')
  const list = element(window.document.querySelector<HTMLElement>('section'))
  const edit = element(window.document.querySelector<HTMLButtonElement>('button'))
  const calls: string[] = []
  edit.addEventListener('click', () => calls.push('edit-clicked'))
  bindListKeyboard(list, {
    edit: () => {
      edit.click()
    },
    move: (offset) => {
      calls.push(`move:${String(offset)}`)
    }
  })

  list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp' }))
  list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }))
  list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }))
  assert.deepEqual(calls, ['move:-1', 'move:1', 'edit-clicked'])
})

test('annotation lists reuse rendered annotation blocks and track selection', () => {
  const { window } = new JSDOM()
  const calls: string[] = []
  const nodes = [
    { id: 'block-1', text: 'First source', feedback: 'First note', lineStart: 1, lineEnd: 1 },
    {
      id: 'block-2',
      text: 'Second source',
      feedback: 'Second note',
      lineStart: 2,
      lineEnd: 2,
      attachments: [{ id: 'img-2', label: 'detail' }]
    }
  ]
  const list = createList(window.document, {
    nodes,
    selectedId: 'block-2',
    context: () => ({ descriptor: '<p>' }),
    attachmentUrl: (attachment) => `file:///tmp/${attachment.id}.png`,
    renderMarkdown: (value) => `<p>${value}</p>`,
    onAttachment: (attachment) => {
      calls.push(`open:${attachment.id}`)
    },
    onSelect: (node) => {
      calls.push(`select:${node.id}`)
    },
    onEdit: (node) => {
      calls.push(`edit:${node.id}`)
    }
  })

  const blocks = list.querySelectorAll('.rendered-annotation--list')
  assert.equal(blocks.length, 2)
  const selectedBlock = element(blocks.item(1))
  assert.equal(selectedBlock.classList.contains('is-selected'), true)
  assert.equal(element(selectedBlock.querySelector('.rendered-annotation-content p')).textContent, 'Second note')
  assert.equal(
    element(element(selectedBlock.querySelector('.rendered-annotation-edit')).parentElement).className,
    'rendered-annotation-body has-edit'
  )
  assert.equal(
    element(selectedBlock.querySelector<HTMLImageElement>('.rendered-annotation-attachment img')).src,
    'file:///tmp/img-2.png'
  )
  selectedBlock.dispatchEvent(new window.Event('click'))
  element(selectedBlock.querySelector<HTMLElement>('.rendered-annotation-attachment')).click()
  element(selectedBlock.querySelector<HTMLElement>('.rendered-annotation-edit')).click()
  assert.deepEqual(calls, ['select:block-2', 'open:img-2', 'edit:block-2'])

  const readonlyList = createList(window.document, {
    nodes,
    selectedId: 'block-1',
    context: () => ({ descriptor: '<p>' }),
    renderMarkdown: (value) => `<p>${value}</p>`,
    onSelect: () => {},
    onEdit: null
  })
  assert.equal(readonlyList.querySelector('.rendered-annotation-edit'), null)
})

test('annotation list truncation indicators reflect measured content overflow', () => {
  const { document } = (new JSDOM()).window
  const list = createList(document, {
    nodes: [{ id: 'block-1', text: 'Source', feedback: 'Long note', lineStart: 1, lineEnd: 1 }],
    selectedId: 'block-1',
    context: () => ({}),
    renderMarkdown: (value) => `<p>${value}</p>`
  })
  const content = element(list.querySelector<HTMLElement>('.rendered-annotation-content'))
  const overflow = element(list.querySelector<HTMLElement>('.rendered-annotation-overflow'))
  Object.defineProperties(content, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 140 }
  })

  updateTruncation(list)
  assert.equal(overflow.hidden, false)

  Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 100 })
  updateTruncation(list)
  assert.equal(overflow.hidden, true)
})

test('annotation list cards use scannable titles, compact thumbnails, and primary edit actions', () => {
  assert.match(styles, /\.rendered-annotation-identity strong \{[^}]*font-size: 14px;/)
  assert.match(styles, /\.rendered-annotation-overflow \{[^}]*font-size: 15px;/)
  assert.match(styles, /\.rendered-annotation--list \.rendered-annotation-attachment \{[^}]*padding: 0;/)
  assert.match(styles, /\.rendered-annotation--list \.rendered-annotation-attachment span \{[^}]*display: none;/)
  assert.match(styles, /\.rendered-annotation-edit \{[^}]*color: var\(--primary-button-text\);[^}]*background: var\(--primary-button-bg\);/)
  assert.match(styles, /\.annotation-list-view \{[^}]*min-width: 0;[^}]*overflow-x: hidden;/)
  assert.match(styles, /\.annotation-list \{[^}]*grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(styles, /\.annotation-list \.rendered-annotation \{[^}]*min-width: 0;[^}]*overflow: hidden;/)
  assert.match(styles, /\.annotation-list \.rendered-annotation\.is-selected \{[^}]*box-shadow: inset -3px 0 0 var\(--brand-orange\);/)
  assert.match(styles, /\.annotation-list-view:focus \.rendered-annotation\.is-selected \{[^}]*box-shadow: inset -4px 0 0 var\(--brand-orange\);/)
})

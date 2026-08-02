const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const {
  bindDismiss,
  bindListKeyboard,
  bindSneakPeek,
  create,
  createList,
  model,
  popoverPosition
} = require('../src/annotation-block')

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
    attachmentLabels: ['diagram', 'img-2'],
    descriptor: '<p>',
    feedback: '**Keep** the real feedback.',
    lineLabel: 'Lines 8–10'
  })
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

test('the shared component renders Markdown feedback rather than source text', () => {
  const { document } = (new JSDOM()).window
  const renderedValues = []
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
    renderMarkdown: (value) => {
      renderedValues.push(value)
      return '<p><strong>Actual feedback</strong></p>'
    }
  })

  assert.deepEqual(renderedValues, ['**Actual feedback**'])
  assert.equal(block.classList.contains('rendered-annotation--peek'), true)
  assert.equal(block.querySelector('.rendered-annotation-body strong').textContent, 'Actual feedback')
  assert.equal(block.textContent.includes('Source context only'), false)
  assert.equal(block.querySelector('.rendered-annotation-attachments').textContent, '▧ diagram')
})

test('only a bound own marker opens a preview and leave or scroll closes it', () => {
  const { window } = new JSDOM('<div id="tree"><i id="own"></i><i id="descendant"></i></div>')
  const own = window.document.querySelector('#own')
  const descendant = window.document.querySelector('#descendant')
  const tree = window.document.querySelector('#tree')
  const calls = []
  const node = { id: 'block-3' }
  const hide = () => calls.push('hide')

  bindSneakPeek(own, node, {
    show: (shownNode, marker) => calls.push(`show:${shownNode.id}:${marker.id}`),
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
  const list = window.document.querySelector('section')
  const edit = window.document.querySelector('button')
  const calls = []
  edit.addEventListener('click', () => calls.push('edit-clicked'))
  bindListKeyboard(list, {
    edit: () => edit.click(),
    move: (offset) => calls.push(`move:${offset}`)
  })

  list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp' }))
  list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }))
  list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }))
  assert.deepEqual(calls, ['move:-1', 'move:1', 'edit-clicked'])
})

test('annotation lists reuse rendered annotation blocks and track selection', () => {
  const { window } = new JSDOM()
  const calls = []
  const nodes = [
    { id: 'block-1', text: 'First source', feedback: 'First note', lineStart: 1, lineEnd: 1 },
    { id: 'block-2', text: 'Second source', feedback: 'Second note', lineStart: 2, lineEnd: 2 }
  ]
  const list = createList(window.document, {
    nodes,
    selectedId: 'block-2',
    context: () => ({ descriptor: '<p>' }),
    renderMarkdown: (value) => `<p>${value}</p>`,
    onSelect: (node) => calls.push(`select:${node.id}`),
    onEdit: (node) => calls.push(`edit:${node.id}`)
  })

  const blocks = list.querySelectorAll('.rendered-annotation--list')
  assert.equal(blocks.length, 2)
  assert.equal(blocks[1].classList.contains('is-selected'), true)
  assert.equal(blocks[1].querySelector('.rendered-annotation-body').textContent, 'Second note')
  blocks[1].click()
  blocks[1].querySelector('.rendered-annotation-edit').click()
  assert.deepEqual(calls, ['select:block-2', 'edit:block-2'])

  const readonlyList = createList(window.document, {
    nodes,
    selectedId: 'block-1',
    context: () => ({ descriptor: '<p>' }),
    renderMarkdown: (value) => `<p>${value}</p>`,
    onSelect: () => {}
  })
  assert.equal(readonlyList.querySelector('.rendered-annotation-edit'), null)
})

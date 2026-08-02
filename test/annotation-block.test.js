const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const {
  bindDismiss,
  bindSneakPeek,
  create,
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
    excerpt: 'The source block text',
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
  assert.equal(block.querySelector('.rendered-annotation-excerpt').textContent, 'Source context only')
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

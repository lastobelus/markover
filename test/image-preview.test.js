const test = require('node:test')
const assert = require('node:assert/strict')
const { labelFor, sourceLabel, sourceUrl } = require('../src/image-preview')

test('uses an image label with stable fallbacks', () => {
  assert.equal(labelFor({ id: 'img-2', label: 'Header spacing' }), 'Header spacing')
  assert.equal(labelFor({ id: 'img-2', label: '' }), 'img-2')
  assert.equal(labelFor({}), 'Image')
})

test('resolves source images from the reviewed document', () => {
  assert.equal(
    sourceUrl('../design/example image.png', '/tmp/markover/examples/sample.md'),
    'file:///tmp/markover/design/example%20image.png'
  )
  assert.equal(
    sourceUrl('/tmp/example image.png', '/tmp/markover/sample.md'),
    'file:///tmp/example%20image.png'
  )
  assert.equal(sourceUrl('https://example.com/image.png', null), 'https://example.com/image.png')
  assert.equal(sourceUrl('javascript:alert(1)', '/tmp/sample.md'), null)
  assert.equal(sourceUrl('./image.png', null), null)
})

test('labels source images from alt text or their basename', () => {
  assert.equal(sourceLabel('./diagram.png', 'Architecture diagram'), 'Architecture diagram')
  assert.equal(sourceLabel('../assets/diagram.png?raw=1', ''), 'diagram.png')
  assert.equal(sourceLabel('', ''), 'Image')
})

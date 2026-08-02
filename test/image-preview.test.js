const test = require('node:test')
const assert = require('node:assert/strict')
const { labelFor } = require('../src/image-preview')

test('uses an image label with stable fallbacks', () => {
  assert.equal(labelFor({ id: 'img-2', label: 'Header spacing' }), 'Header spacing')
  assert.equal(labelFor({ id: 'img-2', label: '' }), 'img-2')
  assert.equal(labelFor({}), 'Image')
})

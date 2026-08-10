import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const { labelFor, sourceLabel, sourceUrl } = require('../src/image-preview') as
  MarkoverImagePreviewApi

test('uses an image label with stable fallbacks', () => {
  assert.equal(labelFor({ id: 'img-2', label: 'Header spacing' }), 'Header spacing')
  assert.equal(labelFor({ id: 'img-2', label: '' }), 'img-2')
  assert.equal(labelFor({}), 'Image')
})

test('allows only CSP-safe source image URLs', () => {
  assert.equal(sourceUrl('../design/example image.png'), null)
  assert.equal(sourceUrl('/tmp/example image.png'), null)
  assert.equal(sourceUrl('https://example.com/image.png'), null)
  assert.equal(sourceUrl('data:image/png;base64,AA=='), 'data:image/png;base64,AA==')
  assert.equal(sourceUrl('javascript:alert(1)'), null)
  assert.equal(sourceUrl('./image.png'), null)
})

test('labels source images from alt text or their basename', () => {
  assert.equal(sourceLabel('./diagram.png', 'Architecture diagram'), 'Architecture diagram')
  assert.equal(sourceLabel('../assets/diagram.png?raw=1', ''), 'diagram.png')
  assert.equal(sourceLabel('', ''), 'Image')
})

test('renderer keeps source images inert until explicit preview', () => {
  const renderer = fs.readFileSync(
    path.resolve(__dirname, '../../src/renderer.ts'),
    'utf8'
  )
  const imageRule = renderer.match(
    /inlineMarkdown\.renderer\.rules\.image = [\s\S]*?\n\}/
  )?.[0] || ''

  assert.match(imageRule, /<button[^>]+data-image-source=/)
  assert.doesNotMatch(imageRule, /<img\b/)
  assert.match(
    renderer,
    /wireSourceImagePreviews[\s\S]*addEventListener\('click'[\s\S]*openSourceImagePreview/
  )
})

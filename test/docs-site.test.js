const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const projectDirectory = path.resolve(__dirname, '../..')
const html = fs.readFileSync(path.join(projectDirectory, 'docs/index.html'), 'utf8')
const script = fs.readFileSync(path.join(projectDirectory, 'docs/site.js'), 'utf8')
const styles = fs.readFileSync(path.join(projectDirectory, 'docs/styles.css'), 'utf8')
const guide = fs.readFileSync(path.join(projectDirectory, 'docs/guide/index.html'), 'utf8')
const readme = fs.readFileSync(path.join(projectDirectory, 'README.md'), 'utf8')
const readmeLeader = fs.readFileSync(path.join(projectDirectory, 'design/brand/markover-readme-leader.svg'), 'utf8')

const screenshots = [
  'markover-review-editor@2x.png',
  'markover-annotation-browser@2x.png',
  'markover-source-edit@2x.png',
  'markover-review-context@2x.png'
]

test('the Pages preview offers a navigable high-density screenshot gallery', () => {
  for (const screenshot of screenshots) {
    const filePath = path.join(projectDirectory, 'docs/assets', screenshot)
    assert.equal(fs.existsSync(filePath), true, `${screenshot} should exist`)
    const bytes = fs.readFileSync(filePath)
    const header = bytes.subarray(0, 24)
    assert.equal(header.readUInt32BE(16), 2360)
    assert.equal(header.readUInt32BE(20), 1520)
    const density = bytes.indexOf(Buffer.from('pHYs'))
    assert.notEqual(density, -1, `${screenshot} should declare its density`)
    assert.equal(bytes.readUInt32BE(density + 4), 5669)
    assert.equal(bytes.readUInt32BE(density + 8), 5669)
    assert.equal(bytes[density + 12], 1)
    assert.match(html, new RegExp(`data-src="\\./assets/${screenshot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
    assert.doesNotMatch(html, new RegExp(`\\ssrc="\\./assets/${screenshot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
  }

  assert.equal((html.match(/class="product-slide"/g) || []).length, 4)
  assert.match(html, /class="gallery-control gallery-previous"/)
  assert.match(html, /class="gallery-control gallery-next"/)
  assert.match(script, /function showSlide\(index\)/)
  assert.match(script, /event\.key === 'ArrowLeft'/)
  assert.match(script, /event\.key === 'ArrowRight'/)
})

test('the Pages gallery opens lazily and navigates with controls or arrows', () => {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.test/'
  })
  const { document, KeyboardEvent } = dom.window
  const dialog = document.querySelector('#product-preview')
  dialog.showModal = () => { dialog.open = true }
  dialog.close = () => { dialog.open = false }
  dom.window.eval(script)

  const slides = [...document.querySelectorAll('.product-slide')]
  const position = document.querySelector('#gallery-position')
  const currentIndex = () => slides.findIndex((slide) => !slide.hidden)

  assert.equal(slides.every((slide) => !slide.querySelector('img').hasAttribute('src')), true)
  document.querySelector('.product-preview-trigger').click()
  assert.equal(dialog.open, true)
  assert.equal(currentIndex(), 0)
  assert.equal(position.textContent, '1 / 4')
  assert.match(slides[0].querySelector('img').src, /markover-review-editor@2x\.png$/)
  assert.equal(slides[1].querySelector('img').hasAttribute('src'), false)

  document.querySelector('.gallery-next').click()
  assert.equal(currentIndex(), 1)
  assert.equal(position.textContent, '2 / 4')
  assert.match(slides[1].querySelector('img').src, /markover-annotation-browser@2x\.png$/)

  dialog.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowLeft',
    bubbles: true,
    cancelable: true
  }))
  assert.equal(currentIndex(), 0)

  document.querySelector('.gallery-previous').click()
  assert.equal(currentIndex(), 3)
  assert.equal(position.textContent, '4 / 4')
})

test('public surfaces use the standardized tagged logo arrangements', () => {
  assert.match(html, /class="footer-brand brand-lockup brand-lockup-horizontal"/)
  assert.match(html, /class="brand-lockup-logo" src="\.\/assets\/markover-lockup\.svg"/)
  assert.match(html, /class="brand-lockup-tagline">Structured review for Markdown\.<\/span>/)
  assert.doesNotMatch(html, /class="footer-brand"[^>]*>[\s\S]*?<span>Markover<\/span>/)

  assert.match(guide, /class="docs-brand brand-lockup brand-lockup-vertical"/)
  assert.match(guide, /class="brand-lockup-logo" src="\.\.\/assets\/markover-lockup\.svg"/)
  assert.match(guide, /class="brand-lockup-tagline">Structured review for Markdown\.<\/span>/)
  assert.doesNotMatch(guide, /class="docs-brand-row"/)

  assert.match(styles, /\.brand-lockup-horizontal \{[^}]*align-items: flex-end;/)
  assert.match(styles, /\.brand-lockup-vertical \{[^}]*flex-direction: column;[^}]*align-items: flex-start;/)

  assert.match(readme, /alt="Markover — Structured review for Markdown\."/)
  assert.match(readmeLeader, /<desc[^>]*>Structured review for Markdown\.<\/desc>/)
  assert.match(readmeLeader, /<text class="tagline" x="100" y="164">Structured review for Markdown\.<\/text>/)
})

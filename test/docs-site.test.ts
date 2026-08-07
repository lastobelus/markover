import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const projectDirectory = path.resolve(__dirname, '../..')
const html = fs.readFileSync(path.join(projectDirectory, 'docs/index.html'), 'utf8')
const scriptSource = fs.readFileSync(
  path.join(projectDirectory, 'docs/site.ts'),
  'utf8'
)
const script = fs.readFileSync(
  path.join(projectDirectory, 'build/docs/site.js'),
  'utf8'
)
const styles = fs.readFileSync(path.join(projectDirectory, 'docs/styles.css'), 'utf8')
const guide = fs.readFileSync(path.join(projectDirectory, 'docs/guide/index.html'), 'utf8')
const privacy = fs.readFileSync(
  path.join(projectDirectory, 'docs/privacy/index.html'),
  'utf8'
)
const readme = fs.readFileSync(path.join(projectDirectory, 'README.md'), 'utf8')
const readmeLeader = fs.readFileSync(path.join(projectDirectory, 'design/brand/markover-readme-leader.svg'), 'utf8')
const pagesWorkflow = fs.readFileSync(
  path.join(projectDirectory, '.github/workflows/pages.yml'),
  'utf8'
)

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
  assert.match(scriptSource, /function showSlide\(index: number\): void/)
  assert.match(scriptSource, /event\.key === 'ArrowLeft'/)
  assert.match(scriptSource, /event\.key === 'ArrowRight'/)
})

test('the Pages gallery opens lazily and navigates with controls or arrows', () => {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.test/'
  })
  const { document, KeyboardEvent } = dom.window
  const dialog = document.querySelector<HTMLDialogElement>('#product-preview')
  assert.ok(dialog)
  dialog.showModal = () => { dialog.open = true }
  dialog.close = () => { dialog.open = false }
  dom.window.eval(script)

  const slides = [...document.querySelectorAll<HTMLElement>('.product-slide')]
  const position = document.querySelector<HTMLElement>('#gallery-position')
  assert.ok(position)
  const currentIndex = () => slides.findIndex((slide) => !slide.hidden)
  const image = (index: number): HTMLImageElement => {
    const slide = slides[index]
    assert.ok(slide)
    const result = slide.querySelector<HTMLImageElement>('img')
    assert.ok(result)
    return result
  }

  assert.equal(slides.every((slide) => !image(slides.indexOf(slide)).hasAttribute('src')), true)
  const trigger = document.querySelector<HTMLElement>('.product-preview-trigger')
  assert.ok(trigger)
  trigger.click()
  assert.equal(dialog.open, true)
  assert.equal(currentIndex(), 0)
  assert.equal(position.textContent, '1 / 4')
  assert.match(image(0).src, /markover-review-editor@2x\.png$/)
  assert.equal(image(1).hasAttribute('src'), false)

  const next = document.querySelector<HTMLButtonElement>('.gallery-next')
  assert.ok(next)
  next.click()
  assert.equal(currentIndex(), 1)
  assert.equal(position.textContent, '2 / 4')
  assert.match(image(1).src, /markover-annotation-browser@2x\.png$/)

  dialog.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowLeft',
    bubbles: true,
    cancelable: true
  }))
  assert.equal(currentIndex(), 0)

  const previous = document.querySelector<HTMLButtonElement>('.gallery-previous')
  assert.ok(previous)
  previous.click()
  assert.equal(currentIndex(), 3)
  assert.equal(position.textContent, '4 / 4')
})

test('Pages deploys built docs when a documentation build input changes', () => {
  assert.match(
    pagesWorkflow,
    /push:\s+branches:\s+- main\s+paths:/
  )
  for (const buildInput of [
    'docs/**',
    '.github/workflows/pages.yml',
    'package.json',
    'package-lock.json',
    'scripts/copy-build-assets.ts',
    'tsconfig.json'
  ]) {
    assert.equal(pagesWorkflow.includes(`- '${buildInput}'`), true)
  }
  assert.match(pagesWorkflow, /workflow_dispatch:/)
  assert.match(pagesWorkflow, /contents: read\s+pages: write\s+id-token: write/)
  assert.match(pagesWorkflow, /run: npm ci/)
  assert.match(pagesWorkflow, /run: npm run build --silent/)
  assert.match(pagesWorkflow, /actions\/configure-pages@[0-9a-f]{40} # v5/)
  assert.match(pagesWorkflow, /actions\/upload-pages-artifact@[0-9a-f]{40} # v4/)
  assert.match(pagesWorkflow, /path: build\/docs/)
  assert.match(pagesWorkflow, /actions\/deploy-pages@[0-9a-f]{40} # v4/)
  assert.doesNotMatch(pagesWorkflow, /pull_request:/)
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

test('privacy and local-data claims stay linked to the public workflow', () => {
  assert.match(html, /href="\.\/privacy\/">Privacy/)
  assert.match(guide, /href="\.\.\/privacy\/">Privacy and local data/)
  assert.match(readme, /markover\/privacy\//)

  for (const section of [
    'local-only',
    'authorization',
    'stored',
    'locations',
    'discovery',
    'agent-handoff',
    'network',
    'retention'
  ]) {
    assert.match(privacy, new RegExp(`id="${section}"`))
  }
  assert.match(privacy, /0700/)
  assert.match(privacy, /service\.token/)
  assert.match(privacy, /no telemetry, analytics, cloud synchronization/)
  assert.match(privacy, /remote Markdown image starts as an inert preview button/)
  assert.match(privacy, /Discover agent thread from local session logs/)
  assert.match(privacy, /first quit Markover/)
  assert.match(privacy, /does not apply them to the original Markdown source/)
  assert.match(privacy, /outside Markover's control/)
})

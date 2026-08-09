import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const projectDirectory = path.resolve(__dirname, '../..')
const userDirectory = path.join(projectDirectory, 'docs/user')
const html = fs.readFileSync(path.join(userDirectory, 'index.html'), 'utf8')
const scriptSource = fs.readFileSync(
  path.join(userDirectory, 'site.ts'),
  'utf8'
)
const script = fs.readFileSync(
  path.join(projectDirectory, 'build/docs/user/site.js'),
  'utf8'
)
const styles = fs.readFileSync(path.join(userDirectory, 'styles.css'), 'utf8')
const guide = fs.readFileSync(path.join(userDirectory, 'guide/index.html'), 'utf8')
const agents = fs.readFileSync(path.join(userDirectory, 'agents/index.html'), 'utf8')
const privacy = fs.readFileSync(
  path.join(userDirectory, 'privacy/index.html'),
  'utf8'
)
const limitations = fs.readFileSync(
  path.join(userDirectory, 'limitations/index.html'),
  'utf8'
)
const developerIndex = fs.readFileSync(
  path.join(projectDirectory, 'docs/developer/README.md'),
  'utf8'
)
const developerSecurity = fs.readFileSync(
  path.join(projectDirectory, 'docs/developer/local-service-security.md'),
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
    const filePath = path.join(userDirectory, 'assets', screenshot)
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
  assert.match(pagesWorkflow, /path: build\/docs\/user/)
  assert.doesNotMatch(pagesWorkflow, /path: build\/docs\s/)
  assert.equal(
    fs.existsSync(path.join(projectDirectory, 'build/docs/user/index.html')),
    true
  )
  assert.equal(
    fs.existsSync(path.join(projectDirectory, 'build/docs/user/limitations/index.html')),
    true
  )
  assert.equal(
    fs.existsSync(path.join(projectDirectory, 'build/docs/user/agents/index.html')),
    true
  )
  assert.equal(
    fs.existsSync(path.join(projectDirectory, 'build/docs/user/.nojekyll')),
    true
  )
  assert.equal(
    fs.existsSync(path.join(projectDirectory, 'build/docs/user/developer')),
    false
  )
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
  assert.match(agents, /class="docs-brand brand-lockup brand-lockup-vertical"/)

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
    'durability',
    'network',
    'retention',
    'reinstall',
    'delete-one',
    'reset',
    'compatibility',
    'support'
  ]) {
    assert.match(privacy, new RegExp(`id="${section}"`))
  }
  assert.doesNotMatch(privacy, /0700|0600|service\.token|256-bit/)
  assert.match(privacy, /no telemetry, analytics, cloud synchronization/)
  assert.match(privacy, /remote Markdown image starts as an inert preview button/)
  assert.match(privacy, /Discover agent thread from local session logs/)
  assert.match(privacy, /Quit Markover/)
  assert.match(privacy, /Review → Move Review to Trash/)
  assert.match(privacy, /Review → Clean Up Unused Attachments/)
  assert.match(privacy, /Managed reviews and attachments remain until you remove them/)
  assert.match(privacy, /Open Markdown…<\/strong> creates a managed review/)
  assert.doesNotMatch(privacy, /Obsolete prototype review commands/)
  assert.match(privacy, /without changing or deleting the original Markdown document/)
  assert.doesNotMatch(privacy, /does not currently provide in-app review deletion/)
  assert.match(privacy, /does not apply them to the original Markdown source/)
  assert.match(privacy, /outside Markover's control/)
  assert.match(privacy, /Library\/Caches\/Markover/)
  assert.match(privacy, /Application Support\/Markover/)
  assert.match(privacy, /manually downloaded or copied <code>Markover\.app<\/code>/)
  assert.match(privacy, /Applications or Downloads/)
  assert.match(privacy, /two-second window by default/)
  assert.match(privacy, /two-second bound is suspended/)
  assert.match(privacy, /within five seconds/)
  assert.match(privacy, /autosaveMaximumDelayMs/)
  assert.match(privacy, /power loss, operating-system or hardware failure/)
  assert.match(privacy, /may not open every review created by an older version/)
  assert.match(privacy, /github\.com\/lastobelus\/markover\/discussions/)
})

test('user and developer documentation have explicit audience roots', () => {
  assert.equal(fs.existsSync(path.join(projectDirectory, 'docs/user/index.html')), true)
  assert.equal(fs.existsSync(path.join(projectDirectory, 'docs/developer/README.md')), true)
  assert.equal(fs.existsSync(path.join(projectDirectory, 'docs/index.html')), false)
  assert.equal(fs.existsSync(path.join(projectDirectory, 'docs/development.md')), false)
  assert.equal(fs.existsSync(path.join(projectDirectory, 'docs/releasing.md')), false)
  assert.equal(fs.existsSync(path.join(projectDirectory, 'docs/developer/releasing.md')), true)
  assert.equal(fs.existsSync(path.join(projectDirectory, 'docs/user/agents/index.html')), true)
  assert.match(readme, /docs\/developer\/README\.md/)
  assert.match(developerIndex, /User pages explain consequences\s+and actions/)
  assert.match(developerIndex, /Developer documentation may link to those pages/)
  assert.match(developerSecurity, /32-byte capability/)
  assert.match(developerSecurity, /POSIX mode `0700`/)
  assert.match(developerSecurity, /`service\.json` and `service\.token`/)
  assert.match(developerSecurity, /Authorization is checked before URL route handling/)
  assert.match(developerSecurity, /1,500 milliseconds apart/)
  assert.match(developerSecurity, /exponential\s+backoff capped at 30 seconds/)
  assert.match(developerSecurity, /Retry\s+Quit, Cancel Quit, or Quit Anyway/)
  assert.match(developerSecurity, /test\/durability-crash\.test\.ts/)
  assert.doesNotMatch(guide, /1,500 milliseconds|persistence budget|exponential backoff/)
  assert.match(guide, /Start a review with an agent/)
  assert.match(guide, /Tell your agent the review is ready/)
  assert.match(guide, /File → Open Markdown…/)
  assert.match(guide, /creates a managed local review/)
  assert.doesNotMatch(guide, /markover (?:open|get|edit)|review\.agentGuidance|Default policy/)
  assert.match(agents, /id="open"[\s\S]*markover open/)
  assert.match(agents, /id="get"[\s\S]*markover get/)
  assert.match(agents, /id="edit"[\s\S]*markover edit/)
  assert.match(agents, /review\.agentGuidance\.fixedContract/)
  assert.match(agents, /Human reviewers should start with/)
})

test('the early-preview contract is concise and consistent on user entry paths', () => {
  for (const source of [html, guide, readme]) {
    assert.match(source, /Early macOS preview/)
  }
  for (const source of [guide, readme, limitations]) {
    assert.match(source, /macOS 14 Sonoma/)
    assert.match(source, /Apple Silicon Macs/)
    assert.match(source, /issue #80|issues\/80/)
    assert.match(source, /Node\.js 22\.13\.0 or newer/)
    assert.match(source, /not Apple-verified/i)
    assert.match(source, /may not open every older review|may not open every review created by an older version/)
  }
  assert.match(guide, /href="\.\.\/limitations\/"/)
  assert.match(guide, /github\.com\/lastobelus\/markover\/discussions/)
  assert.match(readme, /markover\/limitations\//)
})

test('Markdown limitations distinguish selectable, whole-block, and extension behavior', () => {
  for (const section of [
    'structured',
    'whole-blocks',
    'extensions',
    'links-images',
    'source-preservation',
    'preview-boundary',
    'support'
  ]) {
    assert.match(limitations, new RegExp(`id="${section}"`))
  }
  assert.match(limitations, /YAML frontmatter/)
  assert.match(limitations, /internal rows, cells, and quoted children do not become separately selectable/)
  assert.match(limitations, /Footnotes, definition lists, strikethrough, raw HTML/)
  assert.match(limitations, /original Markdown/)
  assert.match(limitations, /Managed reviews and their unused attachments can be moved to the macOS Trash from Markover/)
  assert.doesNotMatch(limitations, /Review deletion and cache management currently use the manual procedures/)
  assert.doesNotMatch(limitations, /markdown-it|token mapping|node contract/)
})

test('every local user-documentation link and asset stays inside the user root', () => {
  const deployedUserDirectory = path.join(projectDirectory, 'build/docs/user')
  for (const relativePath of [
    'index.html',
    'agents/index.html',
    'guide/index.html',
    'limitations/index.html',
    'privacy/index.html'
  ]) {
    const filePath = path.join(deployedUserDirectory, relativePath)
    const dom = new JSDOM(fs.readFileSync(filePath, 'utf8'))
    const elements = dom.window.document.querySelectorAll<HTMLElement>(
      '[href], [src], [data-src]'
    )
    for (const element of elements) {
      for (const attribute of ['href', 'src', 'data-src']) {
        const target = element.getAttribute(attribute)
        if (!target || /^(?:https?:|#)/.test(target)) continue
        const localTarget = target.split(/[?#]/, 1)[0]
        if (!localTarget) continue
        let resolved = path.resolve(path.dirname(filePath), localTarget)
        if (localTarget.endsWith('/')) resolved = path.join(resolved, 'index.html')
        assert.equal(
          resolved.startsWith(`${deployedUserDirectory}${path.sep}`),
          true,
          `${relativePath}: ${attribute}=${target} escapes docs/user`
        )
        assert.equal(
          fs.existsSync(resolved),
          true,
          `${relativePath}: ${attribute}=${target} does not resolve`
        )
      }
    }
  }
})

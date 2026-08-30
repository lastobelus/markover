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
const compatibility = fs.readFileSync(
  path.join(userDirectory, 'compatibility/index.html'),
  'utf8'
)
const remoteAccess = fs.readFileSync(
  path.join(userDirectory, 'remote-access/index.html'),
  'utf8'
)
const compatibilityCatalog = JSON.parse(fs.readFileSync(
  path.join(userDirectory, 'compatibility/catalog.json'),
  'utf8'
)) as Record<string, unknown>
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

function contrastRatio(foreground: string, background: string): number {
  const luminance = (value: string): number => {
    const channels = value.match(/[0-9a-f]{2}/gi)?.map((channel) => (
      Number.parseInt(channel, 16) / 255
    ))
    assert.equal(channels?.length, 3)
    const linear = channels.map((channel) => (
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    ))
    return 0.2126 * (linear[0] ?? 0) +
      0.7152 * (linear[1] ?? 0) +
      0.0722 * (linear[2] ?? 0)
  }
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

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

test('README and Pages share one strongest product image', () => {
  const readmeScreenshots = [...readme.matchAll(
    /docs\/user\/assets\/(markover-[a-z-]+@2x\.png)/g
  )].map((match) => match[1])
  assert.deepEqual(readmeScreenshots, ['markover-review-editor@2x.png'])
  assert.match(
    readme,
    /alt="Markover in Ember Light showing the review inbox, a launch brief in the center document tree, and precise feedback with two labeled attachments\."/
  )
  assert.match(
    html,
    /href="\.\/assets\/markover-review-editor@2x\.png"/
  )
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

test('Pages deploys built docs and the update manifest for every main push', () => {
  assert.match(
    pagesWorkflow,
    /push:\s+branches:\s+- main\s+workflow_dispatch:/
  )
  assert.doesNotMatch(pagesWorkflow, /\n\s+paths:/)
  assert.match(pagesWorkflow, /workflow_dispatch:/)
  assert.match(
    pagesWorkflow,
    /contents: read\s+pull-requests: read\s+pages: write\s+id-token: write/
  )
  assert.match(pagesWorkflow, /run: npm ci/)
  assert.match(pagesWorkflow, /run: npm run build --silent/)
  assert.match(
    pagesWorkflow,
    /run: node build\/scripts\/generate-canonical-update-manifest\.js/
  )
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
    fs.existsSync(path.join(projectDirectory, 'build/docs/user/compatibility/catalog.json')),
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
  assert.match(html, /<nav class="footer-nav" aria-label="Footer navigation">/)
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

test('public surfaces inherit the current Ember Light visual roles', () => {
  assert.match(styles, /--muted: #6f6761;/)
  assert.match(styles, /--ground: #e8e2d8;/)
  assert.match(styles, /--paper: #f7f4ee;/)
  assert.match(styles, /--neutral-soft: #ece9e2;/)
  assert.match(styles, /--code: #262b2b;/)
  assert.match(styles, /--app-shell-background: var\(--ground\);/)
  assert.match(styles, /--app-header-background: var\(--app-shell-background\);/)
  assert.match(styles, /--left-pane-background: var\(--neutral-soft\);/)
  assert.match(styles, /--center-pane-background: var\(--paper\);/)
  assert.match(styles, /--right-pane-background: var\(--neutral-soft\);/)
  assert.match(styles, /font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;/)
  assert.doesNotMatch(styles, /Inter|Segoe UI|#eee8e0|#756d67|#2c2927/)
  assert.match(readmeLeader, /fill: #6f6761;/)
  assert.match(readmeLeader, /\.tagline \{ fill: #b7aaa3; \}/)
  assert.match(readmeLeader, /"SF Pro Text", system-ui, sans-serif/)
  assert.doesNotMatch(readmeLeader, /Segoe UI|#756d67/)

  for (const page of [
    html,
    guide,
    agents,
    privacy,
    limitations,
    compatibility,
    remoteAccess
  ]) {
    assert.match(page, /<meta name="theme-color" content="#e8e2d8">/)
    assert.doesNotMatch(page, /#eee8e0/)
  }
})

test('every public page offers a persistent system-aware Ember appearance switch', () => {
  const pages = [
    ['index.html', html],
    ['guide/index.html', guide],
    ['agents/index.html', agents],
    ['privacy/index.html', privacy],
    ['limitations/index.html', limitations],
    ['compatibility/index.html', compatibility],
    ['remote-access/index.html', remoteAccess]
  ] as const

  for (const [relativePath, source] of pages) {
    const document = new JSDOM(source).window.document
    const groups = [...document.querySelectorAll<HTMLElement>('.theme-switcher')]
    assert.equal(groups.length, relativePath === 'index.html' ? 1 : 2)
    for (const group of groups) {
      assert.equal(group.getAttribute('role'), 'group')
      assert.equal(group.getAttribute('aria-label'), 'Appearance')
      const buttons = [...group.querySelectorAll<HTMLButtonElement>('button')]
      assert.deepEqual(buttons.map((button) => button.dataset.appearanceChoice), ['light', 'dark'])
      assert.deepEqual(buttons.map((button) => button.getAttribute('aria-pressed')), ['false', 'false'])
      assert.deepEqual(buttons.map((button) => button.querySelector('svg')?.getAttribute('aria-hidden')), ['true', 'true'])
    }

    const initializer = source.indexOf("localStorage.getItem('markover-pages-appearance')")
    const stylesheet = source.indexOf('rel="stylesheet"')
    assert.ok(initializer > -1 && initializer < stylesheet, `${relativePath} should resolve appearance before CSS`)
    assert.match(source, /prefers-color-scheme: dark/)
    assert.match(source, /appearance === 'dark' \? '#242221' : '#e8e2d8'/)
    assert.match(source, relativePath === 'index.html'
      ? /<script src="\.\/site\.js"><\/script>/
      : /<script src="\.\.\/site\.js"><\/script>/)
  }

  assert.match(styles, /:root\[data-appearance="dark"\] \{[^}]*--brand-orange: #e5b8a8;[^}]*--brand-burgundy: #e5b8a8;[^}]*--ink: #dfdedd;[^}]*--muted: #aaa8a6;[^}]*--ground: #242221;[^}]*--paper: #161514;[^}]*--neutral-soft: #110e0a;[^}]*--surface: #0b0808;[^}]*--line: #4a3a34;[^}]*--code: #0e0e0e;/)
  for (const darkSurface of ['#242221', '#161514', '#110e0a', '#0b0808', '#2b2422', '#0e0e0e']) {
    assert.ok(
      contrastRatio('#e5b8a8', darkSurface) >= 4.5,
      `dark accent text on ${darkSurface} must meet 4.5:1`
    )
  }
  assert.ok(contrastRatio('#000000', '#c94e1f') >= 4.5)
  assert.ok(contrastRatio('#dfdedd', '#6d211f') >= 4.5)
  assert.ok(contrastRatio('#ffffff', '#6d211f') >= 4.5)
  assert.match(styles, /:root\[data-appearance="dark"\] \.button-deep:hover \{[^}]*border-color: var\(--brand-burgundy\);[^}]*background: var\(--brand-orange\);/)
  assert.match(styles, /:root\[data-appearance="dark"\] \.button-outline \{[^}]*border-color: var\(--brand-burgundy\);[^}]*color: var\(--brand-burgundy\);/)
  assert.match(styles, /:root\[data-appearance="dark"\] \.product-dialog-header,[^}]*\.gallery-control:hover \{[^}]*background: var\(--markover-secondary\);/)
  assert.match(styles, /:root\[data-appearance="dark"\] \.gallery-position,[^}]*\.dialog-close:hover \{[^}]*color: var\(--ink\);/)
  assert.equal(
    [...styles.matchAll(/background:\s*var\(--brand-(?:orange|burgundy)\)/g)].length,
    5,
    'every branded public background must remain covered by the dark pairing checks'
  )
  assert.match(styles, /\.theme-choice\[aria-pressed="true"\]/)
  assert.match(styles, /\.theme-choice:focus-visible/)
  assert.match(styles, /\.docs-sidebar \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;[^}]*scrollbar-gutter: stable;/)
  for (const name of ['markover-mark', 'markover-logotype', 'markover-lockup']) {
    assert.equal(
      fs.existsSync(path.join(userDirectory, 'assets', `${name}-dark.svg`)),
      false,
      'Ember Dark should use the same canonical brand artwork as the app'
    )
  }
  assert.doesNotMatch(scriptSource, /-dark\.svg|replace\([^)]*\.svg/)
})

test('the Pages appearance control applies and persists an explicit choice', () => {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.test/'
  })
  const { document } = dom.window
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: false,
      addEventListener: () => undefined
    })
  })
  dom.window.localStorage.setItem('markover-pages-appearance', 'dark')
  dom.window.eval(script)

  assert.equal(document.documentElement.dataset.appearance, 'dark')
  assert.equal(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content, '#242221')
  assert.equal(document.querySelector<HTMLButtonElement>('[data-appearance-choice="dark"]')?.getAttribute('aria-pressed'), 'true')
  assert.match(document.querySelector<HTMLImageElement>('.brand-logotype')?.src ?? '', /markover-logotype\.svg$/)

  const light = document.querySelector<HTMLButtonElement>('[data-appearance-choice="light"]')
  assert.ok(light)
  light.click()
  assert.equal(dom.window.localStorage.getItem('markover-pages-appearance'), 'light')
  assert.equal(document.documentElement.dataset.appearance, 'light')
  assert.equal(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content, '#e8e2d8')
  assert.equal(light.getAttribute('aria-pressed'), 'true')
  assert.match(document.querySelector<HTMLImageElement>('.brand-logotype')?.src ?? '', /markover-logotype\.svg$/)
})

test('the Pages appearance follows the system only until a user chooses', () => {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.test/'
  })
  let changeListener: ((event: { matches: boolean }) => void) | undefined
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: true,
      addEventListener: (
        type: string,
        listener: (event: { matches: boolean }) => void
      ) => {
        if (type === 'change') changeListener = listener
      }
    })
  })
  dom.window.localStorage.setItem('markover-pages-appearance', 'sepia')
  dom.window.eval(script)
  assert.equal(dom.window.document.documentElement.dataset.appearance, 'dark')

  assert.ok(changeListener)
  changeListener({ matches: false })
  assert.equal(dom.window.document.documentElement.dataset.appearance, 'light')

  dom.window.document.querySelector<HTMLButtonElement>('[data-appearance-choice="dark"]')?.click()
  changeListener({ matches: false })
  assert.equal(dom.window.document.documentElement.dataset.appearance, 'dark')
})

test('the Pages hero depicts the current App header and three-pane layout', () => {
  const document = new JSDOM(html).window.document
  const frame = document.querySelector('.product-frame')
  assert.ok(frame)
  const shell = frame.querySelector(':scope > .window-titlebar + .app-shell')
  assert.ok(shell)
  const appHeader = shell.querySelector(':scope > .app-header')
  assert.ok(appHeader)
  assert.equal(
    appHeader.querySelector<HTMLImageElement>('.mock-app-brand img')?.getAttribute('src'),
    './assets/markover-lockup.svg'
  )
  assert.equal(appHeader.querySelector('.mock-app-brand span'), null)
  const paneLayout = shell.querySelector(':scope > .pane-layout')
  assert.ok(paneLayout)
  assert.deepEqual(
    [...paneLayout.children].map((element) => element.className),
    ['left-pane', 'center-pane', 'right-pane']
  )
  assert.match(paneLayout.querySelector('.left-pane')?.textContent || '', /Inbox/)
  assert.match(paneLayout.querySelector('.center-pane')?.textContent || '', /Document tree/)
  assert.match(paneLayout.querySelector('.right-pane')?.textContent || '', /Selected block/)
  assert.doesNotMatch(html, /product-toolbar|product-workspace|tree-preview|feedback-preview|checksum/i)

  assert.match(styles, /\.left-pane \{ background: var\(--left-pane-background\); \}/)
  assert.match(styles, /\.center-pane \{[^}]*background: var\(--center-pane-background\);/)
  assert.match(styles, /\.right-pane \{ background: var\(--right-pane-background\); \}/)
  assert.match(styles, /\.mock-app-brand img \{ width: 92px; \}/)
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.left-pane \{ display: none; \}/)
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*?\.hero-actions \{ justify-content: center; flex-wrap: nowrap;/)
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*?\.mock-app-brand \{ grid-column: 1 \/ -1; \}/)
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*?\.demo-copy h2 \{ font-size: 28px;/)
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*?\.demo-media > \.demo-disclosure \{ font-size: 8\.5px; line-height: 1\.5; \}/)
  assert.match(styles, /\.site-footer \.brand-lockup-horizontal \.brand-lockup-logo \{ width: 150px; \}/)
  assert.match(styles, /@media \(max-width: 1040px\)[\s\S]*?\.site-footer \{ grid-template-columns: 1fr; justify-items: center; \}/)
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.footer-nav \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
  assert.doesNotMatch(styles, /backdrop-filter|linear-gradient|radial-gradient/)
})

test('privacy and local-data claims stay linked to the public workflow', () => {
  assert.match(html, /href="\.\/privacy\/">Privacy/)
  assert.match(guide, /href="\.\.\/privacy\/">Privacy and local data/)
  assert.match(readme, /markover\/privacy\//)

  for (const section of [
    'local-only',
    'authorization',
    'remote-client',
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
  assert.match(privacy, /Allow the authorized remote Markover client/)
  assert.match(privacy, /does not configure your tailnet policy/)
  assert.match(privacy, /Certificate Transparency logs/)
  assert.match(privacy, /does not read that path or run Git beside it/)
  assert.match(privacy, /Only an embedded <code>data:<\/code> image can open/)
  assert.match(privacy, /HTTP\(S\) URLs remain unavailable/)
  assert.match(privacy, /makes no network request/)
  assert.match(privacy, /Discover agent thread from local session logs/)
  assert.match(privacy, /Read current titles from T3/)
  assert.match(privacy, /Read current titles from Codex/)
  assert.match(privacy, /Titles are kept in memory only/)
  assert.match(privacy, /it does not poll or watch the database/)
  assert.match(privacy, /local repository roots stay out of the handoff/)
  assert.match(privacy, /not a copy or path of the scanned logs/)
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
  assert.match(privacy, /byte-for-byte backup/)
  assert.match(privacy, /official compatibility catalog/)
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
  assert.equal(fs.existsSync(path.join(projectDirectory, 'docs/user/remote-access/index.html')), true)
  assert.match(readme, /docs\/developer\/README\.md/)
  assert.match(developerIndex, /User pages explain consequences\s+and actions/)
  assert.match(developerIndex, /Developer documentation may link to those pages/)
  assert.match(developerSecurity, /32-byte capability/)
  assert.match(developerSecurity, /POSIX mode `0700`/)
  assert.match(developerSecurity, /`service\.json` and `service\.token`/)
  assert.match(developerSecurity, /Authorization is checked before URL route handling/)
  assert.match(developerSecurity, /Tailscale-App-Capabilities/)
  assert.match(developerSecurity, /lastobelus\.com\/cap\/markover-remote-client/)
  assert.match(developerSecurity, /Every other method or route receives authenticated `404`/)
  assert.match(
    developerSecurity,
    /saved opt-in cannot meet those checks during startup[\s\S]*turns it off and continues/
  )
  assert.match(
    developerSecurity,
    /Request JSON is capped at 16 MiB and response JSON at 32 MiB/
  )
  assert.match(developerSecurity, /Only an embedded `data:` image can open/)
  assert.match(developerSecurity, /HTTP\(S\) URLs, and malformed\s+sources remain unavailable/)
  assert.match(developerSecurity, /makes no network request/)
  assert.match(developerSecurity, /1,500 milliseconds apart/)
  assert.match(developerSecurity, /exponential\s+backoff capped at 30 seconds/)
  assert.match(developerSecurity, /Retry\s+Quit, Cancel Quit, or Quit Anyway/)
  assert.match(developerSecurity, /test\/durability-crash\.test\.ts/)
  assert.doesNotMatch(guide, /1,500 milliseconds|persistence budget|exponential backoff/)
  assert.match(guide, /Start a review with an agent/)
  assert.match(guide, /Tell your agent the review is ready/)
  assert.match(guide, /tailnet-only Tailscale Serve example/)
  assert.match(guide, /File → Open Markdown…/)
  assert.match(guide, /creates a managed local review/)
  assert.match(guide, /open <strong>Review context<\/strong>/)
  assert.match(guide, /copy the <strong>Review ID<\/strong>/)
  assert.match(guide, /agent did not create that review and does not already know its ID/)
  assert.doesNotMatch(guide, /markover (?:open|get|edit)|review\.agentGuidance|Default policy/)
  assert.match(agents, /id="open"[\s\S]*markover open/)
  assert.match(agents, /id="get"[\s\S]*markover get/)
  assert.match(agents, /id="edit"[\s\S]*markover edit/)
  assert.match(agents, /id="revise"[\s\S]*markover revise/)
  assert.match(agents, /id="done"[\s\S]*markover done/)
  assert.match(agents, /pullRequestStatus/)
  assert.match(agents, /review\.agentGuidance\.fixedContract/)
  assert.match(agents, /thread-host-kind/)
  assert.match(agents, /Validate the handoff before reading it/)
  assert.match(agents, /official compatibility catalog/)
  assert.match(agents, /Human reviewers should start with/)
})

test('the public Tailscale example is additive and keeps local routing private', () => {
  assert.match(remoteAccess, /tailscale serve status --json/)
  assert.match(remoteAccess, /tailscale funnel status --json/)
  assert.match(remoteAccess, /Tailscale 1\.92 or newer/)
  assert.match(remoteAccess, /tailscale version/)
  assert.match(remoteAccess, /--accept-app-caps=lastobelus\.com\/cap\/markover-remote-client/)
  assert.match(remoteAccess, /DEDICATED_HTTPS_PORT='replace-with-an-unused-port'/)
  assert.match(remoteAccess, /http:\/\/127\.0\.0\.1:39831/)
  assert.match(remoteAccess, /An unavailable backend is still owned/)
  assert.match(remoteAccess, /Every pre-existing Serve handler is unchanged/)
  assert.match(remoteAccess, /Funnel has no grant for the Markover port/)
  assert.doesNotMatch(remoteAccess, /8443/)
  assert.doesNotMatch(remoteAccess, /https:\/\/[^<\s]*\.ts\.net/)
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
    assert.match(source, /Released review schemas\s+are converted automatically with an original backup/)
  }
  assert.match(guide, /href="\.\.\/limitations\/"/)
  assert.match(guide, /github\.com\/lastobelus\/markover\/discussions/)
  assert.match(readme, /markover\/limitations\//)
})

test('the compatibility catalog maps released schemas without guessing', () => {
  assert.match(compatibility, /official mapping/)
  assert.match(compatibility, /Unreleased prototype shapes are not compatibility targets/)
  assert.match(compatibility, /byte-for-byte backup/)
  assert.equal(compatibilityCatalog.format, 'markover-review-compatibility')
  assert.equal(compatibilityCatalog.version, 1)
  assert.match(JSON.stringify(compatibilityCatalog), /markover-review/)
  assert.match(JSON.stringify(compatibilityCatalog), /firstMarkoverRelease/)
})

test('Markdown limitations publish the behavior-level compatibility boundary', () => {
  for (const section of [
    'matrix',
    'links-images',
    'source-preservation',
    'preview-boundary',
    'support'
  ]) {
    assert.match(limitations, new RegExp(`id="${section}"`))
  }
  assert.match(limitations, /not a claim of blanket CommonMark/)
  assert.match(limitations, /Source precision/)
  assert.match(limitations, /compact raw text uses <code>\\n<\/code> line separators/)
  assert.match(limitations, /CRLF or CR separators/)
  assert.match(limitations, /YAML frontmatter/)
  assert.match(limitations, /Opaque single block/)
  assert.match(limitations, /Visible uninterpreted text/)
  assert.match(limitations, /Source-only content/)
  assert.match(limitations, /valid standalone link definition has no review block/)
  assert.match(limitations, /short caret-prefixed form/)
  assert.match(limitations, /\[\^note\]: Note/)
  assert.match(limitations, /Only an embedded <code>data:<\/code> image can open/)
  assert.match(limitations, /HTTP\(S\) URLs remain unavailable/)
  assert.match(limitations, /makes no network request/)
  assert.match(limitations, /exact reviewed Markdown/)
  assert.match(limitations, /Managed reviews and their unused attachments can be moved to the macOS Trash from Markover/)
  assert.doesNotMatch(limitations, /Review deletion and cache management currently use the manual procedures/)
  assert.doesNotMatch(limitations, /markdown-it|token mapping|node contract/)
})

test('every local user-documentation link and asset stays inside the user root', () => {
  const deployedUserDirectory = path.join(projectDirectory, 'build/docs/user')
  for (const relativePath of [
    'index.html',
    'agents/index.html',
    'compatibility/index.html',
    'guide/index.html',
    'limitations/index.html',
    'privacy/index.html',
    'remote-access/index.html'
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

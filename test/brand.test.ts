import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('canonical brand SVGs use only the normalized semantic inks', () => {
  for (const name of ['markover-mark.svg', 'markover-logotype.svg', 'markover-lockup.svg']) {
    const source = read(`design/brand/${name}`)
    assert.doesNotMatch(source, /rgb\(/)
    const fills = [...source.matchAll(/style="fill:(#[0-9a-f]{6})"/g)]
      .map((match) => match[1])
    assert.ok(fills.length > 0)
    assert.deepEqual([...new Set(fills)].sort(), ['#6d211f', '#c94e1f'])
  }
})

test('production icon assets preserve the approved mark treatment', () => {
  const favicon = read('favicon.svg')
  const mark = read('design/brand/markover-mark.svg')
  const appIcon = read('design/brand/markover-app-icon.svg')
  const appIconPng = fs.readFileSync(path.join(root, 'design/brand/markover-app-icon.png'))
  const main = read('src/main.ts')

  assert.match(favicon, /viewBox="0 0 365 308"/)
  assert.deepEqual(
    [...favicon.matchAll(/style="fill:(#[0-9a-f]{6})"/g)].map((match) => match[1]),
    [...mark.matchAll(/style="fill:(#[0-9a-f]{6})"/g)].map((match) => match[1])
  )
  assert.match(appIcon, /viewBox="0 0 1024 1024"/)
  assert.match(appIcon, /<rect x="100" y="100" width="824" height="824" rx="186"[^>]*fill="#fffaf4"/)
  assert.match(appIcon, /<svg x="223" y="268" width="578" height="488"/)
  assert.deepEqual(appIconPng.subarray(1, 4).toString(), 'PNG')
  assert.equal(appIconPng.readUInt32BE(16), 1024)
  assert.equal(appIconPng.readUInt32BE(20), 1024)
  assert.equal(
    crypto.createHash('sha256').update(appIconPng).digest('hex'),
    'eb9e6459ded7f8e89fc5b534dcccd657504a7cca45c691be37cb4bede3730a2e'
  )
  assert.match(
    main,
    /const appIconPath = path\.isAbsolute\(addressedInstance\.branding\.iconPngPath\)[\s\S]*path\.join\(projectDirectory, addressedInstance\.branding\.iconPngPath\)/
  )
  assert.match(main, /new BrowserWindow\(\{[\s\S]*icon: appIconPath,/)
  assert.match(
    main,
    /process\.platform === 'darwin' && developmentRuntime && !smokeMode\)[\s\S]*app\.dock\.setIcon\(appIconPath\)/
  )
})

test('the branding mockup is a self-contained local artifact bundle', () => {
  const entryPath = path.join(root, 'design/brand/mockups/index.html')
  const html = fs.readFileSync(entryPath, 'utf8')
  const localTargets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((target): target is string => target !== undefined)
    .filter((target) => !target.startsWith('#') && !/^[a-z]+:/i.test(target))

  assert.ok(localTargets.length > 0)
  for (const target of localTargets) {
    assert.equal(target.includes('..'), false, `${target} must not escape the artifact directory`)
    assert.equal(
      fs.existsSync(path.resolve(path.dirname(entryPath), target)),
      true,
      `${target} must resolve inside the artifact bundle`
    )
  }
})

test('the app composes external brand assets and exposes a true empty state', () => {
  const html = read('src/index.html')
  const renderer = read('src/renderer.ts')

  assert.match(html, /class="brand" role="img" aria-label="Markover"/)
  assert.match(html, /<img[\s\S]*id="brand-mark"[\s\S]*src="\.\.\/design\/brand\/markover-lockup\.svg"/)
  assert.doesNotMatch(html, /id="brand-logotype"/)
  assert.match(html, /design\/brand\/markover-lockup\.svg/)
  assert.match(html, /id="app-empty-state-lockup"/)
  assert.equal(html.includes('>M/</'), false)
  assert.match(html, /<header id="app-header" class="app-header is-empty">/)
  assert.match(html, /<div id="app-shell" class="app-shell">[\s\S]*<header id="app-header" class="app-header is-empty">/)
  assert.match(html, /<main id="app-empty-state" class="app-empty-state">/)
  assert.match(html, /<main id="pane-layout" class="pane-layout" hidden>/)
  assert.match(renderer, /function setAppEmptyState\(empty: boolean\): void/)
  assert.match(
    renderer,
    /async function activateReview\([\s\S]*reviewId: string[\s\S]*Promise<ReviewActivationOutcome> \{[\s\S]*setAppEmptyState\(false\)/
  )
  assert.match(renderer, /setAppEmptyState\(true\)/)
  assert.doesNotMatch(renderer, /SAMPLE_MARKDOWN/)
})

test('the application palette matches the brand brief at startup and in CSS', () => {
  const styles = read('src/styles.css')
  const main = read('src/main.ts')
  const renderer = read('src/renderer.ts')
  const reviewInbox = read('src/review-inbox.ts')

  for (const token of [
    '--markover-primary: #c94e1f',
    '--markover-secondary: #6d211f',
    '--brand-orange: var(--markover-primary)',
    '--brand-burgundy: var(--markover-secondary)',
    '--ink: #26211e',
    '--muted: #6f6761',
    '--paper: #f7f4ee',
    '--surface: #fffdf9',
    '--line: #ddd5cc',
    '--brand-soft: #f5e3da'
  ]) assert.match(styles, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  for (const token of [
    '--markover-primary: #075b7a',
    '--markover-secondary: #02b7e3',
    '--markover-primary: #4e5828',
    '--markover-secondary: #b5d52a'
  ]) assert.match(styles, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  assert.match(styles, /:root\[data-appearance="dark"\]/)
  assert.match(styles, /data-colorization="mid"/)
  assert.match(styles, /data-colorization="low"/)
  assert.match(read('src/preload.ts'), /getBrandAssets: \(\) => invoke\('brand:assets'\)/)
  assert.match(main, /function loadBrandAssets\(\)[\s\S]*markover-mark\.svg[\s\S]*markover-logotype\.svg[\s\S]*markover-lockup\.svg/)
  assert.match(renderer, /function themedBrandSource\([\s\S]*source: string,[\s\S]*primary: string,[\s\S]*secondary: string[\s\S]*\): string/)
  assert.match(renderer, /replaceAll\('#c94e1f', primary\)[\s\S]*replaceAll\('#6d211f', secondary\)/)
  assert.match(renderer, /finally \{\s*document\.documentElement\.classList\.add\('is-brand-ready'\)/)
  assert.match(styles, /\.is-brand-ready :is\(\.brand-mark, \.app-empty-state-lockup\)/)
  assert.match(styles, /data-palette="olive"\]:not\(\[data-appearance="dark"\]\)[\s\S]*--app-shell-background: #dde1d2;[\s\S]*--app-header-background: var\(--app-shell-background\);[\s\S]*--center-pane-background: var\(--paper\);/)
  assert.match(styles, /\.review-tab-strip \{[^}]*display: none;/)
  assert.doesNotMatch(styles, /\.review-tab-strip \{[^}]*border-bottom:/)
  assert.match(reviewInbox, /if \(status === 'revised'\) return 'Revised'/)
  assert.match(reviewInbox, /if \(status === 'done'\) return 'Done'/)
  assert.doesNotMatch(styles, /\.review-list-row::before/)
  assert.match(styles, /--status-progress: #d89b35;/)
  assert.match(styles, /data-appearance="dark"[\s\S]*--status-editing: color-mix\(in srgb, var\(--markover-primary\) 70%, white\);/)

  assert.doesNotMatch(styles, /\.brand-logotype \{/)
  assert.match(main, /backgroundColor: windowBackground\(/)
})

test('the working header aligns the brand and exact review identity', () => {
  const styles = read('src/styles.css')
  const renderer = read('src/renderer.ts')
  const html = read('src/index.html')

  assert.match(styles, /\.brand \{[^}]*align-items: flex-end;[^}]*transform: translateY\(6px\);/)
  assert.match(styles, /\.button-primary \{[^}]*background: var\(--primary-button-bg\);/)
  assert.match(styles, /\.review-id-activation \{[^}]*justify-content: center;/)
  assert.match(styles, /\.review-id-activation input \{[^}]*font: 10px\/1 var\(--font-mono\)/)
  assert.match(styles, /\.document-review-id \{[^}]*min-width: max-content;[^}]*font: 9px\/1\.2 var\(--font-mono\)/)
  assert.match(styles, /\.center-pane > \.pane-header \{[^}]*grid-template-columns: auto minmax\(max-content, 1fr\) auto;/)
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*\.center-pane > \.pane-header \{[^}]*padding-inline: 5px;[^}]*grid-template-columns: minmax\(max-content, 1fr\) auto;[\s\S]*\.document-tree-header-actions \.status-pill \{\s*display: none;/
  )
  assert.match(styles, /\.pane\.focus-within > \.pane-header::before \{[^}]*top: 0;[^}]*height: 4px;/)
  assert.match(renderer, /documentReviewId\.textContent = review\.id/)
  assert.match(renderer, /documentReviewId\.ariaLabel = `Copy review ID \$\{review\.id\}`/)
  assert.doesNotMatch(styles, /\.document-tab(?:-|\s|\.)/)
  assert.doesNotMatch(styles, /\.document-meta (?:strong|span) \{[^}]*max-width:/)
  assert.doesNotMatch(renderer, /checksum\.slice\(/)
  assert.doesNotMatch(renderer, /rightPaneEyebrow/)
  assert.ok(
    html.indexOf('class="annotation-view-tabs"') <
      html.indexOf('class="pane-header annotation-selection-header"')
  )
  assert.match(html, />Selected block<\/button>/)
  assert.doesNotMatch(styles, /\.documents-list-header::before \{/)
  assert.match(styles, /\.review-navigation-tab \{[^}]*border-top: 1px solid var\(--line\);[^}]*border-bottom: 1px solid var\(--line\);/)
  assert.match(html, /class="documents-list-header"[\s\S]*class="pane-header-leading"[\s\S]*class="eyebrow">Reviews/)
  assert.match(styles, /data-appearance="dark"[\s\S]*--pane-label-color: color-mix\([\s\S]*--pane-label-inactive: color-mix\(/)
  assert.match(styles, /\.annotation-view-tabs button \{[^}]*color: var\(--pane-label-inactive\);/)
  assert.match(styles, /\.annotation-view-tabs button:hover:not\(\.is-active\):not\(:disabled\) \{[^}]*color: var\(--pane-label-hover\);/)
  assert.match(styles, /\.annotation-view-tabs button\.is-active \{[^}]*color: var\(--pane-label-color\);/)
  assert.match(styles, /\.annotation-view-tabs button\.is-active::after \{[^}]*height: 1px;[^}]*background: currentColor;/)
  assert.match(styles, /--keyboard-help-background: color-mix\([\s\S]*var\(--app-shell-background\) 92%/)
  assert.match(styles, /\.keyboard-help \{[^}]*background: var\(--keyboard-help-background\);/)
  assert.match(styles, /--right-pane-column-width: minmax\(360px, 0\.7fr\);/)
  assert.match(styles, /grid-template-columns:[^;]*var\(--right-pane-column-width\);/)
  assert.match(html, /id="right-pane-resizer"[\s\S]*role="separator"[\s\S]*aria-label="Resize right pane"[\s\S]*aria-valuemin="360"[\s\S]*tabindex="0"/)
  assert.match(styles, /\.right-pane-resizer \{[^}]*cursor: col-resize;[^}]*touch-action: none;/)
  assert.match(styles, /\.right-pane-resizer:focus-visible::after/)
  assert.match(renderer, /beginRightPaneResize[\s\S]*setPointerCapture[\s\S]*applyRightPaneWidth/)
  assert.match(renderer, /resizeRightPaneFromKeyboard[\s\S]*ArrowLeft[\s\S]*ArrowRight[\s\S]*shiftKey \? 48 : 16/)
  assert.match(renderer, /rightPaneResizer\.addEventListener\(\s*'keydown',[\s\S]*resizeRightPaneFromKeyboard/)
  assert.match(html, /id="left-pane-resizer"[\s\S]*role="separator"[\s\S]*aria-valuemin="150"[\s\S]*tabindex="0"/)
  assert.match(renderer, /resizeLeftPaneFromKeyboard[\s\S]*ArrowLeft[\s\S]*ArrowRight[\s\S]*shiftKey \? 48 : 16/)
  assert.match(renderer, /leftPaneResizer\.addEventListener\(\s*'keydown',[\s\S]*resizeLeftPaneFromKeyboard/)
  assert.match(renderer, /event\.key === 'F6'[\s\S]*MarkoverNavigation\.nextPane/)
  assert.doesNotMatch(
    renderer,
    /document\.addEventListener\('keydown',[\s\S]*if \(event\.key === 'Tab'\) \{\s*event\.preventDefault\(\)/
  )
  assert.match(renderer, /setAppEmptyState[\s\S]*requestAnimationFrame[\s\S]*applyRightPaneWidth\(\)/)
  assert.match(renderer, /renderDocumentsList[\s\S]*classList\.toggle\('has-left-pane'[\s\S]*applyRightPaneWidth\(\)/)
  assert.match(renderer, /schedulePaneLayoutResizeUpdate[\s\S]*updatePinnedSelection\(\)[\s\S]*updateTruncation/)
  assert.match(renderer, /beginLeftPaneResize[\s\S]*applyLeftPaneWidth\(\)[\s\S]*schedulePaneLayoutResizeUpdate\(\)/)
  assert.match(renderer, /beginRightPaneResize[\s\S]*applyRightPaneWidth\(\)[\s\S]*schedulePaneLayoutResizeUpdate\(\)/)
  assert.doesNotMatch(html, /id="scrollbar-row-cover"/)
  assert.doesNotMatch(renderer, /ScrollbarRowCover/)
  assert.match(styles, /\.block-row\.is-selected::after \{[^}]*linear-gradient\(/)
  assert.match(styles, /\.left-pane \{[^}]*grid-column: 1;/)
  assert.match(styles, /\.center-pane \{[^}]*grid-column: 2;/)
  assert.match(styles, /\.right-pane \{[^}]*grid-column: 3;/)
})

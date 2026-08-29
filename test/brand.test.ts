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
    '--markover-secondary: #b8cb6e'
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
  assert.match(styles, /data-palette="olive"\]:not\(\[data-appearance="dark"\]\)[\s\S]*--app-shell-background: #dee1d7;[\s\S]*--app-header-background: var\(--app-shell-background\);[\s\S]*--center-pane-background: var\(--paper\);/)
  assert.match(styles, /data-palette="ocean"\]:not\(\[data-appearance="dark"\]\) \{[^}]*--paper: #f4f3f0;[^}]*--neutral-soft: #e9e7e2;/)
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

test('the floating theme-token inspector uses canonical structure and component roles', () => {
  const html = read('src/index.html')
  const renderer = read('src/renderer.ts')
  const styles = read('src/styles.css')

  assert.match(html, /id="theme-token-inspector" class="theme-token-inspector" hidden/)
  assert.match(html, />Theme tokens</)
  assert.doesNotMatch(html, />App header background</)
  assert.doesNotMatch(html, />Code block background</)
  assert.doesNotMatch(html, /Surface blend token|Token share vs --paper/)
  assert.match(html, /id="theme-token-inspector-show-document-checksum" type="checkbox"/)
  assert.match(html, /id="document-checksum" hidden/)
  assert.match(renderer, /installThemeTokenInspector\(startupInfo\)/)
  assert.match(renderer, /startupInfo\.development[\s\S]*inspector\.hidden = false/)
  assert.match(renderer, /showDocumentChecksum\.addEventListener\('change',[\s\S]*elements\.checksum\.hidden = !showDocumentChecksum\.checked/)
  assert.doesNotMatch(`${html}\n${renderer}\n${styles}`, /interface-tuner/)

  for (const token of [
    '--app-shell-background',
    '--app-header-background',
    '--left-pane-background',
    '--center-pane-background',
    '--right-pane-background'
  ]) {
    assert.match(renderer, new RegExp(`t\\('${token}'\\)`))
  }
  assert.match(renderer, /\['App structure', \[/)
  assert.match(renderer, /const owners = new Map<string, string>\(\)/)
  assert.match(renderer, /colorProbe\.style\.backgroundColor = `var\(\$\{row\.name\}\)`/)
  assert.match(renderer, /getComputedStyle\(colorProbe\)\.backgroundColor/)
  assert.match(renderer, /const owner = owners\.get\(colorKey\)/)
  assert.match(renderer, /row\.value\.textContent = owner \|\| customPropertyValue \|\| renderedColor/)
  assert.match(renderer, /if \(!owner\) owners\.set\(colorKey, row\.name\)/)
  assert.match(renderer, /t\('--danger-button-bg'\)/)
  assert.match(renderer, /t\('--danger-button-hover'\)/)
  assert.match(renderer, /t\('--danger-button-text'\)/)
  assert.match(renderer, /attributeFilter: \['data-palette', 'data-appearance', 'data-colorization'\]/)
  assert.doesNotMatch(renderer, /setProperty\('--app-header-background'/)
  assert.doesNotMatch(renderer, /codeBlockBackground/)
  assert.doesNotMatch(renderer, /setProperty\('--document-tree-code-background'/)
  assert.doesNotMatch(`${html}\n${renderer}\n${styles}`, /surface-blend/)
  assert.match(styles, /\.review-resolution-content \{[^}]*--app-scrollbar-track-background: var\(--surface\);[^}]*background: var\(--surface\);/)
  assert.match(styles, /\.review-resolution-summary \{[^}]*background: transparent;/)
  assert.doesNotMatch(styles, /\.review-resolution-summary(?::first-child)? \{[^}]*border-(?:top|bottom):/)
  assert.doesNotMatch(styles, /\.review-resolution-summary \{[^}]*border-radius:/)
  assert.match(styles, /\.review-resolution-row-copy strong \{[^}]*color: var\(--muted\);[^}]*font-size: 12px;/)
  assert.match(styles, /\.review-resolution-summaries \{[^}]*padding: 4px 26px 10px 34px;/)
  assert.match(styles, /\.review-resolution-annotation-count \{[^}]*width: 24px;[^}]*height: 24px;[^}]*border: 1px solid var\(--markover-primary\);[^}]*border-radius: 999px;[^}]*color: var\(--markover-primary\);[^}]*background: var\(--primary-contrast\);[^}]*font: 650 8px\/1 var\(--font-sans\);/)
  assert.match(renderer, /annotationCount\.textContent = String\(review\.blocks\.length\)/)
  assert.match(styles, /\.button-secondary \{[^}]*background: var\(--surface\);/)
  assert.match(styles, /\.button-tertiary \{[^}]*background: var\(--paper\);/)
  assert.match(html, /id="open-button" class="button button-tertiary"/)
  assert.match(html, /id="incoming-review-dialog-open"[\s\S]*class="button button-tertiary"/)
  assert.match(html, /id="review-resolution-cancel" class="button button-tertiary"/)
  assert.match(html, /id="review-trash-cancel" class="button button-tertiary"/)
  assert.match(renderer, /const expandable = review\.blocks\.length > 0[\s\S]*document\.createElement\(expandable \? 'details' : 'div'\)/)

  for (const token of [
    '--theme-token-inspector-background: var(--surface)',
    '--theme-token-inspector-border-color: var(--line)',
    '--theme-token-inspector-shadow-color: var(--shadow)',
    '--theme-token-inspector-foreground: var(--ink)',
    '--theme-token-inspector-muted-foreground: var(--muted)',
    '--theme-token-inspector-control-background: var(--input)'
  ]) {
    assert.match(styles, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(`${renderer}\n${styles}`, /theme-token-inspector-duplicate/)
  assert.match(styles, /\.theme-token-inspector-tokens \{[\s\S]*grid-template-columns: 18px minmax\(0, 1fr\) minmax\(0, 1fr\);/)
  assert.match(styles, /\.theme-token-inspector-token \{\s*display: contents;/)
  assert.doesNotMatch(styles, /\.theme-token-inspector-token span \{[^}]*max-width:/)
  assert.match(styles, /--danger-button-bg: var\(--source-error\);/)
  assert.match(styles, /--danger-button-text: var\(--primary-contrast\);/)
  assert.match(styles, /data-appearance="dark"[\s\S]*--danger-button-text: var\(--code\);/)
  assert.match(styles, /data-palette="ember"\]\[data-appearance="dark"\]\[data-colorization\] \{[^}]*--paper: #161514;[^}]*--surface: #0b0808;[^}]*--surface-rgb: 11 8 8;[^}]*--neutral-soft: #110e0a;[^}]*--input: #181818;[^}]*--ground: #242221;[^}]*--line: #212121;[^}]*--selection-line: var\(--brand-soft\);[^}]*--primary-contrast: #000;[^}]*--pane-label-color: var\(--markover-secondary\);[^}]*--pane-label-inactive: color-mix\([\s\S]*var\(--pane-label-color\) 50%,[\s\S]*var\(--right-pane-background\)[\s\S]*--pane-label-highlight: var\(--pane-label-inactive\);[^}]*--pane-label-hover: color-mix\([\s\S]*var\(--pane-label-color\) 80%,[\s\S]*var\(--right-pane-background\)/)
  assert.match(styles, /data-palette="ocean"\]\[data-appearance="dark"\] \{[^}]*--primary-contrast: #000;/)
  assert.match(styles, /data-palette="ocean"\]\[data-appearance="dark"\]\[data-colorization\] \{[^}]*--app-header-background: black;[^}]*--paper: #101618;[^}]*--surface: #161c1f;[^}]*--surface-rgb: 22 28 31;[^}]*--neutral-soft: #0b0d0e;/)
  assert.match(styles, /data-palette="olive"\]:not\(\[data-appearance="dark"\]\) \{[^}]*--surface: #f9f7f2;[^}]*--surface-rgb: 249 247 242;[^}]*--brand-soft: #fbf9ea;[^}]*--accent-deep: var\(--markover-primary\);[^}]*--window-background: #d6dbc8;[^}]*--document-tree-code-foreground: var\(--markover-primary\);/)
  assert.match(styles, /--document-tree-code-background: var\(--surface\);/)
  assert.match(styles, /--document-tree-code-foreground: var\(--accent-deep\);/)
  assert.doesNotMatch(styles, /data-appearance="dark"[\s\S]*--document-tree-code-background:/)
  assert.match(styles, /\.block-content\.code \{[^}]*background: var\(--document-tree-code-background\);/)
  assert.match(styles, /\.block-row\.is-selected \.block-content\.code \{\s*background: var\(--brand-soft\);/)
  assert.match(styles, /\.block-row\.is-selected \.block-content\.code \{[^}]*box-shadow: inset 0 0 0 1px var\(--accent\);/)
  assert.match(styles, /data-palette="ember"\]:not\(\[data-appearance="dark"\]\)[\s\S]*:is\(\.block-row:hover, \.block-row\.is-selected\) \.block-content\.code \{[^}]*background: var\(--paper\);/)
  assert.match(styles, /data-palette="olive"\]:not\(\[data-appearance="dark"\]\)[\s\S]*\.block-row\.is-selected \.block-content\.code \{[^}]*background: var\(--surface\);[^}]*box-shadow: none;/)
  assert.match(styles, /\.block-row\.is-selected \{[^}]*background: var\(--primary-contrast\);/)
  assert.match(styles, /\.block-content\.code code \{[^}]*overflow-wrap: anywhere;[^}]*white-space: pre-wrap;/)
  assert.doesNotMatch(styles, /\.block-row:has\(\.block-content\.code\) \{[^}]*background:/)
  assert.match(renderer, /node\.type === 'code'\) kind\.append\(markoverIcon\('code-xml'\)\)/)
  assert.match(styles, /\.block-kind \.lucide-icon \{[^}]*width: 12px;[^}]*height: 12px;/)
  assert.match(styles, /\.source-header \{[^}]*background: var\(--paper\);/)
  assert.match(styles, /\.selected-source \{[^}]*background: var\(--surface\);/)
  assert.match(styles, /--annotation-readonly-background: var\(--center-pane-background\);/)
  assert.match(styles, /\.annotation-readonly \{[^}]*background: var\(--annotation-readonly-background\);/)
  assert.match(renderer, /t\('--annotation-readonly-background'\)/)
  assert.doesNotMatch(`${renderer}\n${styles}`, /--input-muted/)
  assert.match(styles, /\.instance-badge \{[^}]*border: 1px solid var\(--line\);[^}]*background: var\(--paper\);/)
  assert.match(html, /id="theme-token-inspector-show-incoming-review"[^>]*>\s*Show incoming-review dialog/)
  assert.match(renderer, /showIncomingReview\.addEventListener\('click', showIncomingReviewPreview\)/)
  assert.match(styles, /\.review-filter \{[^}]*background-color: var\(--paper\);/)
  assert.match(styles, /\.selected-location \{[^}]*background: var\(--paper\);/)
  assert.match(styles, /\.review-context-button \{[^}]*border: 1px solid var\(--markover-primary\);[^}]*color: var\(--markover-primary\);[^}]*background: var\(--surface\);/)
  assert.match(styles, /\.review-context-button:hover,[\s\S]*border-color: var\(--markover-primary\);[^}]*color: var\(--markover-primary\);/)
  assert.doesNotMatch(styles, /\.review-context-button\.has-metadata-error/)
  assert.match(styles, /\.document-tree-header-actions \.status-pill \{[^}]*background: var\(--surface\);/)
  assert.match(styles, /\.document-tree-view-toggle \{[^}]*background: var\(--surface\);/)
  assert.match(styles, /\.source-action \{[^}]*background: var\(--surface\);/)
  assert.match(styles, /\.status-pill \{[^}]*background: var\(--paper\);/)
  assert.match(styles, /\.block-row:hover \{[^}]*background: var\(--surface\);/)
  assert.match(styles, /--ground: #e8e2d8;/)
  assert.match(styles, /--document-tree-row-hover-border: var\(--ground\);/)
  assert.match(styles, /\.block-row:hover \{[^}]*border-color: var\(--document-tree-row-hover-border\);/)
  assert.doesNotMatch(`${renderer}\n${styles}`, /--hover-line/)
  assert.match(styles, /\.pane-icon-button \{[^}]*color: var\(--pane-label-inactive\);/)
  assert.match(styles, /\.pane-icon-button:hover:not\(:disabled\) \{[^}]*color: var\(--pane-label-color\);[^}]*background: var\(--paper\);/)
  assert.match(
    styles,
    /\.annotation-list \.rendered-annotation\.is-selectable:hover \{[^}]*linear-gradient\([\s\S]*var\(--right-pane-background\),[\s\S]*var\(--paper\) 10px/
  )
  assert.match(styles, /\.inline-image \{[^}]*background: var\(--surface\);/)
  assert.match(styles, /\.rendered-annotation-attachment \{[^}]*background: var\(--surface\);/)
  assert.doesNotMatch(styles, /\.source-panel \{[^}]*background:/)
  assert.match(styles, /\.source-diff \{[^}]*background: var\(--surface\);/)
  assert.match(styles, /\.inbox-prototype-development-badge \{[^}]*background: var\(--paper\);/)
  assert.match(styles, /\.inbox-prototype-review-id-activation input \{[^}]*background: var\(--paper\);/)
  assert.doesNotMatch(styles, /rgb\(var\(--surface-rgb\) \/ (?:72|78)%\)/)
  for (const token of [
    '--app-scrollbar-thumb-background',
    '--app-scrollbar-thumb-hover-background',
    '--document-tree-scrollbar-track-background',
    '--documents-list-scrollbar-track-background',
    '--annotation-views-scrollbar-track-background',
    '--review-context-scrollbar-track-background',
    '--theme-token-inspector-scrollbar-track-background'
  ]) {
    assert.match(renderer, new RegExp(`t\\('${token}'\\)`))
  }
  assert.match(
    styles,
    /\*::-webkit-scrollbar \{[^}]*width: 9px;[^}]*height: 9px;/
  )
  assert.match(
    styles,
    /\*::-webkit-scrollbar-thumb \{[^}]*border: 0 solid transparent;[^}]*border-radius: 999px;[^}]*background: var\(--app-scrollbar-thumb-background\);[^}]*background-clip: content-box;/
  )
  assert.match(styles, /\*::-webkit-scrollbar-thumb:vertical \{[^}]*border-right-width: 1px;[^}]*border-left-width: 1px;/)
  assert.match(styles, /\*::-webkit-scrollbar-thumb:horizontal \{[^}]*border-top-width: 1px;[^}]*border-bottom-width: 1px;/)
  assert.match(styles, /\.selected-annotation-view \{[^}]*overflow-y: auto;/)
  assert.match(styles, /\.theme-token-inspector \{[\s\S]*color: var\(--theme-token-inspector-foreground\);[\s\S]*background: var\(--theme-token-inspector-background\);/)
})

test('the working header aligns the brand and exact review identity', () => {
  const styles = read('src/styles.css')
  const renderer = read('src/renderer.ts')
  const html = read('src/index.html')
  const leftPane = html.slice(
    html.indexOf('<aside id="left-pane"'),
    html.indexOf('</aside>', html.indexOf('<aside id="left-pane"'))
  )

  assert.match(styles, /\.app-header-bar \{[^}]*min-height: 67px;[^}]*padding: 10px 22px 8px 12px;/)
  assert.match(styles, /\.brand \{[^}]*align-items: flex-end;[^}]*transform: translateY\(6px\);/)
  assert.match(styles, /\.brand-mark \{[^}]*width: calc\(161px \* var\(--brand-scale, 0\.82\)\);/)
  assert.match(styles, /\.review-list-row-open \{[^}]*padding: 6px 9px 6px 6px;/)
  assert.match(styles, /\.button-primary \{[^}]*background: var\(--primary-button-bg\);/)
  assert.match(styles, /\.review-id-activation \{[^}]*border-radius: 999px;[^}]*background: var\(--neutral-soft\);/)
  assert.match(styles, /\.review-id-activation input \{[^}]*font: 10px\/1 var\(--font-mono\)/)
  assert.match(styles, /\.review-id-activation input \{[^}]*background: var\(--surface\);/)
  assert.match(styles, /\.review-id-activation button \{[^}]*background: var\(--surface\);/)
  assert.match(styles, /#review-id-copy \{[^}]*background: var\(--paper\);/)
  assert.match(styles, /\.document-review-id \{[^}]*min-width: max-content;[^}]*font: 10px\/1\.2 var\(--font-mono\)/)
  assert.match(styles, /\.center-pane > \.pane-header \{[^}]*grid-template-columns: auto minmax\(max-content, 1fr\) auto;/)
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*\.center-pane > \.pane-header \{[^}]*padding-inline: 5px;[^}]*grid-template-columns: minmax\(max-content, 1fr\) auto;[\s\S]*\.document-tree-header-actions \.status-pill \{\s*display: none;/
  )
  assert.match(styles, /\.pane\.focus-within > \.pane-header::before \{[^}]*top: 0;[^}]*height: 4px;/)
  assert.match(renderer, /documentReviewId\.textContent = review\.id/)
  assert.match(renderer, /documentReviewId\.ariaLabel = `Show controls for review ID \$\{review\.id\}`/)
  assert.doesNotMatch(styles, /\.document-tab(?:-|\s|\.)/)
  assert.doesNotMatch(styles, /\.document-meta (?:strong|span) \{[^}]*max-width:/)
  assert.match(styles, /\.document-meta \{[^}]*right: var\(--right-pane-column-width, 360px\);[^}]*left: var\(--left-pane-column-width, 0px\);[^}]*align-items: center;/)
  assert.match(renderer, /appHeader\.style\.setProperty\(\s*'--left-pane-column-width'/)
  assert.match(renderer, /appHeader\.style\.setProperty\(\s*'--right-pane-column-width'/)
  assert.match(
    renderer,
    /function installThemeTokenInspector\(startupInfo: StartupInfo\)[\s\S]*startupInfo\.development &&[\s\S]*startupInfo\.elementCallouts &&[\s\S]*inspector\.hidden = false/
  )
  assert.doesNotMatch(renderer, /checksum\.slice\(/)
  assert.doesNotMatch(renderer, /rightPaneEyebrow/)
  assert.ok(
    html.indexOf('id="annotation-view-selected"') <
      html.indexOf('class="pane-header annotation-selection-header"')
  )
  assert.match(html, />Selected block<\/button>/)
  assert.doesNotMatch(styles, /\.documents-list-header::before \{/)
  assert.match(html, /class="review-navigation-tabs pane-view-tabs"[^>]*role="tablist"/)
  assert.match(html, /id="review-navigation-inbox"[\s\S]*role="tab"[\s\S]*aria-selected="true"/)
  assert.match(html, /id="review-inbox-count" class="review-inbox-count">\(0\)<\/span>/)
  assert.match(styles, /\.review-navigation-bar \{[^}]*align-items: center;/)
  assert.match(styles, /\.pane-header h2 \{[^}]*color: var\(--muted\);[^}]*font: 600 16px\/1 var\(--font-sans\);[^}]*transform: translate\(-50%, -50%\);/)
  assert.match(styles, /\.review-navigation-bar > \.left-pane-disclosure \{[^}]*transform: translateY\(5px\);/)
  assert.match(styles, /\.review-navigation-tabs \{[^}]*gap: 6px;[^}]*padding: 0 6px 0 8px;/)
  assert.match(html, /class="review-navigation-bar"[\s\S]*id="review-navigation-projects"[\s\S]*id="left-pane-collapse"/)
  assert.doesNotMatch(leftPane, /id="review-list-count"|class="eyebrow">Reviews/)
  assert.doesNotMatch(renderer, /reviewListCount/)
  assert.match(styles, /data-appearance="dark"[\s\S]*--pane-label-color: color-mix\([\s\S]*--pane-label-inactive: color-mix\(/)
  assert.match(styles, /\.pane-view-tabs \{[^}]*min-height: 28px;/)
  assert.match(styles, /\.pane-view-tabs > button \{[^}]*min-height: 28px;[^}]*padding: 12px 0 0;[^}]*color: var\(--pane-label-inactive\);/)
  assert.match(styles, /\.pane-view-tabs > button:hover:not\(\.is-active\):not\(:disabled\) \{[^}]*color: var\(--pane-label-hover\);/)
  assert.match(styles, /\.pane-view-tabs > button\.is-active \{[^}]*color: var\(--pane-label-color\);/)
  assert.match(styles, /\.pane-view-tabs > button\.is-active::after \{[^}]*bottom: 0;[^}]*height: 1px;[^}]*background: currentColor;/)
  assert.match(styles, /\.left-pane:focus-within > \.review-navigation-bar::before \{[^}]*background: var\(--markover-secondary\);/)
  assert.match(styles, /\.pane:focus > \.pane-header::before,[\s\S]*background: var\(--markover-secondary\);/)
  assert.match(styles, /\.right-pane:focus > \.annotation-view-tabs::before,[\s\S]*background: var\(--markover-secondary\);/)
  assert.match(styles, /\.pane-layout:has\(\.right-pane:focus-within\) \.center-pane > \.pane-header::after,[\s\S]*border-top: 4px solid var\(--markover-secondary\);/)
  assert.match(renderer, /setReviewNavigationMode[\s\S]*aria-selected/)
  assert.match(renderer, /moveReviewNavigationTabFromKeyboard[\s\S]*ArrowLeft[\s\S]*ArrowRight/)
  assert.match(styles, /--keyboard-help-background: var\(--neutral-soft\);/)
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
  assert.match(
    renderer,
    /event\.key === 'PageUp'[\s\S]*event\.key === 'PageDown'[\s\S]*elements\.tree\.scrollBy[\s\S]*elements\.tree\.clientHeight/
  )
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
  assert.match(renderer, /centerPane\.classList\.toggle\([\s\S]*'has-tree-scrollbar'[\s\S]*tree\.scrollHeight > elements\.tree\.clientHeight/)
  assert.match(styles, /\.center-pane:not\(\.has-tree-scrollbar\) \{\s*--tree-gutter: 0px;/)
  assert.match(styles, /\.center-pane:not\(\.has-tree-scrollbar\) > \.pane-header::after \{\s*display: none;/)
  assert.match(styles, /\.center-pane:not\(\.has-tree-scrollbar\) \.tree::-webkit-scrollbar \{\s*width: 0;\s*height: 0;/)
  assert.doesNotMatch(styles, /\.center-pane:focus > \.pane-header::after/)
  assert.match(styles, /\.block-row\.is-selected::after \{[^}]*linear-gradient\(/)
  assert.match(styles, /\.left-pane \{[^}]*grid-column: 1;/)
  assert.match(styles, /\.center-pane \{[^}]*grid-column: 2;/)
  assert.match(styles, /\.right-pane \{[^}]*grid-column: 3;/)
})

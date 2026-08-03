const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

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
  const main = read('src/main.js')

  assert.match(favicon, /viewBox="0 0 365 308"/)
  assert.deepEqual(
    [...favicon.matchAll(/style="fill:(#[0-9a-f]{6})"/g)].map((match) => match[1]),
    [...mark.matchAll(/style="fill:(#[0-9a-f]{6})"/g)].map((match) => match[1])
  )
  assert.match(appIcon, /viewBox="0 0 1024 1024"/)
  assert.match(appIcon, /<rect[^>]*rx="224"[^>]*fill="#fffaf4"/)
  assert.match(appIcon, /<svg x="164" y="218" width="696" height="588"/)
  assert.deepEqual(appIconPng.subarray(1, 4).toString(), 'PNG')
  assert.equal(appIconPng.readUInt32BE(16), 1024)
  assert.equal(appIconPng.readUInt32BE(20), 1024)
  assert.match(main, /const appIconPath = path\.join\(projectDirectory, 'design\/brand\/markover-app-icon\.png'\)/)
  assert.match(main, /new BrowserWindow\(\{[\s\S]*icon: appIconPath,/)
  assert.match(main, /process\.platform === 'darwin'\) app\.dock\.setIcon\(appIconPath\)/)
})

test('the branding mockup is a self-contained local artifact bundle', () => {
  const entryPath = path.join(root, 'design/brand/mockups/index.html')
  const html = fs.readFileSync(entryPath, 'utf8')
  const localTargets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
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
  const renderer = read('src/renderer.js')

  assert.match(html, /class="brand" role="img" aria-label="Markover"/)
  assert.match(html, /<img[\s\S]*id="brand-mark"[\s\S]*src="\.\.\/design\/brand\/markover-mark\.svg"/)
  assert.match(html, /<img[\s\S]*id="brand-logotype"[\s\S]*src="\.\.\/design\/brand\/markover-logotype\.svg"/)
  assert.match(html, /design\/brand\/markover-lockup\.svg/)
  assert.match(html, /id="empty-workspace-lockup"/)
  assert.equal(html.includes('>M/</'), false)
  assert.match(html, /<header class="app-header is-empty">/)
  assert.match(html, /<main id="empty-workspace" class="empty-workspace">/)
  assert.match(html, /<main id="workspace" class="workspace" hidden>/)
  assert.match(renderer, /function setWorkspaceEmpty\(empty\)/)
  assert.match(renderer, /function activateReview\(reviewId\) \{\s*setWorkspaceEmpty\(false\)/)
  assert.match(renderer, /setWorkspaceEmpty\(true\)/)
  assert.doesNotMatch(renderer, /SAMPLE_MARKDOWN/)
})

test('the application palette matches the brand brief at startup and in CSS', () => {
  const styles = read('src/styles.css')
  const main = read('src/main.js')
  const renderer = read('src/renderer.js')

  for (const token of [
    '--markover-primary: #c94e1f',
    '--markover-secondary: #6d211f',
    '--brand-orange: var(--markover-primary)',
    '--brand-burgundy: var(--markover-secondary)',
    '--ink: #26211e',
    '--muted: #756d67',
    '--paper: #eee8e0',
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
  assert.match(read('src/preload.js'), /getBrandAssets: \(\) => ipcRenderer\.invoke\('brand:assets'\)/)
  assert.match(main, /function loadBrandAssets\(\)[\s\S]*markover-mark\.svg[\s\S]*markover-logotype\.svg[\s\S]*markover-lockup\.svg/)
  assert.match(renderer, /function themedBrandSource\(source, primary, secondary\)/)
  assert.match(renderer, /replaceAll\('#c94e1f', primary\)[\s\S]*replaceAll\('#6d211f', secondary\)/)
  assert.match(renderer, /finally \{\s*document\.documentElement\.classList\.add\('is-brand-ready'\)/)
  assert.match(styles, /\.is-brand-ready :is\(\.brand-mark, \.brand-logotype, \.empty-workspace-lockup\)/)
  assert.match(styles, /data-palette="olive"\]:not\(\[data-appearance="dark"\]\)[\s\S]*--app-header-bg: #dde1d2;[\s\S]*--document-tabs-bg: #e8eadf;[\s\S]*--document-tree-bg: #fff;/)
  assert.match(styles, /\.document-tabs \{[^}]*border-top: 1px solid var\(--line\);/)
  assert.doesNotMatch(styles, /\.document-tabs \{[^}]*border-bottom:/)
  assert.match(renderer, /fill="var\(--status-editing\)"/)
  assert.match(renderer, /fill="var\(--status-pending\)"/)
  assert.match(renderer, /stroke="var\(--status-outline\)"/)
  assert.match(styles, /--status-progress: #d89b35;/)
  assert.match(styles, /data-appearance="dark"[\s\S]*--status-editing: color-mix\(in srgb, var\(--markover-primary\) 70%, white\);/)

  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.brand-logotype \{\s*display: none;/)
  assert.match(main, /backgroundColor: windowBackground\(/)
})

test('the working header aligns the brand and uses the primary action color', () => {
  const styles = read('src/styles.css')
  const renderer = read('src/renderer.js')
  const html = read('src/index.html')

  assert.match(styles, /\.brand \{[^}]*align-items: flex-end;[^}]*transform: translateY\(6px\);/)
  assert.match(styles, /\.button-primary \{[^}]*background: var\(--primary-button-bg\);/)
  assert.match(styles, /\.document-tab-status \{[^}]*background: var\(--brand-orange\);/)
  assert.match(styles, /\.document-tab-status\.is-pending \{[^}]*background: var\(--brand-burgundy\);/)
  assert.match(styles, /\.document-tab\.is-active \{[^}]*color: var\(--brand-orange\);/)
  assert.match(styles, /\.document-tab \+ \.document-tab \{[^}]*border-left: 1px solid var\(--surface\);/)
  assert.match(styles, /\.document-tab \{[^}]*max-width: 320px;[^}]*justify-content: center;/)
  assert.match(styles, /\.document-tab\.is-active::before \{[^}]*top: -1px;[^}]*height: 4px;[^}]*background: var\(--accent\);/)
  assert.match(styles, /\.pane\.focus-within > \.pane-header::before \{[^}]*top: -1px;[^}]*height: 4px;/)
  assert.match(styles, /\.document-tab-name \{[^}]*font-weight: 400;/)
  assert.match(styles, /\.document-tab-overflow \{[^}]*height: 30px;/)
  assert.match(styles, /\.document-tab-overflow-menu \{[^}]*top: 30px;/)
  assert.match(renderer, /session\.reviewId !== state\.reviewId[\s\S]*button\.title = `\$\{session\.documentName\}\\n\$\{session\.checksum\}`/)
  assert.doesNotMatch(styles, /\.document-meta (?:strong|span) \{[^}]*max-width:/)
  assert.doesNotMatch(renderer, /checksum\.slice\(/)
  assert.doesNotMatch(renderer, /annotationPaneEyebrow/)
  assert.ok(
    html.indexOf('class="annotation-view-tabs"') <
      html.indexOf('class="pane-header annotation-selection-header"')
  )
  assert.match(html, />Selected block<\/button>/)
  assert.match(styles, /\.documents-list-header::before \{[^}]*top: -1px;[^}]*height: 1px;/)
  assert.match(html, /class="documents-list-header"[\s\S]*class="pane-header-leading"[\s\S]*class="eyebrow">Documents/)
  assert.match(styles, /data-appearance="dark"[\s\S]*--pane-label-color: color-mix\([\s\S]*--pane-label-inactive: color-mix\(/)
  assert.match(styles, /\.annotation-view-tabs button \{[^}]*color: var\(--pane-label-inactive\);/)
  assert.match(styles, /\.annotation-view-tabs button:hover:not\(\.is-active\):not\(:disabled\) \{[^}]*color: var\(--pane-label-hover\);/)
  assert.match(styles, /\.annotation-view-tabs button\.is-active \{[^}]*color: var\(--pane-label-color\);/)
  assert.match(styles, /\.annotation-view-tabs button\.is-active::after \{[^}]*height: 1px;[^}]*background: currentColor;/)
  assert.match(styles, /\.keyboard-help \{[^}]*background: color-mix\(in srgb, var\(--app-header-bg\) 92%, transparent\);/)
  assert.match(styles, /grid-template-columns:[^;]*minmax\(360px, 0\.7fr\);/)
})

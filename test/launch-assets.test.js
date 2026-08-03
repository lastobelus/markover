const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const bytes = (relativePath) => fs.readFileSync(path.join(root, relativePath))
const sha256 = (contents) => crypto.createHash('sha256').update(contents).digest('hex')
const manifest = JSON.parse(read('doc/launch/issue-16/launch-manifest.json'))

function pngDimensions(contents) {
  assert.equal(contents.subarray(1, 4).toString(), 'PNG')
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20)
  }
}

test('launch manifest preserves the agreed repository metadata', () => {
  assert.equal(manifest.issue, 16)
  assert.equal(manifest.phase, 'focused-preview')
  assert.equal(manifest.canonicalDescriptor, 'Structured review for Markdown.')
  assert.deepEqual(manifest.repository, {
    description: 'Local-first macOS app for reviewing agent-produced Markdown and returning structured, block-level feedback to the agent thread.',
    homepage: 'https://lastobelus.github.io/markover/',
    topics: [
      'markdown',
      'document-review',
      'annotations',
      'ai-agents',
      'coding-agents',
      'codex',
      'local-first',
      'macos',
      'electron',
      'developer-tools'
    ],
    socialPreview: 'docs/assets/markover-github-social-preview.png'
  })
  assert.deepEqual(manifest.profilePins, [
    'lastobelus/markover',
    'lastobelus/lastCode'
  ])
  assert.equal(manifest.release.currentPublicTag, 'v0.1.1')
  assert.equal(manifest.release.focusedPreviewTag, null)
  assert.deepEqual(manifest.release.blockedByIssues, [10, 11])
  assert.equal(manifest.announcement.community, 'r/codex')
  assert.equal(
    manifest.announcement.title,
    'I built a little Electron app for reviewing agent-written Markdown block by block'
  )
})

test('social-card sources and outputs match the launch manifest', () => {
  const canonicalLockup = manifest.assets.canonicalLockup
  assert.equal(sha256(bytes(canonicalLockup.path)), canonicalLockup.sha256)

  for (const name of ['githubSocialPreview', 'pagesSocialCard']) {
    const asset = manifest.assets[name]
    const source = bytes(asset.source)
    const output = bytes(asset.output)
    assert.equal(sha256(source), asset.sourceSha256)
    assert.equal(sha256(output), asset.outputSha256)
    assert.deepEqual(pngDimensions(output), {
      width: asset.width,
      height: asset.height
    })
    if (asset.maximumBytes) assert.ok(output.length < asset.maximumBytes)

    const svg = source.toString('utf8')
    assert.match(svg, new RegExp(`width="${asset.width}" height="${asset.height}"`))
    assert.match(svg, /design\/brand\/markover-lockup\.svg/)
    assert.match(svg, /Structured review for Markdown\./)
    assert.doesNotMatch(svg, /gradient/i)
  }

  const productImage = manifest.assets.canonicalProductImage
  assert.equal(sha256(bytes(productImage.path)), productImage.sha256)
})

test('Pages publishes complete large-card metadata', () => {
  for (const page of ['docs/index.html', 'docs/guide/index.html']) {
    const html = read(page)
    assert.match(html, /property="og:type" content="website"/)
    assert.match(html, /property="og:site_name" content="Markover"/)
    assert.match(html, /property="og:title"/)
    assert.match(html, /property="og:description"/)
    assert.match(html, /property="og:url"/)
    assert.match(
      html,
      /property="og:image" content="https:\/\/lastobelus\.github\.io\/markover\/assets\/markover-pages-social-card\.png"/
    )
    assert.match(html, /property="og:image:width" content="1200"/)
    assert.match(html, /property="og:image:height" content="630"/)
    assert.match(html, /name="twitter:card" content="summary_large_image"/)
    assert.match(html, /name="twitter:image:alt"/)
  }
})

test('public setup surfaces use the exact current release and warn about npm', () => {
  const releaseUrl = `https://github.com/lastobelus/markover/releases/download/${manifest.release.currentPublicTag}/markover-cli.tgz`
  const publicSources = [
    read('README.md'),
    read('docs/guide/index.html')
  ]
  for (const source of publicSources) {
    assert.match(source, new RegExp(releaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(source, /releases\/latest\/download\/markover-cli\.tgz/)
    assert.match(source, /public npm package named (?:<code>)?`?markover/)
    assert.match(source, /Node\.js 22\.13\.0 or newer/)
  }

  const readme = publicSources[0]
  assert.equal((readme.match(/markover-review-editor@2x\.png/g) || []).length, 1)
  assert.doesNotMatch(readme, /markover-annotation-browser@2x\.png/)
  assert.match(readme, /free, MIT-licensed early preview for macOS/)
  assert.match(readme, /review data stays on your Mac/)
  assert.match(readme, /Check Markover/)
})

test('prepared announcement and demo sources retain finalization gates', () => {
  const reddit = read('doc/launch/issue-16/reddit-draft.md')
  const storyboard = read('doc/launch/issue-16/demo-storyboard.md')
  const filter = read('doc/launch/issue-16/handoff-summary.jq')

  assert.match(reddit, /\[DEMO_URL\]/)
  assert.match(reddit, /\[PREVIEW_TAG\]/)
  assert.match(reddit, /first step that is confusing or broken/)
  assert.doesNotMatch(reddit, /stars|upvotes/i)
  assert.match(storyboard, /Check Markover/)
  assert.match(storyboard, /current landing page/)
  assert.match(storyboard, /Codex and T3 Code/)
  assert.match(filter, /review: \{ status: \.review\.status \}/)
  assert.match(filter, /attachments/)
  assert.match(filter, /sourceEdit/)
})

test('social-card build extends the existing macOS-native asset approach', () => {
  const script = read('scripts/build-social-cards.js')
  const packageJson = require('../package.json')
  assert.equal(packageJson.scripts['build:social-cards'], 'node scripts/build-social-cards.js')
  assert.match(script, /\/usr\/bin\/sips/)
  assert.match(script, /markover-lockup\.svg/)
  assert.doesNotMatch(script, /sharp|canvas|playwright/i)
})

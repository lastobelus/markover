import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), 'utf8')
const bytes = (relativePath: string): Buffer =>
  fs.readFileSync(path.join(root, relativePath))
const sha256 = (contents: Buffer): string =>
  crypto.createHash('sha256').update(contents).digest('hex')

interface LaunchAsset {
  source: string
  sourceSha256: string
  output: string
  outputSha256: string
  width: number
  height: number
  maximumBytes?: number
}

interface LaunchManifest {
  issue: number
  phase: string
  canonicalDescriptor: string
  repository: {
    description: string
    homepage: string
    topics: string[]
    socialPreview: string
  }
  profilePins: string[]
  release: {
    currentPublicTag: string
    focusedPreviewCandidateTag: string
    focusedPreviewTag: string | null
    platform: string
    blockedByIssues: number[]
  }
  announcement: {
    community: string
    title: string
  }
  assets: {
    canonicalLockup: { path: string; sha256: string }
    githubSocialPreview: LaunchAsset
    pagesSocialCard: LaunchAsset
    canonicalProductImage: { path: string; sha256: string }
  }
}

interface PackageManifest {
  scripts: Record<string, string>
}

const manifest = JSON.parse(
  read('doc/launch/issue-16/launch-manifest.json')
) as LaunchManifest

function pngDimensions(contents: Buffer): { width: number; height: number } {
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
    socialPreview: 'docs/user/assets/markover-github-social-preview.png'
  })
  assert.deepEqual(manifest.profilePins, [
    'lastobelus/markover',
    'lastobelus/lastCode'
  ])
  assert.equal(manifest.release.currentPublicTag, 'v0.1.3')
  assert.equal(manifest.release.focusedPreviewCandidateTag, 'v0.1.3')
  assert.equal(manifest.release.focusedPreviewTag, null)
  assert.equal(
    manifest.release.platform,
    'macOS 14 Sonoma or newer on Apple Silicon'
  )
  assert.deepEqual(manifest.release.blockedByIssues, [93, 11, 10])
  assert.equal(manifest.announcement.community, 'r/codex')
  assert.equal(
    manifest.announcement.title,
    'I built a little Electron app for reviewing agent-written Markdown block by block'
  )
})

test('social-card sources and outputs match the launch manifest', () => {
  const canonicalLockup = manifest.assets.canonicalLockup
  assert.equal(sha256(bytes(canonicalLockup.path)), canonicalLockup.sha256)

  const cards = [
    manifest.assets.githubSocialPreview,
    manifest.assets.pagesSocialCard
  ]
  for (const asset of cards) {
    const source = bytes(asset.source)
    const output = bytes(asset.output)
    assert.equal(sha256(source), asset.sourceSha256)
    assert.equal(sha256(output), asset.outputSha256)
    assert.deepEqual(pngDimensions(output), {
      width: asset.width,
      height: asset.height
    })
    if (asset.maximumBytes !== undefined) {
      assert.ok(output.length < asset.maximumBytes)
    }

    const svg = source.toString('utf8')
    assert.match(svg, new RegExp(`width="${asset.width}" height="${asset.height}"`))
    assert.match(svg, /design\/brand\/markover-lockup\.svg/)
    assert.match(svg, /Structured review for Markdown\./)
    assert.doesNotMatch(svg, /gradient/i)
  }

  const productImage = manifest.assets.canonicalProductImage
  assert.equal(sha256(bytes(productImage.path)), productImage.sha256)
})

test('every Pages surface publishes complete large-card metadata', () => {
  const pages = [
    'docs/user/index.html',
    'docs/user/guide/index.html',
    'docs/user/agents/index.html',
    'docs/user/privacy/index.html',
    'docs/user/limitations/index.html'
  ]
  for (const page of pages) {
    const html = read(page)
    assert.match(html, /rel="canonical"/)
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

test('public setup surfaces preserve the repository launcher and preview boundary', () => {
  const readme = read('README.md')
  const agentGuide = read('docs/user/agents/index.html')
  const userGuide = read('docs/user/guide/index.html')
  const launcherUrl = /https:\/\/github\.com\/lastobelus\/markover\/releases\/latest\/download\/markover-cli\.tgz/

  for (const source of [readme, agentGuide]) {
    assert.match(source, launcherUrl)
    assert.match(
      source,
      /public npm package named(?:\s|>)*(?:<code>)?`?markover/
    )
  }
  for (const source of [readme, userGuide]) {
    assert.match(source, /Node(?:\.js)? 22\.13\.0 or newer/)
  }

  assert.equal((readme.match(/markover-review-editor@2x\.png/g) ?? []).length, 1)
  assert.doesNotMatch(readme, /markover-annotation-browser@2x\.png/)
  assert.match(readme, /free and MIT-licensed/)
  assert.match(
    readme,
    /ordinary(?:\s|>)+review data stays in your macOS account/
  )
  assert.match(readme, /macOS 14 Sonoma or newer on Apple Silicon/)
  assert.match(agentGuide, /Check Markover/)
})

test('prepared announcement and demo retain their finalization gates', () => {
  const reddit = read('doc/launch/issue-16/reddit-draft.md')
  const storyboard = read('doc/launch/issue-16/demo-storyboard.md')
  const filter = read('doc/launch/issue-16/handoff-summary.jq')

  assert.match(reddit, /\[DEMO_URL\]/)
  assert.match(reddit, /\[PREVIEW_TAG\]/)
  assert.match(reddit, /first step that is confusing or broken/)
  assert.match(reddit, /Apple Silicon Macs running\s+macOS 14 Sonoma or newer/)
  assert.doesNotMatch(reddit, /stars|upvotes/i)
  assert.match(storyboard, /Check Markover/)
  assert.match(storyboard, /current landing page/)
  assert.match(storyboard, /Codex and T3 Code/)
  assert.match(storyboard, /issues 93, 11, and 10/)
  assert.match(filter, /review: \{ status: \.review\.status \}/)
  assert.match(filter, /attachments/)
  assert.match(filter, /sourceEdit/)
})

test('social-card build follows the macOS-native TypeScript pipeline', () => {
  const script = read('scripts/build-social-cards.ts')
  const packageJson = JSON.parse(read('package.json')) as PackageManifest
  assert.equal(
    packageJson.scripts['build:social-cards'],
    'npm run build --silent && node build/scripts/build-social-cards.js'
  )
  assert.match(script, /\/usr\/bin\/sips/)
  assert.match(script, /markover-lockup\.svg/)
  assert.match(script, /docs\/user\/assets/)
  assert.doesNotMatch(script, /sharp|canvas|playwright/i)
})

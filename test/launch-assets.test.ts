import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const root = path.resolve(__dirname, '../..')
const userDirectory = path.join(root, 'docs/user')
const assetDirectory = path.join(userDirectory, 'assets')
const issueDirectory = path.join(root, 'doc/launch/issue-16')

const pagePaths = [
  ['index.html', 'https://lastobelus.github.io/markover/'],
  ['guide/index.html', 'https://lastobelus.github.io/markover/guide/'],
  ['agents/index.html', 'https://lastobelus.github.io/markover/agents/'],
  ['privacy/index.html', 'https://lastobelus.github.io/markover/privacy/'],
  ['limitations/index.html', 'https://lastobelus.github.io/markover/limitations/'],
  ['compatibility/index.html', 'https://lastobelus.github.io/markover/compatibility/'],
  ['remote-access/index.html', 'https://lastobelus.github.io/markover/remote-access/']
] as const

interface AssetReference {
  path: string
  sha256: string
}

interface LaunchManifest {
  desiredRepositoryMetadata: {
    description: string
    homepage: string
    topics: string[]
    socialPreview: string
  }
  assets: {
    demo: AssetReference
    poster: AssetReference
    githubSocialPreview: AssetReference
    pagesSocialCard: AssetReference
    transcript: string
    captions: string
    tailoredCopy: string
  }
  focusedPreviewTag: string | null
  releaseBlockers: number[]
  announcementOwner: number
}

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function pngDimensions(bytes: Buffer): { width: number, height: number } {
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function jpegDimensions(bytes: Buffer): { width: number, height: number } {
  assert.equal(bytes.readUInt16BE(0), 0xffd8)
  let offset = 2
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = bytes.readUInt16BE(offset + 2)
    if (startOfFrame.has(marker)) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7)
      }
    }
    offset += 2 + length
  }
  throw new Error('JPEG has no supported start-of-frame marker')
}

function topLevelMp4Boxes(bytes: Buffer): Map<string, { offset: number, size: number }> {
  const boxes = new Map<string, { offset: number, size: number }>()
  let offset = 0
  while (offset + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    if (size === 1) size = Number(bytes.readBigUInt64BE(offset + 8))
    if (size === 0) size = bytes.length - offset
    assert.ok(size >= 8 && offset + size <= bytes.length, `invalid ${type} MP4 box`)
    boxes.set(type, { offset, size })
    offset += size
  }
  assert.equal(offset, bytes.length)
  return boxes
}

test('every public page exposes one canonical Ember Light sharing card', () => {
  const socialCard = 'https://lastobelus.github.io/markover/assets/markover-pages-social-card.png'
  for (const [relativePath, canonical] of pagePaths) {
    const source = fs.readFileSync(path.join(userDirectory, relativePath), 'utf8')
    const document = new JSDOM(source).window.document
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content
    assert.ok(description, `${relativePath} should have a description`)
    assert.equal(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href, canonical)
    assert.equal(document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content, canonical)
    assert.equal(document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content, socialCard)
    assert.equal(document.querySelector<HTMLMetaElement>('meta[property="og:image:width"]')?.content, '1200')
    assert.equal(document.querySelector<HTMLMetaElement>('meta[property="og:image:height"]')?.content, '630')
    assert.equal(document.querySelector<HTMLMetaElement>('meta[name="twitter:card"]')?.content, 'summary_large_image')
    assert.equal(document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]')?.content, socialCard)
    assert.equal(document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content, description)
    assert.equal(document.querySelector<HTMLMetaElement>('meta[name="twitter:description"]')?.content, description)
  }
})

test('Pages offers an accessible current-UI demo without surprise playback', () => {
  const source = fs.readFileSync(path.join(userDirectory, 'index.html'), 'utf8')
  const document = new JSDOM(source).window.document
  const video = document.querySelector<HTMLVideoElement>('#demo video')
  assert.ok(video)
  assert.equal(video.hasAttribute('controls'), true)
  assert.equal(video.hasAttribute('playsinline'), true)
  assert.equal(video.getAttribute('preload'), 'metadata')
  assert.equal(video.hasAttribute('autoplay'), false)
  assert.equal(video.hasAttribute('loop'), false)
  assert.equal(video.getAttribute('poster'), './assets/markover-demo-poster.jpg')
  assert.equal(video.querySelector('source')?.getAttribute('src'), './assets/markover-focused-preview-demo.mp4')
  assert.equal(video.querySelector('source')?.getAttribute('type'), 'video/mp4')
  const transcript = document.querySelector('#demo-transcript')
  const disclosure = document.querySelector('.demo-disclosure')
  assert.ok(transcript)
  const canonicalTranscript = fs.readFileSync(
    path.join(issueDirectory, 'demo-transcript.md'),
    'utf8'
  )
  const canonicalPagesText = canonicalTranscript.match(
    /<!-- pages-transcript:start -->\s*([\s\S]*?)\s*<!-- pages-transcript:end -->/
  )?.[1]
  assert.ok(canonicalPagesText)
  const normalizeTranscript = (value: string): string => value
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const inlinePagesText = [...transcript.querySelectorAll(':scope > p')]
    .filter((paragraph) => !paragraph.querySelector('a'))
    .map((paragraph) => paragraph.textContent)
    .join(' ')
  assert.equal(
    normalizeTranscript(inlinePagesText),
    normalizeTranscript(canonicalPagesText)
  )
  assert.match(transcript.textContent, /demo fixture data/)
  assert.ok(disclosure)
  assert.equal(transcript.nextElementSibling, disclosure)
})

test('the launch movie is a fast-start silent H.264 MP4 with a real poster', () => {
  const captureSource = fs.readFileSync(path.join(root, 'scripts/capture-demo.ts'), 'utf8')
  assert.match(captureSource, /availability\.textContent = 'Free, MIT-licensed macOS early preview'/)
  const movie = fs.readFileSync(path.join(assetDirectory, 'markover-focused-preview-demo.mp4'))
  const boxes = topLevelMp4Boxes(movie)
  const moov = boxes.get('moov')
  const mdat = boxes.get('mdat')
  assert.ok(boxes.has('ftyp'))
  assert.ok(moov)
  assert.ok(mdat)
  assert.ok(moov.offset < mdat.offset, 'moov should precede mdat for fast start')
  const movieMetadata = movie.subarray(moov.offset, moov.offset + moov.size).toString('latin1')
  assert.ok(movieMetadata.includes('vide'))
  assert.ok(movieMetadata.includes('avc1'))
  assert.equal(movieMetadata.includes('soun'), false)
  assert.equal(movieMetadata.includes('mp4a'), false)

  const poster = fs.readFileSync(path.join(assetDirectory, 'markover-demo-poster.jpg'))
  assert.deepEqual(jpegDimensions(poster), { width: 1920, height: 1080 })
})

test('social cards are deterministic current Ember Light assets', () => {
  const cards = [
    ['github-social-preview.svg', 'markover-github-social-preview.png', 1280, 640],
    ['pages-social-card.svg', 'markover-pages-social-card.png', 1200, 630]
  ] as const
  for (const [sourceName, outputName, width, height] of cards) {
    const source = fs.readFileSync(path.join(issueDirectory, sourceName), 'utf8')
    const output = fs.readFileSync(path.join(assetDirectory, outputName))
    assert.deepEqual(pngDimensions(output), { width, height })
    assert.match(source, /#e8e2d8/)
    assert.match(source, /#f7f4ee/)
    assert.match(source, /#6f6761/)
    assert.match(source, /#c94e1f/)
    assert.doesNotMatch(source, /linearGradient|radialGradient|href="https?:\/\/|#eee8e0|#756d67|Inter/)
  }
  assert.ok(fs.statSync(path.join(assetDirectory, 'markover-github-social-preview.png')).size < 1_000_000)
})

test('the launch manifest pins every binary and keeps release claims honest', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(issueDirectory, 'launch-manifest.json'), 'utf8')
  ) as LaunchManifest
  for (const asset of [
    manifest.assets.demo,
    manifest.assets.poster,
    manifest.assets.githubSocialPreview,
    manifest.assets.pagesSocialCard
  ]) {
    assert.equal(sha256(path.join(root, asset.path)), asset.sha256, asset.path)
  }
  assert.equal(fs.existsSync(path.join(root, manifest.assets.transcript)), true)
  assert.equal(fs.existsSync(path.join(root, manifest.assets.captions)), true)
  assert.equal(fs.existsSync(path.join(root, manifest.assets.tailoredCopy)), true)
  assert.equal(manifest.desiredRepositoryMetadata.homepage, 'https://lastobelus.github.io/markover/')
  assert.equal(manifest.desiredRepositoryMetadata.socialPreview, 'docs/user/assets/markover-github-social-preview.png')
  assert.deepEqual(manifest.releaseBlockers, [10, 11])
  assert.equal(manifest.focusedPreviewTag, null)
  assert.equal(manifest.announcementOwner, 17)
})

test('README uses one linked product image and states the preview boundary', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.equal((readme.match(/markover-review-editor@2x\.png/g) ?? []).length, 1)
  assert.match(readme, /href="https:\/\/lastobelus\.github\.io\/markover\/#demo"/)
  assert.match(readme, /early preview/i)
  assert.match(readme, /free and MIT-licensed/i)
  assert.match(readme, /requires no\s+account/i)
  assert.match(readme, /public npm package named `markover` is unrelated/)
  assert.match(readme, /--package=https:\/\/github\.com\/lastobelus\/markover\/releases\/latest\/download\/markover-cli\.tgz/)
})

test('the public feature indices have deliberate visual weight', () => {
  const styles = fs.readFileSync(path.join(userDirectory, 'styles.css'), 'utf8')
  assert.match(styles, /\.feature-number \{[^}]*color: var\(--brand-burgundy\);[^}]*font: 750 16\.5px\/1\.2/)
  assert.match(styles, /\.workflow li::before \{[^}]*color: var\(--brand-burgundy\);[^}]*font: 750 16\.5px\/1\.2/)
})

test('Ember orange stays out of normal-size public text', () => {
  const styles = fs.readFileSync(path.join(userDirectory, 'styles.css'), 'utf8')
  assert.doesNotMatch(styles, /color: var\(--brand-orange\)/)
  assert.match(styles, /\.eyebrow \{[^}]*color: var\(--brand-burgundy\);[^}]*font: 750 12px\/1\.2/)
  assert.match(styles, /\.docs-nav p \{[^}]*color: var\(--brand-burgundy\);[^}]*font: 750 10px\/1\.2/)
})

test('agent-specific examples use only observable supported identities', () => {
  const agents = fs.readFileSync(path.join(userDirectory, 'agents/index.html'), 'utf8')
  assert.match(agents, /--thread-id "\$CODEX_THREAD_ID"[\s\S]*?--thread-host-kind t3code[\s\S]*?--thread-host-provider codex/)
  assert.match(agents, /--thread-id "\$CLAUDE_CODE_SESSION_ID"[\s\S]*?--thread-host-kind claude-code[\s\S]*?--thread-host-provider claude/)
  assert.match(agents, /generate a fresh high-entropy <code>--handoff-key<\/code>/)
  assert.doesNotMatch(agents, /--thread-host-thread-id (THREAD_ID|"\$CODEX_THREAD_ID"|"\$CLAUDE_CODE_SESSION_ID")/)
})

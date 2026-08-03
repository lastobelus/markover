#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const projectDirectory = path.resolve(__dirname, '..')
const cards = [
  {
    source: 'doc/launch/issue-16/github-social-preview.svg',
    output: 'docs/assets/markover-github-social-preview.png',
    width: 1280,
    height: 640,
    maximumBytes: 1_000_000
  },
  {
    source: 'doc/launch/issue-16/pages-social-card.svg',
    output: 'docs/assets/markover-pages-social-card.png',
    width: 1200,
    height: 630
  }
]

function dimensions(bytes) {
  if (bytes.subarray(1, 4).toString() !== 'PNG') {
    throw new Error('Expected a PNG export')
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  }
}

function inlineCanonicalAssets(source) {
  const lockup = fs.readFileSync(
    path.join(projectDirectory, 'design/brand/markover-lockup.svg')
  )
  return source.replace(
    '../../../design/brand/markover-lockup.svg',
    `data:image/svg+xml;base64,${lockup.toString('base64')}`
  )
}

function render(card, temporaryDirectory) {
  const sourcePath = path.join(projectDirectory, card.source)
  const outputPath = path.join(projectDirectory, card.output)
  const temporarySource = path.join(
    temporaryDirectory,
    path.basename(card.source)
  )
  fs.writeFileSync(
    temporarySource,
    inlineCanonicalAssets(fs.readFileSync(sourcePath, 'utf8'))
  )
  const result = spawnSync('/usr/bin/sips', [
    '-s', 'format', 'png',
    temporarySource,
    '--out', outputPath
  ], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `sips exited ${result.status}`)
  }

  const bytes = fs.readFileSync(outputPath)
  const size = dimensions(bytes)
  if (size.width !== card.width || size.height !== card.height) {
    throw new Error(
      `${card.output} is ${size.width}×${size.height}; expected ${card.width}×${card.height}`
    )
  }
  if (card.maximumBytes && bytes.length >= card.maximumBytes) {
    throw new Error(`${card.output} must remain under ${card.maximumBytes} bytes`)
  }
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Building Markover social cards requires macOS.')
  }
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'markover-social-cards-')
  )
  try {
    for (const card of cards) render(card, temporaryDirectory)
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`markover social cards: ${error.message}\n`)
    process.exit(1)
  }
}

module.exports = { cards, dimensions, inlineCanonicalAssets, main }

#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const projectDirectory = path.resolve(__dirname, '../..')

interface SocialCard {
  source: string
  output: string
  width: number
  height: number
  maximumBytes?: number
}

export const cards: readonly SocialCard[] = [
  {
    source: 'doc/launch/issue-16/github-social-preview.svg',
    output: 'docs/user/assets/markover-github-social-preview.png',
    width: 1280,
    height: 640,
    maximumBytes: 1_000_000
  },
  {
    source: 'doc/launch/issue-16/pages-social-card.svg',
    output: 'docs/user/assets/markover-pages-social-card.png',
    width: 1200,
    height: 630
  }
]

export interface ImageDimensions {
  width: number
  height: number
}

export function dimensions(bytes: Buffer): ImageDimensions {
  if (bytes.subarray(1, 4).toString() !== 'PNG') {
    throw new Error('Expected a PNG export')
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  }
}

export function inlineCanonicalAssets(source: string): string {
  const lockup = fs.readFileSync(
    path.join(projectDirectory, 'design/brand/markover-lockup.svg')
  )
  return source.replace(
    '../../../design/brand/markover-lockup.svg',
    `data:image/svg+xml;base64,${lockup.toString('base64')}`
  )
}

function render(card: SocialCard, temporaryDirectory: string): void {
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
    '-s',
    'format',
    'png',
    temporarySource,
    '--out',
    outputPath
  ], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `sips exited ${String(result.status)}`
    )
  }

  const bytes = fs.readFileSync(outputPath)
  const size = dimensions(bytes)
  if (size.width !== card.width || size.height !== card.height) {
    throw new Error(
      `${card.output} is ${size.width}×${size.height}; expected ${card.width}×${card.height}`
    )
  }
  if (card.maximumBytes !== undefined && bytes.length >= card.maximumBytes) {
    throw new Error(`${card.output} must remain under ${card.maximumBytes} bytes`)
  }
}

export function main(): void {
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
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover social cards: ${message}\n`)
    process.exit(1)
  }
}

import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { screenshotSpec } from './capture-stills'

interface Card {
  height: number
  output: string
  source: string
  width: number
}

const cards: Card[] = [
  {
    source: 'doc/launch/issue-16/github-social-preview.svg',
    output: 'docs/user/assets/markover-github-social-preview.png',
    width: 1280,
    height: 640
  },
  {
    source: 'doc/launch/issue-16/pages-social-card.svg',
    output: 'docs/user/assets/markover-pages-social-card.png',
    width: 1200,
    height: 630
  }
]

async function run(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('Launch art rendering requires macOS sips.')
  const root = path.resolve(__dirname, '../..')
  const lockupPath = path.join(root, 'design', 'brand', 'markover-lockup.svg')
  const lockup = await fs.readFile(lockupPath)
  const embeddedLockup = `data:image/svg+xml;base64,${lockup.toString('base64')}`
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-launch-art-'))
  try {
    for (const card of cards) {
      const sourcePath = path.join(root, card.source)
      const outputPath = path.join(root, card.output)
      const renderedSource = (await fs.readFile(sourcePath, 'utf8')).replace(
        '../../../design/brand/markover-lockup.svg',
        embeddedLockup
      )
      const stagedSvg = path.join(temporaryDirectory, path.basename(card.source))
      await fs.writeFile(stagedSvg, renderedSource, 'utf8')
      execFileSync('/usr/bin/sips', [
        '-s', 'format', 'png',
        stagedSvg,
        '--out', outputPath
      ], { stdio: 'ignore' })
      const output = await fs.readFile(outputPath)
      const spec = screenshotSpec(output)
      if (spec.width !== card.width || spec.height !== card.height) {
        throw new Error(`Unexpected ${card.output} dimensions: ${String(spec.width)}x${String(spec.height)}`)
      }
      if (card.width === 1280 && output.length >= 1_000_000) {
        throw new Error('GitHub social preview must be smaller than 1 MB.')
      }
    }
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover launch art: ${message}\n`)
    process.exitCode = 1
  })
}

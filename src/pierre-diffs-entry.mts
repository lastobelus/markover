import { FileDiff, parseDiffFromFile } from '@pierre/diffs'

import type { DiffStats } from './contracts.js'

const PIERRE_CSS = `
  [data-diffs] {
    --diffs-font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    --diffs-font-size: 9.5px;
    --diffs-line-height: 1.45;
  }
  pre { margin: 0; }
`

function files(original: string, current: string, key = 'block') {
  return {
    oldFile: {
      name: 'block.md',
      contents: original,
      cacheKey: `${key}:original`
    },
    newFile: {
      name: 'block.md',
      contents: current,
      cacheKey: `${key}:current:${current}`
    }
  }
}

function stats(original: string, current: string): DiffStats {
  const input = files(original, current)
  const metadata = parseDiffFromFile(input.oldFile, input.newFile)
  return metadata.hunks.reduce<DiffStats>(
    (total, hunk) => ({
      additions: total.additions + hunk.additionLines,
      deletions: total.deletions + hunk.deletionLines
    }),
    { additions: 0, deletions: 0 }
  )
}

function render(
  container: HTMLElement,
  original: string,
  current: string,
  key?: string
): () => void {
  const instance = new FileDiff({
    diffStyle: 'unified',
    lineDiffType: 'word-alt',
    overflow: 'wrap',
    disableFileHeader: true,
    disableVirtualizationBuffers: true,
    theme: 'pierre-light',
    themeType: 'light',
    unsafeCSS: PIERRE_CSS
  })
  instance.render({
    ...files(original, current, key),
    containerWrapper: container
  })
  return () => {
    instance.cleanUp()
  }
}

export { render, stats }

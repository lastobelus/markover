import {
  FileDiff,
  getSharedHighlighter,
  parseDiffFromFile
} from '@pierre/diffs'

import type {
  DiffStats,
  SyntaxHighlightResult,
  SyntaxHighlightToken
} from './contracts.js'

const MAX_HIGHLIGHT_CHARACTERS = 20_000
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'shellscript',
  yml: 'yaml',
  md: 'markdown',
  plain: 'text',
  plaintext: 'text',
  txt: 'text'
}

function syntaxLanguage(value: string): string | null {
  const normalized = value.trim().split(/\s+/, 1)[0]?.toLowerCase() || ''
  if (!normalized) return null
  return LANGUAGE_ALIASES[normalized] || normalized
}

async function highlight(
  source: string,
  languageLabel: string
): Promise<SyntaxHighlightResult | null> {
  const language = syntaxLanguage(languageLabel)
  if (!language || source.length > MAX_HIGHLIGHT_CHARACTERS) return null
  try {
    const highlighter = await getSharedHighlighter({
      themes: ['pierre-light', 'pierre-dark'],
      langs: [language],
      preferredHighlighter: 'shiki-js'
    })
    const lines = highlighter.codeToTokensWithThemes(source, {
      lang: language,
      themes: {
        light: 'pierre-light',
        dark: 'pierre-dark'
      }
    })
    const highlightedLines: SyntaxHighlightToken[][] = []
    for (const line of lines) {
      const highlightedLine: SyntaxHighlightToken[] = []
      for (const token of line) {
        const light = token.variants.light
        const dark = token.variants.dark
        if (!light?.color || !dark?.color) return null
        highlightedLine.push({
          content: token.content,
          lightColor: light.color,
          darkColor: dark.color,
          fontStyle: light.fontStyle || 0
        })
      }
      highlightedLines.push(highlightedLine)
    }
    return { lines: highlightedLines }
  } catch {
    return null
  }
}

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

export { highlight, render, stats }

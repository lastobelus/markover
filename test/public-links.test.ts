import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PUBLIC_LINKS } from '../src/public-links'

const root = path.resolve(__dirname, '../..')
const publicSiteRoot = new URL('https://lastobelus.github.io/markover/')

function filesBelow(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(entryPath) : [entryPath]
  })
}

function resolvedPublicSiteLinks(): Set<string> {
  const sourceRoot = path.join(root, 'docs/user')
  const result = new Set<string>()
  for (const filePath of filesBelow(sourceRoot)) {
    if (!filePath.endsWith('.html')) continue
    const relativePath = path.relative(sourceRoot, filePath).split(path.sep).join('/')
    const pageUrl = new URL(relativePath, publicSiteRoot)
    const html = fs.readFileSync(filePath, 'utf8')
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1]
      if (!href || href.startsWith('#') || href.startsWith('mailto:')) continue
      result.add(new URL(href, pageUrl).href)
    }
  }
  return result
}

test('public-link definitions are unique fixed HTTPS destinations', () => {
  assert.equal(new Set(PUBLIC_LINKS.map((link) => link.id)).size, PUBLIC_LINKS.length)
  assert.equal(new Set(PUBLIC_LINKS.map((link) => link.url)).size, PUBLIC_LINKS.length)
  for (const link of PUBLIC_LINKS) {
    const url = new URL(link.url)
    assert.equal(url.protocol, 'https:')
    assert.ok(link.label)
  }
})

test('README and the public site cannot silently diverge from Help destinations', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  const siteLinks = resolvedPublicSiteLinks()
  for (const link of PUBLIC_LINKS) {
    assert.ok(readme.includes(link.url), `README is missing ${link.id}`)
    assert.ok(siteLinks.has(link.url), `Public site is missing ${link.id}`)
  }
})

test('main-process adapter provides bounded native failure feedback', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  assert.match(main, /openExternal: \(url\) => shell\.openExternal\(url\)/)
  assert.match(main, /buttons: \['Copy Link', 'OK'\]/)
  assert.match(main, /defaultId: 1,[\s\S]*cancelId: 1,[\s\S]*noLink: true/)
  assert.match(main, /copyText: \(text\) => \{ clipboard\.writeText\(text\) \}/)
  assert.match(main, /restoreFocus: restoreMainWindowFocus/)
})

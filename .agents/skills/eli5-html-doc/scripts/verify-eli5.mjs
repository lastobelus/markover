#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'

function usage() {
  return `Usage: node verify-eli5.mjs [--repo-root PATH] FILE.html [...]

Check the mechanical parts of a self-contained ELI5 artifact. Inputs are
explicit so unrelated HTML files are never pulled into the contract.`
}

function parseArguments(argv) {
  let repoRoot
  const files = []

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${usage()}\n`)
      process.exit(0)
    }
    if (argument === '--repo-root') {
      repoRoot = argv[index + 1]
      if (!repoRoot) throw new Error('--repo-root needs a path')
      index += 1
      continue
    }
    if (argument.startsWith('-')) throw new Error(`unknown option: ${argument}`)
    files.push(argument)
  }

  if (files.length === 0) throw new Error('provide at least one HTML file')
  return { repoRoot: repoRoot && path.resolve(repoRoot), files }
}

function repositoryRoot(filePath, explicitRoot) {
  if (explicitRoot) return explicitRoot
  try {
    return execFileSync(
      'git',
      ['-C', path.dirname(filePath), 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
  } catch {
    throw new Error(`cannot find the repository root for ${filePath}; pass --repo-root`)
  }
}

function attributes(source) {
  const result = new Map()
  const expression = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const match of source.matchAll(expression)) {
    result.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
  }
  return result
}

function tags(source, name) {
  const expression = new RegExp(`<${name}\\b([^>]*)>`, 'gi')
  return [...source.matchAll(expression)].map((match) => ({
    full: match[0],
    attrs: attributes(match[1])
  }))
}

function withoutQueryOrFragment(value) {
  return value.split(/[?#]/, 1)[0]
}

function isNavigationOrInline(value) {
  return /^(?:#|https?:|mailto:|data:|javascript:)/i.test(value)
}

function isAbsoluteFilesystemPath(value) {
  return (
    value.startsWith('/') ||
    value.startsWith('~') ||
    /^[a-z]:[\\/]/i.test(value) ||
    /^file:\/\/\//i.test(value)
  )
}

function resolveInside(base, relativePath, boundary) {
  const resolved = path.resolve(base, relativePath)
  const relation = path.relative(boundary, resolved)
  if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    return { resolved, escaped: true }
  }
  return { resolved, escaped: false }
}

function inspectFile(input, explicitRoot) {
  const filePath = path.resolve(input)
  const failures = []

  if (!fs.existsSync(filePath)) return [`file does not exist: ${filePath}`]
  if (!fs.statSync(filePath).isFile()) return [`not a file: ${filePath}`]
  if (path.extname(filePath).toLowerCase() !== '.html') {
    return [`not an HTML file: ${filePath}`]
  }

  const root = repositoryRoot(filePath, explicitRoot)
  const relativeFile = path.relative(root, filePath).split(path.sep).join('/')
  if (relativeFile === '..' || relativeFile.startsWith('../')) {
    failures.push(`file is outside repository root ${root}`)
  }

  const source = fs.readFileSync(filePath, 'utf8')
  if (!/^\s*<!doctype html>/i.test(source)) failures.push('missing <!doctype html>')

  const html = tags(source, 'html')[0]
  if (!html?.attrs.get('lang')) failures.push('missing <html lang="…">')
  if (!/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(source)) {
    failures.push('missing viewport metadata')
  }

  const documentPath = html?.attrs.get('data-repo-doc-path')
  if (documentPath) {
    if (isAbsoluteFilesystemPath(documentPath) || documentPath.includes('..')) {
      failures.push(`data-repo-doc-path is not repository-relative: ${documentPath}`)
    } else if (withoutQueryOrFragment(documentPath) !== relativeFile) {
      failures.push(
        `data-repo-doc-path is ${documentPath}; expected ${relativeFile}`
      )
    }
  }

  for (const script of tags(source, 'script')) {
    if (script.attrs.has('src')) failures.push(`external script tag: ${script.full}`)
  }
  for (const link of tags(source, 'link')) {
    const relation = (link.attrs.get('rel') || '').toLowerCase().split(/\s+/)
    const href = link.attrs.get('href')
    if (relation.includes('stylesheet')) {
      failures.push(`external stylesheet tag: ${link.full}`)
    } else if (href && !href.startsWith('data:')) {
      failures.push(`non-inline link tag: ${link.full}`)
    }
  }
  const cssSources = [
    ...[...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(
      (match) => match[1]
    )
  ]
  for (const match of source.matchAll(/<[a-z][^>]*>/gi)) {
    const style = attributes(match[0]).get('style')
    if (style) cssSources.push(style)
  }

  if (cssSources.some((css) => /@import\b/i.test(css))) {
    failures.push('CSS @import is not self-contained')
  }
  for (const css of cssSources) {
    for (const match of css.matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi)) {
      const value = match[2].trim()
      if (!/^(?:data:|#)/i.test(value)) failures.push(`non-inline CSS url(): ${value}`)
    }
  }

  const runtimeTags = ['audio', 'embed', 'iframe', 'img', 'input', 'source', 'track', 'video']
  for (const tagName of runtimeTags) {
    for (const tag of tags(source, tagName)) {
      const value = tag.attrs.get('src')
      if (value && !value.startsWith('data:')) {
        failures.push(`non-inline ${tagName} source: ${value}`)
      }
      const sourceSet = tag.attrs.get('srcset')
      if (sourceSet && !sourceSet.split(',').every((item) => item.trim().startsWith('data:'))) {
        failures.push(`non-inline ${tagName} srcset: ${sourceSet}`)
      }
    }
  }

  const pathLeaks = [
    { expression: /\/Users\/[A-Za-z0-9._-]+\//, label: 'macOS user path' },
    { expression: /\/home\/[A-Za-z0-9._-]+\//, label: 'Linux home path' },
    { expression: /~\/(?:\.t3|\.codex)\//, label: 'home-relative tool path' },
    { expression: /file:\/\/\/(?:Users|home)\//i, label: 'absolute file URL' },
    { expression: /[A-Za-z]:\\Users\\[^\\]+\\/, label: 'Windows user path' }
  ]
  if (source.includes(root)) failures.push('committed current repository path')
  for (const { expression, label } of pathLeaks) {
    if (expression.test(source)) failures.push(`committed ${label}`)
  }

  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      new vm.Script(match[1], { filename: `${filePath}:inline-script` })
    } catch (error) {
      failures.push(`inline JavaScript does not compile: ${error.message}`)
    }
  }

  for (const anchor of tags(source, 'a')) {
    const href = anchor.attrs.get('href')
    if (!href || href === '#' || isNavigationOrInline(href)) continue
    if (isAbsoluteFilesystemPath(href)) {
      failures.push(`absolute local link: ${href}`)
      continue
    }
    const localPath = withoutQueryOrFragment(decodeURIComponent(href))
    if (!localPath) continue
    if (localPath.split(/[\\/]/).includes('..')) {
      failures.push(`local link uses parent traversal: ${href}`)
      continue
    }
    const target = resolveInside(path.dirname(filePath), localPath, root)
    if (target.escaped) failures.push(`local link escapes the repository: ${href}`)
    else if (!fs.existsSync(target.resolved)) failures.push(`local link does not exist: ${href}`)
  }

  for (const attributeName of ['data-repo-path', 'data-zed-path']) {
    const expression = new RegExp(`${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gi')
    for (const match of source.matchAll(expression)) {
      const value = match[1] ?? match[2]
      if (!value || isAbsoluteFilesystemPath(value)) {
        failures.push(`${attributeName} is not repository-relative: ${value}`)
        continue
      }
      const targetPath = withoutQueryOrFragment(value)
      const target = resolveInside(root, targetPath, root)
      if (target.escaped) failures.push(`${attributeName} escapes the repository: ${value}`)
      else if (!fs.existsSync(target.resolved)) failures.push(`${attributeName} does not exist: ${value}`)
    }
  }

  return failures
}

let options
try {
  options = parseArguments(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error.message}\n\n${usage()}\n`)
  process.exit(2)
}

let failed = 0
for (const input of options.files) {
  let failures
  try {
    failures = inspectFile(input, options.repoRoot)
  } catch (error) {
    failures = [error.message]
  }

  if (failures.length === 0) {
    process.stdout.write(`PASS ${input}\n`)
    continue
  }

  failed += 1
  process.stderr.write(`FAIL ${input}\n`)
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`)
}

if (failed > 0) {
  process.stderr.write(`${failed} of ${options.files.length} file(s) failed\n`)
  process.exit(1)
}

process.stdout.write(`${options.files.length} file(s) passed\n`)

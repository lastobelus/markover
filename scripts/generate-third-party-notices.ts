#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const projectDirectory = path.resolve(__dirname, '../..')
const outputPath = path.join(projectDirectory, 'THIRD_PARTY_NOTICES.md')

type NoticeKind = 'license' | 'notice'

interface NoticeFile {
  kind: NoticeKind
  name: string
  path: string
}

interface NoticeText extends NoticeFile {
  text: string
}

interface OverrideSource {
  kind?: NoticeKind
  path: string
  start?: string
  end?: string
}

interface LicenseOverride {
  license: string
  reason: string
  sources: OverrideSource[]
}

type LicenseOverrides = Record<string, LicenseOverride>

export interface PackageRecord {
  id: string
  name: string
  version: string
  license: string
  location: string
  texts: NoticeText[]
}

interface TextGroup {
  kind: NoticeKind
  text: string
  packages: PackageRecord[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeText(source: string): string {
  return source
}

function noticeFiles(packageDirectory: string): NoticeFile[] {
  return fs.readdirSync(packageDirectory)
    .filter((name) => /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name))
    .filter((name) => fs.statSync(path.join(packageDirectory, name)).isFile())
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      kind: /^notice/i.test(name) ? 'notice' : 'license',
      name,
      path: path.join(packageDirectory, name)
    }))
}

export function loadOverrides(
  rootDirectory = projectDirectory
): LicenseOverrides {
  const filePath = path.join(rootDirectory, 'third_party/license-overrides.json')
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!isRecord(parsed)) throw new Error('License overrides must be an object')
  const overrides: LicenseOverrides = {}
  for (const [id, value] of Object.entries(parsed)) {
    if (
      !isRecord(value) ||
      typeof value.license !== 'string' ||
      typeof value.reason !== 'string' ||
      !Array.isArray(value.sources)
    ) {
      throw new Error(`${id} has an invalid license override`)
    }
    const sources: OverrideSource[] = value.sources.map((source: unknown) => {
      if (
        !isRecord(source) ||
        typeof source.path !== 'string' ||
        (source.kind !== undefined &&
          source.kind !== 'license' && source.kind !== 'notice') ||
        (source.start !== undefined && typeof source.start !== 'string') ||
        (source.end !== undefined && typeof source.end !== 'string')
      ) {
        throw new Error(`${id} has an invalid license override source`)
      }
      return {
        path: source.path,
        ...(source.kind === undefined ? {} : { kind: source.kind }),
        ...(source.start === undefined ? {} : { start: source.start }),
        ...(source.end === undefined ? {} : { end: source.end })
      }
    })
    overrides[id] = {
      license: value.license,
      reason: value.reason,
      sources
    }
  }
  return overrides
}

export function resolveOverrideSources(
  packageRecord: PackageRecord,
  override: LicenseOverride | undefined,
  rootDirectory: string
): NoticeText[] {
  if (!override) return []
  if (override.license.toLowerCase() !== packageRecord.license.toLowerCase()) {
    throw new Error(
      `${packageRecord.id} override license ${override.license} does not match ` +
      packageRecord.license
    )
  }
  if (!override.reason || !Array.isArray(override.sources) || !override.sources.length) {
    throw new Error(`${packageRecord.id} has an incomplete license override`)
  }
  return override.sources.map((source) => {
    const sourcePath = path.join(rootDirectory, source.path)
    let text = fs.readFileSync(sourcePath, 'utf8')
    if (source.start) {
      const start = text.indexOf(source.start)
      if (start === -1) {
        throw new Error(`${packageRecord.id} override marker was not found`)
      }
      text = text.slice(start)
    }
    if (source.end) {
      const end = text.indexOf(source.end)
      if (end === -1) {
        throw new Error(`${packageRecord.id} override end marker was not found`)
      }
      text = text.slice(0, end)
    }
    return {
      kind: source.kind || 'license',
      name: source.path,
      path: sourcePath,
      text: normalizeText(text)
    }
  })
}

export function productionPackages(
  rootDirectory = projectDirectory,
  overrides = loadOverrides(rootDirectory)
): PackageRecord[] {
  const lock: unknown = JSON.parse(fs.readFileSync(
    path.join(rootDirectory, 'package-lock.json'),
    'utf8'
  ))
  if (!isRecord(lock) || !isRecord(lock.packages)) {
    throw new Error('package-lock.json is missing package records')
  }
  const packages: PackageRecord[] = []
  for (const [location, lockEntry] of Object.entries(lock.packages)) {
    if (
      !location.startsWith('node_modules/') ||
      (isRecord(lockEntry) && lockEntry.dev === true)
    ) continue
    const packageDirectory = path.join(rootDirectory, location)
    if (!fs.existsSync(packageDirectory)) continue
    const manifest: unknown = JSON.parse(fs.readFileSync(
      path.join(packageDirectory, 'package.json'),
      'utf8'
    ))
    if (
      !isRecord(manifest) ||
      typeof manifest.name !== 'string' ||
      typeof manifest.version !== 'string' ||
      typeof manifest.license !== 'string'
    ) {
      throw new Error(`${location} is missing name, version, or license metadata`)
    }
    const record: PackageRecord = {
      id: `${manifest.name}@${manifest.version}`,
      name: manifest.name,
      version: manifest.version,
      license: manifest.license,
      location,
      texts: []
    }
    const discovered = noticeFiles(packageDirectory).map((file) => ({
      ...file,
      text: normalizeText(fs.readFileSync(file.path, 'utf8'))
    }))
    record.texts = discovered.length
      ? discovered
      : resolveOverrideSources(record, overrides[record.id], rootDirectory)
    if (!record.texts.length) {
      throw new Error(`${record.id} does not include usable license text`)
    }
    packages.push(record)
  }
  return packages.sort((left, right) => left.id.localeCompare(right.id))
}

export function groupedTexts(packages: PackageRecord[]): TextGroup[] {
  const groups = new Map<string, TextGroup>()
  for (const packageRecord of packages) {
    for (const entry of packageRecord.texts) {
      const key = `${entry.kind}\0${entry.text}`
      let group = groups.get(key)
      if (!group) {
        group = {
          kind: entry.kind,
          text: entry.text,
          packages: []
        }
        groups.set(key, group)
      }
      group.packages.push(packageRecord)
    }
  }
  return [...groups.values()].sort((left, right) => {
    const kind = left.kind.localeCompare(right.kind)
    if (kind) return kind
    return (left.packages[0]?.id ?? '').localeCompare(
      right.packages[0]?.id ?? ''
    )
  })
}

export function renderNotices(packages: PackageRecord[]): string {
  const lines = [
    '# Third-Party Notices',
    '',
    '> This file is generated by `npm run notices:generate`. Do not edit it',
    '> directly. It covers JavaScript dependencies shipped with Markover;',
    '> Electron and Chromium license materials are bundled separately.',
    '',
    '## Included packages',
    '',
    '| Package | Version | License |',
    '| --- | --- | --- |'
  ]
  for (const packageRecord of packages) {
    lines.push(
      `| \`${packageRecord.name}\` | \`${packageRecord.version}\` | ` +
      `\`${packageRecord.license}\` |`
    )
  }
  lines.push('', '## License and notice texts', '')
  for (const [index, group] of groupedTexts(packages).entries()) {
    const identifiers = [...new Set(group.packages.map((entry) => entry.license))]
    const label = group.kind === 'notice' ? 'Notice' : 'License'
    lines.push(
      `### ${label} ${String(index + 1)}: ${identifiers.join(', ')}`,
      ''
    )
    lines.push(
      `Applies to: ${group.packages.map((entry) => `\`${entry.id}\``).join(', ')}`,
      '',
      group.text.trimEnd(),
      '',
      '---',
      ''
    )
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function generatedNotices(rootDirectory = projectDirectory): string {
  return renderNotices(productionPackages(rootDirectory))
}

export function main(args: string[] = process.argv.slice(2)): void {
  const unexpected = args.filter((argument) => argument !== '--check')
  const firstUnexpected = unexpected[0]
  if (firstUnexpected !== undefined) {
    throw new Error(`Unknown option: ${firstUnexpected}`)
  }
  const generated = generatedNotices()
  if (args.includes('--check')) {
    const existing = fs.existsSync(outputPath)
      ? fs.readFileSync(outputPath, 'utf8')
      : null
    if (existing !== generated) {
      throw new Error(
        'THIRD_PARTY_NOTICES.md is stale; run npm run notices:generate'
      )
    }
    process.stdout.write('Third-party notices are current.\n')
    return
  }
  fs.writeFileSync(outputPath, generated)
  process.stdout.write('Updated THIRD_PARTY_NOTICES.md.\n')
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover notices: ${message}\n`)
    process.exit(1)
  }
}

#!/usr/bin/env node

import fs from 'node:fs/promises'

import {
  verifyMacosArtifact,
  type MacosArtifactReport
} from './macos-artifact-preflight'
import {
  parseMacosArchitecture,
  parseMacosTrustMode
} from './macos-release-contract'
import {
  compareReleasePayloads,
  developerIdReadiness,
  generateReleaseNotes,
  githubReleaseReadiness,
  verifyDraftRelease,
  verifyReleasePayloads,
  verifyReleaseTag,
  type ReadinessReport,
  type ReleasePayloadReport
} from './release-operations'

function parseFlags(
  args: readonly string[],
  required: readonly string[],
  optional: readonly string[] = []
): Map<string, string> {
  const values = new Map<string, string>()
  for (const argument of args) {
    const match = argument.match(/^--([a-z-]+)=(.+)$/)
    if (!match?.[1] || match[2] === undefined) {
      throw new Error(`Invalid argument: ${argument}`)
    }
    if (values.has(match[1])) {
      throw new Error(`Duplicate argument: --${match[1]}`)
    }
    values.set(match[1], match[2])
  }
  for (const name of required) {
    if (!values.has(name)) throw new Error(`Missing argument: --${name}`)
  }
  for (const name of values.keys()) {
    if (![...required, ...optional].includes(name)) {
      throw new Error(`Unknown argument: --${name}`)
    }
  }
  return values
}

function value(flags: ReadonlyMap<string, string>, name: string): string {
  return flags.get(name) ?? ''
}

function printMacosReport(report: MacosArtifactReport): void {
  process.stdout.write([
    'macOS artifact preflight: verified',
    `Archive SHA-256: ${report.sha256}`,
    `Architecture: ${report.architecture}`,
    'Trust: hardened ad-hoc (not Apple-verified)',
    'Gatekeeper: rejected as expected for ad-hoc signing',
    ''
  ].join('\n'))
}

function printPayloadReport(
  report: ReleasePayloadReport,
  heading = 'Release payloads: verified'
): void {
  process.stdout.write(`${heading}\n`)
  for (const payload of report.payloads) {
    process.stdout.write(
      `${payload.name}: ${payload.sha256} (${payload.architecture})\n`
    )
  }
}

function printReadiness(label: string, report: ReadinessReport): void {
  process.stdout.write(`${label}: ${report.state}\n`)
  for (const check of report.checks) {
    process.stdout.write(`- ${check.name}: ${check.state} — ${check.detail}\n`)
  }
  if (report.state !== 'ready') {
    process.exitCode = report.state === 'blocked' ? 2 : 1
  }
}

async function verifyMacos(flags: readonly string[]): Promise<void> {
  const parsed = parseFlags(flags, [
    'architecture',
    'archive',
    'checksum',
    'trust-mode',
    'version'
  ])
  printMacosReport(await verifyMacosArtifact({
    architecture: parseMacosArchitecture(value(parsed, 'architecture')),
    archivePath: value(parsed, 'archive'),
    checksumPath: value(parsed, 'checksum'),
    trustMode: parseMacosTrustMode(value(parsed, 'trust-mode')),
    version: value(parsed, 'version')
  }))
}

async function verifyTag(flags: readonly string[]): Promise<void> {
  const parsed = parseFlags(
    flags,
    ['commit', 'main-ref', 'repository', 'tag'],
    ['github-output']
  )
  const report = verifyReleaseTag({
    commit: value(parsed, 'commit'),
    mainRef: value(parsed, 'main-ref'),
    repository: value(parsed, 'repository'),
    tag: value(parsed, 'tag')
  })
  process.stdout.write([
    'Release tag: verified',
    `Tag: ${report.tag}`,
    `Commit: ${report.commit}`,
    `Previous stable release: ${report.previousTag}`,
    ''
  ].join('\n'))
  const githubOutput = parsed.get('github-output')
  if (githubOutput) {
    await fs.appendFile(githubOutput, `previous-tag=${report.previousTag}\n`)
  }
}

async function verifyPayloads(flags: readonly string[]): Promise<void> {
  const parsed = parseFlags(flags, ['directory'])
  printPayloadReport(await verifyReleasePayloads(value(parsed, 'directory')))
}

async function comparePayloads(flags: readonly string[]): Promise<void> {
  const parsed = parseFlags(flags, ['actual', 'expected'])
  printPayloadReport(
    await compareReleasePayloads(
      value(parsed, 'expected'),
      value(parsed, 'actual')
    ),
    'Draft release payloads: unchanged'
  )
}

async function prepareRelease(flags: readonly string[]): Promise<void> {
  const parsed = parseFlags(flags, [
    'commit',
    'directory',
    'notes',
    'previous-tag',
    'repository',
    'run-id',
    'tag',
    'verification-directory'
  ])
  const notes = await generateReleaseNotes({
    commit: value(parsed, 'commit'),
    directory: value(parsed, 'directory'),
    previousTag: value(parsed, 'previous-tag'),
    repository: value(parsed, 'repository'),
    runId: value(parsed, 'run-id'),
    tag: value(parsed, 'tag'),
    verificationDirectory: value(parsed, 'verification-directory')
  })
  await fs.writeFile(value(parsed, 'notes'), notes)
  process.stdout.write([
    'Release draft inputs: verified',
    `Notes: ${value(parsed, 'notes')}`,
    'Trust: hardened ad-hoc (not Apple-verified)',
    ''
  ].join('\n'))
}

async function verifyDraft(flags: readonly string[]): Promise<void> {
  const parsed = parseFlags(flags, ['notes', 'release', 'tag'])
  await verifyDraftRelease({
    notesPath: value(parsed, 'notes'),
    releasePath: value(parsed, 'release'),
    tag: value(parsed, 'tag')
  })
  process.stdout.write('Draft release metadata: unchanged\n')
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [subcommand, ...flags] = args
  switch (subcommand) {
    case 'verify-macos':
      await verifyMacos(flags)
      return
    case 'verify-tag':
      await verifyTag(flags)
      return
    case 'verify-payloads':
      await verifyPayloads(flags)
      return
    case 'compare-payloads':
      await comparePayloads(flags)
      return
    case 'prepare-release':
      await prepareRelease(flags)
      return
    case 'verify-draft':
      await verifyDraft(flags)
      return
    case 'github-readiness': {
      const parsed = parseFlags(flags, ['repository'])
      printReadiness(
        'GitHub release readiness',
        githubReleaseReadiness(value(parsed, 'repository'))
      )
      return
    }
    case 'developer-id-readiness':
      parseFlags(flags, [])
      printReadiness('Developer ID readiness', developerIdReadiness())
      return
    default:
      throw new Error(
        subcommand === undefined
          ? 'A preflight subcommand is required.'
          : `Unknown preflight subcommand: ${subcommand}`
      )
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover release preflight: ${message}\n`)
    process.exitCode = 1
  })
}

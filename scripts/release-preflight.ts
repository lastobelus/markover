#!/usr/bin/env node

import {
  verifyMacosArtifact,
  type MacosArtifactReport
} from './macos-artifact-preflight'
import {
  parseMacosArchitecture,
  parseMacosTrustMode
} from './macos-release-contract'

interface ParsedArguments {
  architecture: string
  archive: string
  checksum: string
  trustMode: string
  version: string
}

function parseFlags(args: readonly string[]): ParsedArguments {
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
  const expected = ['architecture', 'archive', 'checksum', 'trust-mode', 'version']
  for (const name of expected) {
    if (!values.has(name)) throw new Error(`Missing argument: --${name}`)
  }
  for (const name of values.keys()) {
    if (!expected.includes(name)) throw new Error(`Unknown argument: --${name}`)
  }
  return {
    architecture: values.get('architecture') ?? '',
    archive: values.get('archive') ?? '',
    checksum: values.get('checksum') ?? '',
    trustMode: values.get('trust-mode') ?? '',
    version: values.get('version') ?? ''
  }
}

function printReport(report: MacosArtifactReport): void {
  process.stdout.write([
    'macOS artifact preflight: verified',
    `Archive SHA-256: ${report.sha256}`,
    `Architecture: ${report.architecture}`,
    'Trust: hardened ad-hoc (not Apple-verified)',
    'Gatekeeper: rejected as expected for ad-hoc signing',
    ''
  ].join('\n'))
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [subcommand, ...flags] = args
  if (subcommand !== 'verify-macos') {
    throw new Error(
      subcommand === undefined
        ? 'A preflight subcommand is required.'
        : `Unknown preflight subcommand: ${subcommand}`
    )
  }
  const parsed = parseFlags(flags)
  const report = await verifyMacosArtifact({
    architecture: parseMacosArchitecture(parsed.architecture),
    archivePath: parsed.archive,
    checksumPath: parsed.checksum,
    trustMode: parseMacosTrustMode(parsed.trustMode),
    version: parsed.version
  })
  printReport(report)
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover release preflight: ${message}\n`)
    process.exit(1)
  })
}

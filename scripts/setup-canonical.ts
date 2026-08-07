#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'

import {
  canonicalDescriptorPath,
  discoverCheckoutRoot,
  writeCanonicalInstanceDescriptor
} from '../src/instance'

const projectDirectory = path.resolve(__dirname, '../..')

function currentBranch(checkout: string): string {
  const result = spawnSync(
    'git',
    ['branch', '--show-current'],
    { cwd: checkout, encoding: 'utf8' }
  )
  const branch = result.stdout.trim()
  if (result.error || result.status !== 0 || !branch) {
    throw new Error('Canonical setup requires a named checked-out branch.')
  }
  return branch
}

export async function setupCanonicalInstance(
  checkoutCandidate = projectDirectory,
  blessedBranch?: string,
  destination = canonicalDescriptorPath()
): Promise<{
    status: 'configured'
    identity: 'canonical'
    checkout: string
    blessedBranch: string
    descriptorPath: string
  }> {
  const checkout = await discoverCheckoutRoot(checkoutCandidate)
  const checkedOutBranch = currentBranch(checkout)
  const selectedBranch = blessedBranch?.trim() || checkedOutBranch
  if (selectedBranch !== checkedOutBranch) {
    throw new Error(
      `Cannot bless ${selectedBranch}: ${checkout} currently has ${checkedOutBranch} checked out.`
    )
  }
  await writeCanonicalInstanceDescriptor({
    version: 1,
    checkout,
    blessedBranch: selectedBranch
  }, { destination })
  return {
    status: 'configured',
    identity: 'canonical',
    checkout,
    blessedBranch: selectedBranch,
    descriptorPath: destination
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length > 1) {
    throw new Error('Usage: npm run setup:canonical -- [blessed-branch]')
  }
  const result = await setupCanonicalInstance(projectDirectory, args[0])
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover canonical setup: ${message}\n`)
    process.exitCode = 1
  })
}

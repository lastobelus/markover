#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

import {
  buildAddressedDevelopmentBundle,
  type AddressedDevelopmentBundle
} from './development-bundle'
import { resolveInstance, type ResolvedInstance } from '../src/instance'

export interface BuildConfiguredCanonicalBundleOptions {
  build?: (
    instance: ResolvedInstance
  ) => Promise<AddressedDevelopmentBundle>
  checkout?: string
  realpath?: (filePath: string) => Promise<string>
  resolve?: () => Promise<ResolvedInstance>
}

export async function buildConfiguredCanonicalBundle({
  build = buildAddressedDevelopmentBundle,
  checkout = path.resolve(__dirname, '../..'),
  realpath = fs.realpath,
  resolve = () => resolveInstance('canonical')
}: BuildConfiguredCanonicalBundleOptions = {}): Promise<
  AddressedDevelopmentBundle
> {
  const instance = await resolve()
  if (instance.identity.kind !== 'canonical' || !instance.checkout) {
    throw new Error('The configured canonical checkout is unavailable.')
  }
  const [configured, owner] = await Promise.all([
    realpath(instance.checkout),
    realpath(checkout)
  ])
  if (configured !== owner) {
    throw new Error(
      `Canonical packaging must run from its configured checkout: ${instance.checkout}`
    )
  }
  return build(instance)
}

async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length > 0) {
    throw new Error('Configured canonical packaging accepts no arguments.')
  }
  const result = await buildConfiguredCanonicalBundle()
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `markover canonical bundle: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  })
}

#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import * as esbuild from 'esbuild'

const buildDirectory = path.resolve(__dirname, '..')
const projectDirectory = path.resolve(buildDirectory, '..')
const output = path.join(
  projectDirectory,
  'packages',
  'cli',
  'bin',
  'markover.js'
)

export async function main(): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true })
  await esbuild.build({
    entryPoints: [path.join(buildDirectory, 'packages', 'cli', 'src', 'index.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    banner: { js: '#!/usr/bin/env node' },
    outfile: output
  })
  await fs.chmod(output, 0o755)
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover cli build: ${message}\n`)
    process.exit(1)
  })
}

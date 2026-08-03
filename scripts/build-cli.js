#!/usr/bin/env node

const fs = require('node:fs/promises')
const path = require('node:path')
const esbuild = require('esbuild')

const buildDirectory = path.resolve(__dirname, '..')
const projectDirectory = path.resolve(buildDirectory, '..')
const output = path.join(
  projectDirectory,
  'packages',
  'cli',
  'bin',
  'markover.js'
)

async function main() {
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
  main().catch((error) => {
    process.stderr.write(`markover cli build: ${error.message}\n`)
    process.exit(1)
  })
}

module.exports = { main }

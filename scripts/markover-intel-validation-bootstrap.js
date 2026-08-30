#!/usr/bin/env node

/* global __dirname, process, require */

const path = require('node:path')
const { buildSync } = require('esbuild')

const sourcePath = path.resolve(__dirname, 'markover-intel-validation.ts')
const outputPath = path.resolve(
  __dirname,
  '../build/scripts/markover-intel-validation-action.cjs'
)

try {
  buildSync({
    entryPoints: [sourcePath],
    outfile: outputPath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    sourcemap: 'inline',
    target: 'node22.13'
  })
  void require(outputPath).runMain()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[run-intel-validation] Bootstrap failed: ${message}\n`)
  process.exitCode = 1
}

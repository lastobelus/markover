/* global __dirname, process, require */

const path = require('node:path')
const { buildSync } = require('esbuild')

const outputPath = path.resolve(
  __dirname,
  '../build/scripts/development-watch-bootstrap.cjs'
)

function fail(error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`markover dev bootstrap: ${message}\n`)
  process.exitCode = 1
}

try {
  buildSync({
    entryPoints: [path.resolve(__dirname, 'development-watch.ts')],
    bundle: true,
    format: 'cjs',
    logLevel: 'silent',
    outfile: outputPath,
    packages: 'external',
    platform: 'node',
    sourcemap: 'inline',
    target: 'node26'
  })
  const watcher = require(outputPath)
  void Promise.resolve(watcher.main(process.argv.slice(2))).catch(fail)
} catch (error) {
  fail(error)
}

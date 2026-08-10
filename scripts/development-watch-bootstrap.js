/* global Buffer, __dirname, clearTimeout, process, require, setTimeout */

const { watch } = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')

const projectDirectory = path.resolve(__dirname, '..')
const outputPath = path.resolve(
  __dirname,
  '../build/scripts/development-watch-bootstrap.cjs'
)
const watchedDirectories = ['design/brand', 'scripts', 'src']
const watchedFiles = new Set([
  '.markover/development.json',
  'package.json',
  'tsconfig.build.json',
  'tsconfig.json'
])
const debounceMilliseconds = 120

function normalizedRelativePath(filePath) {
  return filePath.replaceAll(path.sep, '/').replace(/^\.\//, '')
}

function isBuildInput(filePath) {
  if (filePath === null) return true
  const relativePath = normalizedRelativePath(filePath)
  if (watchedFiles.has(relativePath)) return true
  return watchedDirectories.some((directory) => (
    relativePath === directory || relativePath.startsWith(`${directory}/`)
  ))
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`markover dev bootstrap: ${message}\n`)
}

function isArgumentError(error) {
  return error !== null &&
    typeof error === 'object' &&
    error.code === 'INVALID_START_ARGUMENT'
}

let starting = false
let started = false
let stopping = false
let timer = null
let developmentLoop = null

const bootstrapWatcher = watch(
  projectDirectory,
  { recursive: true },
  (_event, filename) => {
    const filePath = Buffer.isBuffer(filename)
      ? filename.toString('utf8')
      : filename
    if (started || !isBuildInput(filePath)) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void startWatcher()
    }, debounceMilliseconds)
  }
)

bootstrapWatcher.on('error', (error) => {
  fail(error)
  process.exitCode = 1
  bootstrapWatcher.close()
})

async function stop(signal) {
  if (stopping) return
  stopping = true
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  bootstrapWatcher.close()
  try {
    if (developmentLoop !== null) await developmentLoop.stop(signal)
  } catch (error) {
    fail(error)
    process.exitCode = 1
  } finally {
    process.exit(process.exitCode || 0)
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { void stop(signal) })
}

async function startWatcher() {
  if (starting || started) return
  starting = true
  let watcher
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
    const resolvedOutput = require.resolve(outputPath)
    delete require.cache[resolvedOutput]
    watcher = require(resolvedOutput)
  } catch (error) {
    fail(error)
    process.stderr.write(
      'markover dev bootstrap: Keeping the bootstrap watcher active.\n'
    )
    starting = false
    return
  }

  try {
    developmentLoop = await watcher.main(process.argv.slice(2))
    started = true
    bootstrapWatcher.close()
  } catch (error) {
    fail(error)
    if (isArgumentError(error)) {
      process.exitCode = 1
      bootstrapWatcher.close()
    } else {
      process.stderr.write(
        'markover dev bootstrap: Keeping the bootstrap watcher active.\n'
      )
    }
  } finally {
    starting = false
  }
}

void startWatcher()

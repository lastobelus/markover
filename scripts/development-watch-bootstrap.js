/* global Buffer, __dirname, clearTimeout, process, require, setTimeout */

const { watch } = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')

const projectDirectory = path.resolve(__dirname, '..')
const outputPath = path.resolve(
  __dirname,
  '../build/scripts/development-watch-bootstrap.cjs'
)
const watchedDirectories = [
  'design/brand',
  'packages/cli/src',
  'scripts',
  'src',
  'test'
]
const watchedFiles = new Set([
  '.markover/development.json',
  'docs/user/site.ts',
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
let completedRevision = 0
let revision = 0
let transition = null
let watcherInputs = new Set()

function normalizedBundleInput(filePath) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(projectDirectory, filePath)
  return normalizedRelativePath(path.relative(projectDirectory, absolutePath))
}

function isWatcherInput(filePath) {
  if (filePath === null) return true
  return watcherInputs.has(normalizedRelativePath(filePath))
}

function scheduleWatcherStart() {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void startWatcher()
  }, debounceMilliseconds)
}

function requestWatcherStart() {
  revision += 1
  scheduleWatcherStart()
}

const bootstrapWatcher = watch(
  projectDirectory,
  { recursive: true },
  (_event, filename) => {
    const filePath = Buffer.isBuffer(filename)
      ? filename.toString('utf8')
      : filename
    if (!isBuildInput(filePath)) return
    if (!started || starting || isWatcherInput(filePath)) {
      requestWatcherStart()
    } else {
      developmentLoop.notify(filePath)
    }
  }
)

bootstrapWatcher.on('error', (error) => {
  fail(error)
  process.exitCode = 1
  void stop('SIGHUP')
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
    if (transition !== null) await transition
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
  if (starting || stopping) return
  starting = true
  const targetRevision = revision
  transition = (async () => {
    let watcher
    let buildResult
    try {
      if (developmentLoop !== null) {
        const previousLoop = developmentLoop
        developmentLoop = null
        started = false
        await previousLoop.stop('SIGHUP')
      }
      if (stopping) return
      buildResult = buildSync({
        entryPoints: [path.resolve(__dirname, 'development-watch.ts')],
        bundle: true,
        format: 'cjs',
        logLevel: 'silent',
        metafile: true,
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
      return
    }

    try {
      if (stopping) return
      developmentLoop = await watcher.main(
        process.argv.slice(2),
        { externalWatch: true }
      )
      watcherInputs = new Set(
        Object.keys(buildResult.metafile.inputs).map(normalizedBundleInput)
      )
      started = true
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
    }
  })().finally(() => {
    completedRevision = targetRevision
    starting = false
    transition = null
    if (!stopping && completedRevision < revision) scheduleWatcherStart()
  })
  await transition
}

revision += 1
void startWatcher()

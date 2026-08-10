/* global Buffer, __dirname, __filename, clearTimeout, process, require, setTimeout */

const { readFileSync, watch } = require('node:fs')
const path = require('node:path')
const { Script } = require('node:vm')
const { buildSync } = require('esbuild')

const projectDirectory = path.resolve(__dirname, '..')
const outputPath = path.resolve(
  __dirname,
  '../build/scripts/development-watch-bootstrap.cjs'
)
const watchedDirectories = [
  '.github',
  'design/brand',
  'docs',
  'examples',
  'packages/cli/src',
  'scripts',
  'src',
  'test'
]
const watchedFiles = new Set([
  '.markover/development.json',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'favicon.svg',
  'package.json',
  'packages/cli/package.json',
  'tsconfig.build.json',
  'tsconfig.json'
])
const debounceMilliseconds = 120
const bootstrapSourcePath = normalizedRelativePath(
  path.relative(projectDirectory, __filename)
)

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

function preflightBootstrapSource(source) {
  const inertWatcher = {
    close() {},
    on() { return inertWatcher }
  }
  const inertLoop = {
    notify() { return true },
    start() {},
    stop() { return Promise.resolve() }
  }
  const preflightRequire = (specifier) => {
    if (specifier === 'node:fs') {
      return {
        readFileSync,
        watch() { return inertWatcher }
      }
    }
    if (specifier === 'node:path') return path
    if (specifier === 'node:vm') return { Script }
    if (specifier === 'esbuild') {
      return {
        buildSync() { return { metafile: { inputs: {} } } }
      }
    }
    return { main() { return Promise.resolve(inertLoop) } }
  }
  preflightRequire.cache = {}
  preflightRequire.resolve = (specifier) => specifier
  const preflightProcess = {
    argv: ['node', __filename, ...process.argv.slice(2)],
    exit(code) { throw new Error(`Bootstrap preflight exited ${String(code)}.`) },
    exitCode: 0,
    off() {},
    on() {},
    stderr: { write() {} }
  }
  const inertTimer = () => ({})
  new Script(source, { filename: __filename }).runInNewContext({
    Buffer,
    __dirname,
    __filename,
    clearTimeout() {},
    process: preflightProcess,
    require: preflightRequire,
    setTimeout: inertTimer
  })
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
let bootstrapReloadRequested = false
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
    if (bootstrapReloadRequested) {
      bootstrapReloadRequested = false
      void reloadBootstrap()
    } else {
      void startWatcher()
    }
  }, debounceMilliseconds)
}

function requestWatcherStart() {
  revision += 1
  scheduleWatcherStart()
}

function requestBootstrapReload() {
  bootstrapReloadRequested = true
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
    if (
      filePath !== null &&
      normalizedRelativePath(filePath) === bootstrapSourcePath
    ) {
      requestBootstrapReload()
      return
    }
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

const signalHandlers = new Map()
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  const handler = () => { void stop(signal) }
  signalHandlers.set(signal, handler)
  process.on(signal, handler)
}

function removeSignalHandlers() {
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler)
  }
  signalHandlers.clear()
}

async function reloadBootstrap() {
  if (stopping) return
  try {
    preflightBootstrapSource(readFileSync(__filename, 'utf8'))
  } catch (error) {
    fail(error)
    process.stderr.write(
      'markover dev bootstrap: Keeping the current watcher active.\n'
    )
    return
  }
  stopping = true
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  bootstrapWatcher.close()
  removeSignalHandlers()
  try {
    if (transition !== null) await transition
    if (developmentLoop !== null) await developmentLoop.stop('SIGHUP')
    const resolvedBootstrap = require.resolve(__filename)
    delete require.cache[resolvedBootstrap]
    require(resolvedBootstrap)
  } catch (error) {
    fail(error)
    process.exit(1)
  }
}

async function startWatcher() {
  if (starting || stopping) return
  starting = true
  const targetRevision = revision
  transition = (async () => {
    let watcher
    let buildResult
    let candidateLoop
    try {
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
      candidateLoop = await watcher.main(
        process.argv.slice(2),
        { deferStart: true, externalWatch: true }
      )
    } catch (error) {
      fail(error)
      if (isArgumentError(error) && developmentLoop === null) {
        process.exitCode = 1
        bootstrapWatcher.close()
        return
      }
      process.stderr.write(
        'markover dev bootstrap: Keeping the bootstrap watcher active.\n'
      )
      return
    }

    try {
      if (stopping) return
      if (developmentLoop !== null) {
        const previousLoop = developmentLoop
        await previousLoop.stop('SIGHUP')
      }
      if (stopping) return
      developmentLoop = candidateLoop
      watcherInputs = new Set(
        Object.keys(buildResult.metafile.inputs).map(normalizedBundleInput)
      )
      started = true
      developmentLoop.start()
    } catch (error) {
      fail(error)
      process.stderr.write(
        'markover dev bootstrap: Keeping the bootstrap watcher active.\n'
      )
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

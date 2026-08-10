import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import {
  DevelopmentInstanceManager,
  DevelopmentWatchController,
  isDevelopmentBuildInput,
  type DevelopmentProcess
} from '../scripts/development-watch'
import { parseStartArguments, StartArgumentError } from '../scripts/start'
import type { ResolvedInstance } from '../src/instance'

const projectDirectory = path.resolve(__dirname, '../..')

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitUntil(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return
    await wait(1)
  }
  throw new Error('Condition did not become true.')
}

function canonicalInstance(
  status: 'running' | 'stopped',
  checkout = '/checkouts/markover'
): ResolvedInstance {
  return {
    version: 1,
    identity: { kind: 'canonical', key: 'canonical' },
    stateRoot: '/state/markover',
    checkout,
    service: {
      root: '/state/markover',
      endpointPath: '/state/markover/service.json',
      tokenPath: '/state/markover/service.token',
      singleInstanceLockRoot: '/state/markover'
    },
    scheme: 'markover',
    process: { status },
    coldStart: status === 'running'
      ? { eligible: false, blockedBy: 'already-running' }
      : { eligible: true, blockedBy: null },
    branding: {
      appName: 'Markover',
      headerBadge: null,
      iconLabel: null,
      iconSvgPath: 'design/brand/markover-mark.svg',
      iconPngPath: 'design/brand/markover-app-icon.png',
      iconIcnsPath: 'design/brand/markover-app-icon.icns'
    },
    pullRequest: null
  }
}

test('development command bootstraps before the first application build', async () => {
  const manifest: unknown = JSON.parse(await fs.readFile(
    path.join(projectDirectory, 'package.json'),
    'utf8'
  ))
  assert.ok(manifest && typeof manifest === 'object')
  const scripts: unknown = Reflect.get(manifest, 'scripts')
  assert.ok(scripts && typeof scripts === 'object')
  assert.equal(
    Reflect.get(scripts, 'dev'),
    'node scripts/development-watch-bootstrap.js'
  )

  const bootstrap = await fs.readFile(
    path.join(projectDirectory, 'scripts/development-watch-bootstrap.js'),
    'utf8'
  )
  assert.match(bootstrap, /buildSync/)
  assert.match(bootstrap, /watch\(/)
  assert.match(bootstrap, /metafile: true/)
  assert.match(bootstrap, /isWatcherInput\(filePath\)/)
  assert.match(bootstrap, /developmentLoop\.notify\(filePath\)/)
  assert.match(bootstrap, /externalWatch: true/)
  assert.match(bootstrap, /Keeping the bootstrap watcher active/)
  assert.match(bootstrap, /INVALID_START_ARGUMENT/)
  assert.doesNotMatch(bootstrap, /npm run build/)
})

test('invalid development arguments remain non-retryable bootstrap errors', () => {
  assert.throws(
    () => parseStartArguments(['--instance', 'invalid']),
    StartArgumentError
  )
})

test('bootstrap reloads watcher inputs and delegates application inputs', async () => {
  const source = await fs.readFile(
    path.join(projectDirectory, 'scripts/development-watch-bootstrap.js'),
    'utf8'
  )
  const notifications: Array<string | null> = []
  const exits: number[] = []
  const stops: NodeJS.Signals[] = []
  const timers: Array<() => void> = []
  let mainCalls = 0
  let watchCallback: (
    event: string,
    filename: string | Buffer | null
  ) => void = () => {}
  let watchError: (error: Error) => void = () => {}
  const bootstrapWatcher = {
    close() {},
    on(event: string, listener: (error: Error) => void) {
      if (event === 'error') watchError = listener
      return bootstrapWatcher
    }
  }
  const bundledWatcher = {
    main() {
      mainCalls += 1
      return Promise.resolve({
        notify(filePath: string | null) {
          notifications.push(filePath)
          return true
        },
        stop(signal: NodeJS.Signals) {
          stops.push(signal)
          return Promise.resolve()
        }
      })
    }
  }
  const requireStub = ((specifier: string) => {
    if (specifier === 'node:fs') {
      return {
        watch(
          _directory: string,
          _options: unknown,
          callback: typeof watchCallback
        ) {
          watchCallback = callback
          return bootstrapWatcher
        }
      }
    }
    if (specifier === 'node:path') return path
    if (specifier === 'esbuild') {
      return {
        buildSync() {
          return {
            metafile: {
              inputs: {
                'scripts/development-watch.ts': {},
                'src/instance.ts': {}
              }
            }
          }
        }
      }
    }
    return bundledWatcher
  }) as NodeJS.Require
  const resolveStub = ((specifier: string) => specifier) as NodeJS.RequireResolve
  resolveStub.paths = () => null
  requireStub.resolve = resolveStub
  requireStub.cache = {}

  vm.runInNewContext(source, {
    Buffer,
    __dirname: path.join(projectDirectory, 'scripts'),
    clearTimeout() {},
    process: {
      argv: ['node', 'development-watch-bootstrap.js'],
      exit(code: number) { exits.push(code) },
      exitCode: 0,
      on() {},
      stderr: { write() {} }
    },
    require: requireStub,
    setTimeout(callback: () => void) {
      timers.push(callback)
      return timers.length
    }
  })
  await waitUntil(() => mainCalls === 1)
  await wait(1)

  watchCallback('change', 'src/renderer.ts')
  assert.deepEqual(notifications, ['src/renderer.ts'])
  assert.deepEqual(stops, [])

  watchCallback('change', 'src/instance.ts')
  assert.equal(timers.length, 1)
  timers.shift()?.()
  await waitUntil(() => mainCalls === 2)

  assert.deepEqual(stops, ['SIGHUP'])

  watchError(new Error('recursive watch failed'))
  await waitUntil(() => exits.length === 1)

  assert.deepEqual(stops, ['SIGHUP', 'SIGHUP'])
  assert.deepEqual(exits, [1])
})

test('development build inputs exclude generated and unrelated paths', () => {
  for (const filePath of [
    'src/renderer.ts',
    'scripts/build-app.ts',
    '.github/workflows/ci.yml',
    'design/brand/markover-mark.svg',
    'docs/developer/development.md',
    'docs/user/site.ts',
    'examples/review.md',
    'packages/cli/src/index.ts',
    'test/development-watch.test.ts',
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'favicon.svg',
    'package.json',
    'packages/cli/package.json',
    'tsconfig.json',
    '.markover/development.json'
  ]) assert.equal(isDevelopmentBuildInput(filePath), true, filePath)

  for (const filePath of [
    'build/app/src/renderer.js',
    'node_modules/electron/index.js',
    '.git/index',
    '.markover/generated/pr-85/icon.png',
    '.markover/instance/service.json'
  ]) assert.equal(isDevelopmentBuildInput(filePath), false, filePath)
})

test('rapid changes coalesce into one build and restart', async () => {
  let builds = 0
  let restarts = 0
  const controller = new DevelopmentWatchController({
    build() {
      builds += 1
      return Promise.resolve()
    },
    restart() {
      restarts += 1
      return Promise.resolve()
    }
  }, { debounceMilliseconds: 2 })

  controller.notify('src/renderer.ts')
  controller.notify('src/styles.css')
  controller.notify('src/index.html')
  await controller.waitForIdle()

  assert.equal(builds, 1)
  assert.equal(restarts, 1)
  controller.close()
})

test('a failed build keeps watching and the next valid change restarts', async () => {
  let builds = 0
  let restarts = 0
  const failures: unknown[] = []
  const controller = new DevelopmentWatchController({
    build() {
      builds += 1
      return builds === 1
        ? Promise.reject(new Error('compile failed'))
        : Promise.resolve()
    },
    restart() {
      restarts += 1
      return Promise.resolve()
    },
    reportError(error) {
      failures.push(error)
    }
  }, { debounceMilliseconds: 2 })

  controller.notify('src/renderer.ts')
  await controller.waitForIdle()
  assert.equal(builds, 1)
  assert.equal(restarts, 0)
  assert.match(String(failures[0]), /compile failed/)

  controller.notify('src/renderer.ts')
  await controller.waitForIdle()
  assert.equal(builds, 2)
  assert.equal(restarts, 1)
  controller.close()
})

test('changes during a build queue one serialized follow-up cycle', async () => {
  let builds = 0
  let activeOperations = 0
  let maximumActiveOperations = 0
  let releaseFirstBuild: () => void = () => {}
  const firstBuild = new Promise<void>((resolve) => {
    releaseFirstBuild = resolve
  })
  const controller = new DevelopmentWatchController({
    async build() {
      builds += 1
      activeOperations += 1
      maximumActiveOperations = Math.max(
        maximumActiveOperations,
        activeOperations
      )
      if (builds === 1) await firstBuild
      activeOperations -= 1
    },
    async restart() {
      activeOperations += 1
      maximumActiveOperations = Math.max(
        maximumActiveOperations,
        activeOperations
      )
      await Promise.resolve()
      activeOperations -= 1
    }
  }, { debounceMilliseconds: 2 })

  controller.notify('src/renderer.ts')
  await waitUntil(() => builds === 1)
  controller.notify('src/styles.css')
  controller.notify('src/index.html')
  await wait(5)
  assert.equal(builds, 1)
  releaseFirstBuild()
  await controller.waitForIdle()

  assert.equal(builds, 2)
  assert.equal(maximumActiveOperations, 1)
  controller.close()
})

test('restart waits for the addressed process before launching the same target', async () => {
  const events: string[] = []
  let running = true
  let resolveCalls = 0
  const launched: DevelopmentProcess = {
    exitCode: null,
    pid: 90211,
    signalCode: null
  }
  const manager = new DevelopmentInstanceManager(
    canonicalInstance('running'),
    ['--example'],
    {
      checkoutDirectory: '/checkouts/markover',
      isProcessAlive() {
        return running
      },
      quit(endpointPath) {
        events.push(`quit:${endpointPath}`)
        running = false
        return Promise.resolve()
      },
      launch(instance, appArguments) {
        events.push(
          `launch:${instance.identity.key}:${appArguments.join(',')}`
        )
        return launched
      },
      probe(endpointPath) {
        events.push(`ready:${endpointPath}`)
        return Promise.resolve()
      },
      readProcessEndpoint() {
        return Promise.resolve({ pid: 90210 })
      },
      resolve() {
        resolveCalls += 1
        return Promise.resolve(canonicalInstance(
          resolveCalls === 1 ? 'running' : 'stopped'
        ))
      },
      wait() {
        return Promise.resolve()
      }
    }
  )

  await manager.restart()

  assert.deepEqual(events, [
    'quit:/state/markover/service.json',
    'launch:canonical:--example',
    'ready:/state/markover/service.json'
  ])
})

test('restart fails closed when resolution changes checkout identity', async () => {
  let killed = false
  const manager = new DevelopmentInstanceManager(
    canonicalInstance('running'),
    [],
    {
      checkoutDirectory: '/checkouts/markover',
      quit() {
        killed = true
        return Promise.resolve()
      },
      resolve() {
        return Promise.resolve(canonicalInstance(
          'running',
          path.join('/different', 'checkout')
        ))
      }
    }
  )

  await assert.rejects(manager.restart(), /does not match watched canonical/)
  assert.equal(killed, false)
})

test('loop stop requests managed quit and waits for the addressed process', async () => {
  const events: string[] = []
  let running = true
  const manager = new DevelopmentInstanceManager(
    canonicalInstance('running'),
    [],
    {
      checkoutDirectory: '/checkouts/markover',
      isProcessAlive() {
        return running
      },
      quit(endpointPath) {
        events.push(`quit:${endpointPath}`)
        running = false
        return Promise.resolve()
      },
      readProcessEndpoint() {
        return Promise.resolve({ pid: 90210 })
      },
      resolve() {
        return Promise.resolve(canonicalInstance('running'))
      },
      wait() {
        return Promise.resolve()
      }
    }
  )

  await manager.stop()

  assert.deepEqual(events, ['quit:/state/markover/service.json'])
})

test('a watcher-owned process without a service quits through its control channel', async () => {
  const events: string[] = []
  let running = false
  let launches = 0
  const manager = new DevelopmentInstanceManager(
    canonicalInstance('stopped'),
    [],
    {
      checkoutDirectory: '/checkouts/markover',
      isProcessAlive() {
        return running
      },
      launch() {
        launches += 1
        running = true
        return {
          exitCode: null,
          pid: 90211,
          send(message) {
            events.push(`control:${JSON.stringify(message)}`)
            running = false
            return true
          },
          signalCode: null
        }
      },
      probe() {
        return Promise.resolve()
      },
      resolve() {
        return Promise.resolve(canonicalInstance('stopped'))
      },
      wait() {
        return Promise.resolve()
      }
    }
  )

  await manager.restart()
  await manager.restart()

  assert.equal(launches, 2)
  assert.deepEqual(events, [
    'control:{"action":"quit","type":"markover-development-control","version":1}'
  ])
})

test('an owned process falls back to control when its quit route fails', async () => {
  const events: string[] = []
  let launches = 0
  let running = false
  const manager = new DevelopmentInstanceManager(
    canonicalInstance('stopped'),
    [],
    {
      checkoutDirectory: '/checkouts/markover',
      isProcessAlive() {
        return running
      },
      launch() {
        launches += 1
        running = true
        return {
          exitCode: null,
          pid: 90211,
          send(message) {
            events.push(`control:${JSON.stringify(message)}`)
            running = false
            return true
          },
          signalCode: null
        }
      },
      probe() {
        return Promise.resolve()
      },
      quit(endpointPath) {
        events.push(`quit:${endpointPath}`)
        return Promise.reject(new Error('quit route unavailable'))
      },
      readProcessEndpoint() {
        return Promise.resolve({ pid: 90211 })
      },
      resolve() {
        return Promise.resolve(canonicalInstance('stopped'))
      },
      wait() {
        return Promise.resolve()
      }
    }
  )

  await manager.restart()
  await manager.restart()

  assert.equal(launches, 2)
  assert.deepEqual(events, [
    'quit:/state/markover/service.json',
    'control:{"action":"quit","type":"markover-development-control","version":1}'
  ])
})

test('stop owns a pre-service process before unavailable PR resolution', async () => {
  const events: string[] = []
  let probeCalls = 0
  let resolutionCalls = 0
  let running = false
  const manager = new DevelopmentInstanceManager(
    canonicalInstance('stopped'),
    [],
    {
      checkoutDirectory: '/checkouts/markover',
      isProcessAlive() {
        return running
      },
      launch() {
        running = true
        return {
          exitCode: null,
          pid: 90211,
          send(message) {
            events.push(`control:${JSON.stringify(message)}`)
            running = false
            return true
          },
          signalCode: null
        }
      },
      probe() {
        probeCalls += 1
        return probeCalls === 1
          ? Promise.resolve()
          : Promise.reject(new Error('service unavailable'))
      },
      resolve() {
        resolutionCalls += 1
        if (resolutionCalls > 2) {
          return Promise.reject(new Error('GitHub unavailable'))
        }
        return Promise.resolve(canonicalInstance('stopped'))
      },
      wait() {
        return Promise.resolve()
      }
    }
  )

  await manager.restart()
  await manager.stop()

  assert.equal(resolutionCalls, 2)
  assert.deepEqual(events, [
    'control:{"action":"quit","type":"markover-development-control","version":1}'
  ])
})

test('an asynchronous spawn error stays inside the recoverable cycle', async () => {
  let launches = 0
  const failedLaunchEmitter = new EventEmitter()
  const failedLaunch = Object.assign(failedLaunchEmitter, {
    exitCode: null,
    pid: undefined,
    signalCode: null
  }) as DevelopmentProcess
  const manager = new DevelopmentInstanceManager(
    canonicalInstance('stopped'),
    [],
    {
      checkoutDirectory: '/checkouts/markover',
      launch() {
        launches += 1
        if (launches === 1) {
          setImmediate(() => failedLaunchEmitter.emit(
            'error',
            new Error('spawn Electron EACCES')
          ))
          return failedLaunch
        }
        return {
          exitCode: null,
          pid: 90211,
          signalCode: null
        }
      },
      probe() {
        return Promise.resolve()
      },
      resolve() {
        return Promise.resolve(canonicalInstance('stopped'))
      }
    }
  )

  await assert.rejects(manager.restart(), /spawn Electron EACCES/)
  await manager.restart()

  assert.equal(launches, 2)
})

test('watcher refuses a running instance owned by another checkout', () => {
  assert.throws(
    () => new DevelopmentInstanceManager(
      canonicalInstance('running'),
      [],
      { checkoutDirectory: '/checkouts/feature' }
    ),
    /run the loop from its owning checkout \/checkouts\/markover/
  )
})

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  DevelopmentInstanceManager,
  DevelopmentWatchController,
  isDevelopmentBuildInput,
  type DevelopmentProcess
} from '../scripts/development-watch'
import type { ResolvedInstance } from '../src/instance'

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

test('development build inputs exclude generated and unrelated paths', () => {
  for (const filePath of [
    'src/renderer.ts',
    'scripts/build-app.ts',
    'design/brand/markover-mark.svg',
    'package.json',
    'tsconfig.json',
    '.markover/development.json'
  ]) assert.equal(isDevelopmentBuildInput(filePath), true, filePath)

  for (const filePath of [
    'build/app/src/renderer.js',
    'node_modules/electron/index.js',
    '.git/index',
    '.markover/generated/pr-85/icon.png',
    '.markover/instance/service.json',
    'docs/developer/development.md'
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
      isProcessAlive() {
        return running
      },
      killProcess(pid, signal) {
        events.push(`kill:${String(pid)}:${signal}`)
        running = false
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
    'kill:90210:SIGTERM',
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
      killProcess() {
        killed = true
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

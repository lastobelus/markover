import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  assertCanonicalReviewRoutingReady,
  inspectCanonicalHealth,
  parseStartupDiagnosticSnapshot
} from '../src/canonical-maintenance'
import { canonicalApplicationAddress } from '../src/canonical-application'
import type { ResolvedInstance } from '../src/instance'
import type { LinkHandlerStatus } from '../src/link-handler'

function handler(
  status: LinkHandlerStatus['status'],
  ownerPath = '/handlers/Markover Development Link Handler.app'
): LinkHandlerStatus {
  return {
    format: 'markover-link-handler-status',
    version: 1,
    scheme: 'markover',
    status,
    expectedPath: '/handlers/Markover Development Link Handler.app',
    ownerPath,
    identity: 'canonical',
    endpointPath: '/state/service.json'
  }
}

function canonicalInstance(checkout: string, stateRoot: string): ResolvedInstance {
  return {
    version: 1,
    identity: { kind: 'canonical', key: 'canonical' },
    stateRoot,
    checkout,
    service: {
      root: stateRoot,
      endpointPath: path.join(stateRoot, 'service.json'),
      tokenPath: path.join(stateRoot, 'service.token'),
      singleInstanceLockRoot: stateRoot
    },
    scheme: 'markover',
    process: { status: 'running' },
    coldStart: { eligible: false, blockedBy: 'already-running' },
    branding: {
      appName: 'Markover',
      headerBadge: null,
      iconLabel: null,
      iconSvgPath: 'design/brand/markover-app-icon.svg',
      iconPngPath: 'design/brand/markover-app-icon.png',
      iconIcnsPath: 'design/brand/markover-app-icon.icns'
    },
    pullRequest: null
  }
}

test('startup diagnostic parsing fails closed', () => {
  assert.equal(parseStartupDiagnosticSnapshot({ version: 1 }), null)
  assert.deepEqual(parseStartupDiagnosticSnapshot({
    format: 'markover-startup-diagnostic',
    version: 1,
    status: 'ready',
    build: {
      version: '0.1.3',
      commit: 'abc123',
      dirty: false,
      rendererSha256: 'sha256'
    }
  }), {
    status: 'ready',
    build: {
      version: '0.1.3',
      commit: 'abc123',
      dirty: false,
      rendererSha256: 'sha256'
    }
  })
})

test('doctor requires a clean matching build and exact healthy URI owner', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-doctor-'))
  const checkout = path.join(directory, 'main')
  const stateRoot = path.join(directory, 'state')
  await fs.mkdir(checkout)
  await fs.mkdir(stateRoot)
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  assert.equal(spawnSync('git', ['init', '-b', 'main'], {
    cwd: checkout,
    encoding: 'utf8'
  }).status, 0)
  await fs.writeFile(path.join(checkout, 'README.md'), 'Markover\n')
  assert.equal(spawnSync('git', ['add', 'README.md'], {
    cwd: checkout,
    encoding: 'utf8'
  }).status, 0)
  assert.equal(spawnSync('git', [
    '-c', 'user.name=Markover Test',
    '-c', 'user.email=markover@example.test',
    'commit', '-m', 'initial'
  ], {
    cwd: checkout,
    encoding: 'utf8'
  }).status, 0)
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: checkout,
    encoding: 'utf8'
  }).stdout.trim()
  await fs.writeFile(
    path.join(stateRoot, 'startup-diagnostic.json'),
    JSON.stringify({
      format: 'markover-startup-diagnostic',
      version: 1,
      status: 'ready',
      build: {
        version: '0.1.3',
        commit: head,
        dirty: false,
        rendererSha256: 'sha256'
      }
    })
  )
  const instance = canonicalInstance(checkout, stateRoot)
  const application = canonicalApplicationAddress(instance)
  const healthy = await inspectCanonicalHealth(instance, {
    inspectHandler: () => Promise.resolve(handler('healthy')),
    probe: () => Promise.resolve({
      endpoint: { instanceId: 'instance-id', pid: 123 },
      executablePath: application.generatedExecutablePath,
      windowVisible: true
    }),
    readBundleIdentifier: () => application.bundleIdentifier
  })
  assert.equal(healthy.status, 'healthy')
  assert.equal(healthy.application.status, 'current')
  assert.equal(healthy.application.source, 'generated')
  assert.equal(healthy.build.status, 'current')
  assert.equal(healthy.window.status, 'electron-visible')
  assert.equal(healthy.repairCommand, null)

  const displaced = await inspectCanonicalHealth(instance, {
    inspectHandler: () => Promise.resolve(handler(
      'conflicting',
      '/worktree/dist/Markover.app'
    )),
    probe: () => Promise.resolve({
      endpoint: { instanceId: 'instance-id', pid: 123 },
      executablePath: application.generatedExecutablePath,
      windowVisible: false
    }),
    readBundleIdentifier: () => application.bundleIdentifier
  })
  assert.equal(displaced.status, 'unhealthy')
  assert.equal(displaced.window.status, 'electron-hidden')
  assert.match(displaced.issues.join(' '), /worktree\/dist\/Markover\.app/)
  assert.match(displaced.repairCommand || '', /canonical refresh/)
})

test('doctor rejects a raw or wrongly identified canonical executable', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-runtime-doctor-'))
  const checkout = path.join(directory, 'main')
  const stateRoot = path.join(directory, 'state')
  await fs.mkdir(checkout)
  await fs.mkdir(stateRoot)
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  assert.equal(spawnSync('git', ['init', '-b', 'main'], {
    cwd: checkout,
    encoding: 'utf8'
  }).status, 0)
  await fs.writeFile(path.join(checkout, 'README.md'), 'Markover\n')
  assert.equal(spawnSync('git', ['add', 'README.md'], {
    cwd: checkout,
    encoding: 'utf8'
  }).status, 0)
  assert.equal(spawnSync('git', [
    '-c', 'user.name=Markover Test',
    '-c', 'user.email=markover@example.test',
    'commit', '-m', 'initial'
  ], { cwd: checkout, encoding: 'utf8' }).status, 0)
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: checkout,
    encoding: 'utf8'
  }).stdout.trim()
  await fs.writeFile(path.join(stateRoot, 'startup-diagnostic.json'), JSON.stringify({
    format: 'markover-startup-diagnostic',
    version: 1,
    status: 'ready',
    build: {
      version: '0.1.3',
      commit: head,
      dirty: false,
      rendererSha256: 'sha256'
    }
  }))
  const instance = canonicalInstance(checkout, stateRoot)
  const raw = await inspectCanonicalHealth(instance, {
    inspectHandler: () => Promise.resolve(handler('healthy')),
    probe: () => Promise.resolve({
      endpoint: { instanceId: 'instance-id', pid: 123 },
      executablePath: '/Applications/Electron.app/Contents/MacOS/Electron',
      windowVisible: true
    }),
    readBundleIdentifier: () => 'com.github.Electron'
  })
  assert.equal(raw.status, 'unhealthy')
  assert.equal(raw.application.status, 'mismatch')
  assert.match(raw.issues.join(' '), /not an exact addressed canonical application/)
})

test('canonical review creation fails before returning a broken URI', async () => {
  const instance = canonicalInstance('/canonical', '/state')
  await assert.rejects(
    assertCanonicalReviewRoutingReady(
      instance,
      () => Promise.resolve(handler(
        'conflicting',
        '/worktree/dist/Markover.app'
      ))
    ),
    (error: unknown) => error instanceof Error &&
      /Cannot create a canonical review/.test(error.message) &&
      /canonical refresh/.test(error.message)
  )
})

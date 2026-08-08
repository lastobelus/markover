import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { ResolvedInstance } from '../src/instance'
import {
  inspectLinkHandler,
  installLinkHandler,
  linkHandlerAppPath,
  linkHandlerBinding,
  linkHandlerBundleId,
  linkHandlerDisplayName,
  parseLinkHandlerBinding,
  removeLinkHandler
} from '../src/link-handler'

const testMacos = process.platform === 'darwin' ? test : test.skip

function canonicalInstance(stateRoot: string): ResolvedInstance {
  return {
    version: 1,
    identity: { kind: 'canonical', key: 'canonical' },
    stateRoot,
    checkout: null,
    service: {
      root: stateRoot,
      endpointPath: path.join(stateRoot, 'service.json'),
      tokenPath: path.join(stateRoot, 'service.token'),
      singleInstanceLockRoot: stateRoot
    },
    scheme: 'markover',
    process: { status: 'stopped' },
    coldStart: {
      eligible: false,
      blockedBy: 'canonical-descriptor-missing'
    },
    branding: {
      appName: 'Markover',
      headerBadge: null,
      iconLabel: null,
      iconSvgPath: '/missing/icon.svg',
      iconPngPath: '/missing/icon.png',
      iconIcnsPath: '/missing/icon.icns'
    },
    pullRequest: null
  }
}

test('bindings and bundle identities are exact for canonical and PR schemes', () => {
  assert.equal(
    linkHandlerDisplayName('markover'),
    'Markover Development Link Handler'
  )
  assert.equal(
    linkHandlerDisplayName('markover-76'),
    'Markover PR 76 Link Handler'
  )
  assert.equal(
    linkHandlerBundleId('markover-76'),
    'com.lastobelus.markover.link-handler.pr.76'
  )
  assert.throws(() => linkHandlerDisplayName('markover-dev'), /Expected markover/)
})

testMacos('generates, claims, inspects, and removes one recoverable exact handler', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-handler-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const stateRoot = path.join(directory, 'state')
  const handlerRoot = path.join(directory, 'handlers')
  await fs.mkdir(stateRoot)
  const instance = canonicalInstance(stateRoot)
  let ownerPath: string | null = null
  const options = {
    handlerRoot,
    inspectOwner: () => Promise.resolve(ownerPath),
    probe: () => Promise.resolve(false),
    register(appPath: string) {
      ownerPath = appPath
      return Promise.resolve()
    },
    unregister() {
      ownerPath = null
      return Promise.resolve()
    }
  }

  const installed = await installLinkHandler('install', instance, options)
  assert.equal(installed.action, 'installed')
  assert.equal(installed.status, 'exact')
  const appPath = linkHandlerAppPath('markover', handlerRoot)
  assert.equal(installed.expectedPath, appPath)
  assert.equal(await fs.stat(
    path.join(appPath, 'Contents/MacOS/MarkoverLinkHandler')
  ).then((stats) => stats.isFile()), true)
  const plist = await fs.readFile(
    path.join(appPath, 'Contents/Info.plist'),
    'utf8'
  )
  assert.match(plist, /<key>LSUIElement<\/key>\s*<true\/>/)
  assert.match(plist, /<string>markover<\/string>/)
  assert.doesNotMatch(plist, /markover-/)
  const bindingValue: unknown = JSON.parse(await fs.readFile(
    path.join(appPath, 'Contents/Resources/binding.json'),
    'utf8'
  ))
  assert.deepEqual(
    parseLinkHandlerBinding(bindingValue, 'markover'),
    linkHandlerBinding(instance, handlerRoot)
  )

  const second = await installLinkHandler('install', instance, options)
  assert.equal(second.action, 'unchanged')
  assert.equal(second.expectedPath, appPath)

  const bindingPath = path.join(appPath, 'Contents/Resources/binding.json')
  await fs.chmod(bindingPath, 0o644)
  await fs.writeFile(bindingPath, '{}\n')
  assert.equal(
    (await inspectLinkHandler('markover', instance, options)).status,
    'incompatible'
  )
  const repaired = await installLinkHandler('repair', instance, options)
  assert.equal(repaired.action, 'repaired')
  assert.equal(repaired.status, 'exact')

  await fs.rm(stateRoot, { recursive: true })
  assert.equal(
    (await inspectLinkHandler('markover', undefined, options)).status,
    'exact'
  )
  const removed = await removeLinkHandler('markover', options)
  assert.equal(removed.action, 'removed')
  assert.equal(removed.status, 'absent')
  await assert.rejects(fs.access(appPath))
})

testMacos('idempotent install proves LaunchServices selected the handler', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-handler-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const stateRoot = path.join(directory, 'state')
  const handlerRoot = path.join(directory, 'handlers')
  await fs.mkdir(stateRoot)
  const instance = canonicalInstance(stateRoot)
  let ownerPath: string | null = null
  const base = {
    handlerRoot,
    inspectOwner: () => Promise.resolve(ownerPath),
    probe: () => Promise.resolve(false)
  }
  await installLinkHandler('install', instance, {
    ...base,
    register(appPath: string) {
      ownerPath = appPath
      return Promise.resolve()
    }
  })
  ownerPath = null

  await assert.rejects(
    installLinkHandler('install', instance, {
      ...base,
      register: () => Promise.resolve()
    }),
    /LaunchServices did not select/
  )
})

testMacos('a removed PR worktree leaves a stale handler removable by scheme', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-handler-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const checkout = path.join(directory, 'checkout')
  const stateRoot = path.join(checkout, '.markover/instance')
  const handlerRoot = path.join(directory, 'handlers')
  await fs.mkdir(checkout, { recursive: true })
  const canonical = canonicalInstance(stateRoot)
  const instance = {
    ...canonical,
    identity: {
      kind: 'development',
      key: 'pr-76',
      pullRequestNumber: 76
    },
    checkout,
    scheme: 'markover-76',
    pullRequest: { number: 76, state: 'open' },
    branding: {
      ...canonical.branding,
      appName: 'Markover-76',
      headerBadge: 'PR 76',
      iconLabel: '76'
    }
  } as ResolvedInstance
  let ownerPath: string | null = null
  const options = {
    handlerRoot,
    inspectOwner: () => Promise.resolve(ownerPath),
    probe: () => Promise.resolve(false),
    register(appPath: string) {
      ownerPath = appPath
      return Promise.resolve()
    },
    unregister() {
      ownerPath = null
      return Promise.resolve()
    }
  }
  await installLinkHandler('install', instance, options)
  await fs.rm(checkout, { recursive: true })
  assert.equal(
    (await inspectLinkHandler('markover-76', undefined, options)).status,
    'stale'
  )
  assert.equal(
    (await removeLinkHandler('markover-76', options)).status,
    'absent'
  )
})

testMacos('install refuses a conflicting owner and closed PR identity', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-handler-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const stateRoot = path.join(directory, 'state')
  await fs.mkdir(stateRoot)
  const instance = canonicalInstance(stateRoot)
  await assert.rejects(
    installLinkHandler('install', instance, {
      handlerRoot: path.join(directory, 'handlers'),
      inspectOwner: () => Promise.resolve('/Applications/Other.app'),
      probe: () => Promise.resolve(false)
    }),
    /use replace only after confirming that owner/
  )

  const closed = {
    ...instance,
    identity: {
      kind: 'development',
      key: 'pr-76',
      pullRequestNumber: 76
    },
    scheme: 'markover-76',
    pullRequest: { number: 76, state: 'closed' }
  } as ResolvedInstance
  await assert.rejects(
    installLinkHandler('repair', closed, {
      handlerRoot: path.join(directory, 'handlers'),
      inspectOwner: () => Promise.resolve(null),
      probe: () => Promise.resolve(false)
    }),
    /live open pull request/
  )
})

testMacos('replace is explicit and force removal leaves a different owner unchanged', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-handler-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const stateRoot = path.join(directory, 'state')
  const handlerRoot = path.join(directory, 'handlers')
  await fs.mkdir(stateRoot)
  const instance = canonicalInstance(stateRoot)
  let ownerPath: string | null = null
  const base = {
    handlerRoot,
    inspectOwner: () => Promise.resolve(ownerPath),
    probe: () => Promise.resolve(false)
  }
  const register = (appPath: string) => {
    ownerPath = appPath
    return Promise.resolve()
  }
  await installLinkHandler('install', instance, { ...base, register })
  ownerPath = '/Applications/Other.app'
  await assert.rejects(
    installLinkHandler('repair', instance, { ...base, register }),
    /use replace only after confirming that owner/
  )
  const replaced = await installLinkHandler('replace', instance, {
    ...base,
    register
  })
  assert.equal(replaced.action, 'replaced')
  assert.equal(replaced.previousOwnerPath, '/Applications/Other.app')

  ownerPath = '/Applications/Other.app'
  const removed = await removeLinkHandler('markover', {
    ...base,
    force: true,
    unregister: () => Promise.resolve()
  })
  assert.equal(removed.action, 'removed')
  assert.equal(removed.status, 'conflicting')
  assert.equal(ownerPath, '/Applications/Other.app')
})

testMacos('failed replacement restores prior files and LaunchServices owner', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-handler-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const stateRoot = path.join(directory, 'state')
  const handlerRoot = path.join(directory, 'handlers')
  await fs.mkdir(stateRoot)
  const instance = canonicalInstance(stateRoot)
  const externalOwner = '/Applications/Other.app'
  let ownerPath: string | null = null
  let hideReplacementOwner = false
  const options = {
    handlerRoot,
    inspectOwner: () => Promise.resolve(
      hideReplacementOwner ? null : ownerPath
    ),
    probe: () => Promise.resolve(false),
    register(appPath: string) {
      ownerPath = appPath
      return Promise.resolve()
    },
    unregister(appPath: string) {
      if (ownerPath === appPath) ownerPath = null
      return Promise.resolve()
    },
    restoreOwner(appPath: string) {
      ownerPath = appPath
      hideReplacementOwner = false
      return Promise.resolve()
    }
  }
  await installLinkHandler('install', instance, options)
  const appPath = linkHandlerAppPath('markover', handlerRoot)
  const originalBinding = await fs.readFile(
    path.join(appPath, 'Contents/Resources/binding.json'),
    'utf8'
  )

  ownerPath = externalOwner
  await assert.rejects(
    installLinkHandler('replace', instance, {
      ...options,
      register(replacementPath: string) {
        ownerPath = replacementPath
        hideReplacementOwner = true
        return Promise.resolve()
      }
    }),
    /LaunchServices did not select/
  )

  assert.equal(ownerPath, externalOwner)
  assert.equal(await fs.readFile(
    path.join(appPath, 'Contents/Resources/binding.json'),
    'utf8'
  ), originalBinding)
})

test('replacement commit retains its backup until temporary cleanup succeeds', async () => {
  const source = await fs.readFile(
    path.join(__dirname, '../../src/link-handler.ts'),
    'utf8'
  )
  const commit = source.slice(
    source.indexOf('async function commitGeneratedAppReplacement'),
    source.indexOf('async function rollbackGeneratedAppReplacement')
  )
  assert.ok(
    commit.indexOf('replacement.temporaryRoot') <
      commit.indexOf('replacement.backupPath')
  )
})

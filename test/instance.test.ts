import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  canonicalDescriptorPath,
  discoverCheckoutRoot,
  developmentGeneratedRoot,
  developmentStateRoot,
  InstanceResolutionError,
  parseCanonicalInstanceDescriptor,
  parseResolvedInstance,
  parseRuntimeInstanceIdentity,
  publishRuntimeInstanceIdentity,
  resolveInstance,
  resolvedInstanceEnvironment,
  runtimeInstanceFromEnvironment,
  runtimeInstancePath,
  writeCanonicalInstanceDescriptor,
  type PullRequestLookup
} from '../src/instance'

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-instance-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return directory
}

function pullRequest(
  number: number,
  state: 'open' | 'closed' | 'merged' = 'open'
): PullRequestLookup {
  return () => Promise.resolve({ number, state })
}

function unavailablePullRequest(): PullRequestLookup {
  return () => Promise.reject(new InstanceResolutionError(
    'PULL_REQUEST_VERIFICATION_UNAVAILABLE',
    'GitHub is unavailable.'
  ))
}

test('canonical and development roots stay in their owned boundaries', () => {
  assert.equal(
    canonicalDescriptorPath({
      platform: 'darwin',
      homeDirectory: '/Users/reviewer',
      environment: {}
    }),
    '/Users/reviewer/Library/Application Support/Markover/canonical-instance.json'
  )
  assert.equal(
    developmentStateRoot('/checkouts/pr-42'),
    '/checkouts/pr-42/.markover/instance'
  )
  assert.equal(
    developmentGeneratedRoot('/checkouts/pr-42'),
    '/checkouts/pr-42/.markover/generated'
  )
})

test('parses only exact canonical and runtime descriptors', () => {
  assert.deepEqual(parseCanonicalInstanceDescriptor({
    version: 1,
    checkout: '/checkouts/main',
    blessedBranch: ' main '
  }), {
    version: 1,
    checkout: '/checkouts/main',
    blessedBranch: 'main'
  })
  assert.equal(parseCanonicalInstanceDescriptor({
    version: 1,
    checkout: 'relative',
    blessedBranch: 'main'
  }), null)
  assert.deepEqual(parseRuntimeInstanceIdentity({
    version: 1,
    kind: 'development',
    key: 'pr-42',
    pullRequestNumber: 42
  }), {
    kind: 'development',
    key: 'pr-42',
    pullRequestNumber: 42
  })
  assert.equal(parseRuntimeInstanceIdentity({
    version: 1,
    kind: 'development',
    key: 'pr-41',
    pullRequestNumber: 42
  }), null)
})

test('discovers the enclosing worktree without accepting a non-checkout', async (t) => {
  const checkout = await temporaryDirectory(t)
  assert.equal(spawnSync('git', ['init', '-b', 'feature'], {
    cwd: checkout,
    encoding: 'utf8'
  }).status, 0)
  const nested = path.join(checkout, 'nested', 'directory')
  await fs.mkdir(nested, { recursive: true })
  assert.equal(await discoverCheckoutRoot(nested), await fs.realpath(checkout))

  const outside = await temporaryDirectory(t)
  await assert.rejects(
    discoverCheckoutRoot(outside),
    (error: unknown) => error instanceof InstanceResolutionError &&
      error.code === 'CHECKOUT_INVALID'
  )
})

test('canonical cold starts require an explicit valid blessed checkout', async (t) => {
  const directory = await temporaryDirectory(t)
  const applicationSupport = path.join(directory, 'application-support')
  const descriptorPath = path.join(applicationSupport, 'canonical.json')

  const missing = await resolveInstance('canonical', {
    canonicalDescriptorPath: descriptorPath,
    platform: 'darwin',
    homeDirectory: directory,
    environment: {},
    probe: () => Promise.resolve(false)
  })
  assert.equal(missing.identity.key, 'canonical')
  assert.deepEqual(missing.coldStart, {
    eligible: false,
    blockedBy: 'canonical-descriptor-missing'
  })

  const checkout = path.join(directory, 'main')
  await fs.mkdir(checkout)
  assert.equal(spawnSync('git', ['init', '-b', 'main'], {
    cwd: checkout,
    encoding: 'utf8'
  }).status, 0)
  await fs.mkdir(applicationSupport, { recursive: true })
  await fs.writeFile(descriptorPath, `${JSON.stringify({
    version: 1,
    checkout,
    blessedBranch: 'main'
  })}\n`)

  const resolved = await resolveInstance('canonical', {
    canonicalDescriptorPath: descriptorPath,
    platform: 'darwin',
    homeDirectory: directory,
    environment: {},
    probe: () => Promise.resolve(false)
  })
  assert.equal(resolved.checkout, checkout)
  assert.equal(resolved.scheme, 'markover')
  assert.equal(resolved.branding.appName, 'Markover')
  assert.deepEqual(resolved.coldStart, { eligible: true, blockedBy: null })
})

test('a running canonical service remains routable without a start descriptor', async (t) => {
  const directory = await temporaryDirectory(t)
  const resolved = await resolveInstance('canonical', {
    canonicalDescriptorPath: path.join(directory, 'missing.json'),
    platform: 'darwin',
    homeDirectory: directory,
    environment: {},
    probe: () => Promise.resolve(true)
  })
  assert.deepEqual(resolved.process, { status: 'running' })
  assert.deepEqual(resolved.coldStart, {
    eligible: false,
    blockedBy: 'canonical-descriptor-missing'
  })
  assert.equal(resolved.checkout, null)
})

test('open pull requests resolve isolated development contracts', async (t) => {
  const checkout = await temporaryDirectory(t)
  const resolved = await resolveInstance('development', {
    checkoutDirectory: checkout,
    inspectPullRequest: pullRequest(42),
    probe: () => Promise.resolve(false)
  })

  assert.deepEqual(resolved.identity, {
    kind: 'development',
    key: 'pr-42',
    pullRequestNumber: 42
  })
  assert.equal(resolved.checkout, checkout)
  assert.equal(resolved.stateRoot, path.join(checkout, '.markover', 'instance'))
  assert.equal(resolved.service.endpointPath, path.join(
    checkout,
    '.markover',
    'instance',
    'service.json'
  ))
  assert.equal(resolved.service.singleInstanceLockRoot, resolved.stateRoot)
  assert.equal(resolved.scheme, 'markover-42')
  assert.deepEqual(resolved.process, { status: 'stopped' })
  assert.deepEqual(resolved.coldStart, { eligible: true, blockedBy: null })
  assert.deepEqual(resolved.branding, {
    appName: 'Markover-42',
    headerBadge: 'PR 42',
    iconLabel: '42',
    iconSvgPath: path.join(
      checkout,
      '.markover',
      'generated',
      'pr-42',
      'markover-app-icon.svg'
    ),
    iconPngPath: path.join(
      checkout,
      '.markover',
      'generated',
      'pr-42',
      'markover-app-icon.png'
    ),
    iconIcnsPath: path.join(
      checkout,
      '.markover',
      'generated',
      'pr-42',
      'markover-app-icon.icns'
    )
  })

  const serialized = resolvedInstanceEnvironment(resolved)
  assert.deepEqual(
    runtimeInstanceFromEnvironment({ MARKOVER_RESOLVED_INSTANCE: serialized }),
    resolved
  )
  const mutated = JSON.parse(serialized) as {
    service: { endpointPath: string }
  }
  mutated.service.endpointPath = path.join(checkout, 'wrong-service.json')
  assert.equal(parseResolvedInstance(mutated), null)
})

test('an app without an instance environment remains canonical', () => {
  const canonical = runtimeInstanceFromEnvironment({}, {
    platform: 'darwin',
    homeDirectory: '/Users/reviewer',
    environment: {}
  })
  assert.deepEqual(canonical.identity, { kind: 'canonical', key: 'canonical' })
  assert.equal(canonical.scheme, 'markover')
  assert.equal(
    canonical.service.endpointPath,
    '/Users/reviewer/Library/Application Support/Markover/service.json'
  )
})

test('closed and merged pull requests refuse cold starts', async (t) => {
  const checkout = await temporaryDirectory(t)
  for (const [state, blockedBy] of [
    ['closed', 'pull-request-closed'],
    ['merged', 'pull-request-merged']
  ] as const) {
    const resolved = await resolveInstance('development', {
      checkoutDirectory: checkout,
      inspectPullRequest: pullRequest(42, state),
      probe: () => Promise.resolve(false)
    })
    assert.deepEqual(resolved.coldStart, { eligible: false, blockedBy })
  }
})

test('a running PR instance remains addressable when GitHub is unavailable', async (t) => {
  const checkout = await temporaryDirectory(t)
  const stateRoot = developmentStateRoot(checkout)
  await publishRuntimeInstanceIdentity(stateRoot, {
    kind: 'development',
    key: 'pr-42',
    pullRequestNumber: 42
  })

  const resolved = await resolveInstance('development', {
    checkoutDirectory: checkout,
    inspectPullRequest: unavailablePullRequest(),
    probe: () => Promise.resolve(true)
  })
  assert.deepEqual(resolved.process, { status: 'running' })
  assert.deepEqual(resolved.coldStart, {
    eligible: false,
    blockedBy: 'already-running'
  })
  assert.deepEqual(resolved.pullRequest, { number: 42, state: 'unknown' })
})

test('a running closed PR remains addressable but reports its closed state', async (t) => {
  const checkout = await temporaryDirectory(t)
  const stateRoot = developmentStateRoot(checkout)
  await publishRuntimeInstanceIdentity(stateRoot, {
    kind: 'development',
    key: 'pr-42',
    pullRequestNumber: 42
  })
  const resolved = await resolveInstance('development', {
    checkoutDirectory: checkout,
    inspectPullRequest: pullRequest(42, 'closed'),
    probe: () => Promise.resolve(true)
  })
  assert.deepEqual(resolved.process, { status: 'running' })
  assert.deepEqual(resolved.pullRequest, { number: 42, state: 'closed' })
  assert.deepEqual(resolved.coldStart, {
    eligible: false,
    blockedBy: 'already-running'
  })
})

test('a stopped instance fails closed when GitHub cannot verify its PR', async (t) => {
  const checkout = await temporaryDirectory(t)
  await assert.rejects(
    resolveInstance('development', {
      checkoutDirectory: checkout,
      inspectPullRequest: unavailablePullRequest(),
      probe: () => Promise.resolve(false)
    }),
    (error: unknown) => error instanceof InstanceResolutionError &&
      error.code === 'PULL_REQUEST_VERIFICATION_UNAVAILABLE'
  )
})

test('a stopped persisted identity cannot be relabeled after a branch switch', async (t) => {
  const checkout = await temporaryDirectory(t)
  await publishRuntimeInstanceIdentity(developmentStateRoot(checkout), {
    kind: 'development',
    key: 'pr-61',
    pullRequestNumber: 61
  })
  await assert.rejects(
    resolveInstance('development', {
      checkoutDirectory: checkout,
      inspectPullRequest: pullRequest(62),
      probe: () => Promise.resolve(false)
    }),
    (error: unknown) => error instanceof InstanceResolutionError &&
      error.code === 'INSTANCE_IDENTITY_MISMATCH'
  )

  const cleanup = await resolveInstance('development', {
    checkoutDirectory: checkout,
    expectedPullRequestNumber: 61,
    inspectPullRequest: () => {
      throw new Error('cleanup must use the persisted identity offline')
    },
    operation: 'cleanup',
    probe: () => Promise.resolve(false)
  })
  assert.deepEqual(cleanup.identity, {
    kind: 'development',
    key: 'pr-61',
    pullRequestNumber: 61
  })
  assert.deepEqual(cleanup.pullRequest, { number: 61, state: 'unknown' })
  assert.deepEqual(cleanup.coldStart, {
    eligible: false,
    blockedBy: 'cleanup-only'
  })
})

test('explicit PR targeting refuses a different checkout identity', async (t) => {
  const checkout = await temporaryDirectory(t)
  await assert.rejects(
    resolveInstance('development', {
      checkoutDirectory: checkout,
      expectedPullRequestNumber: 43,
      inspectPullRequest: pullRequest(42),
      probe: () => Promise.resolve(false)
    }),
    (error: unknown) => error instanceof InstanceResolutionError &&
      error.code === 'INSTANCE_IDENTITY_MISMATCH'
  )
})

test('separate worktrees resolve separate simultaneous identities', async (t) => {
  const parent = await temporaryDirectory(t)
  const first = path.join(parent, 'first')
  const second = path.join(parent, 'second')
  await Promise.all([fs.mkdir(first), fs.mkdir(second)])
  await Promise.all([
    publishRuntimeInstanceIdentity(developmentStateRoot(first), {
      kind: 'development',
      key: 'pr-42',
      pullRequestNumber: 42
    }),
    publishRuntimeInstanceIdentity(developmentStateRoot(second), {
      kind: 'development',
      key: 'pr-43',
      pullRequestNumber: 43
    })
  ])
  const [pr42, pr43] = await Promise.all([
    resolveInstance('development', {
      checkoutDirectory: first,
      inspectPullRequest: pullRequest(42),
      probe: () => Promise.resolve(true)
    }),
    resolveInstance('development', {
      checkoutDirectory: second,
      inspectPullRequest: pullRequest(43),
      probe: () => Promise.resolve(true)
    })
  ])
  assert.notEqual(pr42.stateRoot, pr43.stateRoot)
  assert.notEqual(pr42.service.endpointPath, pr43.service.endpointPath)
  assert.notEqual(pr42.identity.key, pr43.identity.key)
})

test('runtime identity records are private and parseable', async (t) => {
  const stateRoot = path.join(await temporaryDirectory(t), 'instance')
  await publishRuntimeInstanceIdentity(stateRoot, {
    kind: 'development',
    key: 'pr-61',
    pullRequestNumber: 61
  })
  const identityPath = runtimeInstancePath(stateRoot)
  assert.equal((await fs.stat(stateRoot)).mode & 0o777, 0o700)
  assert.equal((await fs.stat(identityPath)).mode & 0o777, 0o600)
  assert.deepEqual(
    parseRuntimeInstanceIdentity(JSON.parse(await fs.readFile(
      identityPath,
      'utf8'
    ))),
    { kind: 'development', key: 'pr-61', pullRequestNumber: 61 }
  )
})

test('canonical descriptor writer gives installers one validated private path', async (t) => {
  const directory = await temporaryDirectory(t)
  const destination = path.join(directory, 'Markover', 'canonical-instance.json')
  const descriptor = await writeCanonicalInstanceDescriptor({
    version: 1,
    checkout: '/checkouts/main',
    blessedBranch: 'main'
  }, { destination, platform: 'darwin' })
  assert.deepEqual(descriptor, {
    version: 1,
    checkout: '/checkouts/main',
    blessedBranch: 'main'
  })
  assert.equal((await fs.stat(path.dirname(destination))).mode & 0o777, 0o700)
  assert.equal((await fs.stat(destination)).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(await fs.readFile(destination, 'utf8')), descriptor)
  await assert.rejects(
    writeCanonicalInstanceDescriptor({
      version: 1,
      checkout: 'relative',
      blessedBranch: 'main'
    }, { destination }),
    (error: unknown) => error instanceof InstanceResolutionError &&
      error.code === 'CANONICAL_DESCRIPTOR_INVALID'
  )
})

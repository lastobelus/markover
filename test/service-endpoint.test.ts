import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  CAPABILITY_TOKEN_PATTERN,
  createServiceIdentity,
  parseServiceCredential,
  parseServiceEndpoint,
  publishServiceConnection,
  reviewsDirectory,
  SERVICE_INSTANCE_PATTERN,
  serviceDirectory,
  serviceEndpointPath,
  serviceTokenPath,
  tokenPathForEndpoint
} from '../src/service-endpoint'

test('all macOS checkouts share one Markover service endpoint', () => {
  const options = {
    platform: 'darwin',
    homeDirectory: '/Users/reviewer',
    environment: {}
  } as const
  assert.equal(
    serviceDirectory(options),
    path.join('/Users/reviewer', 'Library', 'Application Support', 'Markover')
  )
  assert.equal(
    serviceEndpointPath(options),
    path.join(
      '/Users/reviewer',
      'Library',
      'Application Support',
      'Markover',
      'service.json'
    )
  )
  assert.equal(
    serviceTokenPath(options),
    path.join(
      '/Users/reviewer',
      'Library',
      'Application Support',
      'Markover',
      'service.token'
    )
  )
  assert.equal(
    reviewsDirectory(options),
    path.join(
      '/Users/reviewer',
      'Library',
      'Application Support',
      'Markover',
      'reviews'
    )
  )
})

test('creates a fresh 256-bit capability and UUID instance identity', () => {
  const first = createServiceIdentity()
  const second = createServiceIdentity()
  assert.match(first.instanceId, SERVICE_INSTANCE_PATTERN)
  assert.match(first.token, CAPABILITY_TOKEN_PATTERN)
  assert.equal(Buffer.from(first.token, 'base64url').length, 32)
  assert.notEqual(first.instanceId, second.instanceId)
  assert.notEqual(first.token, second.token)
})

test('parses only protocol-v2 endpoints and protocol-v1 credentials', () => {
  const identity = createServiceIdentity()
  assert.deepEqual(parseServiceEndpoint({
    version: 2,
    instanceId: identity.instanceId,
    port: 43123,
    pid: 90210
  }), {
    version: 2,
    instanceId: identity.instanceId,
    port: 43123,
    pid: 90210
  })
  assert.deepEqual(parseServiceCredential({
    version: 1,
    instanceId: identity.instanceId,
    token: identity.token
  }), {
    version: 1,
    instanceId: identity.instanceId,
    token: identity.token
  })
  assert.equal(parseServiceEndpoint({ version: 1, port: 43123 }), null)
  assert.equal(parseServiceCredential({
    version: 1,
    instanceId: identity.instanceId,
    token: 'short'
  }), null)
})

test('publishes private matching records and repairs POSIX modes', async (
  t: TestContext
) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-endpoint-test-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const endpointPath = path.join(directory, 'service.json')
  const tokenPath = tokenPathForEndpoint(endpointPath)
  await fs.writeFile(endpointPath, '{}', { mode: 0o666 })
  await fs.writeFile(tokenPath, '{}', { mode: 0o666 })
  await fs.chmod(directory, 0o777)

  const identity = createServiceIdentity()
  await publishServiceConnection({
    endpointPath,
    identity,
    port: 43123,
    pid: 90210
  })

  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700)
  assert.equal((await fs.stat(endpointPath)).mode & 0o777, 0o600)
  assert.equal((await fs.stat(tokenPath)).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(await fs.readFile(endpointPath, 'utf8')), {
    version: 2,
    instanceId: identity.instanceId,
    port: 43123,
    pid: 90210
  })
  assert.deepEqual(JSON.parse(await fs.readFile(tokenPath, 'utf8')), {
    version: 1,
    instanceId: identity.instanceId,
    token: identity.token
  })
})

test('refuses to publish an invalid service identity', async () => {
  await assert.rejects(
    publishServiceConnection({
      endpointPath: '/unused/service.json',
      identity: { instanceId: 'invalid', token: 'invalid' },
      port: 43123
    }),
    /identity is invalid/
  )
})

test('service endpoint has platform-appropriate fallbacks', () => {
  assert.equal(
    serviceEndpointPath({
      platform: 'linux',
      homeDirectory: '/home/reviewer',
      environment: { XDG_CONFIG_HOME: '/config' }
    }),
    path.join('/config', 'Markover', 'service.json')
  )
  assert.equal(
    serviceEndpointPath({
      platform: 'win32',
      homeDirectory: 'C:\\Users\\reviewer',
      environment: { APPDATA: 'C:\\AppData' }
    }),
    path.join('C:\\AppData', 'Markover', 'service.json')
  )
})

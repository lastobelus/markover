import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  CANONICAL_UPDATE_MANIFEST_URL,
  CanonicalUpdateManifestError,
  decodeCanonicalUpdateManifest,
  fetchCanonicalUpdateManifest,
  MAXIMUM_CANONICAL_UPDATE_MANIFEST_BYTES,
  readCanonicalUpdateManifestCache,
  selectCanonicalUpdateChangelist,
  writeCanonicalUpdateManifestCache,
  type CanonicalUpdateManifest
} from '../src/canonical-update-manifest'

const BASE_COMMIT = '1'.repeat(40)
const FIRST_COMMIT = '2'.repeat(40)
const SECOND_COMMIT = '3'.repeat(40)

function manifest(): CanonicalUpdateManifest {
  return {
    version: 1,
    repository: 'lastobelus/markover',
    generatedAt: '2026-08-29T03:00:00.000Z',
    baseCommit: BASE_COMMIT,
    headCommit: SECOND_COMMIT,
    pullRequests: [
      {
        number: 205,
        title: 'First update',
        mergeCommit: FIRST_COMMIT,
        mergedAt: '2026-08-29T01:00:00Z'
      },
      {
        number: 206,
        title: 'Second update',
        mergeCommit: SECOND_COMMIT,
        mergedAt: '2026-08-29T02:00:00Z'
      }
    ]
  }
}

function encode(value: unknown): string {
  return JSON.stringify(value)
}

function errorCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof CanonicalUpdateManifestError &&
    error.code === code
}

test('decodes the exact bounded canonical update manifest schema', () => {
  assert.deepEqual(decodeCanonicalUpdateManifest(encode(manifest())), manifest())
})

test('rejects unknown keys, versions, invalid commits, and duplicate entries', () => {
  const valid = manifest()
  const cases: unknown[] = [
    { ...valid, extra: true },
    { ...valid, version: 2 },
    { ...valid, repository: 'someone/else' },
    { ...valid, baseCommit: 'short' },
    { ...valid, headCommit: 'A'.repeat(40) },
    { ...valid, generatedAt: 'yesterday' },
    {
      ...valid,
      pullRequests: [{ ...valid.pullRequests[0], extra: true }, valid.pullRequests[1]]
    },
    {
      ...valid,
      pullRequests: [valid.pullRequests[0], {
        ...valid.pullRequests[1],
        number: valid.pullRequests[0]?.number
      }]
    },
    {
      ...valid,
      pullRequests: [valid.pullRequests[0], {
        ...valid.pullRequests[1],
        mergeCommit: valid.pullRequests[0]?.mergeCommit
      }]
    },
    {
      ...valid,
      pullRequests: [valid.pullRequests[0], {
        ...valid.pullRequests[1],
        mergedAt: '2026-08-29T00:00:00Z'
      }]
    },
    { ...valid, headCommit: '4'.repeat(40) }
  ]
  for (const candidate of cases) {
    assert.throws(
      () => decodeCanonicalUpdateManifest(encode(candidate)),
      errorCode('CANONICAL_UPDATE_MANIFEST_INVALID')
    )
  }
})

test('rejects a manifest before parsing when its encoded body is oversized', () => {
  const source = Buffer.alloc(MAXIMUM_CANONICAL_UPDATE_MANIFEST_BYTES + 1, 0x20)
  assert.throws(
    () => decodeCanonicalUpdateManifest(source),
    errorCode('CANONICAL_UPDATE_MANIFEST_TOO_LARGE')
  )
})

test('selects changes only from an exact manifest commit', () => {
  const valid = manifest()
  assert.deepEqual(
    selectCanonicalUpdateChangelist(valid, BASE_COMMIT),
    valid.pullRequests
  )
  assert.deepEqual(
    selectCanonicalUpdateChangelist(valid, FIRST_COMMIT),
    [valid.pullRequests[1]]
  )
  assert.deepEqual(selectCanonicalUpdateChangelist(valid, SECOND_COMMIT), [])
  assert.equal(
    selectCanonicalUpdateChangelist(valid, '4'.repeat(40)),
    null
  )
  assert.equal(selectCanonicalUpdateChangelist(valid, 'invalid'), null)
})

test('writes and reads an owner-only last-valid cache atomically', async (
  t: TestContext
) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-update-cache-test-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const cachePath = path.join(directory, 'state', 'manifest.json')

  await writeCanonicalUpdateManifestCache(cachePath, manifest())

  assert.equal((await fs.stat(path.dirname(cachePath))).mode & 0o777, 0o700)
  assert.equal((await fs.stat(cachePath)).mode & 0o777, 0o600)
  assert.deepEqual(await readCanonicalUpdateManifestCache(cachePath), manifest())

  await fs.writeFile(cachePath, '{invalid', { mode: 0o600 })
  assert.equal(await readCanonicalUpdateManifestCache(cachePath), null)
  assert.equal(
    await readCanonicalUpdateManifestCache(path.join(directory, 'missing.json')),
    null
  )
})

test('refuses an exposed or linked cache file', async (t: TestContext) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-unsafe-update-cache-test-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const cachePath = path.join(directory, 'manifest.json')
  await fs.writeFile(cachePath, encode(manifest()), { mode: 0o600 })
  await fs.chmod(cachePath, 0o644)

  await assert.rejects(
    readCanonicalUpdateManifestCache(cachePath),
    errorCode('CANONICAL_UPDATE_CACHE_UNSAFE')
  )
  await assert.rejects(
    writeCanonicalUpdateManifestCache(cachePath, manifest()),
    errorCode('CANONICAL_UPDATE_CACHE_UNSAFE')
  )

  await fs.unlink(cachePath)
  const target = path.join(directory, 'target.json')
  await fs.writeFile(target, encode(manifest()), { mode: 0o600 })
  await fs.symlink(target, cachePath)
  await assert.rejects(
    readCanonicalUpdateManifestCache(cachePath),
    errorCode('CANONICAL_UPDATE_CACHE_UNSAFE')
  )
})

test('fetches only the exact manifest URL with a bounded JSON response', async () => {
  const calls: Array<{ input: string; init: RequestInit }> = []
  const fetched = await fetchCanonicalUpdateManifest({
    fetchImplementation: (input, init) => {
      calls.push({ input, init })
      return Promise.resolve(new Response(encode(manifest()), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      }))
    },
    timeoutMilliseconds: 100
  })

  assert.deepEqual(fetched, manifest())
  assert.equal(calls.length, 1)
  const [call] = calls
  assert.ok(call)
  assert.equal(call.input, CANONICAL_UPDATE_MANIFEST_URL)
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.redirect, 'error')
  assert.ok(call.init.signal instanceof AbortSignal)
})

test('rejects oversized, non-JSON, and non-success manifest responses', async () => {
  const oversized = new Uint8Array(MAXIMUM_CANONICAL_UPDATE_MANIFEST_BYTES + 1)
  await assert.rejects(
    fetchCanonicalUpdateManifest({
      fetchImplementation: () => Promise.resolve(new Response(oversized, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))
    }),
    errorCode('CANONICAL_UPDATE_MANIFEST_TOO_LARGE')
  )
  await assert.rejects(
    fetchCanonicalUpdateManifest({
      fetchImplementation: () => Promise.resolve(new Response('{}', {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      }))
    }),
    errorCode('CANONICAL_UPDATE_FETCH_FAILED')
  )
  await assert.rejects(
    fetchCanonicalUpdateManifest({
      fetchImplementation: () => Promise.resolve(new Response('{}', {
        status: 503,
        headers: { 'content-type': 'application/json' }
      }))
    }),
    errorCode('CANONICAL_UPDATE_FETCH_FAILED')
  )
})

test('aborts a manifest request at the configured timeout', async () => {
  let signal: AbortSignal | undefined
  await assert.rejects(
    fetchCanonicalUpdateManifest({
      fetchImplementation: (_input, init) => {
        signal = init.signal as AbortSignal
        return new Promise<Response>(() => {})
      },
      timeoutMilliseconds: 10
    }),
    errorCode('CANONICAL_UPDATE_FETCH_TIMEOUT')
  )
  assert.equal(signal?.aborted, true)
})

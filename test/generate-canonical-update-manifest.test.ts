import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  generateCanonicalUpdateManifest,
  writeCanonicalUpdateManifest
} from '../scripts/generate-canonical-update-manifest'
import { decodeCanonicalUpdateManifest } from '../src/canonical-update-manifest'

const BASE = '1'.repeat(40)
const FIRST = '2'.repeat(40)
const SECOND = '3'.repeat(40)

function githubResponse(head = SECOND): unknown {
  return {
    data: {
      repository: {
        defaultBranchRef: {
          target: {
            oid: head,
            history: {
              nodes: [
                {
                  oid: head,
                  associatedPullRequests: {
                    nodes: head === SECOND ? [{
                      baseRefName: 'main',
                      mergeCommit: { oid: SECOND },
                      mergedAt: '2026-08-29T02:00:00Z',
                      number: 206,
                      state: 'MERGED',
                      title: ' Second update '
                    }] : []
                  }
                },
                {
                  oid: FIRST,
                  associatedPullRequests: {
                    nodes: [{
                      baseRefName: 'main',
                      mergeCommit: { oid: FIRST },
                      mergedAt: '2026-08-29T01:00:00Z',
                      number: 205,
                      state: 'MERGED',
                      title: 'First update'
                    }]
                  }
                },
                {
                  oid: BASE,
                  associatedPullRequests: { nodes: [] }
                }
              ]
            }
          }
        }
      }
    }
  }
}

test('generates the exact v1 PR changelist oldest to newest', async () => {
  const calls: Array<{ input: string; init: RequestInit }> = []
  const manifest = await generateCanonicalUpdateManifest({
    expectedHead: SECOND,
    generatedAt: '2026-08-29T03:00:00.000Z',
    token: 'test-token',
    fetchImplementation: (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      calls.push({ input: url, init: init ?? {} })
      return Promise.resolve(new Response(JSON.stringify(githubResponse()), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))
    }
  })

  assert.deepEqual(manifest, {
    version: 1,
    repository: 'lastobelus/markover',
    generatedAt: '2026-08-29T03:00:00.000Z',
    baseCommit: BASE,
    headCommit: SECOND,
    pullRequests: [
      {
        number: 205,
        title: 'First update',
        mergeCommit: FIRST,
        mergedAt: '2026-08-29T01:00:00Z'
      },
      {
        number: 206,
        title: 'Second update',
        mergeCommit: SECOND,
        mergedAt: '2026-08-29T02:00:00Z'
      }
    ]
  })
  assert.equal(calls.length, 1)
  const call = calls[0]
  assert.ok(call)
  assert.equal(call.input, 'https://api.github.com/graphql')
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.redirect, 'error')
  assert.ok(call.init.signal instanceof AbortSignal)
  assert.equal(
    (call.init.headers as Record<string, string>).authorization,
    'Bearer test-token'
  )
  assert.equal(typeof call.init.body, 'string')
  const body = JSON.parse(call.init.body as string) as {
    variables: Record<string, unknown>
  }
  assert.deepEqual(body.variables, {
    owner: 'lastobelus',
    name: 'markover',
    limit: 100,
    associatedLimit: 5
  })
})

test('resets display history at a direct main push', async () => {
  const directHead = '4'.repeat(40)
  const manifest = await generateCanonicalUpdateManifest({
    expectedHead: directHead,
    generatedAt: '2026-08-29T03:00:00.000Z',
    token: 'test-token',
    fetchImplementation: () => Promise.resolve(new Response(
      JSON.stringify(githubResponse(directHead)),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ))
  })
  assert.equal(manifest.baseCommit, directHead)
  assert.equal(manifest.headCommit, directHead)
  assert.deepEqual(manifest.pullRequests, [])
})

test('refuses stale workflow heads and malformed API results', async () => {
  await assert.rejects(
    generateCanonicalUpdateManifest({
      expectedHead: FIRST,
      token: 'test-token',
      fetchImplementation: () => Promise.resolve(new Response(
        JSON.stringify(githubResponse()),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ))
    }),
    /no longer GitHub’s default branch head/
  )
  await assert.rejects(
    generateCanonicalUpdateManifest({
      expectedHead: SECOND,
      token: 'test-token',
      fetchImplementation: () => Promise.resolve(new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))
    }),
    /default branch head/
  )
})

test('writes generated output outside the committed Pages source', async (
  t: TestContext
) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-generated-manifest-test-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const outputPath = path.join(directory, 'build', 'docs', 'user', 'update-manifest.json')
  const manifest = await generateCanonicalUpdateManifest({
    expectedHead: SECOND,
    generatedAt: '2026-08-29T03:00:00.000Z',
    token: 'test-token',
    fetchImplementation: () => Promise.resolve(new Response(
      JSON.stringify(githubResponse()),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ))
  })

  await writeCanonicalUpdateManifest(outputPath, manifest)

  const encoded = await fs.readFile(outputPath, 'utf8')
  assert.deepEqual(decodeCanonicalUpdateManifest(encoded), manifest)
  assert.equal(encoded.endsWith('\n'), true)
})

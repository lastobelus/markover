import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { MAXIMUM_ATTACHMENT_BYTES } from '../src/attachment-limits'
import { reviewChecksum } from '../src/review-format'

import {
  assertReviewTree,
  reviewDeletionPolicy,
  ReviewStore,
  ReviewStoreError,
  type ReviewStoreOptions
} from '../src/review-store'

const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi
const {
  DEFAULT_INTERPRETATION_POLICY,
  FIXED_CONTRACT
} = require('../src/agent-guidance') as MarkoverAgentGuidanceApi

function child(node: ReviewNode, index = 0): ReviewNode {
  const result = node.children[index]
  assert.ok(result)
  return result
}

function nodeOfType(root: ReviewNode, type: ReviewNode['type']): ReviewNode {
  if (root.type === type) return root
  for (const nested of root.children) {
    try {
      return nodeOfType(nested, type)
    } catch {
      // Continue searching the remaining branches.
    }
  }
  throw new Error(`Missing ${type} node.`)
}

function attachment(node: ReviewNode, index = 0): ReviewAttachment {
  const result = node.attachments?.[index]
  assert.ok(result)
  return result
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof ReviewStoreError && error.code === code
}

function reverseJsonObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseJsonObjectKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, nested]) => [key, reverseJsonObjectKeys(nested)])
  )
}

async function temporaryStore(options: ReviewStoreOptions = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-store-test-')
  )
  return {
    directory,
    store: new ReviewStore(directory, options)
  }
}

function tree(source = '# Review\n'): ReviewTree {
  return parseMarkdown(source, reviewChecksum(source), {
    name: 'review.md',
    path: '/tmp/review.md'
  })
}

function digest(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

test('creates distinct sessions with exact source and metadata', async (t) => {
  const ids = ['mko_aaa11111', 'mko_bbb22222']
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string,
    now: () => '2026-07-30T20:00:00.000Z'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const first = await store.create({
    tree: tree('# First\r\n'),
    contextSummary: 'Review the first document.',
    agentThread: {
      id: 'thread-1',
      threadHost: { kind: 'codex', provider: 'codex' }
    },
    git: { branch: 'feature/reviews' }
  })
  const second = await store.create({
    tree: tree('# Second\n'),
    contextSummary: 'Review the second document.'
  })

  assert.equal(first.review.id, 'mko_aaa11111')
  assert.equal(second.review.id, 'mko_bbb22222')
  assert.equal(first.review.status, 'editing')
  assert.equal(first.review.contextSummary, 'Review the first document.')
  assert.deepEqual(first.review.agentThread, {
    id: 'thread-1',
    threadHost: { kind: 'codex', provider: 'codex' }
  })
  assert.deepEqual(first.review.git, { branch: 'feature/reviews' })
  assert.deepEqual(first.review.agentGuidance, {
    fixedContract: FIXED_CONTRACT,
    interpretationPolicy: DEFAULT_INTERPRETATION_POLICY
  })
  assert.equal(first.sourceDocument.content, '# First\r\n')
  assert.equal(second.sourceDocument.content, '# Second\n')
  assert.deepEqual((await store.list()).map((item) => item.review.id), [
    'mko_aaa11111',
    'mko_bbb22222'
  ])
})

test('receipt-backed create and body-free recovery share the create queue', async (t) => {
  const ids = ['mko_aaa11111', 'mko_bbb22222']
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string,
    now: () => '2026-08-18T20:00:00.000Z'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const requestBytes = Buffer.from('{"exact":"request bytes"}')
  const attempt = {
    idempotencyKey: 'mko-idempotency-key-with-enough-random-material',
    requestBytes,
    requestDigest: digest(requestBytes)
  }
  const input = {
    tree: tree('# Remote\n'),
    contextSummary: 'Review from a remote agent.',
    origin: 'remote-agent'
  }

  const [created, recovered] = await Promise.all([
    store.createWithReceipt(input, attempt),
    store.recoverCreation(attempt)
  ])
  assert.equal(created.created, true)
  assert.equal(recovered.review.id, created.artifact.review.id)
  assert.deepEqual(created.artifact.review.creationReceipt, {
    version: 1,
    keyDigest: digest(attempt.idempotencyKey),
    requestDigest: attempt.requestDigest
  })

  const retried = await store.createWithReceipt(input, attempt)
  assert.equal(retried.created, false)
  assert.equal(retried.artifact.review.id, created.artifact.review.id)
  assert.equal((await store.list()).length, 1)
  assert.deepEqual(ids, ['mko_bbb22222'])
})

test('creation receipts fail closed on body, key, and stored receipt conflicts', async (t) => {
  const ids = ['mko_aaa11111', 'mko_bbb22222', 'mko_ccc33333']
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const requestBytes = Buffer.from('{"request":1}')
  const key = 'mko-idempotency-key-with-enough-random-material'
  const requestDigest = digest(requestBytes)
  const input = {
    tree: tree('# Remote\n'),
    contextSummary: 'Review from a remote agent.',
    origin: 'remote-agent'
  }

  await assert.rejects(
    store.createWithReceipt(input, {
      idempotencyKey: key,
      requestBytes,
      requestDigest: digest('different bytes')
    }),
    (error: unknown) => hasErrorCode(error, 'REQUEST_DIGEST_MISMATCH')
  )
  await assert.rejects(
    store.recoverCreation({ idempotencyKey: key, requestDigest }),
    (error: unknown) => hasErrorCode(error, 'RECEIPT_NOT_FOUND')
  )

  const created = await store.createWithReceipt(input, {
    idempotencyKey: key,
    requestBytes,
    requestDigest
  })
  await assert.rejects(
    store.recoverCreation({
      idempotencyKey: key,
      requestDigest: digest('another request')
    }),
    (error: unknown) => {
      assert.ok(error instanceof ReviewStoreError)
      assert.equal(error.code, 'IDEMPOTENCY_CONFLICT')
      assert.equal(error.reviewId, created.artifact.review.id)
      assert.deepEqual(
        error.creationReceipt,
        created.artifact.review.creationReceipt
      )
      return true
    }
  )

  const duplicate = await store.create({
    tree: tree('# Duplicate\n'),
    contextSummary: 'Duplicate stored receipt.',
    origin: 'remote-agent'
  })
  const storedReceipt = created.artifact.review.creationReceipt
  assert.ok(storedReceipt)
  duplicate.review.creationReceipt = structuredClone(storedReceipt)
  await store.write(duplicate.review.id, duplicate)
  await assert.rejects(
    store.recoverCreation({ idempotencyKey: key, requestDigest }),
    (error: unknown) => {
      assert.ok(error instanceof ReviewStoreError)
      assert.equal(error.code, 'DUPLICATE_CREATION_RECEIPT')
      assert.deepEqual(error.reviewIds, [
        created.artifact.review.id,
        duplicate.review.id
      ].sort())
      return true
    }
  )
})

test('receipt scans ignore unrelated invalid v1 fields without rewriting them', async (t) => {
  const ids = [
    'mko_aaa11111',
    'mko_bbb22222',
    'mko_ccc33333',
    'mko_ddd44444',
    'mko_eee55555'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const mutations = [
    (artifact: Record<string, unknown>) => {
      artifact.discovery = { source: 'prototype' }
    },
    (artifact: Record<string, unknown>) => {
      const review = artifact.review as Record<string, unknown>
      review.git = { repositoryRoot: '/private/prototype' }
    },
    (artifact: Record<string, unknown>) => {
      const root = artifact.root as Record<string, unknown>
      root.collapsed = true
    },
    (artifact: Record<string, unknown>) => {
      const review = artifact.review as Record<string, unknown>
      delete review.origin
      delete review.attentionRequestedAt
    }
  ]
  const preserved = new Map<string, string>()
  for (const mutate of mutations) {
    const created = await store.create({
      tree: tree('# Prototype\n'),
      contextSummary: 'Pre-v1 prototype review.'
    })
    const artifact = structuredClone(created) as unknown as Record<string, unknown>
    mutate(artifact)
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`
    await fs.writeFile(store.reviewPath(created.review.id), serialized, 'utf8')
    preserved.set(created.review.id, serialized)
    await assert.rejects(
      store.load(created.review.id),
      (error: unknown) => hasErrorCode(error, 'INVALID_REVIEW')
    )
  }

  const requestBytes = Buffer.from('{"request":1}')
  const created = await store.createWithReceipt({
    tree: tree('# Remote\n'),
    contextSummary: 'Review from a remote agent.',
    origin: 'remote-agent'
  }, {
    idempotencyKey: 'mko-idempotency-key-with-enough-random-material',
    requestBytes,
    requestDigest: digest(requestBytes)
  })
  assert.equal(created.created, true)
  assert.equal(created.artifact.review.id, 'mko_eee55555')
  await assert.rejects(
    store.recoverCreation({
      idempotencyKey: 'different-mko-idempotency-key-with-enough-material',
      requestDigest: digest('different request')
    }),
    (error: unknown) => hasErrorCode(error, 'RECEIPT_NOT_FOUND')
  )
  for (const [reviewId, serialized] of preserved) {
    assert.equal(await fs.readFile(store.reviewPath(reviewId), 'utf8'), serialized)
  }
})

test('valid receipts in invalid v1 artifacts still prevent duplicate creation', async (t) => {
  const ids = ['mko_aaa11111', 'mko_bbb22222']
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const firstBytes = Buffer.from('{"request":1}')
  const firstKey = 'first-mko-idempotency-key-with-enough-random-material'
  const first = await store.createWithReceipt({
    tree: tree('# First\n'),
    contextSummary: 'First remote review.',
    origin: 'remote-agent'
  }, {
    idempotencyKey: firstKey,
    requestBytes: firstBytes,
    requestDigest: digest(firstBytes)
  })
  const invalid = structuredClone(first.artifact) as unknown as Record<string, unknown>
  invalid.discovery = { source: 'prototype' }
  await fs.writeFile(
    store.reviewPath(first.artifact.review.id),
    JSON.stringify(invalid),
    'utf8'
  )

  const secondBytes = Buffer.from('{"request":2}')
  const second = await store.createWithReceipt({
    tree: tree('# Second\n'),
    contextSummary: 'Second remote review.',
    origin: 'remote-agent'
  }, {
    idempotencyKey: 'second-mko-idempotency-key-with-enough-random-material',
    requestBytes: secondBytes,
    requestDigest: digest(secondBytes)
  })
  assert.equal(second.created, true)
  await assert.rejects(
    store.recoverCreation({
      idempotencyKey: firstKey,
      requestDigest: digest(firstBytes)
    }),
    (error: unknown) => hasErrorCode(error, 'CREATION_RECEIPT_SCAN_INCOMPLETE')
  )
  await assert.rejects(
    store.recoverCreation({
      idempotencyKey: firstKey,
      requestDigest: digest('changed request')
    }),
    (error: unknown) => hasErrorCode(error, 'IDEMPOTENCY_CONFLICT')
  )

  const duplicate = structuredClone(second.artifact) as ReviewArtifact & {
    discovery: unknown
  }
  duplicate.discovery = { source: 'prototype' }
  const firstReceipt = first.artifact.review.creationReceipt
  assert.ok(firstReceipt)
  duplicate.review.creationReceipt = structuredClone(firstReceipt)
  await fs.writeFile(
    store.reviewPath(second.artifact.review.id),
    JSON.stringify(duplicate),
    'utf8'
  )
  await assert.rejects(
    store.recoverCreation({
      idempotencyKey: firstKey,
      requestDigest: digest(firstBytes)
    }),
    (error: unknown) => hasErrorCode(error, 'DUPLICATE_CREATION_RECEIPT')
  )
})

test('receipt operations fail closed when a managed artifact is uninspectable', async (t) => {
  const variants = [
    'invalid',
    'invalid-envelope',
    'malformed-receipt',
    'malformed-json',
    'non-object',
    'incompatible',
    'unreadable'
  ] as const
  for (const variant of variants) {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), `markover-receipt-${variant}-test-`)
    )
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    let allocations = 0
    const store = new ReviewStore(directory, {
      idFactory: () => {
        allocations += 1
        return allocations === 1 ? 'mko_aaa11111' : 'mko_bbb22222'
      }
    })
    const requestBytes = Buffer.from('{"request":1}')
    const attempt = {
      idempotencyKey: 'mko-idempotency-key-with-enough-random-material',
      requestBytes,
      requestDigest: digest(requestBytes)
    }
    const created = await store.createWithReceipt({
      tree: tree('# Remote\n'),
      contextSummary: 'Review from a remote agent.',
      origin: 'remote-agent'
    }, attempt)
    const reviewPath = store.reviewPath(created.artifact.review.id)

    if (variant === 'unreadable') {
      await fs.chmod(reviewPath, 0)
    } else if (variant === 'malformed-json') {
      await fs.writeFile(reviewPath, '{not json', 'utf8')
    } else if (variant === 'non-object') {
      await fs.writeFile(reviewPath, '[]', 'utf8')
    } else {
      const damaged = structuredClone(created.artifact) as unknown as Record<
        string,
        unknown
      >
      if (variant === 'incompatible') {
        damaged.version = 2
      } else {
        const review = damaged.review as Record<string, unknown>
        if (variant === 'invalid-envelope') {
          review.id = 'mko_other111'
        } else if (variant === 'malformed-receipt') {
          const receipt = review.creationReceipt as Record<string, unknown>
          receipt.requestDigest = 'sha256:bad'
        } else {
          review.status = 'invalid'
        }
      }
      await fs.writeFile(reviewPath, JSON.stringify(damaged), 'utf8')
    }

    await assert.rejects(
      store.createWithReceipt({
        tree: tree('# Remote\n'),
        contextSummary: 'Review from a remote agent.',
        origin: 'remote-agent'
      }, attempt),
      (error: unknown) => {
        assert.ok(error instanceof ReviewStoreError)
        assert.equal(error.code, 'CREATION_RECEIPT_SCAN_INCOMPLETE')
        assert.deepEqual(error.reviewIds, [created.artifact.review.id])
        return true
      },
      variant
    )
    assert.equal(allocations, 1, variant)
    if (variant === 'unreadable') await fs.chmod(reviewPath, 0o600)
  }
})

test('reviewer round trips preserve additive creation receipt data', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const requestBytes = Buffer.from('{"request":1}')
  const result = await store.createWithReceipt({
    tree: tree('# Remote\n'),
    contextSummary: 'Preserve the portable receipt.',
    origin: 'remote-agent'
  }, {
    idempotencyKey: 'mko-idempotency-key-with-enough-random-material',
    requestBytes,
    requestDigest: digest(requestBytes)
  })
  const extended = structuredClone(result.artifact)
  assert.ok(extended.review.creationReceipt)
  extended.review.creationReceipt.fixtureExtension = { preserve: true }
  await store.write(extended.review.id, extended)

  const claimed = await store.getForReview(extended.review.id, {
    mode: 'annotation-only'
  })
  const reviewed = await store.submitAgentReview(extended.review.id, claimed)
  assert.deepEqual(reviewed.review.creationReceipt, extended.review.creationReceipt)
})

test('pending queries return every unresolved review for the exact requesting thread', async (t) => {
  const ids = [
    'mko_aaa11111',
    'mko_bbb22222',
    'mko_ccc33333',
    'mko_ddd44444',
    'mko_eee55555'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string,
    now: () => '2026-08-10T00:00:00.000Z'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const hostThread = {
    id: 'provider-session-1',
    threadHost: {
      kind: 't3code',
      provider: 'codex',
      threadId: 'host-thread-1'
    }
  }
  const first = await store.create({
    tree: tree('# First\n'),
    contextSummary: 'First pending review.',
    agentThread: hostThread
  })
  const second = await store.create({
    tree: tree('# Second\n'),
    contextSummary: 'Same host thread, different provider session.',
    agentThread: {
      ...hostThread,
      id: 'provider-session-2'
    }
  })
  const completed = await store.create({
    tree: tree('# Completed\n'),
    contextSummary: 'Completed review.',
    agentThread: hostThread
  })
  const other = await store.create({
    tree: tree('# Other\n'),
    contextSummary: 'Other thread.',
    agentThread: {
      id: 'provider-session-3',
      threadHost: {
        kind: 't3code',
        provider: 'codex',
        threadId: 'host-thread-2'
      }
    }
  })
  const providerOnly = await store.create({
    tree: tree('# Provider only\n'),
    contextSummary: 'Provider-session fallback review.',
    agentThread: {
      id: 'provider-session-1',
      threadHost: {
        kind: 't3code',
        provider: 'codex'
      }
    }
  })
  await store.handoff(second.review.id)
  await store.resolve(completed.review.id, 'accepted-unreviewed')
  await store.handoff(other.review.id)

  assert.deepEqual(
    (await store.pendingForThread(hostThread)).map((artifact) => [
      artifact.review.id,
      artifact.review.status
    ]),
    [
      [second.review.id, 'pending-agent'],
      [first.review.id, 'editing']
    ]
  )
  assert.deepEqual(
    (await store.pendingForThread({
      id: 'provider-session-1',
      threadHost: { kind: 't3code', provider: 'codex' }
    })).map((artifact) => artifact.review.id),
    [providerOnly.review.id]
  )
})

test('snapshots a custom interpretation policy when the review is created', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check custom guidance.',
    interpretationPolicy: 'Apply revisions in checklist order.'
  })

  assert.deepEqual(created.review.agentGuidance, {
    fixedContract: FIXED_CONTRACT,
    interpretationPolicy: 'Apply revisions in checklist order.'
  })
  assert.deepEqual((await store.handoff(created.review.id)).review.agentGuidance, {
    fixedContract: FIXED_CONTRACT,
    interpretationPolicy: 'Apply revisions in checklist order.'
  })
})

test('handoff freezes an idempotent snapshot', async (t) => {
  const timestamps = [
    '2026-07-30T20:00:00.000Z',
    '2026-07-30T20:01:00.000Z'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => timestamps.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check the handoff.'
  })
  const handedOff = await store.handoff(created.review.id)
  const retry = await store.handoff(created.review.id)

  assert.equal(handedOff.review.status, 'pending-agent')
  assert.equal(handedOff.review.updatedAt, '2026-07-30T20:01:00.000Z')
  assert.equal(
    handedOff.review.attentionRequestedAt,
    '2026-07-30T20:00:00.000Z'
  )
  assert.deepEqual(retry, handedOff)
  assert.deepEqual(await store.load(created.review.id), handedOff)
})

test('agent review claims are pristine, attributed, frozen, and recoverable', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    claimIdFactory: () => 'mko_claim_0123456789abcdef',
    now: () => '2026-08-12T20:00:00.000Z'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const created = await store.create({
    tree: tree('# Review\n\nParagraph.\n'),
    contextSummary: 'Agent reviewer claim.'
  })
  const identity = {
    id: 'reviewer-thread',
    threadHost: { kind: 't3code', provider: 'codex' }
  }
  const claimed = await store.getForReview(created.review.id, {
    mode: 'annotation-only',
    agentThread: identity,
    maximumSubmissionBytes: 1024 * 1024
  })

  assert.equal(claimed.review.status, 'agent-reviewing')
  const reviewer = claimed.review.agentReviewer
  assert.ok(reviewer)
  assert.deepEqual(reviewer.agentThread, identity)
  assert.equal(reviewer.mode, 'annotation-only')
  assert.equal(
    reviewer.claimId,
    'mko_claim_0123456789abcdef'
  )
  assert.match(
    reviewer.agentGuidance.fixedContract,
    /sole reviewer/
  )
  assert.deepEqual(
    await store.getForReview(created.review.id, { mode: 'annotation-only' }),
    claimed
  )
  await assert.rejects(
    store.getForReview(created.review.id, {
      mode: 'annotation-only',
      agentThread: null
    }),
    (error: unknown) => hasErrorCode(error, 'CLAIM_CONFLICT')
  )
})

test('agent review claims reject human content and impossible submit sizes', async (t) => {
  const ids = ['mko_aaa11111', 'mko_bbb22222']
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string,
    claimIdFactory: () => 'mko_claim_0123456789abcdef'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const annotated = await store.create({
    tree: tree(),
    contextSummary: 'Reject existing feedback.'
  })
  const update = structuredClone(annotated)
  child(update.root).feedback = 'Human feedback.'
  await store.updateTree(annotated.review.id, update)
  await assert.rejects(
    store.getForReview(annotated.review.id, { mode: 'annotation-only' }),
    (error: unknown) => hasErrorCode(error, 'REVIEW_NOT_PRISTINE')
  )
  assert.equal((await store.load(annotated.review.id)).review.status, 'editing')

  const oversized = await store.create({
    tree: tree(),
    contextSummary: 'Reject impossible body.'
  })
  await assert.rejects(
    store.getForReview(oversized.review.id, {
      mode: 'annotation-only',
      maximumSubmissionBytes: 1
    }),
    (error: unknown) => hasErrorCode(error, 'BODY_TOO_LARGE')
  )
  assert.equal((await store.load(oversized.review.id)).review.status, 'editing')
})

test('agent submissions are atomic, mode-limited, and exactly retryable', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    claimIdFactory: () => 'mko_claim_0123456789abcdef',
    now: () => '2026-08-12T20:00:00.000Z'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const created = await store.create({
    tree: tree('# Review\n\nParagraph.\n'),
    contextSummary: 'Submit an agent review.'
  })
  const claimed = await store.getForReview(created.review.id, {
    mode: 'annotation-only'
  })
  const forbidden = structuredClone(claimed)
  const paragraph = nodeOfType(forbidden.root, 'paragraph')
  paragraph.feedback = 'Clarify this paragraph.'
  paragraph.sourceEdit = {
    original: paragraph.raw,
    current: 'Clearer paragraph.'
  }
  await assert.rejects(
    store.submitAgentReview(created.review.id, forbidden),
    (error: unknown) => hasErrorCode(error, 'SOURCE_PROPOSALS_FORBIDDEN')
  )
  assert.equal((await store.load(created.review.id)).review.status, 'agent-reviewing')

  const submission = structuredClone(claimed)
  nodeOfType(submission.root, 'paragraph').feedback = 'Clarify this paragraph.'
  const reviewed = await store.submitAgentReview(created.review.id, submission)
  assert.equal(reviewed.review.status, 'reviewed')
  assert.equal(reviewed.review.agentReviewer?.completedAt, reviewed.review.updatedAt)
  assert.deepEqual(
    await store.submitAgentReview(created.review.id, submission),
    reviewed
  )
  assert.deepEqual(
    await store.submitAgentReview(
      created.review.id,
      reverseJsonObjectKeys(submission)
    ),
    reviewed
  )
  const changedRetry = structuredClone(submission)
  nodeOfType(changedRetry.root, 'paragraph').feedback = 'Different feedback.'
  await assert.rejects(
    store.submitAgentReview(created.review.id, changedRetry),
    (error: unknown) => hasErrorCode(error, 'SUBMISSION_CONFLICT')
  )
  await assert.rejects(
    store.edit(created.review.id),
    (error: unknown) => hasErrorCode(error, 'INVALID_TRANSITION')
  )
})

test('cancel and same-clock reclaim reject a stale first claim', async (t) => {
  const claimIds = [
    'mko_claim_0123456789abcdef',
    'mko_claim_fedcba9876543210'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    claimIdFactory: () => claimIds.shift() as string,
    now: () => '2026-08-12T20:00:00.000Z'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const created = await store.create({
    tree: tree(),
    contextSummary: 'Reject stale claims.'
  })
  const first = await store.getForReview(created.review.id, {
    mode: 'annotation-only'
  })
  await store.edit(created.review.id)
  const second = await store.getForReview(created.review.id, {
    mode: 'annotation-only'
  })
  assert.notEqual(
    first.review.agentReviewer?.claimId,
    second.review.agentReviewer?.claimId
  )
  await assert.rejects(
    store.submitAgentReview(created.review.id, first),
    (error: unknown) => hasErrorCode(error, 'REVIEW_MISMATCH')
  )
})

test('source-proposal mode accepts valid proposals and preserves additive fields', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    claimIdFactory: () => 'mko_claim_0123456789abcdef'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const created = await store.create({
    tree: tree('# Review\n\nParagraph.\n'),
    contextSummary: 'Accept a source proposal.'
  })
  const extended = structuredClone(created)
  Reflect.set(extended.review, 'fixtureAgentExtension', { preserved: true })
  await store.write(created.review.id, extended)
  const claimed = await store.getForReview(created.review.id, {
    mode: 'annotations-and-source-proposals'
  })
  const submission = structuredClone(claimed)
  const paragraph = nodeOfType(submission.root, 'paragraph')
  paragraph.sourceEdit = {
    original: paragraph.raw,
    current: 'Replacement paragraph.'
  }
  const reviewed = await store.submitAgentReview(created.review.id, submission)
  assert.deepEqual(
    Reflect.get(reviewed.review, 'fixtureAgentExtension'),
    { preserved: true }
  )
  assert.equal(
    nodeOfType(reviewed.root, 'paragraph').sourceEdit?.current,
    'Replacement paragraph.'
  )

  const changedExtension = structuredClone(claimed)
  Reflect.set(changedExtension.review, 'fixtureAgentExtension', { preserved: false })
  await assert.rejects(
    store.submitAgentReview(created.review.id, changedExtension),
    (error: unknown) => hasErrorCode(error, 'SUBMISSION_CONFLICT')
  )
})

test('PR completion skips inflight agent review and archives reviewed content', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    claimIdFactory: () => 'mko_claim_0123456789abcdef'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const created = await store.create({
    tree: tree(),
    contextSummary: 'Do not archive inflight reviewer work.',
    git: { repositoryUrl: 'https://github.com/lastobelus/markover.git' },
    pullRequest: { number: 132 }
  })
  const claimed = await store.getForReview(created.review.id, {
    mode: 'annotation-only'
  })
  assert.deepEqual(
    (await store.done(
      'https://github.com/lastobelus/markover/pull/132',
      'merged'
    )).reviews,
    []
  )
  assert.equal(
    (await store.load(created.review.id)).review.status,
    'agent-reviewing'
  )
  await store.submitAgentReview(created.review.id, claimed)
  const result = await store.done(
    'https://github.com/lastobelus/markover/pull/132',
    'merged'
  )
  const completed = result.reviews[0]
  assert.ok(completed)
  assert.equal(completed.review.status, 'done')
  assert.equal(
    completed.review.agentReviewer?.claimId,
    'mko_claim_0123456789abcdef'
  )
  assert.deepEqual(
    await store.submitAgentReview(created.review.id, claimed),
    completed
  )
  const changedRetry = structuredClone(claimed)
  child(changedRetry.root).feedback = 'Different feedback.'
  await assert.rejects(
    store.submitAgentReview(created.review.id, changedRetry),
    (error: unknown) => hasErrorCode(error, 'SUBMISSION_CONFLICT')
  )
  const changedExtension = structuredClone(claimed)
  const pullRequest = changedExtension.review.pullRequest as Record<string, unknown>
  pullRequest.fixtureExtension = 'changed'
  await assert.rejects(
    store.submitAgentReview(created.review.id, changedExtension),
    (error: unknown) => hasErrorCode(error, 'SUBMISSION_CONFLICT')
  )
})

test('edit returns a pending review to editing and is idempotent', async (t) => {
  const timestamps = [
    '2026-07-30T20:00:00.000Z',
    '2026-07-30T20:01:00.000Z',
    '2026-07-30T20:02:00.000Z'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => timestamps.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check editing.'
  })
  await store.handoff(created.review.id)
  const editing = await store.edit(created.review.id)
  const retry = await store.edit(created.review.id)

  assert.equal(editing.review.status, 'editing')
  assert.equal(editing.review.updatedAt, '2026-07-30T20:02:00.000Z')
  assert.equal(
    editing.review.attentionRequestedAt,
    '2026-07-30T20:02:00.000Z'
  )
  assert.deepEqual(retry, editing)
})

test('mutations preserve lifecycle ordering when the system clock moves backward', async (t) => {
  let now = '2026-07-30T20:00:00.000Z'
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => now
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Keep lifecycle timestamps monotonic.'
  })
  now = '2026-07-30T19:00:00.000Z'
  const annotated = structuredClone(created)
  child(annotated.root).feedback = 'Clock rollback feedback.'
  const updated = await store.updateTree(created.review.id, annotated)
  const handedOff = await store.handoff(created.review.id)
  const editing = await store.edit(created.review.id)

  for (const artifact of [updated, handedOff, editing]) {
    assert.equal(artifact.review.updatedAt, created.review.updatedAt)
    assert.equal(
      artifact.review.attentionRequestedAt,
      created.review.attentionRequestedAt
    )
  }
  assert.deepEqual(await store.load(created.review.id), editing)
})

test('revise completes a handoff and rejects backward transitions', async (t) => {
  const timestamps = [
    '2026-08-10T01:00:00.000Z',
    '2026-08-10T01:01:00.000Z',
    '2026-08-10T01:02:00.000Z'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => timestamps.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check revision completion.'
  })
  await assert.rejects(
    store.revise(created.review.id),
    (error: unknown) => hasErrorCode(error, 'INVALID_TRANSITION')
  )
  await store.handoff(created.review.id)
  const revised = await store.revise(created.review.id)
  const retry = await store.revise(created.review.id)

  assert.equal(revised.review.status, 'revised')
  assert.equal(revised.review.updatedAt, '2026-08-10T01:02:00.000Z')
  assert.deepEqual(revised.review.resolution, {
    outcome: 'feedback-addressed',
    resolvedAt: '2026-08-10T01:02:00.000Z'
  })
  assert.deepEqual(retry, revised)
  await assert.rejects(
    store.edit(created.review.id),
    (error: unknown) => hasErrorCode(error, 'INVALID_TRANSITION')
  )
  await assert.rejects(
    store.handoff(created.review.id),
    (error: unknown) => hasErrorCode(error, 'INVALID_TRANSITION')
  )
})

test('manual no-note resolution is explicit, content-safe, and reversible', async (t) => {
  const timestamps = [
    '2026-08-10T01:10:00.000Z',
    '2026-08-10T01:11:00.000Z',
    '2026-08-10T01:12:00.000Z'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => timestamps.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Resolve without notes.'
  })
  const resolved = await store.resolve(created.review.id, 'reviewed-no-notes')
  assert.equal(resolved.review.status, 'revised')
  assert.deepEqual(resolved.review.resolution, {
    outcome: 'reviewed-no-notes',
    resolvedAt: '2026-08-10T01:11:00.000Z'
  })

  const editing = await store.unresolve(created.review.id)
  assert.equal(editing.review.status, 'editing')
  assert.equal(editing.review.attentionRequestedAt, '2026-08-10T01:12:00.000Z')
  assert.equal(editing.review.resolution, undefined)
})

test('feedback-bearing resolution requires explicit abandonment and preserves content', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => '2026-08-10T01:20:00.000Z'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree('# Review\n\nKeep this feedback.\n'),
    contextSummary: 'Preserve abandoned feedback.'
  })
  const annotated = structuredClone(created)
  const paragraph = nodeOfType(annotated.root, 'paragraph')
  paragraph.feedback = 'This should remain visible in history.'
  paragraph.sourceEdit = {
    original: paragraph.raw,
    current: 'A proposed replacement.'
  }
  await store.updateTree(created.review.id, annotated)

  await assert.rejects(
    store.resolve(created.review.id, 'accepted-unreviewed'),
    (error: unknown) => hasErrorCode(error, 'FEEDBACK_REQUIRES_ABANDONMENT')
  )
  const resolved = await store.resolve(created.review.id, 'feedback-abandoned')
  assert.equal(resolved.review.status, 'revised')
  assert.equal(resolved.review.resolution?.outcome, 'feedback-abandoned')
  assert.equal(
    nodeOfType(resolved.root, 'paragraph').feedback,
    'This should remain visible in history.'
  )
  assert.equal(
    nodeOfType(resolved.root, 'paragraph').sourceEdit?.current,
    'A proposed replacement.'
  )
})

test('stores successful agent PR observations with transition receipt time', async (t) => {
  const timestamps = [
    '2026-08-10T02:00:00.000Z',
    '2026-08-10T02:01:00.000Z',
    '2026-08-10T02:02:00.000Z',
    '2026-08-10T02:03:00.000Z'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => timestamps.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check PR observations.',
    git: { repositoryUrl: 'git@github.com:lastobelus/markover.git' },
    pullRequest: { number: 123, fixtureExtension: 'preserve me' },
    pullRequestStatus: 'draft'
  })
  assert.deepEqual(created.review.pullRequest, {
    number: 123,
    fixtureExtension: 'preserve me',
    url: 'https://github.com/lastobelus/markover/pull/123',
    status: 'draft',
    statusObservedAt: '2026-08-10T02:00:00.000Z',
    statusSource: 'agent'
  })

  const handedOff = await store.handoff(created.review.id, 'open')
  assert.deepEqual(handedOff.review.pullRequest, {
    number: 123,
    fixtureExtension: 'preserve me',
    url: 'https://github.com/lastobelus/markover/pull/123',
    status: 'open',
    statusObservedAt: '2026-08-10T02:01:00.000Z',
    statusSource: 'agent'
  })
  const revised = await store.revise(created.review.id, 'open')
  assert.equal(revised.review.status, 'revised')
  assert.deepEqual(revised.review.pullRequest, {
    number: 123,
    fixtureExtension: 'preserve me',
    url: 'https://github.com/lastobelus/markover/pull/123',
    status: 'open',
    statusObservedAt: '2026-08-10T02:02:00.000Z',
    statusSource: 'agent'
  })
  const persisted = await store.load(created.review.id)
  assert.ok(persisted.review.resolution)
  persisted.review.resolution.fixtureExtension = 'preserve me'
  await fs.writeFile(
    store.reviewPath(created.review.id),
    `${JSON.stringify(persisted, null, 2)}\n`,
    'utf8'
  )
  const retry = await store.revise(created.review.id, 'open')
  assert.deepEqual(retry.review.resolution, {
    outcome: 'feedback-addressed',
    resolvedAt: '2026-08-10T02:02:00.000Z',
    fixtureExtension: 'preserve me'
  })
  assert.equal(
    retry.review.pullRequest?.statusObservedAt,
    '2026-08-10T02:03:00.000Z'
  )
})

test('an omitted PR observation preserves the last successful value', async (t) => {
  const timestamps = [
    '2026-08-10T02:10:00.000Z',
    '2026-08-10T02:11:00.000Z',
    '2026-08-10T02:12:00.000Z'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => timestamps.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Preserve the prior PR observation.',
    git: { repositoryUrl: 'https://github.com/lastobelus/markover' },
    pullRequest: { number: 123 },
    pullRequestStatus: 'open'
  })
  const observed = created.review.pullRequest
  await store.handoff(created.review.id)
  const revised = await store.revise(created.review.id)
  assert.deepEqual(revised.review.pullRequest, observed)
  assert.equal(revised.review.updatedAt, '2026-08-10T02:12:00.000Z')
})

test('a changed equal-time PR observation propagates without lifecycle churn', async (t) => {
  const ids = ['mko_aaa11111', 'mko_bbb22222', 'mko_ccc33333']
  const timestamps = [
    '2026-08-10T04:00:00.000Z',
    '2026-08-10T04:01:00.000Z',
    '2026-08-10T04:02:00.000Z',
    '2026-08-10T03:59:00.000Z'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string,
    now: () => timestamps.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const older = await store.create({
    tree: tree('# Older\n'),
    contextSummary: 'Older matching review.',
    git: { repositoryUrl: 'git@github.com:lastobelus/markover.git' },
    pullRequest: {
      number: 123,
      status: 'draft',
      statusObservedAt: '2026-08-10T04:00:00.000Z',
      statusSource: 'agent'
    }
  })
  const unrelated = await store.create({
    tree: tree('# Other\n'),
    contextSummary: 'Same PR number in another repository.',
    git: { repositoryUrl: 'git@github.com:openai/markover.git' },
    pullRequest: { number: 123 }
  })
  const source = await store.create({
    tree: tree('# Current\n'),
    contextSummary: 'Newest matching observation.',
    git: { repositoryUrl: 'https://github.com/Lastobelus/Markover' },
    pullRequest: {
      number: 123,
      status: 'open',
      statusObservedAt: '2026-08-10T04:00:00.000Z',
      statusSource: 'agent'
    }
  })

  const propagated = await store.propagatePullRequestObservation(source)
  assert.deepEqual(propagated.map((review) => review.review.id), [older.review.id])
  const refreshed = await store.load(older.review.id)
  assert.equal(refreshed.review.updatedAt, '2026-08-10T04:00:00.000Z')
  assert.equal(
    refreshed.review.attentionRequestedAt,
    older.review.attentionRequestedAt
  )
  assert.deepEqual(refreshed.review.pullRequest, {
    number: 123,
    url: 'https://github.com/lastobelus/markover/pull/123',
    status: 'open',
    statusObservedAt: '2026-08-10T04:00:00.000Z',
    statusSource: 'agent'
  })
  assert.deepEqual((await store.load(unrelated.review.id)).review.pullRequest, {
    number: 123,
    url: 'https://github.com/openai/markover/pull/123'
  })
  assert.deepEqual(await store.propagatePullRequestObservation(refreshed), [])
})

test('requires canonical PR identity and complete lifecycle observations', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => '2026-08-10T02:20:00.000Z'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  await assert.rejects(
    store.create({
      tree: tree(),
      contextSummary: 'Missing repository identity.',
      pullRequest: { number: 123 }
    }),
    (error: unknown) => hasErrorCode(error, 'INVALID_PULL_REQUEST')
  )
  await assert.rejects(
    store.create({
      tree: tree(),
      contextSummary: 'Mismatched pull request identity.',
      pullRequest: {
        number: 124,
        url: 'https://github.com/lastobelus/markover/pull/123'
      }
    }),
    (error: unknown) => hasErrorCode(error, 'INVALID_PULL_REQUEST')
  )
  await assert.rejects(
    store.create({
      tree: tree(),
      contextSummary: 'Incomplete pull request observation.',
      git: { repositoryUrl: 'https://github.com/lastobelus/markover' },
      pullRequest: { number: 123, status: 'open' }
    }),
    (error: unknown) => hasErrorCode(error, 'INVALID_PULL_REQUEST_STATUS')
  )

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Validate the Done invariant.',
    git: { repositoryUrl: 'https://github.com/lastobelus/markover' },
    pullRequest: { number: 123 },
    pullRequestStatus: 'open'
  })
  const invalidDone = structuredClone(created)
  invalidDone.review.status = 'done'
  await store.write(created.review.id, invalidDone)
  await assert.rejects(
    store.load(created.review.id),
    (error: unknown) => hasErrorCode(error, 'INVALID_REVIEW')
  )
})

test('done matches repository and PR identity and is retry-safe', async (t) => {
  const ids = [
    'mko_aaa11111',
    'mko_bbb22222',
    'mko_ccc33333',
    'mko_ddd44444'
  ]
  let minute = 0
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string,
    now: () => `2026-08-10T03:${String(minute++).padStart(2, '0')}:00.000Z`
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const first = await store.create({
    tree: tree('# First\n'),
    contextSummary: 'First matching review.',
    git: { repositoryUrl: 'git@github.com:lastobelus/markover.git' },
    pullRequest: { number: 123 }
  })
  const second = await store.create({
    tree: tree('# Second\n'),
    contextSummary: 'Second matching review.',
    git: { repositoryUrl: 'https://github.com/Lastobelus/Markover.git' },
    pullRequest: { number: 123 }
  })
  const otherPr = await store.create({
    tree: tree('# Other PR\n'),
    contextSummary: 'Different PR.',
    git: { repositoryUrl: 'git@github.com:lastobelus/markover.git' },
    pullRequest: { number: 124 }
  })
  const otherRepository = await store.create({
    tree: tree('# Other repository\n'),
    contextSummary: 'Different repository.',
    git: { repositoryUrl: 'git@github.com:openai/markover.git' },
    pullRequest: { number: 123 }
  })
  await store.handoff(second.review.id)
  await store.revise(second.review.id)

  const completed = await store.done(
    'https://github.com/lastobelus/markover/pull/123',
    'merged'
  )
  assert.deepEqual(
    completed.reviews.map((review) => review.review.id),
    [first.review.id, second.review.id]
  )
  for (const review of completed.reviews) {
    assert.equal(review.review.status, 'done')
    assert.equal(
      (review.review.pullRequest as Record<string, unknown>).status,
      'merged'
    )
    assert.equal(
      (review.review.pullRequest as Record<string, unknown>).url,
      'https://github.com/lastobelus/markover/pull/123'
    )
  }
  assert.equal(
    completed.reviews.find((review) => review.review.id === first.review.id)
      ?.review.resolution?.outcome,
    'merged-unresolved'
  )
  assert.equal(
    completed.reviews.find((review) => review.review.id === second.review.id)
      ?.review.resolution?.outcome,
    'feedback-addressed'
  )
  assert.equal((await store.load(otherPr.review.id)).review.status, 'editing')
  assert.equal(
    (await store.load(otherRepository.review.id)).review.status,
    'editing'
  )
  assert.deepEqual(await store.done(
    'https://github.com/lastobelus/markover/pull/123',
    'merged'
  ), completed)
  await assert.rejects(
    store.done('https://github.com/lastobelus/markover/pull/123', 'closed'),
    (error: unknown) => hasErrorCode(error, 'INVALID_PULL_REQUEST_STATUS')
  )
})

test('tree updates are allowed only while editing', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check updates.'
  })
  const annotated = structuredClone(created)
  const annotatedHeading = child(annotated.root)
  annotatedHeading.feedback = 'Make the title more specific.'
  annotatedHeading.attachments = [{
    id: 'img-1',
    type: 'image',
    path: '/tmp/img-1.png'
  }]
  const updated = await store.updateTree(created.review.id, annotated)
  const updatedHeading = child(updated.root)
  assert.equal(
    updatedHeading.feedback,
    'Make the title more specific.'
  )
  assert.equal(Object.hasOwn(updatedHeading, 'collapsed'), false)
  assert.equal(attachment(updatedHeading).id, 'img-1')
  assert.equal(updated.review.contextSummary, 'Check updates.')
  assert.equal(
    updated.review.attentionRequestedAt,
    created.review.attentionRequestedAt
  )

  await store.handoff(created.review.id)
  await assert.rejects(
    store.updateTree(created.review.id, annotated),
    (error: unknown) => hasErrorCode(error, 'NOT_EDITABLE')
  )
  assert.equal(
    (await store.load(created.review.id)).sourceDocument.content,
    '# Review\n'
  )
})

test('additive v1 fields survive store loads and owned mutations', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => '2026-08-11T20:00:00.000Z'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree('# Review\n\nOriginal paragraph.\n'),
    contextSummary: 'Preserve additive fields.',
    agentThread: {
      id: 'provider-thread',
      threadHost: { kind: 't3code', provider: 'codex' }
    },
    git: {
      repositoryUrl: 'https://github.com/lastobelus/markover.git',
      branch: 'feature/extensions'
    },
    pullRequest: {
      number: 99,
      url: 'https://github.com/lastobelus/markover/pull/99'
    }
  })
  const extended = structuredClone(created)
  Reflect.set(extended, 'fixtureTopLevelExtension', { preserved: true })
  Reflect.set(extended.sourceDocument, 'fixtureSourceExtension', 'source')
  Reflect.set(extended.root, 'fixtureNodeExtension', 'root')
  Reflect.set(extended.review, 'fixtureEnvelopeExtension', 'envelope')
  Reflect.set(extended.review.agentGuidance, 'fixtureGuidanceExtension', 'guidance')
  assert.ok(extended.review.agentThread)
  assert.ok(extended.review.git)
  assert.ok(extended.review.pullRequest)
  Reflect.set(extended.review.agentThread, 'fixtureThreadExtension', 'thread')
  Reflect.set(extended.review.git, 'fixtureGitExtension', 'git')
  Reflect.set(extended.review.pullRequest, 'fixturePullRequestExtension', 'pr')
  const paragraph = child(child(extended.root))
  paragraph.sourceEdit = {
    original: paragraph.raw,
    current: 'Revised paragraph.'
  }
  Reflect.set(paragraph.sourceEdit, 'fixtureProposalExtension', 'proposal')
  paragraph.attachments = [{ id: 'img-1' }]
  const addedAttachment = paragraph.attachments[0]
  assert.ok(addedAttachment)
  Reflect.set(addedAttachment, 'fixtureAttachmentExtension', 'attachment')
  await store.write(created.review.id, extended)

  const update = await store.load(created.review.id)
  child(child(update.root)).feedback = 'Persist this annotation.'
  const handedOff = await store.handoff(
    (await store.updateTree(created.review.id, update)).review.id
  )

  assert.deepEqual(Reflect.get(handedOff, 'fixtureTopLevelExtension'), {
    preserved: true
  })
  assert.equal(Reflect.get(handedOff.sourceDocument, 'fixtureSourceExtension'), 'source')
  assert.equal(Reflect.get(handedOff.root, 'fixtureNodeExtension'), 'root')
  assert.equal(Reflect.get(handedOff.review, 'fixtureEnvelopeExtension'), 'envelope')
  assert.equal(
    Reflect.get(handedOff.review.agentGuidance, 'fixtureGuidanceExtension'),
    'guidance'
  )
  assert.ok(handedOff.review.agentThread)
  assert.ok(handedOff.review.git)
  assert.ok(handedOff.review.pullRequest)
  assert.equal(Reflect.get(handedOff.review.agentThread, 'fixtureThreadExtension'), 'thread')
  assert.equal(Reflect.get(handedOff.review.git, 'fixtureGitExtension'), 'git')
  assert.equal(Reflect.get(handedOff.review.pullRequest, 'fixturePullRequestExtension'), 'pr')
  const handedOffParagraph = child(child(handedOff.root))
  assert.ok(handedOffParagraph.sourceEdit)
  assert.equal(Reflect.get(handedOffParagraph.sourceEdit, 'fixtureProposalExtension'), 'proposal')
  const handedOffAttachment = handedOffParagraph.attachments?.[0]
  assert.ok(handedOffAttachment)
  assert.equal(
    Reflect.get(handedOffAttachment, 'fixtureAttachmentExtension'),
    'attachment'
  )
})

test('tree updates cannot change the source snapshot or block structure', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check immutability.'
  })

  await assert.rejects(
    store.updateTree(created.review.id, tree('# Different\n')),
    (error: unknown) => hasErrorCode(error, 'REVIEW_MISMATCH')
  )

  const changedBlock = structuredClone(created)
  child(changedBlock.root).text = 'Different'
  await assert.rejects(
    store.updateTree(created.review.id, changedBlock),
    (error: unknown) => hasErrorCode(error, 'REVIEW_MISMATCH')
  )
})

test('source edit proposals can be added, changed, removed, and handed off', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree('# Review\n\nOriginal paragraph.\n'),
    contextSummary: 'Check source edit proposals.'
  })
  const paragraph = child(child(created.root))
  const proposed = structuredClone(created)
  const proposedParagraph = child(child(proposed.root))
  proposedParagraph.sourceEdit = {
    original: paragraph.raw,
    current: 'Revised paragraph.'
  }

  const added = await store.updateTree(created.review.id, proposed)
  assert.deepEqual(child(child(added.root)).sourceEdit, {
    original: 'Original paragraph.',
    current: 'Revised paragraph.'
  })

  assert.ok(proposedParagraph.sourceEdit)
  proposedParagraph.sourceEdit.current = 'A second revision.'
  const changed = await store.updateTree(created.review.id, proposed)
  assert.equal(
    child(child(changed.root)).sourceEdit?.current,
    'A second revision.'
  )

  delete proposedParagraph.sourceEdit
  const removed = await store.updateTree(created.review.id, proposed)
  assert.equal(
    Object.hasOwn(child(child(removed.root)), 'sourceEdit'),
    false
  )

  proposedParagraph.sourceEdit = {
    original: paragraph.raw,
    current: 'Final proposal.'
  }
  await store.updateTree(created.review.id, proposed)
  const handedOff = await store.handoff(created.review.id)
  assert.deepEqual(child(child(handedOff.root)).sourceEdit, {
    original: 'Original paragraph.',
    current: 'Final proposal.'
  })
  assert.deepEqual(await store.load(created.review.id), handedOff)
})

test('rejects malformed source edit proposals without changing the review', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree('# Review\n\nOriginal paragraph.\n'),
    contextSummary: 'Check source edit validation.'
  })
  const paragraph = child(child(created.root))
  const malformed: unknown[] = [
    null,
    'Revised paragraph.',
    { original: paragraph.raw, current: '' },
    { original: paragraph.raw, current: '   ' },
    { original: paragraph.raw, current: paragraph.raw },
    { original: paragraph.raw, current: 42 },
    { original: 'Different original.', current: 'Revised paragraph.' },
    { current: 'Revised paragraph.' }
  ]

  for (const sourceEdit of malformed) {
    const updated = structuredClone(created)
    const updatedParagraph = child(child(updated.root))
    Reflect.set(updatedParagraph, 'sourceEdit', sourceEdit)
    await assert.rejects(
      store.updateTree(created.review.id, updated),
      (error: unknown) => hasErrorCode(error, 'INVALID_REVIEW')
    )
  }

  assert.equal(
    Object.hasOwn(
      child(child((await store.load(created.review.id)).root)),
      'sourceEdit'
    ),
    false
  )
})

test('source edit proposals do not permit immutable target changes', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree('# Review\n\nOriginal paragraph.\n'),
    contextSummary: 'Check proposal target immutability.'
  })
  const changedTarget = structuredClone(created)
  const paragraph = child(child(changedTarget.root))
  paragraph.sourceEdit = {
    original: paragraph.raw,
    current: 'Revised paragraph.'
  }
  paragraph.text = 'Changed target text'

  await assert.rejects(
    store.updateTree(created.review.id, changedTarget),
    (error: unknown) => hasErrorCode(error, 'REVIEW_MISMATCH')
  )
})

test('source edit proposals reject non-editable frontmatter parents', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree('---\ntitle: Review\n---\n\n# Document\n'),
    contextSummary: 'Check frontmatter source edit protection.'
  })
  const proposed = structuredClone(created)
  const frontmatter = child(proposed.root)
  frontmatter.sourceEdit = {
    original: frontmatter.raw,
    current: '---\ntitle: Revised\n---'
  }

  await assert.rejects(
    store.updateTree(created.review.id, proposed),
    (error: unknown) => hasErrorCode(error, 'INVALID_REVIEW')
  )
})

test('invalid YAML proposals remain non-blocking review data', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree('---\ntitle: Review\n---\n\n# Document\n'),
    contextSummary: 'Check non-blocking YAML diagnostics.'
  })
  const proposed = structuredClone(created)
  const title = child(child(proposed.root))
  title.sourceEdit = {
    original: title.raw,
    current: 'title: [broken'
  }

  const saved = await store.updateTree(created.review.id, proposed)
  assert.equal(
    child(child(saved.root)).sourceEdit?.current,
    'title: [broken'
  )
})

test('attachment allocation is owned, editable, and serialized by the store', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check attachments.'
  })
  const [first, second] = await Promise.all([
    store.saveAttachmentFile(created.review.id, 'png', Buffer.from('first')),
    store.saveAttachmentFile(created.review.id, 'png', Buffer.from('second'))
  ])

  assert.deepEqual([first.id, second.id], ['img-1', 'img-2'])
  assert.equal(await fs.readFile(first.path, 'utf8'), 'first')
  assert.equal(await fs.readFile(second.path, 'utf8'), 'second')

  await store.handoff(created.review.id)
  await assert.rejects(
    store.saveAttachmentFile(
      created.review.id,
      'png',
      Buffer.from('pending')
    ),
    (error: unknown) => hasErrorCode(error, 'NOT_EDITABLE')
  )
  await assert.rejects(
    store.saveAttachmentFile(
      'mko_missing1',
      'png',
      Buffer.from('missing')
    ),
    (error: unknown) => hasErrorCode(error, 'NOT_FOUND')
  )
  await assert.rejects(
    fs.access(path.join(directory, 'mko_missing1'))
  )
})

test('attachment allocation enforces the shared remote response bound', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check attachment bounds.'
  })
  const accepted = await store.saveAttachmentFile(
    created.review.id,
    'png',
    Buffer.alloc(MAXIMUM_ATTACHMENT_BYTES)
  )
  assert.equal((await fs.stat(accepted.path)).size, MAXIMUM_ATTACHMENT_BYTES)

  await assert.rejects(
    store.saveAttachmentFile(
      created.review.id,
      'png',
      Buffer.alloc(MAXIMUM_ATTACHMENT_BYTES + 1)
    ),
    (error: unknown) => hasErrorCode(error, 'ATTACHMENT_TOO_LARGE')
  )
  assert.deepEqual(
    await fs.readdir(path.dirname(accepted.path)),
    [path.basename(accepted.path)]
  )
})

test('review deletion policies cover every status and trash the exact directory', async (t) => {
  const ids = ['mko_aaa11111', 'mko_bbb22222']
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const editing = await store.create({
    tree: tree(),
    contextSummary: 'Delete an editing review.'
  })
  const pending = await store.create({
    tree: tree(),
    contextSummary: 'Delete a pending review.'
  })
  await store.handoff(pending.review.id)
  const sidecarBytes = '{malformed historical sidecar bytes\n'
  await fs.writeFile(
    path.join(store.reviewDirectory(editing.review.id), 'enrichment.json'),
    sidecarBytes,
    'utf8'
  )
  const trashed: string[] = []

  assert.equal(reviewDeletionPolicy('editing'), 'standard')
  assert.equal(reviewDeletionPolicy('pending-agent'), 'pending-agent')
  assert.equal(reviewDeletionPolicy('agent-reviewing'), 'pending-agent')
  assert.equal(reviewDeletionPolicy('reviewed'), 'standard')
  assert.equal(reviewDeletionPolicy('revised'), 'standard')
  assert.equal(reviewDeletionPolicy('done'), 'standard')
  assert.equal(
    await store.trashReview(editing.review.id, async (target) => {
      trashed.push(target)
      assert.equal(
        await fs.readFile(path.join(target, 'enrichment.json'), 'utf8'),
        sidecarBytes
      )
    }),
    'standard'
  )
  assert.equal(
    await store.trashReview(pending.review.id, (target) => {
      trashed.push(target)
      return Promise.resolve()
    }),
    'pending-agent'
  )
  assert.deepEqual(trashed, [
    store.reviewDirectory(editing.review.id),
    store.reviewDirectory(pending.review.id)
  ])
})

test('attachment removal saves the reference-free tree before trashing its file', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Remove one attachment.'
  })
  const saved = await store.saveAttachmentFile(
    created.review.id,
    'png',
    Buffer.from('image')
  )
  const annotated = structuredClone(created)
  const heading = child(annotated.root)
  heading.feedback = '[!diagram]'
  heading.attachments = [{ id: saved.id, label: 'diagram', path: saved.path }]
  await store.updateTree(created.review.id, annotated)
  const candidate = structuredClone(annotated)
  const candidateHeading = child(candidate.root)
  candidateHeading.feedback = ''
  candidateHeading.attachments = []

  const updated = await store.removeAttachment(
    created.review.id,
    saved.id,
    candidate,
    async (target) => {
      assert.equal(target, saved.path)
      const persisted: unknown = JSON.parse(
        await fs.readFile(store.reviewPath(created.review.id), 'utf8')
      )
      assertReviewTree(persisted)
      assert.deepEqual(child(persisted.root).attachments, [])
    }
  )
  assert.deepEqual(child(updated.root).attachments, [])
  assert.deepEqual(child((await store.load(created.review.id)).root).attachments, [])
})

test('attachment removal restores the review when Trash rejects the file', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Keep references on Trash failure.'
  })
  const saved = await store.saveAttachmentFile(
    created.review.id,
    'png',
    Buffer.from('image')
  )
  const annotated = structuredClone(created)
  child(annotated.root).attachments = [{ id: saved.id, path: saved.path }]
  await store.updateTree(created.review.id, annotated)
  const candidate = structuredClone(annotated)
  child(candidate.root).attachments = []

  await assert.rejects(
    store.removeAttachment(
      created.review.id,
      saved.id,
      candidate,
      () => Promise.reject(new Error('Trash unavailable'))
    ),
    /Trash unavailable/
  )
  assert.equal(
    attachment(child((await store.load(created.review.id)).root)).id,
    saved.id
  )
})

test('cleanup finds only generated unreferenced files and rejects stale scans', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Clean unused attachments.'
  })
  const used = await store.saveAttachmentFile(
    created.review.id,
    'png',
    Buffer.from('used')
  )
  const unused = await store.saveAttachmentFile(
    created.review.id,
    'jpg',
    Buffer.from('unused')
  )
  const annotated = structuredClone(created)
  child(annotated.root).attachments = [{ id: used.id, path: used.path }]
  await store.updateTree(created.review.id, annotated)
  await fs.writeFile(
    path.join(path.dirname(unused.path), 'notes.txt'),
    'not owned cleanup data'
  )
  const invalidDirectory = path.join(directory, 'mko_broken1')
  await fs.mkdir(invalidDirectory)
  await fs.writeFile(path.join(invalidDirectory, 'review.json'), '{broken')

  const scan = await store.scanUnusedAttachments()
  assert.deepEqual(scan.candidates, [{
    reviewId: created.review.id,
    attachmentId: unused.id,
    filePath: unused.path,
    bytes: 6
  }])
  assert.deepEqual(scan.warnings, [{
    reviewId: 'mko_broken1',
    reason: 'invalid'
  }])
  const trashed: string[] = []
  assert.deepEqual(
    await store.trashUnusedAttachments(scan, (target) => {
      trashed.push(target)
      return Promise.resolve()
    }),
    { count: 1, totalBytes: 6 }
  )
  assert.deepEqual(trashed, [unused.path])

  const stale = await store.scanUnusedAttachments()
  await fs.writeFile(
    path.join(path.dirname(unused.path), 'img-3.png'),
    'new'
  )
  await assert.rejects(
    store.trashUnusedAttachments(stale, () => Promise.resolve()),
    (error: unknown) => hasErrorCode(error, 'CLEANUP_CHANGED')
  )
})

test('a new store restores sessions from disk without sharing mutable state', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check restoration.'
  })
  created.root.text = 'Mutated outside the store'

  const restoredStore = new ReviewStore(directory)
  const restored = await restoredStore.load(created.review.id)
  restored.root.text = 'Another outside mutation'

  assert.equal((await restoredStore.load(created.review.id)).root.text, 'Document')
  assert.equal((await restoredStore.list()).length, 1)
})

test('a new store restores Revised and Done lifecycle states', async (t) => {
  const ids = ['mko_aaa11111', 'mko_bbb22222']
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const revised = await store.create({
    tree: tree('# Revised\n'),
    contextSummary: 'Restore a Revised review.'
  })
  await store.handoff(revised.review.id)
  await store.revise(revised.review.id)

  const done = await store.create({
    tree: tree('# Done\n'),
    contextSummary: 'Restore a Done review.',
    git: { repositoryUrl: 'https://github.com/lastobelus/markover' },
    pullRequest: { number: 129 }
  })
  await store.done(
    'https://github.com/lastobelus/markover/pull/129',
    'merged'
  )

  const restoredStore = new ReviewStore(directory)
  assert.equal(
    (await restoredStore.load(revised.review.id)).review.status,
    'revised'
  )
  const restoredDone = await restoredStore.load(done.review.id)
  assert.equal(restoredDone.review.status, 'done')
  assert.equal(
    (restoredDone.review.pullRequest as Record<string, unknown>).status,
    'merged'
  )
})

test('concurrent handoffs serialize to one frozen result', async (t) => {
  const timestamps = [
    '2026-07-30T20:00:00.000Z',
    '2026-07-30T20:01:00.000Z'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => timestamps.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check concurrency.'
  })
  const [first, second] = await Promise.all([
    store.handoff(created.review.id),
    store.handoff(created.review.id)
  ])

  assert.deepEqual(first, second)
  assert.equal(first.review.updatedAt, '2026-07-30T20:01:00.000Z')
})

test('rejects unsafe IDs and leaves no temporary files', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  await assert.rejects(
    store.load('../outside'),
    (error: unknown) => hasErrorCode(error, 'INVALID_ID')
  )
  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check paths.'
  })
  await store.handoff(created.review.id)

  const entries = await fs.readdir(store.reviewDirectory(created.review.id))
  assert.deepEqual(entries, ['review.json'])
  if (process.platform !== 'win32') {
    assert.equal(
      (await fs.stat(store.reviewPath(created.review.id))).mode & 0o777,
      0o600
    )
  }
})

test('publishes complete sessions and ignores incomplete review directories', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  await fs.mkdir(path.join(directory, 'mko_orphan1'))
  const created = await store.create({
    tree: tree(),
    contextSummary: 'Check complete creation.'
  })

  assert.deepEqual(
    (await store.list()).map((review) => review.review.id),
    [created.review.id]
  )
  assert.deepEqual(
    (await fs.readdir(directory)).sort(),
    ['mko_aaa11111', 'mko_orphan1']
  )
})

test('listing leaves legacy durable reviews untouched and unmanaged', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const legacyDirectory = path.join(directory, 'mko_legacy1')
  await fs.mkdir(legacyDirectory)
  await fs.writeFile(
    path.join(legacyDirectory, 'review.json'),
    JSON.stringify(tree('# Legacy\n'))
  )
  const created = await store.create({
    tree: tree(),
    contextSummary: 'Review managed listing.'
  })

  assert.deepEqual(
    (await store.list()).map((review) => review.review.id),
    [created.review.id]
  )
  const legacy: unknown = JSON.parse(
    await fs.readFile(path.join(legacyDirectory, 'review.json'), 'utf8')
  )
  assertReviewTree(legacy)
  assert.equal(legacy.sourceDocument.content, '# Legacy\n')
})

test('listing isolates malformed reviews and reports preserved warnings', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const malformedDirectory = path.join(directory, 'mko_broken1')
  await fs.mkdir(malformedDirectory)
  const malformedPath = path.join(malformedDirectory, 'review.json')
  await fs.writeFile(malformedPath, '{not json', 'utf8')
  const created = await store.create({
    tree: tree(),
    contextSummary: 'Review valid listing.'
  })

  const result = await store.listWithWarnings()
  assert.deepEqual(result.reviews.map((review) => review.review.id), [
    created.review.id
  ])
  assert.deepEqual(result.warnings, [{
    reviewId: 'mko_broken1',
    reason: 'invalid'
  }])
  assert.equal(await fs.readFile(malformedPath, 'utf8'), '{not json')
})

test('unknown versions remain byte-for-byte incompatible and outside cleanup', async (t) => {
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_future11',
    now: () => '2026-08-11T20:00:00.000Z'
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const created = await store.create({
    tree: tree(),
    contextSummary: 'Preserve an unknown future version.'
  })
  const future = structuredClone(created) as unknown as Record<string, unknown>
  future.version = 2
  future.futureBody = { invalidForV1: true }
  const futureBytes = `${JSON.stringify(future, null, 2)}\n`
  await fs.writeFile(store.reviewPath(created.review.id), futureBytes, 'utf8')
  const attachmentDirectory = path.join(
    store.reviewDirectory(created.review.id),
    'attachments'
  )
  await fs.mkdir(attachmentDirectory)
  const attachmentPath = path.join(attachmentDirectory, 'img-1.png')
  const attachmentBytes = Buffer.from('future attachment')
  await fs.writeFile(attachmentPath, attachmentBytes)

  assert.deepEqual(await store.listWithWarnings(), {
    reviews: [],
    incompatible: [{
      reviewId: created.review.id,
      format: 'markover-review',
      version: '2',
      compatibilityUrl: 'https://lastobelus.github.io/markover/compatibility/?format=markover-review&version=2'
    }],
    warnings: [{
      reviewId: created.review.id,
      reason: 'incompatible',
      detail: 'Unsupported markover-review version 2; this Markover supports version 1. Consult the official compatibility catalog for the Markover release that supports it: https://lastobelus.github.io/markover/compatibility/?format=markover-review&version=2'
    }]
  })
  await assert.rejects(
    store.load(created.review.id),
    (error: unknown) => hasErrorCode(error, 'UNSUPPORTED_REVIEW_VERSION')
  )
  await assert.rejects(
    store.trashReview(created.review.id, () => Promise.resolve()),
    (error: unknown) => hasErrorCode(error, 'UNSUPPORTED_REVIEW_VERSION')
  )
  const scan = await store.scanUnusedAttachments()
  assert.deepEqual(scan.candidates, [])
  assert.deepEqual(scan.warnings, [{
    reviewId: created.review.id,
    reason: 'incompatible',
    detail: 'Unsupported markover-review version 2; this Markover supports version 1. Consult the official compatibility catalog for the Markover release that supports it: https://lastobelus.github.io/markover/compatibility/?format=markover-review&version=2'
  }])
  assert.equal(await fs.readFile(store.reviewPath(created.review.id), 'utf8'), futureBytes)
  assert.deepEqual(await fs.readFile(attachmentPath), attachmentBytes)
})

test('retries an ID collision without disturbing the existing review', async (t) => {
  const ids = ['mko_aaa11111', 'mko_aaa11111', 'mko_bbb22222']
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift() as string
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const first = await store.create({
    tree: tree('# First\n'),
    contextSummary: 'Review first.'
  })
  const second = await store.create({
    tree: tree('# Second\n'),
    contextSummary: 'Review second.'
  })

  assert.equal(first.review.id, 'mko_aaa11111')
  assert.equal(second.review.id, 'mko_bbb22222')
  assert.equal(
    (await store.load(first.review.id)).sourceDocument.content,
    '# First\n'
  )
})

test('requires a valid tree and non-empty context summary', async (t) => {
  const { directory, store } = await temporaryStore()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  await assert.rejects(
    store.create({ tree: {}, contextSummary: 'Review it.' }),
    (error: unknown) => hasErrorCode(error, 'INVALID_REVIEW')
  )
  await assert.rejects(
    store.create({ tree: tree(), contextSummary: '   ' }),
    (error: unknown) => hasErrorCode(error, 'INVALID_REVIEW')
  )
})

test('rejects non-array review collections before persistence', async (t) => {
  const { directory, store } = await temporaryStore()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const invalidChildren = tree()
  Reflect.set(invalidChildren.root, 'children', {})
  const invalidUnsupported = tree()
  Reflect.set(invalidUnsupported, 'unsupported', null)

  for (const invalidTree of [invalidChildren, invalidUnsupported]) {
    await assert.rejects(
      store.create({ tree: invalidTree, contextSummary: 'Review it.' }),
      (error: unknown) => hasErrorCode(error, 'INVALID_REVIEW')
    )
  }
  assert.deepEqual(await fs.readdir(directory), [])
})

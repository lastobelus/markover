import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  decodeReviewArtifact,
  decodeReviewTree,
  ReviewFormatError,
  reviewChecksum
} from '../src/review-format'

const fixturePath = path.resolve(
  __dirname,
  '../../test/fixtures/review-handoff-v1.json'
)

function fixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Record<string, unknown>
}

function cloneFixture(): Record<string, unknown> {
  return structuredClone(fixture())
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

function review(value: Record<string, unknown>): Record<string, unknown> {
  return record(value.review)
}

function root(value: Record<string, unknown>): Record<string, unknown> {
  return record(value.root)
}

function children(value: Record<string, unknown>): Record<string, unknown>[] {
  const result = value.children
  assert.ok(Array.isArray(result))
  return result.map(record)
}

function child(value: Record<string, unknown>, index: number): Record<string, unknown> {
  const result = children(value)[index]
  assert.ok(result)
  return result
}

function assertFormatCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error: unknown) => (
    error instanceof ReviewFormatError && error.code === code
  ))
}

test('the representative v1 fixture decodes losslessly with every node variant', () => {
  const value = fixture()
  const decoded = decodeReviewArtifact(value, 'mko_fixture1')
  assert.equal(decoded, value)

  const types = new Set<string>()
  const visit = (node: Record<string, unknown>): void => {
    types.add(String(node.type))
    for (const child of children(node)) visit(child)
  }
  visit(root(value))
  assert.deepEqual([...types].sort(), [
    'blockquote',
    'code',
    'document',
    'frontmatter',
    'frontmatter-entry',
    'heading',
    'ordered-item',
    'paragraph',
    'table',
    'thematic-break',
    'unordered-item'
  ])
  assert.deepEqual(value.fixtureTopLevelExtension, { preserved: true })
  assert.equal(
    record(record(review(value).agentThread).threadHost).fixtureThreadHostExtension,
    'preserve me'
  )
  assert.equal(Object.hasOwn(review(value), 'requestingThreadTitle'), false)
  assert.equal(Object.hasOwn(record(review(value).agentThread), 'title'), false)
})

test('the platform-neutral checksum matches SHA-256 for UTF-8 source', () => {
  for (const source of ['', 'abc', 'Markover 🌲\nレビュー']) {
    assert.equal(
      reviewChecksum(source),
      `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`
    )
  }
})

test('header classification precedes all v1 body validation', () => {
  assertFormatCode(
    () => decodeReviewArtifact({ format: 'other-review', version: 1 }),
    'UNSUPPORTED_REVIEW_FORMAT'
  )
  assertFormatCode(
    () => decodeReviewArtifact({ format: 'markover-review', version: 2 }),
    'UNSUPPORTED_REVIEW_VERSION'
  )
  assert.throws(
    () => decodeReviewArtifact({ format: 'markover-review', version: 2 }),
    /https:\/\/lastobelus\.github\.io\/markover\/compatibility\/\?format=markover-review&version=2/
  )
  assertFormatCode(() => decodeReviewArtifact({ version: 1 }), 'INVALID_REVIEW')
  assertFormatCode(
    () => decodeReviewArtifact({ format: 'markover-review', version: '2' }),
    'INVALID_REVIEW'
  )
})

test('all four lifecycle values and open-string origins are valid', () => {
  for (const status of ['editing', 'pending-agent', 'revised'] as const) {
    const value = cloneFixture()
    review(value).status = status
    assert.equal(decodeReviewArtifact(value), value)
  }

  const done = cloneFixture()
  review(done).status = 'done'
  record(review(done).pullRequest).status = 'merged'
  assert.equal(decodeReviewArtifact(done), done)

  const futureOrigin = cloneFixture()
  review(futureOrigin).origin = 'imported-agent'
  assert.equal(decodeReviewArtifact(futureOrigin), futureOrigin)

  const local = cloneFixture()
  review(local).origin = 'local'
  review(local).agentThread = null
  assert.equal(decodeReviewArtifact(local), local)
})

test('lifecycle, timestamp, and pull-request invariants reject invalid envelopes', () => {
  const unknownStatus = cloneFixture()
  review(unknownStatus).status = 'archived'
  assertFormatCode(() => decodeReviewArtifact(unknownStatus), 'INVALID_REVIEW')

  const localThread = cloneFixture()
  review(localThread).origin = 'local'
  assertFormatCode(() => decodeReviewArtifact(localThread), 'INVALID_REVIEW')

  const unorderedTime = cloneFixture()
  review(unorderedTime).attentionRequestedAt = '2026-08-11T12:06:00.000Z'
  assertFormatCode(() => decodeReviewArtifact(unorderedTime), 'INVALID_REVIEW')

  const noncanonicalTime = cloneFixture()
  review(noncanonicalTime).updatedAt = '2026-08-11T12:05:00Z'
  assertFormatCode(() => decodeReviewArtifact(noncanonicalTime), 'INVALID_REVIEW')

  const futureObservation = cloneFixture()
  record(review(futureObservation).pullRequest).statusObservedAt =
    '2026-08-11T12:06:00.000Z'
  assertFormatCode(() => decodeReviewArtifact(futureObservation), 'INVALID_REVIEW')

  const partialObservation = cloneFixture()
  delete record(review(partialObservation).pullRequest).statusSource
  assertFormatCode(() => decodeReviewArtifact(partialObservation), 'INVALID_REVIEW')

  const unmergedDone = cloneFixture()
  review(unmergedDone).status = 'done'
  assertFormatCode(() => decodeReviewArtifact(unmergedDone), 'INVALID_REVIEW')
})

test('thread-host identity is typed without duplicating provider identity', () => {
  const direct = cloneFixture()
  const directHost = record(record(review(direct).agentThread).threadHost)
  directHost.kind = 'codex'
  directHost.provider = 'codex'
  delete directHost.threadId
  delete directHost.machine
  assert.equal(decodeReviewArtifact(direct), direct)

  const duplicate = cloneFixture()
  const agentThread = record(review(duplicate).agentThread)
  record(agentThread.threadHost).threadId = agentThread.id
  assertFormatCode(() => decodeReviewArtifact(duplicate), 'INVALID_REVIEW')

  const incomplete = cloneFixture()
  delete record(record(review(incomplete).agentThread).threadHost).provider
  assertFormatCode(() => decodeReviewArtifact(incomplete), 'INVALID_REVIEW')

  const truthfulFallback = cloneFixture()
  review(truthfulFallback).agentThread = null
  assert.equal(decodeReviewArtifact(truthfulFallback), truthfulFallback)
})

test('portable metadata rejects credentials and known app-private evidence', () => {
  const credential = cloneFixture()
  record(review(credential).git).repositoryUrl =
    'https://token@github.com/lastobelus/markover.git'
  assertFormatCode(() => decodeReviewArtifact(credential), 'INVALID_REVIEW')

  for (const field of ['repositoryRoot', 'projectRoot']) {
    const privateGit = cloneFixture()
    Reflect.set(record(review(privateGit).git), field, '/private/checkout')
    assertFormatCode(() => decodeReviewArtifact(privateGit), 'INVALID_REVIEW')
  }

  const privateThread = cloneFixture()
  record(review(privateThread).agentThread).logPath = '/private/session.jsonl'
  assertFormatCode(() => decodeReviewArtifact(privateThread), 'INVALID_REVIEW')

  for (const field of [
    'cwd',
    'logPath',
    'discovery',
    'parentThreadId',
    'forkedFromId',
    'repositoryRoot',
    'projectRoot',
    'sources',
    'commonGitDirectory',
    'title',
    'name',
    'requestingThreadTitle'
  ]) {
    const privateEnvelope = cloneFixture()
    Reflect.set(review(privateEnvelope), field, 'Private session evidence')
    assertFormatCode(() => decodeReviewArtifact(privateEnvelope), 'INVALID_REVIEW')

    const privateThreadTitle = cloneFixture()
    Reflect.set(
      record(review(privateThreadTitle).agentThread),
      field,
      'Private requesting thread title'
    )
    assertFormatCode(
      () => decodeReviewArtifact(privateThreadTitle),
      'INVALID_REVIEW'
    )

    const privateHostTitle = cloneFixture()
    Reflect.set(
      record(record(review(privateHostTitle).agentThread).threadHost),
      field,
      'Private requesting thread title'
    )
    assertFormatCode(
      () => decodeReviewArtifact(privateHostTitle),
      'INVALID_REVIEW'
    )
  }

  for (const repositoryUrl of [
    '/Users/alice/private/repo.git',
    '../repo.git',
    'file:///Users/alice/private/repo.git',
    'file:/Users/alice/private/repo.git',
    'file:../repo.git',
    'C:/Users/alice/private/repo.git',
    'C://Users/alice/private/repo.git',
    'C:private/repo.git'
  ]) {
    const filesystemRemote = cloneFixture()
    record(review(filesystemRemote).git).repositoryUrl = repositoryUrl
    assertFormatCode(
      () => decodeReviewArtifact(filesystemRemote),
      'INVALID_REVIEW'
    )
  }

  for (const field of [
    'workspace',
    'settings',
    'credentials',
    'cache',
    'privateEnrichment'
  ]) {
    const privateExtension = cloneFixture()
    Reflect.set(privateExtension, field, { private: true })
    assertFormatCode(
      () => decodeReviewArtifact(privateExtension),
      'INVALID_REVIEW'
    )
  }

  const nestedPrivateExtension = cloneFixture()
  Reflect.set(nestedPrivateExtension, 'futureOptionalField', {
    workspace: { activeReviewId: 'mko_private' }
  })
  assertFormatCode(
    () => decodeReviewArtifact(nestedPrivateExtension),
    'INVALID_REVIEW'
  )
})

test('pull request associations require the exact canonical URL', () => {
  for (const pullRequestUrl of [
    'https://token@github.com/lastobelus/markover/pull/139',
    'https://github.com/lastobelus/markover/pull/139?token=secret',
    'https://github.com/lastobelus/markover/pull/139#fragment',
    'https://github.com/Lastobelus/Markover/pull/139/'
  ]) {
    const noncanonical = cloneFixture()
    const pullRequest = record(review(noncanonical).pullRequest)
    pullRequest.url = pullRequestUrl
    pullRequest.number = 139
    assertFormatCode(() => decodeReviewArtifact(noncanonical), 'INVALID_REVIEW')
  }
})

test('source, node, attachment, and presentation invariants are enforced', () => {
  const changedSource = cloneFixture()
  record(changedSource.sourceDocument).content = 'changed'
  assertFormatCode(() => decodeReviewArtifact(changedSource), 'INVALID_REVIEW')

  const duplicateNode = cloneFixture()
  child(root(duplicateNode), 0).id = 'block-4'
  assertFormatCode(() => decodeReviewArtifact(duplicateNode), 'INVALID_REVIEW')

  const collapsed = cloneFixture()
  root(collapsed).collapsed = false
  assertFormatCode(() => decodeReviewArtifact(collapsed), 'INVALID_REVIEW')

  const unknownType = cloneFixture()
  child(root(unknownType), 0).type = 'interactive-widget'
  assertFormatCode(() => decodeReviewArtifact(unknownType), 'INVALID_REVIEW')

  const duplicateAttachment = cloneFixture()
  const heading = child(root(duplicateAttachment), 1)
  const attachments = heading.attachments
  assert.ok(Array.isArray(attachments))
  attachments.push(structuredClone(attachments[0]))
  assertFormatCode(() => decodeReviewArtifact(duplicateAttachment), 'INVALID_REVIEW')
})

test('tree decoding supports unmanaged creation input but artifact decoding requires an envelope', () => {
  const value = cloneFixture()
  delete value.review
  assert.equal(decodeReviewTree(value), value)
  assertFormatCode(() => decodeReviewArtifact(value), 'INVALID_REVIEW')

  const source = '# New review\n'
  const parsed = {
    ...value,
    sourceDocument: {
      ...record(value.sourceDocument),
      content: source,
      checksum: reviewChecksum(source)
    },
    root: {
      ...root(value),
      raw: source
    }
  }
  assert.equal(decodeReviewTree(parsed), parsed)
})

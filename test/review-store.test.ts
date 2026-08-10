import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

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

function attachment(node: ReviewNode, index = 0): ReviewAttachment {
  const result = node.attachments?.[index]
  assert.ok(result)
  return result
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof ReviewStoreError && error.code === code
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
  return parseMarkdown(source, 'sha256:test', {
    name: 'review.md',
    path: '/tmp/review.md'
  })
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
    agentThread: { provider: 'codex', id: 'thread-1' },
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
    provider: 'codex',
    id: 'thread-1'
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
  assert.deepEqual(retry, handedOff)
  assert.deepEqual(await store.load(created.review.id), handedOff)
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
  assert.deepEqual(retry, editing)
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

test('stores successful agent PR observations with transition receipt time', async (t) => {
  const timestamps = [
    '2026-08-10T02:00:00.000Z',
    '2026-08-10T02:01:00.000Z',
    '2026-08-10T02:02:00.000Z'
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
    pullRequest: { number: 123, discovery: 'explicit' },
    pullRequestStatus: 'draft'
  })
  assert.deepEqual(created.review.pullRequest, {
    number: 123,
    discovery: 'explicit',
    url: 'https://github.com/lastobelus/markover/pull/123',
    status: 'draft',
    statusObservedAt: '2026-08-10T02:00:00.000Z',
    statusSource: 'agent'
  })

  const handedOff = await store.handoff(created.review.id, 'open')
  assert.deepEqual(handedOff.review.pullRequest, {
    number: 123,
    discovery: 'explicit',
    url: 'https://github.com/lastobelus/markover/pull/123',
    status: 'open',
    statusObservedAt: '2026-08-10T02:01:00.000Z',
    statusSource: 'agent'
  })
  const revised = await store.revise(created.review.id, 'open')
  assert.equal(revised.review.status, 'revised')
  assert.deepEqual(revised.review.pullRequest, {
    number: 123,
    discovery: 'explicit',
    url: 'https://github.com/lastobelus/markover/pull/123',
    status: 'open',
    statusObservedAt: '2026-08-10T02:02:00.000Z',
    statusSource: 'agent'
  })
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
  annotatedHeading.collapsed = true
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
  assert.equal(updatedHeading.collapsed, true)
  assert.equal(attachment(updatedHeading).id, 'img-1')
  assert.equal(updated.review.contextSummary, 'Check updates.')

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
    { current: 'Revised paragraph.' },
    {
      original: paragraph.raw,
      current: 'Revised paragraph.',
      metadata: 'not part of the schema'
    }
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
  const trashed: string[] = []

  assert.equal(reviewDeletionPolicy('editing'), 'standard')
  assert.equal(reviewDeletionPolicy('pending-agent'), 'pending-agent')
  assert.equal(reviewDeletionPolicy('revised'), 'standard')
  assert.equal(reviewDeletionPolicy('done'), 'standard')
  assert.equal(
    await store.trashReview(editing.review.id, (target) => {
      trashed.push(target)
      return Promise.resolve()
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

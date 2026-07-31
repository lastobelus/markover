const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { ReviewStore } = require('../src/review-store')
const { parseMarkdown } = require('../src/tree')

async function temporaryStore(options = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-store-test-')
  )
  return {
    directory,
    store: new ReviewStore(directory, options)
  }
}

function tree(source = '# Review\n') {
  return parseMarkdown(source, 'sha256:test', {
    name: 'review.md',
    path: '/tmp/review.md'
  })
}

test('creates distinct sessions with exact source and metadata', async (t) => {
  const ids = ['mko_aaa11111', 'mko_bbb22222']
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift(),
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
  assert.equal(first.sourceDocument.content, '# First\r\n')
  assert.equal(second.sourceDocument.content, '# Second\n')
  assert.deepEqual((await store.list()).map((item) => item.review.id), [
    'mko_aaa11111',
    'mko_bbb22222'
  ])
})

test('handoff freezes an idempotent snapshot', async (t) => {
  const timestamps = [
    '2026-07-30T20:00:00.000Z',
    '2026-07-30T20:01:00.000Z'
  ]
  const { directory, store } = await temporaryStore({
    idFactory: () => 'mko_aaa11111',
    now: () => timestamps.shift()
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
    now: () => timestamps.shift()
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
  annotated.root.children[0].feedback = 'Make the title more specific.'
  annotated.root.children[0].collapsed = true
  annotated.root.children[0].attachments = [{
    id: 'img-1',
    type: 'image',
    path: '/tmp/img-1.png'
  }]
  const updated = await store.updateTree(created.review.id, annotated)
  assert.equal(
    updated.root.children[0].feedback,
    'Make the title more specific.'
  )
  assert.equal(updated.root.children[0].collapsed, true)
  assert.equal(updated.root.children[0].attachments[0].id, 'img-1')
  assert.equal(updated.review.contextSummary, 'Check updates.')

  await store.handoff(created.review.id)
  await assert.rejects(
    store.updateTree(created.review.id, annotated),
    (error) => error.code === 'NOT_EDITABLE'
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
    (error) => error.code === 'REVIEW_MISMATCH'
  )

  const changedBlock = structuredClone(created)
  changedBlock.root.children[0].text = 'Different'
  await assert.rejects(
    store.updateTree(created.review.id, changedBlock),
    (error) => error.code === 'REVIEW_MISMATCH'
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
    (error) => error.code === 'NOT_EDITABLE'
  )
  await assert.rejects(
    store.saveAttachmentFile(
      'mko_missing1',
      'png',
      Buffer.from('missing')
    ),
    (error) => error.code === 'NOT_FOUND'
  )
  await assert.rejects(
    fs.access(path.join(directory, 'mko_missing1'))
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
    now: () => timestamps.shift()
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
    (error) => error.code === 'INVALID_ID'
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
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(legacyDirectory, 'review.json'), 'utf8')
    ).sourceDocument.content,
    '# Legacy\n'
  )
})

test('retries an ID collision without disturbing the existing review', async (t) => {
  const ids = ['mko_aaa11111', 'mko_aaa11111', 'mko_bbb22222']
  const { directory, store } = await temporaryStore({
    idFactory: () => ids.shift()
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
    (error) => error.code === 'INVALID_REVIEW'
  )
  await assert.rejects(
    store.create({ tree: tree(), contextSummary: '   ' }),
    (error) => error.code === 'INVALID_REVIEW'
  )
})

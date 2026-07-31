const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isTreeEditable,
  ReviewMutationTracker,
  ReviewSessions
} = require('../src/review-sessions')
const { parseMarkdown } = require('../src/tree')

function document(reviewId, name) {
  const tree = parseMarkdown(`# ${name}\n\n- One\n- Two\n`, `sha256:${reviewId}`, {
    name,
    path: `/tmp/${name}`
  })
  tree.review = {
    id: reviewId,
    status: 'editing'
  }
  return {
    reviewId,
    name,
    path: `/tmp/${name}`,
    checksum: `sha256:${reviewId}`,
    tree
  }
}

test('switching among three reviews preserves independent view and review state', () => {
  const sessions = new ReviewSessions()
  const first = sessions.add(document('mko_first11', 'first.md'))
  const second = sessions.add(document('mko_second2', 'second.md'))
  const third = sessions.add(document('mko_third33', 'third.md'))

  sessions.activate(first.reviewId)
  first.selectedId = 'block-2'
  first.tree.root.children[0].collapsed = true
  first.tree.root.children[0].feedback = 'First feedback'
  first.tree.root.children[0].attachments = [{ id: 'img-1' }]

  sessions.activate(second.reviewId)
  second.selectedId = 'block-3'
  second.tree.root.children[0].feedback = 'Second feedback'

  sessions.activate(third.reviewId)
  third.sourceCollapsed = true

  assert.equal(sessions.list().length, 3)
  assert.equal(sessions.activate(first.reviewId).selectedId, 'block-2')
  assert.equal(first.tree.root.children[0].collapsed, true)
  assert.equal(first.tree.root.children[0].feedback, 'First feedback')
  assert.deepEqual(first.tree.root.children[0].attachments, [{ id: 'img-1' }])
  assert.equal(sessions.activate(second.reviewId).selectedId, 'block-3')
  assert.equal(second.tree.root.children[0].feedback, 'Second feedback')
  assert.equal(sessions.activate(third.reviewId).sourceCollapsed, true)
})

test('status updates do not activate another review', () => {
  const sessions = new ReviewSessions()
  const first = sessions.add(document('mko_first11', 'first.md'))
  const second = sessions.add(document('mko_second2', 'second.md'))
  sessions.activate(first.reviewId)

  sessions.updateStatus(second.reviewId, 'pending-agent')

  assert.equal(sessions.active().reviewId, first.reviewId)
  assert.equal(second.tree.review.status, 'pending-agent')
})

test('adjacent review navigation wraps in either direction', () => {
  const sessions = new ReviewSessions()
  const first = sessions.add(document('mko_first11', 'first.md'))
  sessions.add(document('mko_second2', 'second.md'))
  const third = sessions.add(document('mko_third33', 'third.md'))

  assert.equal(sessions.adjacent(first.reviewId, -1), third)
  assert.equal(sessions.adjacent(third.reviewId, 1), first)
  assert.equal(sessions.adjacent('mko_missing1', 1), null)
})

test('an inactive review snapshot includes its latest in-memory feedback', () => {
  const sessions = new ReviewSessions()
  const first = sessions.add(document('mko_first11', 'first.md'))
  const second = sessions.add(document('mko_second2', 'second.md'))
  sessions.activate(first.reviewId)
  first.tree.root.children[0].feedback = 'Latest feedback before switching.'
  sessions.activate(second.reviewId)

  const snapshot = sessions.snapshot(first.reviewId)
  assert.equal(
    snapshot.root.children[0].feedback,
    'Latest feedback before switching.'
  )
  snapshot.root.children[0].feedback = 'Outside mutation'
  assert.equal(
    first.tree.root.children[0].feedback,
    'Latest feedback before switching.'
  )
})

test('only managed editing trees are editable', () => {
  assert.equal(isTreeEditable({}), true)
  assert.equal(isTreeEditable({ review: { status: 'editing' } }), true)
  assert.equal(isTreeEditable({ review: { status: 'pending-agent' } }), false)
  assert.equal(isTreeEditable({ review: { status: 'unknown' } }), false)
})

test('mutation tracking waits for every overlapping operation', async () => {
  const tracker = new ReviewMutationTracker()
  let finishFirst
  let finishSecond
  const first = new Promise((resolve) => {
    finishFirst = resolve
  })
  const second = new Promise((resolve) => {
    finishSecond = resolve
  })
  tracker.track('mko_review1', first)
  tracker.track('mko_review1', second)

  let settled = false
  const waiting = tracker.wait('mko_review1').then(() => {
    settled = true
  })
  finishSecond()
  await Promise.resolve()
  assert.equal(tracker.has('mko_review1'), true)
  assert.equal(settled, false)

  finishFirst()
  await waiting
  assert.equal(tracker.has('mko_review1'), false)
  assert.equal(settled, true)
})

test('mutation tracking is isolated by review', async () => {
  const tracker = new ReviewMutationTracker()
  let finishOther
  tracker.track('mko_other1', new Promise((resolve) => {
    finishOther = resolve
  }))

  await tracker.wait('mko_current1')
  assert.equal(tracker.has('mko_other1'), true)
  finishOther()
})

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  clampDocumentsListWidth,
  formatRelativeTime,
  isTreeEditable,
  projectIdentity,
  relativeTimeRefreshDelay,
  ReviewMutationTracker,
  ReviewSessions
} = require('../src/review-sessions')
const { parseMarkdown } = require('../src/tree')

function document(reviewId, name, repositoryRoot = null) {
  const tree = parseMarkdown(`# ${name}\n\n- One\n- Two\n`, `sha256:${reviewId}`, {
    name,
    path: `/tmp/${name}`
  })
  tree.review = {
    id: reviewId,
    status: 'editing',
    git: repositoryRoot ? { repositoryRoot } : null
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

test('recent reviews are ordered by last activation', () => {
  let now = Date.parse('2026-07-31T12:00:00.000Z')
  const sessions = new ReviewSessions({ now: () => now })
  const first = sessions.add(document('mko_first11', 'first.md'))
  const second = sessions.add(document('mko_second2', 'second.md'))
  const third = sessions.add(document('mko_third33', 'third.md'))

  assert.deepEqual(
    sessions.recent(2).map((session) => session.reviewId),
    [third.reviewId, second.reviewId]
  )

  now += 60000
  sessions.activate(first.reviewId)

  assert.deepEqual(
    sessions.recent().map((session) => session.reviewId),
    [first.reviewId, third.reviewId, second.reviewId]
  )
  assert.equal(sessions.adjacent(first.reviewId, 1), second)
  assert.equal(first.lastViewedAt, now)
})

test('relative review times use compact T3-style units', () => {
  const now = Date.parse('2026-07-31T12:00:00.000Z')
  assert.equal(formatRelativeTime(now, now), 'now')
  assert.equal(formatRelativeTime(now - 9 * 60000, now), '9m ago')
  assert.equal(formatRelativeTime(now - 3 * 3600000, now), '3h ago')
  assert.equal(formatRelativeTime(now - 31 * 86400000, now), '31d ago')
  assert.equal(formatRelativeTime(now - 800 * 86400000, now), '2y ago')
})

test('relative review time refreshes at the next visible unit boundary', () => {
  const now = Date.parse('2026-07-31T12:00:00.000Z')
  assert.equal(relativeTimeRefreshDelay([now], now), 60000)
  assert.equal(
    relativeTimeRefreshDelay([now - 9.5 * 60000], now),
    30000
  )
  assert.equal(
    relativeTimeRefreshDelay([now - 3.25 * 3600000], now),
    45 * 60000
  )
  assert.equal(relativeTimeRefreshDelay([], now), null)
})

test('documents list width leaves room for the two review panes', () => {
  assert.equal(clampDocumentsListWidth(40, 1180), 150)
  assert.equal(clampDocumentsListWidth(280, 1180), 280)
  assert.equal(clampDocumentsListWidth(800, 1180), 440)
  assert.equal(clampDocumentsListWidth(400, 760), 200)
})

test('reviews group by repository basename in project recency order', () => {
  const sessions = new ReviewSessions()
  const alpha = sessions.add(document(
    'mko_alpha111',
    'alpha.md',
    '/Users/example/projects/alpha'
  ))
  const beta = sessions.add(document(
    'mko_beta2222',
    'beta.md',
    '/Users/example/projects/beta'
  ))
  const alphaRecent = sessions.add(document(
    'mko_alpha333',
    'decisions.md',
    '/Users/example/projects/alpha/'
  ))

  assert.deepEqual(
    sessions.projectGroups().map((group) => ({
      key: group.key,
      name: group.name,
      reviews: group.sessions.map((session) => session.reviewId)
    })),
    [
      {
        key: '/Users/example/projects/alpha',
        name: 'alpha',
        reviews: [alphaRecent.reviewId, alpha.reviewId]
      },
      {
        key: '/Users/example/projects/beta',
        name: 'beta',
        reviews: [beta.reviewId]
      }
    ]
  )
})

test('project identity falls back to the source directory and then Other', () => {
  assert.deepEqual(
    projectIdentity({
      path: '/tmp/fallback/notes.md',
      projectRoot: '/Users/example/projects/markover',
      tree: {}
    }),
    {
      key: '/Users/example/projects/markover',
      name: 'markover',
      root: '/Users/example/projects/markover'
    }
  )
  assert.deepEqual(
    projectIdentity({ path: '/tmp/project/notes.md', tree: {} }),
    { key: '/tmp/project', name: 'project', root: '/tmp/project' }
  )
  assert.deepEqual(
    projectIdentity({ path: null, tree: {} }),
    { key: 'unassigned', name: 'Other', root: null }
  )
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

import assert from 'node:assert/strict'
import test from 'node:test'

import type { ReviewArtifact } from '../src/review-store'

const {
  clampAnnotationPaneWidth,
  clampDocumentsListWidth,
  formatRelativeTime,
  isTreeEditable,
  projectIdentity,
  relativeTimeRefreshDelay,
  ReviewMutationTracker,
  ReviewSessions
} = require('../src/review-sessions') as MarkoverReviewSessionsApi
const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi

function sessionTreeFromArtifact(tree: ReviewArtifact): ReviewSessionTree {
  return tree
}

function reviewDocument(
  reviewId: string,
  name: string,
  repositoryRoot: string | null = null
): ReviewSessionDocument {
  const parsed = parseMarkdown(`# ${name}\n\n- One\n- Two\n`, `sha256:${reviewId}`, {
    name,
    path: `/tmp/${name}`
  })
  const tree = {
    ...parsed,
    review: {
      id: reviewId,
      status: 'editing',
      git: repositoryRoot ? { repositoryRoot } : null
    }
  } satisfies ReviewSessionTree
  return {
    reviewId,
    name,
    path: `/tmp/${name}`,
    checksum: `sha256:${reviewId}`,
    tree
  }
}

function firstNode(session: ReviewSession): ReviewNode {
  const node = session.tree.root.children[0]
  assert.ok(node)
  return node
}

test('switching among three reviews preserves independent view and review state', () => {
  const sessions = new ReviewSessions()
  const first = sessions.add(reviewDocument('mko_first11', 'first.md'))
  const second = sessions.add(reviewDocument('mko_second2', 'second.md'))
  const third = sessions.add(reviewDocument('mko_third33', 'third.md'))

  sessions.activate(first.reviewId)
  first.selectedId = 'block-2'
  first.annotatedOnly = true
  first.annotationView = 'list'
  first.sourceEditingId = 'block-2'
  first.sourceDrafts.set('block-2', 'A proposed source edit')
  const firstBlock = firstNode(first)
  firstBlock.collapsed = true
  firstBlock.feedback = 'First feedback'
  firstBlock.attachments = [{ id: 'img-1' }]

  sessions.activate(second.reviewId)
  second.selectedId = 'block-3'
  const secondBlock = firstNode(second)
  secondBlock.feedback = 'Second feedback'

  sessions.activate(third.reviewId)
  third.sourceCollapsed = true

  assert.equal(sessions.list().length, 3)
  assert.equal(sessions.activate(first.reviewId).selectedId, 'block-2')
  assert.equal(sessions.activate(first.reviewId).annotatedOnly, true)
  assert.equal(sessions.activate(first.reviewId).annotationView, 'list')
  assert.equal(first.sourceEditingId, 'block-2')
  assert.equal(first.sourceDrafts.get('block-2'), 'A proposed source edit')
  assert.equal(firstBlock.collapsed, true)
  assert.equal(firstBlock.feedback, 'First feedback')
  assert.deepEqual(firstBlock.attachments, [{ id: 'img-1' }])
  assert.equal(sessions.activate(second.reviewId).selectedId, 'block-3')
  assert.equal(secondBlock.feedback, 'Second feedback')
  assert.equal(sessions.activate(third.reviewId).sourceCollapsed, true)
})

test('unnamed managed documents receive a stable display name', () => {
  const sessions = new ReviewSessions()
  const parsed = parseMarkdown('# Untitled', 'sha256:mko_unnamed1')
  const tree = {
    ...parsed,
    review: { id: 'mko_unnamed1', status: 'editing' }
  } satisfies ReviewSessionTree

  const session = sessions.add({
    reviewId: 'mko_unnamed1',
    name: null,
    path: null,
    checksum: 'sha256:mko_unnamed1',
    tree
  })

  assert.equal(session.documentName, 'Untitled')
})

test('status updates do not activate another review', () => {
  const sessions = new ReviewSessions()
  const first = sessions.add(reviewDocument('mko_first11', 'first.md'))
  const second = sessions.add(reviewDocument('mko_second2', 'second.md'))
  sessions.activate(first.reviewId)

  sessions.updateStatus(second.reviewId, 'pending-agent')

  assert.equal(sessions.active()?.reviewId, first.reviewId)
  assert.equal(second.tree.review.status, 'pending-agent')
})

test('status updates include the transient renderer handoff state', () => {
  const sessions = new ReviewSessions()
  const review = sessions.add(reviewDocument('mko_handoff1', 'handoff.md'))

  sessions.updateStatus(review.reviewId, 'handoff-in-progress')

  assert.equal(review.tree.review.status, 'handoff-in-progress')
})

test('adjacent review navigation wraps in either direction', () => {
  const sessions = new ReviewSessions()
  const first = sessions.add(reviewDocument('mko_first11', 'first.md'))
  sessions.add(reviewDocument('mko_second2', 'second.md'))
  const third = sessions.add(reviewDocument('mko_third33', 'third.md'))

  assert.equal(sessions.adjacent(first.reviewId, -1), third)
  assert.equal(sessions.adjacent(third.reviewId, 1), first)
  assert.equal(sessions.adjacent('mko_missing1', 1), null)
})

test('recent reviews are ordered by last activation', () => {
  let now = Date.parse('2026-07-31T12:00:00.000Z')
  const sessions = new ReviewSessions({ now: () => now })
  const first = sessions.add(reviewDocument('mko_first11', 'first.md'))
  const second = sessions.add(reviewDocument('mko_second2', 'second.md'))
  const third = sessions.add(reviewDocument('mko_third33', 'third.md'))

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

test('annotation pane width leaves room for the document tree', () => {
  assert.equal(clampAnnotationPaneWidth(200, 1180, 248), 360)
  assert.equal(clampAnnotationPaneWidth(480, 1180, 248), 480)
  assert.equal(clampAnnotationPaneWidth(900, 1180, 248), 732)
  assert.equal(clampAnnotationPaneWidth(420, 760, 200), 360)
})

test('reviews group by repository basename in project recency order', () => {
  const sessions = new ReviewSessions()
  const alpha = sessions.add(reviewDocument(
    'mko_alpha111',
    'alpha.md',
    '/Users/example/projects/alpha'
  ))
  const beta = sessions.add(reviewDocument(
    'mko_beta2222',
    'beta.md',
    '/Users/example/projects/beta'
  ))
  const alphaRecent = sessions.add(reviewDocument(
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
      path: '/tmp/project/notes.md',
      projectRoot: '/Users/example/.t3/worktrees/markover/t3code-b7c2aba1',
      tree: {
        review: {
          git: { repositoryUrl: 'git@github.com:lastobelus/markover.git' }
        }
      }
    }),
    {
      key: '/Users/example/.t3/worktrees/markover/t3code-b7c2aba1',
      name: 'markover',
      root: '/Users/example/.t3/worktrees/markover/t3code-b7c2aba1'
    }
  )
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
    projectIdentity({
      path: '/tmp/project/notes.md',
      tree: { review: { git: 'legacy metadata' } }
    }),
    { key: '/tmp/project', name: 'project', root: '/tmp/project' }
  )
  assert.deepEqual(
    projectIdentity({
      path: '/tmp/project/notes.md',
      projectRoot: { invalid: true },
      tree: { review: { git: { repositoryRoot: 42 } } }
    }),
    { key: '/tmp/project', name: 'project', root: '/tmp/project' }
  )
  assert.deepEqual(
    projectIdentity({ path: null, tree: {} }),
    { key: 'unassigned', name: 'Other', root: null }
  )
})

test('persisted review artifacts satisfy the browser session boundary', () => {
  const source = reviewDocument('mko_stored11', 'stored.md').tree
  const artifact = {
    ...source,
    review: {
      ...source.review,
      status: 'editing',
      createdAt: '2026-08-03T12:00:00.000Z',
      updatedAt: '2026-08-03T12:00:00.000Z',
      contextSummary: 'Review the stored document.',
      agentThread: null,
      git: 'legacy metadata',
      pullRequest: null,
      agentGuidance: {
        fixedContract: 'Interpret feedback by intent.',
        interpretationPolicy: 'Use your judgment.'
      }
    }
  } satisfies ReviewArtifact

  const sessionTree = sessionTreeFromArtifact(artifact)
  assert.equal(sessionTree, artifact)
  assert.equal(sessionTree.review.contextSummary, 'Review the stored document.')
  assert.equal(sessionTree.review.agentThread, null)
  assert.equal(sessionTree.review.pullRequest, null)
})

test('an inactive review snapshot includes its latest in-memory feedback', () => {
  const sessions = new ReviewSessions()
  const first = sessions.add(reviewDocument('mko_first11', 'first.md'))
  const second = sessions.add(reviewDocument('mko_second2', 'second.md'))
  sessions.activate(first.reviewId)
  const firstBlock = firstNode(first)
  firstBlock.feedback = 'Latest feedback before switching.'
  sessions.activate(second.reviewId)

  const snapshot = sessions.snapshot(first.reviewId)
  assert.ok(snapshot)
  assert.equal(
    firstNode({ ...first, tree: snapshot }).feedback,
    'Latest feedback before switching.'
  )
  firstNode({ ...first, tree: snapshot }).feedback = 'Outside mutation'
  assert.equal(
    firstBlock.feedback,
    'Latest feedback before switching.'
  )
})

test('only managed editing trees are editable', () => {
  assert.equal(isTreeEditable({}), true)
  assert.equal(isTreeEditable({ review: { status: 'editing' } }), true)
  assert.equal(
    isTreeEditable({ review: { status: 'handoff-in-progress' } }),
    false
  )
  assert.equal(isTreeEditable({ review: { status: 'pending-agent' } }), false)
  assert.equal(isTreeEditable({ review: { status: 'revised' } }), false)
  assert.equal(isTreeEditable({ review: { status: 'done' } }), false)
  assert.equal(isTreeEditable({ review: { status: 'unknown' } }), false)
})

test('mutation tracking waits for every overlapping operation', async () => {
  const tracker = new ReviewMutationTracker()
  let finishFirst: (() => void) | undefined
  let finishSecond: (() => void) | undefined
  const first = new Promise<void>((resolve) => {
    finishFirst = resolve
  })
  const second = new Promise<void>((resolve) => {
    finishSecond = resolve
  })
  tracker.track('mko_review1', first)
  tracker.track('mko_review1', second)

  let settled = false
  const waiting = tracker.wait('mko_review1').then(() => {
    settled = true
  })
  assert.ok(finishSecond)
  finishSecond()
  await Promise.resolve()
  assert.equal(tracker.has('mko_review1'), true)
  assert.equal(settled, false)

  assert.ok(finishFirst)
  finishFirst()
  await waiting
  assert.equal(tracker.has('mko_review1'), false)
  assert.equal(settled, true)
})

test('mutation tracking is isolated by review', async () => {
  const tracker = new ReviewMutationTracker()
  let finishOther: (() => void) | undefined
  tracker.track('mko_other1', new Promise<void>((resolve) => {
    finishOther = resolve
  }))

  await tracker.wait('mko_current1')
  assert.equal(tracker.has('mko_other1'), true)
  assert.ok(finishOther)
  finishOther()
})

test('waiting for current mutations excludes the operation that follows', async () => {
  const tracker = new ReviewMutationTracker()
  let finishFirst: (() => void) | undefined
  const first = new Promise<void>((resolve) => {
    finishFirst = resolve
  })
  tracker.track('mko_review1', first)
  const current = tracker.waitCurrent('mko_review1')
  let finishFollowing: (() => void) | undefined
  tracker.track('mko_review1', new Promise<void>((resolve) => {
    finishFollowing = resolve
  }))

  assert.ok(finishFirst)
  finishFirst()
  await current
  assert.equal(tracker.has('mko_review1'), true)
  assert.ok(finishFollowing)
  finishFollowing()
  await tracker.wait('mko_review1')
})

test('removing a review preserves other sessions and clears active ownership', () => {
  const sessions = new ReviewSessions()
  const first = sessions.add(reviewDocument('mko_first11', 'first.md'))
  const second = sessions.add(reviewDocument('mko_second2', 'second.md'))
  sessions.activate(first.reviewId)

  assert.equal(sessions.remove(first.reviewId), first)
  assert.equal(sessions.active(), null)
  assert.equal(sessions.get(first.reviewId), null)
  assert.deepEqual(sessions.list(), [second])
  assert.equal(sessions.remove(first.reviewId), null)
})

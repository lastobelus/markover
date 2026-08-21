import assert from 'node:assert/strict'
import test from 'node:test'

import type { ReviewArtifact } from '../src/review-store'

const {
  clampRightPaneWidth,
  clampLeftPaneWidth,
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
  projectValue: string | ProjectIdentity | null = null
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
      origin: 'agent',
      createdAt: '2026-08-03T12:00:00.000Z',
      updatedAt: '2026-08-03T12:00:00.000Z',
      attentionRequestedAt: '2026-08-03T12:00:00.000Z',
      contextSummary: `Review ${name}.`,
      agentThread: null,
      git: null,
      pullRequest: null,
      agentGuidance: {
        fixedContract: 'Interpret feedback by intent.',
        interpretationPolicy: 'Use your judgment.'
      }
    }
  } satisfies ReviewSessionTree
  return {
    reviewId,
    name,
    path: `/tmp/${name}`,
    checksum: `sha256:${reviewId}`,
    tree,
    project: typeof projectValue === 'string'
      ? (() => {
          const root = projectValue.replace(/[\\/]+$/, '')
          return {
            key: root,
            name: root.split('/').pop() || 'Other',
            root
          }
        })()
      : projectValue
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
  first.collapsedBlockIds.add(firstBlock.id)
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
  assert.equal(first.collapsedBlockIds.has(firstBlock.id), true)
  assert.equal(firstBlock.feedback, 'First feedback')
  assert.deepEqual(firstBlock.attachments, [{ id: 'img-1' }])
  assert.equal(sessions.activate(second.reviewId).selectedId, 'block-3')
  assert.equal(secondBlock.feedback, 'Second feedback')
  assert.equal(sessions.activate(third.reviewId).sourceCollapsed, true)
})

test('new sessions apply private default collapse rules without node state', () => {
  const parsed = parseMarkdown(
    '---\ntitle: Example\n---\n\n# Body\n',
    'sha256:mko_front111',
    { name: 'frontmatter.md', path: '/tmp/frontmatter.md' }
  )
  const tree = {
    ...parsed,
    review: {
      ...reviewDocument('mko_front111', 'frontmatter.md').tree.review,
      id: 'mko_front111'
    }
  } satisfies ReviewSessionTree
  const frontmatter = tree.root.children[0]
  assert.ok(frontmatter)
  assert.equal(frontmatter.type, 'frontmatter')

  const session = new ReviewSessions().add({
    reviewId: 'mko_front111',
    name: 'frontmatter.md',
    path: '/tmp/frontmatter.md',
    checksum: 'sha256:mko_front111',
    tree
  })

  assert.equal(session.collapsedBlockIds.has(frontmatter.id), true)
})

test('unnamed managed documents receive a stable display name', () => {
  const sessions = new ReviewSessions()
  const parsed = parseMarkdown('# Untitled', 'sha256:mko_unnamed1')
  const tree = {
    ...parsed,
    review: {
      ...reviewDocument('mko_unnamed1', 'Untitled').tree.review,
      id: 'mko_unnamed1'
    }
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

test('document updates replace returned review content while preserving presentation state', () => {
  const sessions = new ReviewSessions()
  const original = reviewDocument('mko_reviewed1', 'reviewed.md')
  original.tree.review.status = 'agent-reviewing'
  original.tree.review.agentReviewer = {
    mode: 'annotation-only',
    claimId: 'mko_claim_0123456789abcdef',
    agentThread: null,
    startedAt: '2026-08-03T12:00:30.000Z',
    completedAt: null,
    agentGuidance: {
      fixedContract: 'Review the document.',
      interpretationPolicy: 'Report useful findings.'
    }
  }
  const session = sessions.add(original)
  const treeReference = session.tree
  session.selectedId = firstNode(session).id
  session.annotatedOnly = true
  session.sourceCollapsed = true
  session.sourceDrafts.set(firstNode(session).id, 'private draft')

  const returned = structuredClone(original)
  returned.tree.review.status = 'reviewed'
  returned.tree.review.updatedAt = '2026-08-03T12:01:00.000Z'
  returned.tree.review.agentReviewer = {
    mode: 'annotation-only',
    claimId: 'mko_claim_0123456789abcdef',
    agentThread: null,
    startedAt: '2026-08-03T12:00:30.000Z',
    completedAt: '2026-08-03T12:01:00.000Z',
    agentGuidance: {
      fixedContract: 'Review the document.',
      interpretationPolicy: 'Report useful findings.'
    }
  }
  const returnedFirst = returned.tree.root.children[0]
  assert.ok(returnedFirst)
  returnedFirst.feedback = 'Agent finding.'

  const updated = sessions.updateDocument(returned)
  assert.equal(updated, session)
  assert.notEqual(session.tree, treeReference)
  assert.equal(firstNode(session).feedback, 'Agent finding.')
  assert.equal(session.tree.review.status, 'reviewed')
  assert.equal(session.selectedId, firstNode(session).id)
  assert.equal(session.annotatedOnly, true)
  assert.equal(session.sourceCollapsed, true)
  assert.equal(session.sourceDrafts.get(firstNode(session).id), 'private draft')
})

test('document observations preserve newer editable content', () => {
  const sessions = new ReviewSessions()
  const original = reviewDocument('mko_editing11', 'editing.md')
  const session = sessions.add(original)
  const treeReference = session.tree
  firstNode(session).feedback = 'Unsaved human annotation.'

  const observed = structuredClone(original)
  observed.tree.review.updatedAt = '2026-08-03T12:01:00.000Z'
  observed.tree.review.attentionRequestedAt = '2026-08-03T12:00:30.000Z'
  observed.tree.review.pullRequest = {
    number: 150,
    url: 'https://github.com/lastobelus/markover/pull/150',
    status: 'open',
    statusObservedAt: '2026-08-03T12:01:00.000Z',
    statusSource: 'agent'
  }
  const staleNode = observed.tree.root.children[0]
  assert.ok(staleNode)
  staleNode.feedback = ''

  const updated = sessions.updateDocument(observed)
  assert.equal(updated, session)
  assert.equal(session.tree, treeReference)
  assert.equal(firstNode(session).feedback, 'Unsaved human annotation.')
  assert.equal(
    session.tree.review.pullRequest?.statusObservedAt,
    '2026-08-03T12:01:00.000Z'
  )
})

test('agent review claims add reviewer metadata without replacing editable content', () => {
  const sessions = new ReviewSessions()
  const original = reviewDocument('mko_claimed11', 'claimed.md')
  const session = sessions.add(original)
  const treeReference = session.tree
  firstNode(session).feedback = 'Preserve this annotation.'

  const claimed = structuredClone(original)
  claimed.tree.review.status = 'agent-reviewing'
  claimed.tree.review.agentReviewer = {
    mode: 'annotation-only',
    claimId: 'mko_claim_0123456789abcdef',
    agentThread: null,
    startedAt: '2026-08-03T12:00:30.000Z',
    completedAt: null,
    agentGuidance: {
      fixedContract: 'Review the document.',
      interpretationPolicy: 'Report useful findings.'
    }
  }
  const staleNode = claimed.tree.root.children[0]
  assert.ok(staleNode)
  staleNode.feedback = ''

  sessions.updateDocument(claimed)
  sessions.updateStatus(session.reviewId, 'agent-reviewing')

  assert.equal(session.tree, treeReference)
  assert.equal(firstNode(session).feedback, 'Preserve this annotation.')
  assert.deepEqual(
    session.tree.review.agentReviewer,
    claimed.tree.review.agentReviewer
  )
})

test('agent review cancellation removes reviewer metadata without replacing content', () => {
  const sessions = new ReviewSessions()
  const inflight = reviewDocument('mko_cancel111', 'cancel.md')
  inflight.tree.review.status = 'agent-reviewing'
  inflight.tree.review.agentReviewer = {
    mode: 'annotation-only',
    claimId: 'mko_claim_fedcba9876543210',
    agentThread: null,
    startedAt: '2026-08-03T12:00:30.000Z',
    completedAt: null,
    agentGuidance: {
      fixedContract: 'Review the document.',
      interpretationPolicy: 'Report useful findings.'
    }
  }
  const session = sessions.add(inflight)
  const treeReference = session.tree

  const cancelled = structuredClone(inflight)
  cancelled.tree.review.status = 'editing'
  delete cancelled.tree.review.agentReviewer

  sessions.updateDocument(cancelled)
  sessions.updateStatus(session.reviewId, 'editing')

  assert.equal(session.tree, treeReference)
  assert.equal(session.tree.review.status, 'editing')
  assert.equal(session.tree.review.agentReviewer, undefined)
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

test('left pane width leaves room for the center and right panes', () => {
  assert.equal(clampLeftPaneWidth(40, 1180), 150)
  assert.equal(clampLeftPaneWidth(280, 1180), 280)
  assert.equal(clampLeftPaneWidth(800, 1180), 440)
  assert.equal(clampLeftPaneWidth(400, 760), 200)
})

test('right pane width leaves room for the center pane', () => {
  assert.equal(clampRightPaneWidth(200, 1180, 248), 360)
  assert.equal(clampRightPaneWidth(480, 1180, 248), 480)
  assert.equal(clampRightPaneWidth(900, 1180, 248), 732)
  assert.equal(clampRightPaneWidth(420, 760, 200), 360)
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
      project: {
        key: 'remote:github.com/lastobelus/markover',
        name: 'markover',
        root: '/Users/example/.t3/worktrees/markover/t3code-b7c2aba1'
      },
      tree: {
        review: {
          git: { repositoryUrl: 'git@github.com:lastobelus/markover.git' }
        }
      }
    }),
    {
      key: 'remote:github.com/lastobelus/markover',
      name: 'markover',
      root: '/Users/example/.t3/worktrees/markover/t3code-b7c2aba1'
    }
  )
  assert.deepEqual(
    projectIdentity({
      path: '/tmp/fallback/notes.md',
      project: {
        key: 'root:/Users/example/projects/markover',
        name: 'markover',
        root: '/Users/example/projects/markover'
      },
      tree: {}
    }),
    {
      key: 'root:/Users/example/projects/markover',
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
      reviewId: 'mko_stale01',
      path: '/tmp/stale-checkout/notes.md',
      project: null,
      tree: {
        review: {
          git: { repositoryUrl: 'git@github.com:lastobelus/markover.git' }
        }
      }
    }),
    { key: 'unassigned', name: 'Other', root: null }
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
      project: { invalid: true },
      tree: { review: { git: { repositoryRoot: 42 } } }
    }),
    { key: '/tmp/project', name: 'project', root: '/tmp/project' }
  )
  assert.deepEqual(
    projectIdentity({ path: null, tree: {} }),
    { key: 'unassigned', name: 'Other', root: null }
  )
})

test('managed refresh replaces private project and source context', () => {
  const sessions = new ReviewSessions()
  const document = reviewDocument(
    'mko_context1',
    'context.md',
    '/projects/markover'
  )
  document.projectEvidence = 'verified'
  document.sourceState = 'unchanged'
  const session = sessions.add(document)
  assert.equal(session.projectEvidence, 'verified')
  assert.equal(session.sourceState, 'unchanged')

  const refreshed = structuredClone(document)
  refreshed.project = null
  refreshed.projectEvidence = 'conflict'
  refreshed.sourceState = 'changed'
  const updated = sessions.updateDocument(refreshed)
  assert.ok(updated)
  assert.deepEqual(
    {
      key: updated.projectKey,
      name: updated.projectName,
      root: updated.projectRoot,
      evidence: updated.projectEvidence,
      source: updated.sourceState
    },
    {
      key: 'unassigned',
      name: 'Other',
      root: null,
      evidence: 'conflict',
      source: 'changed'
    }
  )
})

test('adding an existing managed review applies refreshed private context', () => {
  const sessions = new ReviewSessions()
  const original = reviewDocument('mko_refresh2', 'refresh.md', {
    key: 'repo:before',
    name: 'Before',
    root: '/tmp/before'
  })
  original.projectEvidence = 'verified'
  original.sourceState = 'unchanged'
  const session = sessions.add(original)

  const refreshed = reviewDocument('mko_refresh2', 'refresh.md', null)
  refreshed.projectEvidence = 'conflict'
  refreshed.sourceState = 'changed'
  const returned = sessions.add(refreshed)

  assert.equal(returned, session)
  assert.equal(session.projectKey, 'unassigned')
  assert.equal(session.projectName, 'Other')
  assert.equal(session.projectEvidence, 'conflict')
  assert.equal(session.sourceState, 'changed')
})

test('persisted review artifacts satisfy the browser session boundary', () => {
  const source = reviewDocument('mko_stored11', 'stored.md').tree
  const artifact = {
    ...source,
    review: {
      ...source.review,
      status: 'editing',
      origin: 'agent',
      createdAt: '2026-08-03T12:00:00.000Z',
      updatedAt: '2026-08-03T12:00:00.000Z',
      attentionRequestedAt: '2026-08-03T12:00:00.000Z',
      contextSummary: 'Review the stored document.',
      agentThread: null,
      git: { branch: 'feature/session' },
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

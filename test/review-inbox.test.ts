import assert from 'node:assert/strict'
import test from 'node:test'

import { projectReviewInbox } from '../src/review-inbox'

const { ReviewSessions } = require('../src/review-sessions') as MarkoverReviewSessionsApi
const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi

interface ReviewFixtureOptions {
  agentThread?: unknown
  branch?: string
  contextSummary?: string
  createdAt: string
  projectRoot: string
  pullRequestNumber?: number
  status?: ReviewSessionStatus
}

function reviewDocument(
  reviewId: string,
  name: string,
  {
    agentThread = null,
    branch,
    contextSummary = 'Review this document.',
    createdAt,
    projectRoot,
    pullRequestNumber,
    status = 'editing'
  }: ReviewFixtureOptions
): ReviewSessionDocument {
  const path = `${projectRoot}/doc/${name}`
  const parsed = parseMarkdown(`# ${name}`, `sha256:${reviewId}`, { name, path })
  return {
    reviewId,
    name,
    path,
    checksum: `sha256:${reviewId}`,
    tree: {
      ...parsed,
      review: {
        id: reviewId,
        status,
        createdAt,
        updatedAt: createdAt,
        contextSummary,
        agentThread,
        git: branch ? { repositoryRoot: projectRoot, branch } : { repositoryRoot: projectRoot },
        pullRequest: pullRequestNumber ? { number: pullRequestNumber } : null
      }
    }
  }
}

test('Inbox exposes every Editing review in attention order without thread grouping', () => {
  const sessions = new ReviewSessions()
  const thread = {
    provider: 'codex',
    id: 'thread-97',
    title: 'Improve inbox / review management'
  }
  sessions.add(reviewDocument('mko_older111', 'inbox-spec.md', {
    agentThread: thread,
    branch: 't3code/review-inbox-management',
    createdAt: '2026-08-09T12:00:00.000Z',
    projectRoot: '/projects/markover',
    pullRequestNumber: 97
  }))
  sessions.add(reviewDocument(
    'mko_newer222',
    '2026-08-09__review-inbox-layout-follow-up.md',
    {
      agentThread: thread,
      branch: 't3code/review-inbox-management',
      createdAt: '2026-08-09T12:14:00.000Z',
      projectRoot: '/projects/markover',
      pullRequestNumber: 97
    }
  ))

  const projection = projectReviewInbox(sessions.list())
  assert.deepEqual(
    projection.editing.map((review) => review.reviewId),
    ['mko_newer222', 'mko_older111']
  )
  assert.deepEqual(
    projection.editing.map((review) => review.title),
    [
      'Improve inbox / review management',
      'Improve inbox / review management'
    ]
  )
  assert.equal(projection.projects[0]?.threads[0]?.editingCount, 2)
})

test('Local reviews use document identity and the synthetic Local reviews group', () => {
  const sessions = new ReviewSessions()
  sessions.add(reviewDocument('mko_local111', 'product-notes.md', {
    branch: 'main',
    contextSummary: 'Opened locally in Markover.',
    createdAt: '2026-08-09T10:00:00.000Z',
    projectRoot: '/projects/markover',
    pullRequestNumber: 88
  }))

  const projection = projectReviewInbox(sessions.list())
  const local = projection.editing[0]
  assert.ok(local)
  assert.equal(local.local, true)
  assert.equal(local.title, 'product-notes.md')
  assert.equal(local.titleSource, 'document-name')
  assert.equal(local.contextPath, 'doc/product-notes.md')
  assert.equal(local.branch, 'main')
  assert.equal(local.pullRequestNumber, 88)
  assert.equal(projection.projects[0]?.threads[0]?.title, 'Local reviews')
})

test('Projects put actionable rollups before every non-actionable lifecycle state', () => {
  const sessions = new ReviewSessions()
  sessions.add(reviewDocument('mko_pending1', 'pending.md', {
    agentThread: { provider: 'codex', id: 'old-thread' },
    createdAt: '2026-08-09T11:00:00.000Z',
    projectRoot: '/projects/recent-history',
    status: 'pending-agent'
  }))
  sessions.add(reviewDocument('mko_revised1', 'revised.md', {
    agentThread: { provider: 'codex', id: 'old-thread' },
    createdAt: '2026-08-09T12:00:00.000Z',
    projectRoot: '/projects/recent-history',
    status: 'revised'
  }))
  sessions.add(reviewDocument('mko_done1111', 'done.md', {
    agentThread: { provider: 'codex', id: 'old-thread' },
    createdAt: '2026-08-09T13:00:00.000Z',
    projectRoot: '/projects/recent-history',
    status: 'done'
  }))
  sessions.add(reviewDocument('mko_editing1', 'needed.md', {
    agentThread: { provider: 'codex', id: 'needed-thread' },
    createdAt: '2026-08-09T09:00:00.000Z',
    projectRoot: '/projects/older-actionable'
  }))

  const projection = projectReviewInbox(sessions.list())
  assert.deepEqual(
    projection.projects.map((project) => project.name),
    ['older-actionable', 'recent-history']
  )
  assert.equal(projection.projects[0]?.editingCount, 1)
  assert.equal(projection.projects[1]?.editingCount, 0)
  assert.deepEqual(
    projection.history.map((review) => [review.reviewId, review.status]),
    [
      ['mko_done1111', 'done'],
      ['mko_revised1', 'revised'],
      ['mko_pending1', 'pending-agent']
    ]
  )
  assert.equal(projection.projects[1]?.threads[0]?.editingCount, 0)
})

test('missing optional metadata remains explicit and never invents a thread title', () => {
  const sessions = new ReviewSessions()
  sessions.add(reviewDocument('mko_missing1', 'research-summary.md', {
    contextSummary: '',
    createdAt: '2026-08-09T08:00:00.000Z',
    projectRoot: '/projects/notes-lab'
  }))

  const row = projectReviewInbox(sessions.list()).editing[0]
  assert.ok(row)
  assert.equal(row.provider, null)
  assert.equal(row.branch, null)
  assert.equal(row.pullRequestNumber, null)
  assert.equal(row.title, 'research-summary.md')
  assert.equal(row.titleSource, 'document-name')
  assert.equal(row.threadKey, 'review:mko_missing1')
})

test('returning to Editing updates attention time while viewing does not', () => {
  let now = Date.parse('2026-08-09T14:00:00.000Z')
  const sessions = new ReviewSessions({ now: () => now })
  const session = sessions.add(reviewDocument('mko_return11', 'return.md', {
    agentThread: { provider: 'codex', id: 'return-thread' },
    createdAt: '2026-08-09T12:00:00.000Z',
    projectRoot: '/projects/markover'
  }))
  assert.equal(
    session.attentionRequestedAt,
    Date.parse('2026-08-09T12:00:00.000Z')
  )

  now += 60_000
  sessions.activate(session.reviewId)
  assert.equal(
    session.attentionRequestedAt,
    Date.parse('2026-08-09T12:00:00.000Z')
  )

  sessions.updateStatus(session.reviewId, 'pending-agent')
  now += 60_000
  sessions.updateStatus(session.reviewId, 'editing')
  assert.equal(session.attentionRequestedAt, now)
  assert.equal(session.lifecycleActivityAt, now)
})

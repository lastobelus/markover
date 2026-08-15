import assert from 'node:assert/strict'
import test from 'node:test'

import { projectReviewInbox } from '../src/review-inbox'

const { ReviewSessions } = require('../src/review-sessions') as MarkoverReviewSessionsApi
const { parseMarkdown } = require('../src/tree') as MarkoverTreeApi

interface ReviewFixtureOptions {
  agentThread?: ReviewAgentThread | null
  attentionRequestedAt?: string
  branch?: string
  contextSummary?: string
  createdAt: string
  origin?: string
  projectRoot: string
  pullRequestNumber?: number
  pullRequestStatus?: 'draft' | 'open' | 'merged' | 'closed'
  pullRequestStatusObservedAt?: string
  pullRequestStatusSource?: string
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
    origin = 'agent',
    attentionRequestedAt = createdAt,
    projectRoot,
    pullRequestNumber,
    pullRequestStatus,
    pullRequestStatusObservedAt,
    pullRequestStatusSource,
    status = 'editing'
  }: ReviewFixtureOptions
): ReviewSessionDocument {
  const path = `${projectRoot}/doc/${name}`
  const parsed = parseMarkdown(`# ${name}`, `sha256:${reviewId}`, { name, path })
  return {
    reviewId,
    name,
    path,
    projectRoot,
    checksum: `sha256:${reviewId}`,
    tree: {
      ...parsed,
      review: {
        id: reviewId,
        status,
        origin,
        createdAt,
        updatedAt: createdAt,
        attentionRequestedAt,
        contextSummary,
        agentThread,
        git: branch ? { branch } : null,
        pullRequest: pullRequestNumber
          ? {
              number: pullRequestNumber,
              url: `https://github.com/lastobelus/markover/pull/${String(pullRequestNumber)}`,
              ...(pullRequestStatus
                ? {
                    status: pullRequestStatus,
                    statusObservedAt: pullRequestStatusObservedAt,
                    statusSource: pullRequestStatusSource
                  }
                : {})
            }
          : null,
        agentGuidance: {
          fixedContract: 'Interpret feedback by intent.',
          interpretationPolicy: 'Use your judgment.'
        }
      }
    }
  }
}

function providerThread(id: string): ReviewAgentThread {
  return {
    id,
    threadHost: { kind: 'codex', provider: 'codex' }
  }
}

test('Inbox exposes every Editing review in attention order without thread grouping', () => {
  const sessions = new ReviewSessions()
  const thread = providerThread('thread-97')
  sessions.add(reviewDocument('mko_older111', 'inbox-spec.md', {
    agentThread: thread,
    branch: 't3code/review-inbox-management',
    contextSummary: 'Improve inbox / review management',
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
      contextSummary: 'Improve inbox / review management',
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

test('thread-host packets expose nested provider and thread-host registry keys', () => {
  const sessions = new ReviewSessions()
  sessions.add(reviewDocument('mko_host1111', 'host.md', {
    agentThread: {
      id: 'provider-thread-1',
      threadHost: {
        kind: 't3code',
        machine: 'Airy.local',
        threadId: 'host-thread-1',
        provider: 'codex'
      }
    },
    createdAt: '2026-08-09T12:30:00.000Z',
    projectRoot: '/projects/markover'
  }))

  const projection = projectReviewInbox(sessions.list())
  const row = projection.editing[0]
  const thread = projection.projects[0]?.threads[0]
  assert.ok(row)
  assert.ok(thread)
  assert.equal(row.provider, 'codex')
  assert.equal(row.threadHostKind, 't3code')
  assert.equal(row.machine, 'Airy.local')
  assert.equal(row.requestingThreadId, 'host-thread-1')
  assert.equal(thread.provider, 'codex')
  assert.equal(thread.threadHostKind, 't3code')
  assert.equal(thread.machine, 'Airy.local')
  assert.equal(thread.requestingThreadId, 'host-thread-1')
  assert.equal(thread.key, 't3code:host-thread-1')
})

test('T3 titles name Projects while Inbox independently follows its preference', () => {
  const sessions = new ReviewSessions()
  sessions.add(reviewDocument('mko_title111', 'title.md', {
    agentThread: {
      id: 'codex-session-1',
      threadHost: {
        kind: 't3-code',
        threadId: 't3-thread-1',
        provider: 'codex'
      }
    },
    contextSummary: 'Review the title integration.',
    createdAt: '2026-08-09T12:30:00.000Z',
    projectRoot: '/projects/markover'
  }))
  const titles = [{ threadId: 't3-thread-1', title: 'Renamed T3 thread' }]

  const purposeFirst = projectReviewInbox(
    sessions.list(),
    titles,
    'review-purpose'
  )
  const purposeRow = purposeFirst.editing[0]
  const projectThread = purposeFirst.projects[0]?.threads[0]
  assert.ok(purposeRow)
  assert.ok(projectThread)
  assert.equal(purposeRow.title, 'Review the title integration.')
  assert.equal(purposeRow.requestingThreadTitle, 'Renamed T3 thread')
  assert.equal(projectThread.title, 'Renamed T3 thread')
  assert.equal(projectThread.titleSource, 'thread-title')

  const titleFirst = projectReviewInbox(
    sessions.list(),
    titles,
    'requesting-thread-title'
  )
  const titleRow = titleFirst.editing[0]
  assert.ok(titleRow)
  assert.equal(titleRow.title, 'Renamed T3 thread')
  assert.equal(titleRow.titleSource, 'thread-title')
})

test('agent-session fallback identity uses thread-host kind and never provider', () => {
  const sessions = new ReviewSessions()
  for (const [reviewId, provider] of [
    ['mko_kindgrp1', 'codex'],
    ['mko_kindgrp2', 'claude']
  ] as const) {
    sessions.add(reviewDocument(reviewId, `${reviewId}.md`, {
      agentThread: {
        id: 'shared-host-session',
        threadHost: { kind: 't3code', provider }
      },
      createdAt: reviewId.endsWith('1')
        ? '2026-08-09T12:30:00.000Z'
        : '2026-08-09T12:31:00.000Z',
      projectRoot: '/projects/markover'
    }))
  }

  const threads = projectReviewInbox(sessions.list()).projects[0]?.threads
  assert.equal(threads?.length, 1)
  assert.equal(threads[0]?.key, 't3code:shared-host-session')
})

test('distinct host thread IDs own grouping across provider identities', () => {
  const sessions = new ReviewSessions()
  sessions.add(reviewDocument('mko_hostgrp1', 'first.md', {
    agentThread: {
      id: 'provider-thread-shared',
      threadHost: {
        kind: 't3code',
        threadId: 'host-thread-1',
        provider: 'codex'
      }
    },
    createdAt: '2026-08-09T12:30:00.000Z',
    projectRoot: '/projects/markover'
  }))
  sessions.add(reviewDocument('mko_hostgrp2', 'second.md', {
    agentThread: {
      id: 'provider-thread-shared',
      threadHost: {
        kind: 't3code',
        threadId: 'host-thread-2',
        provider: 'codex'
      }
    },
    createdAt: '2026-08-09T12:31:00.000Z',
    projectRoot: '/projects/markover'
  }))
  sessions.add(reviewDocument('mko_hostgrp3', 'third.md', {
    agentThread: {
      id: 'different-provider-thread',
      threadHost: {
        kind: 't3code',
        threadId: 'host-thread-1',
        provider: 'claude'
      }
    },
    createdAt: '2026-08-09T12:32:00.000Z',
    projectRoot: '/projects/markover'
  }))

  const threads = projectReviewInbox(sessions.list()).projects[0]?.threads
  assert.ok(threads)
  assert.deepEqual(
    threads.map((thread) => thread.key),
    ['t3code:host-thread-1', 't3code:host-thread-2']
  )
  assert.deepEqual(
    threads[0]?.reviews.map((review) => review.reviewId),
    ['mko_hostgrp3', 'mko_hostgrp1']
  )
})

test('a thread group never presents one review purpose as a shared thread title', () => {
  const sessions = new ReviewSessions()
  for (const [reviewId, contextSummary, createdAt] of [
    ['mko_purpose1', 'Review the schema.', '2026-08-09T12:30:00.000Z'],
    ['mko_purpose2', 'Approve the UI.', '2026-08-09T12:31:00.000Z']
  ] as const) {
    sessions.add(reviewDocument(reviewId, `${reviewId}.md`, {
      agentThread: providerThread('shared-thread'),
      contextSummary,
      createdAt,
      projectRoot: '/projects/markover'
    }))
  }

  const thread = projectReviewInbox(sessions.list()).projects[0]?.threads[0]
  assert.ok(thread)
  assert.equal(thread.title, 'shared-thread')
  assert.equal(thread.titleSource, 'thread-id')
  assert.deepEqual(
    thread.reviews.map((review) => review.title),
    ['Approve the UI.', 'Review the schema.']
  )
})

test('Local reviews use document identity and the synthetic Local reviews group', () => {
  const sessions = new ReviewSessions()
  sessions.add(reviewDocument('mko_local111', 'product-notes.md', {
    branch: 'main',
    contextSummary: 'Opened locally in Markover.',
    createdAt: '2026-08-09T10:00:00.000Z',
    origin: 'local',
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

test('PR observations remain distinct from the green PR-linked fallback', () => {
  const sessions = new ReviewSessions()
  sessions.add(reviewDocument('mko_linked11', 'linked.md', {
    createdAt: '2026-08-09T10:00:00.000Z',
    projectRoot: '/projects/markover',
    pullRequestNumber: 120
  }))
  sessions.add(reviewDocument('mko_merged11', 'merged.md', {
    createdAt: '2026-08-09T11:00:00.000Z',
    projectRoot: '/projects/markover',
    pullRequestNumber: 129,
    pullRequestStatus: 'merged',
    pullRequestStatusObservedAt: '2026-08-09T11:01:00.000Z',
    pullRequestStatusSource: 'agent'
  }))

  const [merged, linked] = projectReviewInbox(sessions.list()).editing
  assert.ok(merged)
  assert.ok(linked)
  assert.equal(merged.pullRequestStatus, 'merged')
  assert.equal(merged.pullRequestStatusObservedAt, '2026-08-09T11:01:00.000Z')
  assert.equal(merged.pullRequestStatusSource, 'agent')
  assert.equal(linked.pullRequestStatus, null)
  assert.equal(linked.pullRequestStatusObservedAt, null)
  assert.equal(linked.pullRequestStatusSource, null)
})

test('Projects put actionable rollups before every non-actionable lifecycle state', () => {
  const sessions = new ReviewSessions()
  sessions.add(reviewDocument('mko_pending1', 'pending.md', {
    agentThread: providerThread('old-thread'),
    createdAt: '2026-08-09T11:00:00.000Z',
    projectRoot: '/projects/recent-history',
    status: 'pending-agent'
  }))
  sessions.add(reviewDocument('mko_revised1', 'revised.md', {
    agentThread: providerThread('old-thread'),
    createdAt: '2026-08-09T12:00:00.000Z',
    projectRoot: '/projects/recent-history',
    status: 'revised'
  }))
  sessions.add(reviewDocument('mko_done1111', 'done.md', {
    agentThread: providerThread('old-thread'),
    createdAt: '2026-08-09T13:00:00.000Z',
    projectRoot: '/projects/recent-history',
    status: 'done'
  }))
  sessions.add(reviewDocument('mko_reviewed1', 'reviewed.md', {
    agentThread: providerThread('old-thread'),
    createdAt: '2026-08-09T14:00:00.000Z',
    projectRoot: '/projects/recent-history',
    status: 'reviewed'
  }))
  sessions.add(reviewDocument('mko_editing1', 'needed.md', {
    agentThread: providerThread('needed-thread'),
    createdAt: '2026-08-09T09:00:00.000Z',
    projectRoot: '/projects/older-actionable'
  }))

  const projection = projectReviewInbox(sessions.list())
  assert.deepEqual(
    projection.projects.map((project) => project.name),
    ['older-actionable', 'recent-history']
  )
  const actionableProject = projection.projects[0]
  const historyProject = projection.projects[1]
  assert.ok(actionableProject)
  assert.ok(historyProject)
  assert.equal(actionableProject.editingCount, 1)
  assert.equal(historyProject.editingCount, 0)
  assert.deepEqual(
    projection.history.map((review) => [review.reviewId, review.status]),
    [
      ['mko_reviewed1', 'reviewed'],
      ['mko_done1111', 'done'],
      ['mko_revised1', 'revised'],
      ['mko_pending1', 'pending-agent']
    ]
  )
  assert.equal(historyProject.threads[0]?.editingCount, 0)
})

test('missing optional metadata remains explicit and never invents a requesting-thread-title', () => {
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
    agentThread: providerThread('return-thread'),
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

test('restoring an Editing review preserves attention time across later autosaves', () => {
  const document = reviewDocument('mko_restore1', 'restore.md', {
    attentionRequestedAt: '2026-08-09T12:00:00.000Z',
    createdAt: '2026-08-09T12:00:00.000Z',
    projectRoot: '/projects/markover'
  })
  document.tree.review.updatedAt = '2026-08-09T16:00:00.000Z'

  const sessions = new ReviewSessions()
  const restored = sessions.add(document)

  assert.equal(
    restored.attentionRequestedAt,
    Date.parse('2026-08-09T12:00:00.000Z')
  )
  assert.equal(
    restored.lifecycleActivityAt,
    Date.parse('2026-08-09T16:00:00.000Z')
  )

  document.tree.review.updatedAt = '2026-08-09T17:00:00.000Z'
  const refreshed = sessions.updateDocument(document)
  assert.ok(refreshed)
  assert.equal(
    refreshed.lifecycleActivityAt,
    Date.parse('2026-08-09T17:00:00.000Z')
  )
  assert.equal(
    refreshed.attentionRequestedAt,
    Date.parse('2026-08-09T12:00:00.000Z')
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type GitHubCommandRunner,
  assertReadOnlyGitHubArgs,
  collectGitHubOwnershipSnapshot,
  decisionGardenerPublicationMarker,
  findOpenGardenerPublication
} from '../scripts/decision-gardener-github'

function result(value: unknown) {
  return { status: 0, stderr: '', stdout: JSON.stringify(value) }
}

test('ownership discovery is read-only, versioned, bounded, and filters work intent by trust', () => {
  const calls: string[][] = []
  const runner: GitHubCommandRunner = (_repository, args) => {
    calls.push([...args])
    const key = args.join(' ')
    if (key === 'repo view --json nameWithOwner,url') {
      return result({ nameWithOwner: 'lastobelus/markover', url: 'https://github.com/lastobelus/markover' })
    }
    if (key.includes('/issues?state=open')) {
      return result([[
        {
          assignees: [{ login: 'lastobelus' }],
          body: 'Owns publication.',
          comments: 3,
          html_url: 'https://github.com/lastobelus/markover/issues/101',
          labels: [{ name: 'automation' }],
          milestone: { title: 'Broad announcement' },
          number: 101,
          state: 'open',
          title: 'Decision gardener',
          pull_request: undefined
        },
        {
          assignees: [],
          body: `${decisionGardenerPublicationMarker}\nDraft body`,
          comments: 0,
          html_url: 'https://github.com/lastobelus/markover/pull/150',
          labels: [],
          milestone: null,
          number: 150,
          pull_request: { url: 'api' },
          state: 'open',
          title: 'Gardener proposal'
        }
      ]])
    }
    if (key.includes('/issues/101/comments')) {
      return result([[
        {
          author_association: 'OWNER',
          body: '<!-- start-issue-work-intent -->\ntrusted',
          created_at: '2026-08-11T00:00:00Z',
          html_url: 'https://example.test/trusted',
          id: 2,
          user: { login: 'lastobelus' }
        },
        {
          author_association: 'NONE',
          body: '<!-- start-issue-work-intent -->\nuntrusted',
          created_at: '2026-08-10T00:00:00Z',
          html_url: 'https://example.test/untrusted',
          id: 1,
          user: { login: 'outsider' }
        },
        {
          author_association: 'OWNER',
          body: 'ordinary comment',
          created_at: '2026-08-09T00:00:00Z',
          html_url: 'https://example.test/ordinary',
          id: 3,
          user: { login: 'lastobelus' }
        }
      ]])
    }
    return { status: 1, stderr: `unexpected: ${key}`, stdout: '' }
  }
  const snapshot = collectGitHubOwnershipSnapshot({
    capturedAt: '2026-08-11T01:00:00Z',
    repository: '/repo',
    runner
  })
  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.repository, 'lastobelus/markover')
  assert.deepEqual(snapshot.items.map(({ number, type }) => ({ number, type })), [
    { number: 101, type: 'issue' },
    { number: 150, type: 'pull_request' }
  ])
  const firstItem = snapshot.items[0]
  assert.ok(firstItem)
  const firstIntent = firstItem.workIntents[0]
  assert.ok(firstIntent)
  assert.equal(firstIntent.body.endsWith('trusted'), true)
  assert.equal(findOpenGardenerPublication(snapshot)?.number, 150)
  for (const call of calls) {
    assert.doesNotThrow(() => {
      assertReadOnlyGitHubArgs(call)
    })
  }
  assert.throws(() => {
    collectGitHubOwnershipSnapshot({
      maxBytes: 10,
      repository: '/repo',
      runner
    })
  }, /snapshot is .* bytes; the limit is 10/)
})

test('GitHub ownership discovery rejects mutating command shapes', () => {
  assert.throws(
    () => {
      assertReadOnlyGitHubArgs(['api', '--method', 'POST', 'repos/o/r/issues'])
    },
    /non-read-only command/
  )
  assert.throws(
    () => {
      assertReadOnlyGitHubArgs(['issue', 'create', '--title', 'bad'])
    },
    /non-read-only command/
  )
})

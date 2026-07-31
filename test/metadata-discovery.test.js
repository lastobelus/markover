const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  discoverCodexThread,
  discoverGitMetadata,
  discoverReviewMetadata,
  sanitizeRemoteUrl
} = require('../src/metadata-discovery')

test('discovers Git metadata and records each source', async () => {
  const answers = new Map([
    ['rev-parse --show-toplevel', '/repo'],
    ['symbolic-ref --quiet --short HEAD', 'feature/discovery'],
    ['rev-parse --verify HEAD', 'abc123'],
    ['config --get remote.origin.url', 'git@example.com:repo.git']
  ])
  const metadata = await discoverGitMetadata('/repo/docs/plan.md', {
    async runGit(args, workingDirectory) {
      assert.equal(workingDirectory, '/repo/docs')
      return answers.get(args.join(' ')) || null
    }
  })

  assert.deepEqual(metadata, {
    repositoryRoot: '/repo',
    repositoryUrl: 'git@example.com:repo.git',
    branch: 'feature/discovery',
    commit: 'abc123',
    sources: {
      repositoryRoot: 'git-cli',
      repositoryUrl: 'git-cli',
      branch: 'git-cli',
      commit: 'git-cli'
    }
  })
})

test('Git discovery degrades outside a repository', async () => {
  assert.equal(
    await discoverGitMetadata('/tmp/plan.md', {
      async runGit() {
        return null
      }
    }),
    null
  )
})

test('redacts credentials from HTTPS Git remotes', () => {
  assert.equal(
    sanitizeRemoteUrl(
      'https://user:secret@example.com/org/repo.git?token=secret#fragment'
    ),
    'https://example.com/org/repo.git'
  )
  assert.equal(
    sanitizeRemoteUrl('git@example.com:org/repo.git'),
    'git@example.com:org/repo.git'
  )
})

test('finds a Codex session by an exact handoff key', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-session-discovery-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const logPath = path.join(directory, '2026', '07', '30', 'session.jsonl')
  await fs.mkdir(path.dirname(logPath), { recursive: true })
  await fs.writeFile(logPath, [
    JSON.stringify({
      type: 'session_meta',
      payload: {
        id: 'thread-123',
        session_id: 'parent-thread',
        parent_thread_id: 'parent-thread',
        cwd: '/repo'
      }
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: { message: 'mko_handoff_0123456789abcdef' }
    })
  ].join('\n'))

  assert.deepEqual(
    await discoverCodexThread('mko_handoff_0123456789abcdef', {
      sessionsDirectory: directory
    }),
    {
      provider: 'codex',
      id: 'thread-123',
      discovery: 'handoff-key',
      cwd: '/repo',
      logPath,
      parentThreadId: 'parent-thread',
      forkedFromId: null
    }
  )
  assert.equal(
    await discoverCodexThread('mko_handoff_fedcba9876543210', {
      sessionsDirectory: directory
    }),
    null
  )
})

test('rejects substring and ambiguous handoff-key matches', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-session-ambiguity-')
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const key = 'mko_handoff_0123456789abcdef'
  const firstPath = path.join(directory, 'first.jsonl')
  const secondPath = path.join(directory, 'second.jsonl')
  const record = (sessionId, message) => [
    JSON.stringify({
      type: 'session_meta',
      payload: { session_id: sessionId, cwd: '/repo' }
    }),
    JSON.stringify({ type: 'event_msg', payload: { message } })
  ].join('\n')
  await fs.writeFile(firstPath, record('thread-1', key))
  await fs.writeFile(secondPath, record('thread-2', `${key}extra`))
  assert.equal(
    (await discoverCodexThread(key, {
      sessionsDirectory: directory
    })).id,
    'thread-1'
  )

  await fs.writeFile(secondPath, record('thread-2', key))
  assert.equal(
    await discoverCodexThread(key, {
      sessionsDirectory: directory
    }),
    null
  )
})

test('explicit metadata overrides discovered values', async () => {
  const metadata = await discoverReviewMetadata({
    sourcePath: '/repo/plan.md',
    branch: 'explicit-branch',
    pullRequestNumber: 7,
    threadId: 'explicit-thread',
    handoffKey: 'mko_handoff_0123456789abcdef'
  }, {
    git: {
      async runGit(args) {
        return new Map([
          ['rev-parse --show-toplevel', '/repo'],
          ['symbolic-ref --quiet --short HEAD', 'discovered-branch'],
          ['rev-parse --verify HEAD', 'abc123']
        ]).get(args.join(' ')) || null
      }
    },
    codex: {
      sessionsDirectory: '/does/not/exist'
    }
  })

  assert.equal(metadata.git.branch, 'explicit-branch')
  assert.equal(metadata.git.sources.branch, 'explicit')
  assert.equal(metadata.git.commit, 'abc123')
  assert.deepEqual(metadata.agentThread, {
    provider: 'codex',
    id: 'explicit-thread',
    discovery: 'explicit'
  })
  assert.deepEqual(metadata.pullRequest, {
    number: 7,
    discovery: 'explicit'
  })
})

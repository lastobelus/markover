import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  claudeRequestingThreadIds,
  claudeThreadTitleSnapshot,
  readClaudeThreadTitles,
  resolveClaudeProjectsDirectory
} from '../src/claude-thread-titles'

function artifact(
  id: string,
  kind: string,
  provider: string,
  threadId?: string
): ReviewArtifact {
  return {
    review: {
      agentThread: {
        id,
        threadHost: {
          kind,
          provider,
          ...(threadId ? { threadId } : {})
        }
      }
    }
  } as unknown as ReviewArtifact
}

async function projectsRoot(t: test.TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-claude-title-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return directory
}

async function writeSession(
  directory: string,
  project: string,
  threadId: string,
  records: unknown[]
): Promise<string> {
  const projectDirectory = path.join(directory, project)
  await fs.mkdir(projectDirectory, { recursive: true })
  const logPath = path.join(projectDirectory, `${threadId}.jsonl`)
  await fs.writeFile(
    logPath,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
  )
  return logPath
}

test('Claude Code identities use provider-owned IDs for its host and T3 correlation', () => {
  assert.deepEqual(claudeRequestingThreadIds([
    artifact('claude-provider-1', 't3code', 'claude', 't3-host-1'),
    artifact('claude-provider-2', 'claude-code', 'kimi'),
    artifact('claude-provider-3', 't3code', 'claudeAgent', 't3-host-3'),
    artifact('ignored-provider', 't3code', 'codex', 't3-host-2'),
    artifact('ignored-product', 'claude-desktop', 'claude'),
    artifact('claude-provider-1', 'claude-code', 'claude')
  ]), ['claude-provider-1', 'claude-provider-2', 'claude-provider-3'])
})

test('exact-session artifacts return the last matching nonblank custom title', async (t) => {
  const directory = await projectsRoot(t)
  await writeSession(directory, 'project-a', 'current-session', [
    { type: 'user', sessionId: 'current-session', message: 'do not infer this' },
    { type: 'custom-title', sessionId: 'current-session', customTitle: ' Before rename ' },
    { type: 'custom-title', sessionId: 'other-session', customTitle: 'Wrong session' },
    { type: 'custom-title', sessionId: 'current-session', customTitle: '   ' },
    { type: 'custom-title', sessionId: 'current-session', customTitle: ' After rename ' }
  ])
  await writeSession(directory, 'project-a', 'blank-session', [
    { type: 'user', sessionId: 'blank-session' },
    { type: 'custom-title', sessionId: 'blank-session', customTitle: '   ' }
  ])

  assert.deepEqual(await readClaudeThreadTitles(directory, [
    'current-session',
    'blank-session',
    'current-session'
  ]), {
    status: 'available',
    detail: '1 Claude Code requesting-thread title available.',
    titles: [{ threadId: 'current-session', title: 'After rename' }]
  })
})

test('missing, malformed, mismatched, and ambiguous exact artifacts fail closed', async (t) => {
  const directory = await projectsRoot(t)
  assert.equal(
    (await readClaudeThreadTitles(directory, ['missing-session'])).status,
    'unavailable'
  )

  const malformedPath = await writeSession(directory, 'project-a', 'malformed-session', [
    { type: 'user', sessionId: 'malformed-session' }
  ])
  await fs.appendFile(malformedPath, '{not json}\n')
  assert.equal(
    (await readClaudeThreadTitles(directory, ['malformed-session'])).status,
    'unavailable'
  )

  await writeSession(directory, 'project-a', 'mismatched-session', [
    { type: 'custom-title', sessionId: 'different-session', customTitle: 'Wrong' }
  ])
  assert.equal(
    (await readClaudeThreadTitles(directory, ['mismatched-session'])).status,
    'unavailable'
  )

  await writeSession(directory, 'project-a', 'duplicate-session', [
    { type: 'user', sessionId: 'duplicate-session' }
  ])
  await writeSession(directory, 'project-b', 'duplicate-session', [
    { type: 'user', sessionId: 'duplicate-session' }
  ])
  assert.equal(
    (await readClaudeThreadTitles(directory, ['duplicate-session'])).status,
    'unavailable'
  )
})

test('disabled lookup reads nothing and unavailable sources recover on refresh', async (t) => {
  const missingDirectory = path.join(await projectsRoot(t), 'missing')
  const review = artifact('recovering-session', 'claude-code', 'claude')
  assert.deepEqual(await claudeThreadTitleSnapshot({
    claudeThreadTitlesEnabled: false
  }, [review], { projectsDirectory: missingDirectory }), {
    status: 'disabled',
    detail: 'Claude Code requesting-thread titles are disabled.',
    titles: []
  })

  assert.deepEqual(await claudeThreadTitleSnapshot({
    claudeThreadTitlesEnabled: true
  }, [review], { projectsDirectory: missingDirectory }), {
    status: 'unavailable',
    detail: 'Claude Code session artifacts are temporarily unavailable.',
    titles: []
  })

  await writeSession(missingDirectory, 'project-a', 'recovering-session', [
    { type: 'custom-title', sessionId: 'recovering-session', customTitle: 'Recovered rename' }
  ])
  assert.deepEqual(await claudeThreadTitleSnapshot({
    claudeThreadTitlesEnabled: true
  }, [review], { projectsDirectory: missingDirectory }), {
    status: 'available',
    detail: '1 Claude Code requesting-thread title available.',
    titles: [{ threadId: 'recovering-session', title: 'Recovered rename' }]
  })
})

test('Claude projects roots resolve without shell expansion', () => {
  assert.equal(
    resolveClaudeProjectsDirectory(),
    path.join(os.homedir(), '.claude', 'projects')
  )
  assert.equal(
    resolveClaudeProjectsDirectory('~/.claude-preview/projects'),
    path.join(os.homedir(), '.claude-preview', 'projects')
  )
})

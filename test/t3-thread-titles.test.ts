import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  DEFAULT_T3_METADATA_DATABASE_PATH,
  readT3ThreadTitles,
  resolveT3MetadataDatabasePath,
  t3RequestingThreadRequests,
  type T3ThreadTitleRequest,
  t3ThreadTitleSnapshot
} from '../src/t3-thread-titles'

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

function request(
  threadId: string,
  provider: 'codex' | 'claudeAgent' | null = null,
  providerSession = false
): T3ThreadTitleRequest {
  return { threadId, provider, providerSession }
}

test('T3 identities distinguish direct hosts from normalized provider sessions', () => {
  assert.deepEqual(t3RequestingThreadRequests([
    artifact('codex-session', 't3-code', 'codex', 't3-thread'),
    artifact('codex-session', 'T3Code', 'openai'),
    artifact('claude-session', 'T3Code', 'anthropic'),
    artifact('unknown-session', 'T3Code', 'other'),
    artifact('ignored-session', 'codex', 'codex'),
    artifact('t3-thread', 't3code', 'claude'),
    artifact('mixed-session', 't3code', 'codex'),
    artifact('mixed-session', 't3code', 'claude')
  ]), [
    request('t3-thread'),
    request('codex-session', 'codex', true),
    request('claude-session', 'claudeAgent', true),
    request('unknown-session', null, true),
    request('mixed-session', null, true)
  ])
})

test('T3 lookup resolves direct and exact provider identities and fails closed', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-t3-title-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const databasePath = path.join(directory, 'state.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      title TEXT,
      deleted_at TEXT
    );
    CREATE TABLE provider_session_runtime (
      thread_id TEXT PRIMARY KEY,
      provider_name TEXT NOT NULL,
      adapter_key TEXT NOT NULL,
      resume_cursor_json TEXT
    )
  `)
  const insertThread = database.prepare(`
    INSERT INTO projection_threads (thread_id, title, deleted_at)
    VALUES (?, ?, ?)
  `)
  insertThread.run('current-thread', 'Opening prompt', null)
  insertThread.run('codex-host', 'Codex T3 title', null)
  insertThread.run('claude-host', 'Claude T3 title', null)
  insertThread.run('direct-collision', 'Direct title', null)
  insertThread.run('collision-target', 'Cursor collision title', null)
  insertThread.run('blank-direct', '   ', null)
  insertThread.run('blank-collision-target', 'Should not replace blank direct', null)
  insertThread.run('ambiguous-a', 'Ambiguous A', null)
  insertThread.run('ambiguous-b', 'Ambiguous B', null)
  insertThread.run('deleted-target', 'Deleted target', '2026-08-15T00:00:00Z')
  insertThread.run('wrong-adapter-target', 'Wrong adapter', null)
  insertThread.run('malformed-target', 'Malformed cursor', null)
  insertThread.run('explicit-target', 'Must not fall through', null)
  const insertRuntime = database.prepare(`
    INSERT INTO provider_session_runtime (
      thread_id, provider_name, adapter_key, resume_cursor_json
    ) VALUES (?, ?, ?, ?)
  `)
  insertRuntime.run(
    'codex-host',
    'codex',
    'codex',
    JSON.stringify({ threadId: 'codex-session' })
  )
  insertRuntime.run(
    'claude-host',
    'claudeAgent',
    'claudeAgent',
    JSON.stringify({ threadId: 'wrong-claude-session', resume: 'claude-session' })
  )
  insertRuntime.run(
    'collision-target',
    'codex',
    'codex',
    JSON.stringify({ threadId: 'direct-collision' })
  )
  insertRuntime.run(
    'blank-collision-target',
    'codex',
    'codex',
    JSON.stringify({ threadId: 'blank-direct' })
  )
  insertRuntime.run(
    'ambiguous-a',
    'codex',
    'codex',
    JSON.stringify({ threadId: 'ambiguous-session' })
  )
  insertRuntime.run(
    'ambiguous-b',
    'codex',
    'codex',
    JSON.stringify({ threadId: 'ambiguous-session' })
  )
  insertRuntime.run(
    'deleted-target',
    'codex',
    'codex',
    JSON.stringify({ threadId: 'deleted-session' })
  )
  insertRuntime.run(
    'wrong-adapter-target',
    'codex',
    'claudeAgent',
    JSON.stringify({ threadId: 'wrong-adapter-session' })
  )
  insertRuntime.run('malformed-target', 'codex', 'codex', '{not-json')
  insertRuntime.run(
    'explicit-target',
    'codex',
    'codex',
    JSON.stringify({ threadId: 'explicit-host-missing' })
  )
  database.prepare(`
    UPDATE projection_threads SET title = ? WHERE thread_id = ?
  `).run('Completed rename', 'current-thread')
  database.close()

  assert.deepEqual(readT3ThreadTitles(databasePath, [
    request('current-thread'),
    request('codex-session', 'codex', true),
    request('claude-session', 'claudeAgent', true),
    request('direct-collision', 'codex', true),
    request('blank-direct', 'codex', true),
    request('ambiguous-session', 'codex', true),
    request('deleted-session', 'codex', true),
    request('wrong-adapter-session', 'codex', true),
    request('wrong-claude-session', 'claudeAgent', true),
    request('malformed-session', 'codex', true),
    request('unknown-session', null, true),
    request('explicit-host-missing'),
    request('missing-thread')
  ]), {
    status: 'available',
    detail: '4 requesting-thread titles available.',
    titles: [
      { threadId: 'current-thread', title: 'Completed rename' },
      { threadId: 'codex-session', title: 'Codex T3 title' },
      { threadId: 'claude-session', title: 'Claude T3 title' },
      { threadId: 'direct-collision', title: 'Direct title' }
    ]
  })
})

test('disabled and failed T3 sources return honest empty snapshots', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-t3-title-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const missingPath = path.join(directory, 'missing.sqlite')

  assert.deepEqual(t3ThreadTitleSnapshot({
    t3ThreadTitlesEnabled: false,
    t3MetadataDatabasePath: missingPath
  }, [artifact('t3-thread', 't3code', 'codex')]), {
    status: 'disabled',
    detail: 'T3 requesting-thread titles are disabled.',
    titles: []
  })
  assert.equal(await fs.access(missingPath).then(() => true, () => false), false)

  const unavailable = t3ThreadTitleSnapshot({
    t3ThreadTitlesEnabled: true,
    t3MetadataDatabasePath: missingPath
  }, [artifact('t3-thread', 't3code', 'codex')])
  assert.deepEqual(unavailable, {
    status: 'unavailable',
    detail: 'T3 metadata is temporarily unavailable.',
    titles: []
  })
  assert.doesNotMatch(unavailable.detail, /missing\.sqlite/)

  const database = new DatabaseSync(missingPath)
  database.exec(`
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      title TEXT,
      deleted_at TEXT
    );
    INSERT INTO projection_threads VALUES (
      't3-thread',
      'Recovered title',
      NULL
    );
  `)
  database.close()
  assert.deepEqual(t3ThreadTitleSnapshot({
    t3ThreadTitlesEnabled: true,
    t3MetadataDatabasePath: missingPath
  }, [artifact('t3-thread', 't3code', 'codex')]), {
    status: 'available',
    detail: '1 requesting-thread title available.',
    titles: [{ threadId: 't3-thread', title: 'Recovered title' }]
  })

  const malformedPath = path.join(directory, 'malformed.sqlite')
  await fs.writeFile(malformedPath, 'not a sqlite database', 'utf8')
  assert.equal(
    readT3ThreadTitles(malformedPath, [request('t3-thread')]).status,
    'unavailable'
  )
})

test('T3 metadata path uses the documented default and expands overrides', () => {
  assert.equal(
    DEFAULT_T3_METADATA_DATABASE_PATH,
    path.join(os.homedir(), '.t3', 'userdata', 'state.sqlite')
  )
  assert.equal(resolveT3MetadataDatabasePath(''), DEFAULT_T3_METADATA_DATABASE_PATH)
  assert.equal(
    resolveT3MetadataDatabasePath('~/.t3/alternate.sqlite'),
    path.join(os.homedir(), '.t3', 'alternate.sqlite')
  )
})

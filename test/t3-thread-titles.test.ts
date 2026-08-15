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
  t3RequestingThreadIds,
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

test('T3 identities use host kind plus host ID or agent-session fallback', () => {
  assert.deepEqual(t3RequestingThreadIds([
    artifact('codex-session', 't3-code', 'codex', 't3-thread'),
    artifact('fallback-session', 'T3Code', 'claude'),
    artifact('ignored-session', 'codex', 'codex'),
    artifact('duplicate-session', 't3code', 'codex', 't3-thread')
  ]), ['t3-thread', 'fallback-session'])
})

test('read-only T3 query returns current nondeleted nonblank titles', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-t3-title-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const databasePath = path.join(directory, 'state.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      title TEXT,
      deleted_at TEXT
    )
  `)
  const insert = database.prepare(`
    INSERT INTO projection_threads (thread_id, title, deleted_at)
    VALUES (?, ?, ?)
  `)
  insert.run('current-thread', 'Opening prompt', null)
  insert.run('deleted-thread', 'Deleted title', '2026-08-15T00:00:00Z')
  insert.run('blank-thread', '   ', null)
  database.prepare(`
    UPDATE projection_threads SET title = ? WHERE thread_id = ?
  `).run('Completed rename', 'current-thread')
  database.close()

  assert.deepEqual(readT3ThreadTitles(databasePath, [
    'current-thread',
    'deleted-thread',
    'blank-thread',
    'missing-thread'
  ]), {
    status: 'available',
    detail: '1 requesting-thread title available.',
    titles: [{ threadId: 'current-thread', title: 'Completed rename' }]
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
  assert.equal(readT3ThreadTitles(malformedPath, ['t3-thread']).status, 'unavailable')
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

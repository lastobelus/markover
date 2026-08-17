import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  codexRequestingThreadIds,
  codexThreadTitleSnapshot,
  readCodexThreadTitles,
  resolveCodexExecutable
} from '../src/codex-thread-titles'

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

async function fakeCodex(
  t: test.TestContext,
  behavior: 'normal' | 'malformed' | 'silent' = 'normal'
): Promise<{ executable: string; logPath: string }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-codex-title-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const executable = path.join(directory, 'fake-codex')
  const logPath = path.join(directory, 'requests.jsonl')
  const source = `#!/usr/bin/env node
const fs = require('node:fs')
const readline = require('node:readline')
const logPath = ${JSON.stringify(logPath)}
const behavior = ${JSON.stringify(behavior)}
const lines = readline.createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  fs.appendFileSync(logPath, JSON.stringify(message) + '\\n')
  if (behavior === 'silent') return
  if (behavior === 'malformed') {
    process.stdout.write('not-json\\n')
    return
  }
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n')
    return
  }
  if (message.method !== 'thread/read') return
  const threadId = message.params.threadId
  if (threadId === 'missing-thread') {
    process.stdout.write(JSON.stringify({
      id: message.id,
      error: { code: -32600, message: 'thread not loaded: missing-thread' }
    }) + '\\n')
    return
  }
  const names = {
    'current-thread': ' Completed Codex rename ',
    'blank-thread': '   '
  }
  process.stdout.write(JSON.stringify({
    id: message.id,
    result: {
      thread: {
        id: threadId,
        name: Object.hasOwn(names, threadId) ? names[threadId] : null
      }
    }
  }) + '\\n')
})
`
  await fs.writeFile(executable, source, { mode: 0o755 })
  return { executable, logPath }
}

test('Codex identities use provider-owned IDs only for the Codex provider', () => {
  assert.deepEqual(codexRequestingThreadIds([
    artifact('codex-provider-1', 't3code', 'codex', 't3-host-1'),
    artifact('codex-provider-2', 'codex', 'Codex'),
    artifact('codex-provider-3', 't3code', 'OpenAI', 't3-host-3'),
    artifact('ignored-provider', 't3code', 'claude', 't3-host-2'),
    artifact('codex-provider-1', 'codex', 'codex')
  ]), ['codex-provider-1', 'codex-provider-2', 'codex-provider-3'])
})

test('exact-ID app-server reads return renamed nonblank Codex titles', async (t) => {
  const { executable, logPath } = await fakeCodex(t)
  assert.deepEqual(await readCodexThreadTitles(executable, [
    'current-thread',
    'blank-thread',
    'missing-thread',
    'current-thread'
  ]), {
    status: 'available',
    detail: '1 Codex requesting-thread title available.',
    titles: [{ threadId: 'current-thread', title: 'Completed Codex rename' }]
  })

  const requests = (await fs.readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  assert.deepEqual(
    requests.map((request) => request.method),
    ['initialize', 'initialized', 'thread/read', 'thread/read', 'thread/read']
  )
  assert.deepEqual(
    requests.filter((request) => request.method === 'thread/read')
      .map((request) => request.params),
    [
      { threadId: 'current-thread', includeTurns: false },
      { threadId: 'blank-thread', includeTurns: false },
      { threadId: 'missing-thread', includeTurns: false }
    ]
  )
})

test('disabled, unavailable, malformed, and recovered Codex sources are honest', async (t) => {
  const review = artifact('current-thread', 'codex', 'codex')
  const missingExecutable = path.join(os.tmpdir(), 'missing-markover-codex')
  assert.deepEqual(await codexThreadTitleSnapshot({
    codexThreadTitlesEnabled: false,
    codexExecutablePath: missingExecutable
  }, [review]), {
    status: 'disabled',
    detail: 'Codex requesting-thread titles are disabled.',
    titles: []
  })

  assert.deepEqual(await codexThreadTitleSnapshot({
    codexThreadTitlesEnabled: true,
    codexExecutablePath: missingExecutable
  }, [review]), {
    status: 'unavailable',
    detail: 'Codex app-server is temporarily unavailable.',
    titles: []
  })

  const malformed = await fakeCodex(t, 'malformed')
  assert.equal((await codexThreadTitleSnapshot({
    codexThreadTitlesEnabled: true,
    codexExecutablePath: malformed.executable
  }, [review])).status, 'unavailable')

  const recovered = await fakeCodex(t)
  assert.deepEqual(await codexThreadTitleSnapshot({
    codexThreadTitlesEnabled: true,
    codexExecutablePath: recovered.executable
  }, [review]), {
    status: 'available',
    detail: '1 Codex requesting-thread title available.',
    titles: [{ threadId: 'current-thread', title: 'Completed Codex rename' }]
  })
})

test('a stalled app-server becomes unavailable within the configured bound', async (t) => {
  const { executable } = await fakeCodex(t, 'silent')
  const startedAt = Date.now()
  const snapshot = await readCodexThreadTitles(
    executable,
    ['current-thread'],
    { timeoutMs: 25 }
  )
  assert.equal(snapshot.status, 'unavailable')
  assert.ok(Date.now() - startedAt < 1_000)
})

test('Codex executable overrides expand without introducing shell arguments', () => {
  assert.equal(resolveCodexExecutable(''), 'codex')
  assert.equal(resolveCodexExecutable('codex-preview'), 'codex-preview')
  assert.equal(
    resolveCodexExecutable('~/.local/bin/codex'),
    path.join(os.homedir(), '.local', 'bin', 'codex')
  )
})

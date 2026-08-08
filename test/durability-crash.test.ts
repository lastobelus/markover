import assert from 'node:assert/strict'
import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { ReviewStore } from '../src/review-store'

interface DurableMessage {
  type: 'durable'
  attachmentContents: string
  autosaveDelayMs: number
  editingElapsedMs: number
  editingId: string
  pendingId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isDurableMessage(value: unknown): value is DurableMessage {
  return isRecord(value) &&
    value.type === 'durable' &&
    typeof value.attachmentContents === 'string' &&
    typeof value.autosaveDelayMs === 'number' &&
    typeof value.editingElapsedMs === 'number' &&
    typeof value.editingId === 'string' &&
    typeof value.pendingId === 'string'
}

function childOutput(child: ChildProcess): () => string {
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  return () => output.trim()
}

function waitForDurableMessage(
  child: ChildProcess,
  output: () => string
): Promise<DurableMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Crash fixture timed out. ${output()}`.trim()))
    }, 5000)
    const finish = (operation: () => void): void => {
      clearTimeout(timeout)
      child.off('exit', onExit)
      child.off('error', onError)
      child.off('message', onMessage)
      operation()
    }
    const onError = (error: Error): void => {
      finish(() => { reject(error) })
    }
    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null
    ): void => {
      finish(() => {
        reject(new Error(
          `Crash fixture exited before persistence: ${String(code)}/${String(signal)}. ${output()}`.trim()
        ))
      })
    }
    const onMessage = (message: unknown): void => {
      if (isDurableMessage(message)) {
        finish(() => { resolve(message) })
        return
      }
      if (isRecord(message) && message.type === 'error') {
        finish(() => { reject(new Error(String(message.message))) })
      }
    }
    child.once('error', onError)
    child.once('exit', onExit)
    child.on('message', onMessage)
  })
}

function waitForExit(child: ChildProcess): Promise<{
  code: number | null
  signal: NodeJS.Signals | null
}> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => { resolve({ code, signal }) })
  })
}

function firstChild(tree: ReviewTree): ReviewNode {
  const node = tree.root.children[0]
  assert.ok(node)
  return node
}

test('a killed process restores rapid edits, inflight state, attachments, and reviews', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-crash-evidence-')
  )
  const fixturePath = path.join(
    __dirname,
    'fixtures',
    'durability-crash-child.js'
  )
  const child = fork(fixturePath, [directory], {
    silent: true
  })
  const output = childOutput(child)
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = waitForExit(child)
      child.kill('SIGKILL')
      await exit
    }
    await fs.rm(directory, { recursive: true, force: true })
  })

  const message = await waitForDurableMessage(child, output)
  assert.ok(
    message.editingElapsedMs <= message.autosaveDelayMs + 900,
    `Latest editing snapshot took ${String(message.editingElapsedMs)}ms to persist.`
  )

  const exit = waitForExit(child)
  assert.equal(child.kill('SIGKILL'), true)
  assert.deepEqual(await exit, { code: null, signal: 'SIGKILL' })

  const restoredStore = new ReviewStore(directory)
  const restored = await restoredStore.list()
  assert.deepEqual(
    restored.map((artifact) => artifact.review.id),
    [message.editingId, message.pendingId]
  )

  const editing = await restoredStore.load(message.editingId)
  const editingHeading = firstChild(editing)
  assert.equal(editing.review.status, 'editing')
  assert.equal(editingHeading.feedback, 'Latest editing feedback with [!img-1].')
  const attachments = editingHeading.attachments
  assert.equal(attachments?.length, 1)
  const attachment = attachments[0]
  assert.ok(attachment?.path)
  assert.equal(await fs.readFile(attachment.path, 'utf8'), message.attachmentContents)

  const pending = await restoredStore.load(message.pendingId)
  assert.equal(pending.review.status, 'pending-agent')
  assert.equal(
    firstChild(pending).feedback,
    'Latest feedback handed to the agent.'
  )
})

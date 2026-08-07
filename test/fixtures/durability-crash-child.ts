import { ReviewAutosave } from '../../src/review-autosave'
import { ReviewStore, type ReviewArtifact } from '../../src/review-store'

const { parseMarkdown } = require('../../src/tree') as MarkoverTreeApi

const AUTOSAVE_DELAY_MS = 100
const EDITING_ID = 'mko_crash001'
const PENDING_ID = 'mko_crash002'
const ATTACHMENT_CONTENTS = 'durable attachment bytes'
const EDITING_FEEDBACK = 'Latest editing feedback with [!img-1].'
const PENDING_FEEDBACK = 'Latest feedback handed to the agent.'

function tree(source: string): ReviewTree {
  return parseMarkdown(source, 'sha256:crash-evidence', {
    name: 'crash-evidence.md',
    path: '/tmp/crash-evidence.md'
  })
}

function annotated(
  artifact: ReviewArtifact,
  feedback: string,
  attachment?: ReviewAttachment
): ReviewTree {
  const snapshot: ReviewTree = structuredClone(artifact)
  const heading = snapshot.root.children[0]
  if (!heading) throw new Error('Crash fixture review is missing its heading.')
  heading.feedback = feedback
  if (attachment) heading.attachments = [attachment]
  return snapshot
}

async function run(): Promise<void> {
  const directory = process.argv[2]
  if (!directory) throw new Error('Crash fixture requires a review directory.')
  const ids = [EDITING_ID, PENDING_ID]
  const store = new ReviewStore(directory, {
    idFactory: () => {
      const id = ids.shift()
      if (!id) throw new Error('Crash fixture exhausted its review IDs.')
      return id
    }
  })
  const editing = await store.create({
    tree: tree('# Editing review\n'),
    contextSummary: 'Crash evidence for an editing review.'
  })
  const pending = await store.create({
    tree: tree('# Agent review\n'),
    contextSummary: 'Crash evidence for an inflight agent review.'
  })

  let resolveEditing!: (elapsedMs: number) => void
  const editingDurable = new Promise<number>((resolve) => {
    resolveEditing = resolve
  })
  let latestEditingQueuedAt = Number.POSITIVE_INFINITY
  const autosave = new ReviewAutosave(store, {
    maximumDelayMs: AUTOSAVE_DELAY_MS,
    onSaved(artifact) {
      const heading = artifact.root.children[0]
      if (
        artifact.review.id === EDITING_ID &&
        heading?.feedback === EDITING_FEEDBACK
      ) {
        resolveEditing(performance.now() - latestEditingQueuedAt)
      }
    }
  })

  for (let edit = 0; edit < 40; edit += 1) {
    autosave.queue(
      EDITING_ID,
      annotated(editing, `Superseded editing feedback ${String(edit)}.`)
    )
    autosave.queue(
      PENDING_ID,
      annotated(pending, `Superseded agent feedback ${String(edit)}.`)
    )
  }

  const savedAttachment = await store.saveAttachmentFile(
    EDITING_ID,
    'txt',
    Buffer.from(ATTACHMENT_CONTENTS)
  )
  latestEditingQueuedAt = performance.now()
  autosave.queue(EDITING_ID, annotated(editing, EDITING_FEEDBACK, {
    id: savedAttachment.id,
    label: 'Crash evidence attachment',
    path: savedAttachment.path
  }))

  await autosave.saveNow(PENDING_ID, annotated(pending, PENDING_FEEDBACK))
  await store.handoff(PENDING_ID)
  const editingElapsedMs = await editingDurable

  process.send?.({
    type: 'durable',
    autosaveDelayMs: AUTOSAVE_DELAY_MS,
    editingElapsedMs,
    editingId: EDITING_ID,
    pendingId: PENDING_ID,
    attachmentContents: ATTACHMENT_CONTENTS
  })

  setInterval(() => {}, 60_000)
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  process.send?.({ type: 'error', message })
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})

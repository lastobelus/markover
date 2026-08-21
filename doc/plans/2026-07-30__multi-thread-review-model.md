# Multi-thread review model

## Goal

Turn Markover from a blocking review command into a local review inbox that
supports several agent threads at once.

The interaction should not require agent polling or manual JSON transfer. An
agent opens a document, retains the returned review identifier in its thread,
and retrieves the review with one command after the user says, "Check
Markover."

## Current baseline

Markover already parses an exact Markdown snapshot into a deterministic review
tree, stores feedback and attachments on block nodes, and can copy the complete
tree as JSON.

Durable dogfooding reviews currently run as independent user `launchd` jobs and
atomically autosave to `.markover/reviews/<review-id>/review.json`. A killed
Electron or agent process can resume the saved tree by review ID. The
multi-thread model should preserve that durability while replacing separate
windows with one application-level review registry.

## Primary workflow

```text
Agent: markover open ./DECISIONS.md --summary "Review the prototype decisions before implementing multi-document handoff."
Output: {"reviewId":"mko_8f3a2c"}

User annotates the document in Markover.

User: "Check Markover."

Agent: markover get mko_8f3a2c
Output: complete markover-review JSON

User: "Wait—I need to add something. Put it back in editing."

Agent: markover edit mko_8f3a2c
Output: {"reviewId":"mko_8f3a2c","status":"editing"}
```

`markover open` should return as soon as the document has been registered and
shown in the existing Markover instance. `markover get` should be a one-shot
local request, not a blocking wait or a polling loop.

The `get` operation should atomically capture the current tree, change its
status from `editing` to `pending-agent`, freeze its annotations, and return the
complete review JSON. Repeating `get` should return the same frozen snapshot so
agent retries are safe.

`markover edit <id>` should idempotently transition `pending-agent` back to
`editing` and make annotations editable again. This supports mistakes and
afterthoughts. It cannot recall work the agent has already performed from an
older snapshot, so the user should also tell the agent thread to pause.

There should not be a separate Ready button in the first cut. The user's
instruction to the agent is the human handoff, and the agent's `get` command is
the state transition.

## Review identity

A review identifier represents one review session, not one source document.
Opening the same file twice should produce two identifiers because the reviews
may belong to different branches, pull requests, agent threads, or purposes.

Use a short opaque identifier such as `mko_8f3a2c`. Do not derive it solely from
the source checksum.

The source checksum continues to identify the exact Markdown snapshot, while
the pair of `reviewId` and block ID identifies a particular annotation in a
particular review.

After the first cut, register links such as
`markover://review/mko_8f3a2c`. The opening agent can emit this link so a user
returning to an old thread can select its review without finding the right tab
manually.

## Review metadata

Metadata belongs to the review envelope rather than the deterministic document
tree. The tree should remain focused on the exact source, its structure, and
annotations.

A first-cut envelope could contain:

```json
{
  "review": {
    "id": "mko_8f3a2c",
    "status": "editing",
    "createdAt": "2026-07-30T22:00:00.000Z",
    "contextSummary": "Review the prototype decisions before implementing multi-document handoff.",
    "agentThread": {
      "provider": "codex",
      "id": "019fb49a-a321-75d3-9b10-355392949bb1",
      "discovery": "handoff-key"
    },
    "git": {
      "repositoryUrl": "https://github.com/example/markover",
      "branch": "feature/multi-review",
      "commit": "abc123"
    },
    "pullRequest": {
      "number": 42,
      "url": "https://github.com/example/markover/pull/42"
    }
  },
  "sourceDocument": {},
  "unsupported": [],
  "root": {}
}
```

All metadata fields except the review ID, status, and context summary may be
unknown. Missing discovery should not prevent opening a review.

The context summary should be short Markdown written by the launching agent. It
should explain why the document exists, why it is being reviewed, and any
context that will help the reviewer make useful comments. It should not attempt
to reproduce the entire agent thread.

## Metadata collection

Prefer explicit metadata when the launching agent knows it:

```text
markover open ./DECISIONS.md \
  --summary "Review the handoff model before implementation." \
  --branch feature/multi-review \
  --pr 42 \
  --thread-id 019fb49a-a321-75d3-9b10-355392949bb1
```

Markover can fill straightforward Git metadata from the source document's
working directory. Pull-request discovery can initially remain explicit; an
optional `gh pr view` lookup can be added after the core workflow is proven.

The agent thread ID may not be available to the shell process. For Codex, a
best-effort handoff-key mechanism appears viable:

1. The launching agent includes a unique handoff key in the `markover open`
   command.
2. Markover searches recent canonical Codex session logs for that exact key.
3. It reads the `session_meta` record from the matching JSONL file.
4. It records the session ID and how it was discovered.

Canonical logs under `~/.codex/sessions/YYYY/MM/DD/*.jsonl` currently begin
with a `session_meta` record containing `payload.session_id`, `payload.cwd`, and
often `payload.git`. Subagent records may additionally contain
`parent_thread_id` and `forked_from_id`.

Automatic log discovery should be a separate, best-effort adapter. The review
protocol should accept explicit metadata and should not depend on the current
Codex log format.

## Single-instance transport

Use one Electron instance with a small loopback JSON service.

- `markover open` starts Markover when necessary, submits the source and
  metadata, and receives a review ID.
- `markover get <id>` makes one request to the existing instance.
- `markover edit <id>` returns a handed-off review to editing.
- Electron's single-instance lock prevents separate review windows from being
  created for each agent thread.
- Startup retries may happen inside the CLI process without consuming
  additional agent turns.

The main process should own a disk-backed registry of review sessions and keep
their latest trees synchronized with the renderer. The local service can then
return a consistent snapshot without asking the visible renderer to serialize
state during handoff. Memory may cache active sessions, but the autosaved review
file is authoritative for recovery.

## Multiple-document UI

Add a compact document tab strip below the app header. Each tab should
show only the information needed for switching and status recognition:

```text
DECISIONS.md · 8f3a2c    Editing
sample.md · a91d0e       With agent
```

The active tab selects which document tree in the center pane and annotation
views in the right pane are visible.
Each review retains its own selected block, collapse state, annotations, and
attachments.

The tab does not need to display the branch, pull request, thread ID, and
context summary. An information button in the document header should open a
review-context drawer for the active tab.

A drawer is preferable to a modal or small popup because it can display a
summary, paths, Git details, pull-request links, and thread provenance without
interrupting block navigation or requiring cramped content.

## Pending-agent state

Use `pending-agent` internally and display `WITH AGENT · READ ONLY` in the UI.
This communicates who currently has responsibility more clearly than the word
"pending."

When a review enters this state:

- The tab shows a distinct status badge.
- The right pane receives a muted treatment, while the document tree
  retains its normal navigational colors.
- The textarea is replaced with rendered feedback.
- Pasting, attachment removal, and attachment label editing are disabled.
- Block navigation, collapsing, raw source, thumbnails, and image preview
  remain available.
- The right pane header or a compact strip clearly says
  `WITH AGENT · READ ONLY`.

Do not change the color scheme of the entire application because other tabs may
still be editable. A watermark can be reconsidered only if the explicit status
and localized muted treatment are insufficient during dogfooding.

## Decisions to change now

1. Replace the blocking review command with non-blocking `open` and one-shot
   `get` commands.
2. Replace the single current document with a registry keyed by review ID.
3. Unify ordinary and review modes into one multi-document application.
4. Stop treating Done as an application-exit operation. Agent retrieval freezes
   only the requested review.
5. Make attachment directories belong to review IDs rather than application
   runs.
6. Keep clipboard JSON as a supported manual and clean-context workflow, but do
   not require it for the normal same-thread handoff.
7. Keep the main process synchronized with the latest state of every review so
   handoff is immediate and consistent.

## Decisions to keep

1. Retain the exact Markdown source and checksum in every review.
2. Keep deterministic block IDs scoped to an exact source snapshot.
3. Store feedback and attachment metadata directly on tree nodes.
4. Keep image bytes outside JSON and expose ordinary local paths.
5. Do not match blocks across document revisions yet.
6. Keep one feedback value per block; `reviewId` plus block ID is sufficient to
   associate a later agent response.
7. Keep the current limited Markdown node support while the handoff workflow is
   being tested.
8. Keep strict machine-readable stdout for agent-facing CLI commands.

## Future agent writeback

A later command could accept an agent result:

```text
markover resolve mko_8f3a2c < agent-result.json
```

That operation would transition the review to `addressed` and attach an outcome
to each original annotated block. The original source and review tree should
remain immutable.

The result may separately contain a revised document snapshot, its checksum,
the current actual document path, and a concise explanation of what the agent
did with each annotation. This avoids solving cross-version block matching
before it is needed.

The existing autosave files provide the persistence foundation. A later history
model can organize original reviews, agent responses, revised snapshots, and
links to the current document without changing the review identity model.

## First-cut implementation plan

### 1. Session model and tests

Create a pure, disk-backed review-session registry with:

- Opaque review IDs
- The metadata envelope
- `editing` and `pending-agent` states
- Multiple simultaneous reviews
- Idempotent `get` and `edit` transitions
- Atomic autosave and process-crash restoration

Test this independently of Electron and the UI.

### 2. Local service and CLI

Add the single-instance loopback service and implement:

- `markover open <path> --summary <text>`
- `markover get <review-id>`
- `markover edit <review-id>`
- Automatic application startup for `open`
- Strict JSON stdout and useful non-zero failures

Prove one complete open/annotate/get flow before changing the layout.

### 3. Multi-document tabs

Replace the renderer's singleton document state with per-review state and add a
minimal tab strip. Verify switching among at least three reviews preserves
selection, collapsed nodes, feedback, and attachments.

### 4. Pending-agent UI

Connect `get` to the renderer state transition. Add the tab badge, localized
muted treatment, read-only rendered annotations, and disabled mutation
controls. Verify that navigation and image viewing still work.

### 5. Metadata and context drawer

Accept summary, branch, pull request, and thread metadata through the CLI. Add
the review-context drawer without placing all metadata in the tab strip or
primary document header. Add discovery adapters independently:

1. Git branch, commit, repository, and working-directory discovery
2. Codex session discovery through an explicit handoff key
3. Optional pull-request discovery

Every discovered value should record its source, and discovery failure should
degrade to an unknown field rather than block the review.

### 6. Dogfood and harden the protocol

Run several real agent threads against one Markover instance. Revisit:

- Whether `get` and `edit` provide sufficient handoff control
- Whether the pending treatment is unmistakable
- Whether review IDs are easy to retain and recognize
- Whether context summaries are consistently useful
- Whether automatic thread discovery is reliable enough to keep
- Which parts of the autosave envelope should become the history format

## Post-first-cut extensions

### Review deep links

Register a `markover://review/<id>` URL scheme and include the link in
`markover open` output. Clicking it should bring the single Markover instance
forward and select the identified review.

### Manual document opening

Add File → Open and a file picker for reviews initiated by the user rather than
an agent. This path supports annotating a document and copying the complete JSON
into a clean-context agent request.

Manually opened documents should autosave beside the Markdown source rather
than only in Markover's internal review directory.

### Git-friendly review files

Design a predictable sidecar structure for review JSON and attachments so the
user can choose to commit reviews as decision records. The convention should:

- Keep each source document's reviews easy to find
- Support several reviews of the same source
- Keep attachments next to their owning review
- Avoid accidental source-document modification
- Make ignored ephemeral reviews and committed durable reviews easy to
  distinguish

Choose the exact file and directory names through dogfooding before treating
them as a stable format.

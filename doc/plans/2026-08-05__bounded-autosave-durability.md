# Bounded autosave durability

Status: accepted for implementation on issue [#39](https://github.com/lastobelus/markover/issues/39). This plan describes a three-PR stack in the Focused preview launch gate. The first PR is `agent/autosave-bounded-core`; later branches add application shutdown barriers and crash evidence.

## Outcome

With default configuration, a responsive Markover process and healthy local storage never leave more than two seconds of accepted review work outside the durable managed-review snapshot. Sustained typing cannot build an unbounded persistence queue. Handoff and graceful shutdown use explicit barriers rather than waiting for the ordinary autosave cadence.

The guarantee covers Markover process crashes and normal restarts. It does not claim durability through disk failure, operating-system failure, hardware failure, or power loss. Markover reports when storage errors suspend the guarantee.

## Accepted product contract

- `autosaveMaximumDelayMs` defaults to `2000` and accepts whole numbers from `100` through `60000` in the persisted settings file.
- The override is intentionally absent from the Settings UI, takes effect after restart, and changes the user's maximum-loss window.
- Each managed review has an independent leading-and-trailing throttle. The first change after an idle window writes promptly; later changes replace the pending snapshot and cannot postpone the trailing write beyond the configured window.
- At most one managed-review snapshot write per review is in flight. A slow review cannot delay another review.
- A failed write retains the newest snapshot, retries with exponential backoff capped at 30 seconds, and keeps the storage failure observable until a current snapshot succeeds.
- Attachment bytes become durable before their marker or metadata can become durable. Interrupted work may leave an orphan file but never a persisted reference to missing bytes.
- Handoff and reopen transitions persist their exact snapshot and status before acknowledging success. The transient `handoff-in-progress` renderer state is never stored.
- Graceful shutdown stops new service mutations, snapshots every loaded editable review, waits for attachment mutations and persistence, closes the service, and then quits.
- A five-second shutdown failure cancels the quit and offers Retry Quit or Quit Anyway. Quit Anyway falls back to the latest bounded autosave.

## Existing system

The renderer emits `review:autosave` on each input and relevant state change. `main.ts` currently calls `ReviewStore.updateTree` for each event. `ReviewStore.serialize` preserves order by queuing every operation for a review, so rapid edits create one full read, validation, flushed temporary-file write, and rename per snapshot.

The replacement-file write itself is already atomic and flushed. Managed reviews already restore from `~/Library/Application Support/Markover/reviews/`. The missing pieces are latest-state coalescing, a managed-review flush API, failure visibility, shutdown coordination, and proof of the loss bound.

## PR 1 — bounded autosave core

Introduce a managed-review autosave coordinator at the persistence boundary. It receives immutable IPC snapshots, retains only the latest pending snapshot per review, owns scheduling and retries, and delegates actual validation and atomic replacement to `ReviewStore`.

The coordinator exposes two paths:

1. `queue(reviewId, tree)` is fire-and-forget autosave input. It starts an eligible leading write or replaces the review's pending trailing snapshot.
2. `saveNow(reviewId, tree)` supersedes pending autosave state, waits behind any in-flight write for that review, persists the exact supplied snapshot, and resolves only when that snapshot is durable. Later PRs use this primitive for handoff and shutdown barriers.

Scheduling uses an injected clock and timer surface in tests. Production uses monotonic elapsed time for deadlines and ordinary timers for wakeups. Wall-clock changes cannot extend a pending durability deadline.

The coordinator reports transitions into and out of storage failure through callbacks. PR 1 keeps the current stderr diagnostic at the application boundary; PR 2 turns the same state into persistent renderer UX without changing the storage core.

Add `autosaveMaximumDelayMs` to settings normalization and the shared settings contract. Invalid, fractional, or out-of-range values normalize to `2000`. The running coordinator reads the value once during application startup.

Wire managed renderer autosaves through the coordinator. Preserve unmanaged one-document review-mode autosaving, whose existing writer already coalesces to the latest pending JSON string.

## PR 1 invariants

- A review has no more than one write in flight and one pending snapshot.
- A newer snapshot always supersedes an older pending snapshot.
- A leading write begins immediately when the review has been idle for at least the configured window.
- While changes continue, the latest eligible trailing write begins no later than the configured deadline when storage is healthy and the previous write has completed.
- When a write exceeds the configured window, the latest pending snapshot begins immediately after it completes; writes for the same review never overlap.
- Failed writes never erase newer pending state.
- Independent review IDs use independent schedules and write chains.
- Exact `saveNow` work cannot be followed by a stale scheduled snapshot.

## PR 1 verification

Use fake time and controllable deferred writers. Do not wait for the real two-second window in ordinary tests.

- Isolated edits exercise leading writes.
- Rapid edits prove intermediate snapshots are dropped and the newest snapshot becomes the trailing write.
- A slow in-flight write proves there is only one pending latest snapshot.
- Two review IDs prove scheduling and failures are isolated.
- Write failure tests prove latest-state retention, retry backoff, the 30-second cap, and recovery notification.
- `saveNow` tests prove pending snapshots are superseded and barriers resolve only after the exact snapshot succeeds.
- Settings tests prove the default, accepted range, invalid fallback, persistence, and absence of a UI control.

The added ordinary test time should remain below two seconds per Node CI lane. Run `npm run check`, `npm test`, the local macOS package build, and signature verification before publishing the PR.

## PR 2 — application durability barriers

Build on the core coordinator to flush exact handoff and reopen states, coordinate renderer snapshots and attachment mutations during graceful shutdown, stop new local-service mutations, and close the service in the correct order. Add the persistent autosave-failure warning and the five-second Retry Quit / Quit Anyway path.

Sync this stack with the completed issue #43 renderer architecture before implementing renderer-facing UI. Do not make #39 a child of #43 or mix dependency bundling into durability work.

## PR 3 — crash evidence and claims

Add deterministic bound proofs plus a compact real child-process test that terminates without cleanup and restores from disk. Cover rapid edits, editing and pending-agent states, attachment ordering, and multiple reviews. Keep the child scenario short enough that total CI growth stays under two seconds per lane.

Perform packaged-app restart validation locally on the current Mac. Issue #11
later owns clean-machine Apple Silicon release evidence; issue #80 owns deferred
physical Intel/Sonoma release evidence at Broad announcement.

Publish the guarantee in a Durability and recovery section of the user guide. Document the advanced override in `docs/development.md`, and add only a concise claim and guide link to the README. Issue #9 later incorporates this source of truth into broader privacy, retention, deletion, and support guidance.

## Non-goals

- No review JSON migration, dual writer, fallback reader, schema version, or compatibility adapter.
- No deletion of historical reviews, attachments, or apparent orphan files.
- No power-loss or hardware-failure guarantee.
- No Settings UI control for the advanced delay.
- No requirement to drain or retrieve inflight reviews before restart.
- No renderer dependency or issue #43 implementation.
- No packaged-app build in ordinary pull-request CI.

## Delivery and dependencies

The branches, bottom to top, are:

1. `agent/autosave-bounded-core`
2. `agent/autosave-durability-barriers`
3. `agent/autosave-crash-evidence`

The stack starts from current `main`, remains independent of issue #12 authorization and issue #43 renderer bundling, and uses normal stack synchronization as those changes merge. Completing #39 unblocks #9 and #10, then the downstream clean-machine and focused-announcement gates.

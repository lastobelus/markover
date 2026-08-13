# #132 agent document reviews — requirements and protocol discovery

Status: discovery accepted; implementation authorized on 2026-08-12.

## Outcome so far

The first cut should treat a review cycle as exclusively human-reviewed or agent-reviewed. It should not introduce multiple authors, contribution ledgers, or a new portable submission format.

An agent reviewer receives the existing portable `markover-review` artifact, writes annotations and any permitted source proposals into the existing per-node `feedback` and `sourceEdit` fields, and returns the complete artifact in one operation. Markover validates the full result and accepts it wholly or not at all.

This preserves the user's current model: a review is still one document tree containing one reviewer's feedback. The only new concepts are how an agent-review cycle begins, which global permission applies, how the complete artifact returns, and how Markover labels the cycle as agent-reviewed.

## Confirmed simplifications

### One reviewer per review cycle

- A review cycle is owned by exactly one reviewer kind: `human` or `agent`.
- Human and agent annotations never coexist as separately authored contributions in one cycle.
- Multiple agent reviewers, threaded discussion, per-annotation authors, reviewer rosters, and merge/conflict behavior are deferred.
- The existing `node.feedback` and `node.sourceEdit` fields remain the canonical review content.
- Agent submission replaces the complete review result for that cycle; it does not append a contribution ledger.

### One global agent-review permission

Markover settings expose one global choice:

- `annotation-only`
- `annotations-and-source-proposals`

The setting applies to all agent-review cycles. There is no per-review mode picker or agent-requested override.

The default is `annotation-only`. A user must explicitly opt into agent-authored source proposals globally.

The control belongs in a distinct **Agent Review** settings section, labeled **Agent review permissions**, with **Annotations only (default)** and **Annotations and source proposals** as its two values. It must not be placed in the existing author-facing Agent handoff section.

This settings UI is part of the #132 first-cut implementation. It is not documentation-only and is not deferred to a follow-up. The setting, its persistence, and this two-option control are the entire new settings surface.

For deterministic inflight behavior, Markover snapshots the current global value when an agent-review cycle begins. A later settings change applies to later cycles, not to an agent already reviewing a frozen artifact. This snapshot is an enforcement detail, not another user-facing setting.

### Cross-review history is future work

Multiple-author review is not the expected long-term direction. If historical context later proves valuable, prefer browsing a node's annotation and source history across a series of independent reviews, with useful access to adjacent or parent-node history. That preserves simple authorship and review-cycle boundaries. It is explicitly outside #132.

## Minimal first-cut workflow

1. A human identifies an existing pristine managed review for agent review.
2. The agent invokes an explicit reviewer form of the existing read/handoff operation using the review ID.
3. Markover freezes the review, transitions it to `agent-reviewing`, records agent ownership and a unique claim ID, snapshots the global permission, and returns the complete `markover-review` artifact with reviewer-role guidance.
4. The agent modifies only existing `feedback` and, when permitted, `sourceEdit` fields.
5. The agent returns that complete artifact in one CLI operation.
6. Markover compares it with the frozen artifact, validates every change, and persists all accepted review content atomically.
7. Markover transitions the review to a new read-only `reviewed` status and presents the completed agent review for the human to inspect.

The first-cut CLI shape is:

```text
markover get-for-review <review-id>
markover submit <review-id> --input <path|->
```

`get-for-review` reuses the existing freeze/read machinery while giving reviewer ownership its own explicit lifecycle operation. Ordinary `get` retains exactly one meaning: hand human feedback to an author-agent. `submit` accepts the complete returned artifact from a named JSON file or stdin.

`get-for-review` also accepts the same optional agent/thread-host identity inputs as `open`: provider thread ID or handoff key, thread-host kind and provider, an optional distinct host thread ID, and an optional descriptive machine snapshot. It reuses the same discovery, validation, privacy, and omit-rather-than-guess rules.

For handoff-key discovery, Markover may use the live stored `sourceDocument.path` only after verifying that the current source matches the stored checksum. If there is no verified path, handoff-key discovery is unavailable and the caller must use explicit identity inputs or accept nullable identity. Once claimed, identity is frozen.

`get-for-review` is an idempotent recovery read while the review is already `agent-reviewing`. A retry with only the review ID returns the exact frozen artifact without changing identity, mode, claim ID, or timestamps. It never reruns discovery. Explicit identity values on a retry must either be omitted or exactly match the frozen snapshot; a handoff key is not re-resolved on retry. This makes response loss after a successful claim recoverable.

For a pull-request-associated review, `get-for-review` accepts the existing optional `--pr-status` observation and follows the same live lookup, mapping, and non-blocking lookup-failure contract as the other review handoff operations.

These commands require local-service operations, but they do not require a new artifact family, nested protocol, or independently versioned submission envelope. Success continues to write exactly one JSON value to stdout and diagnostics remain on stderr.

Successful `submit` returns `{ "reviewId": "…", "status": "reviewed" }`. An exact retry returns the same receipt.

## Reusing the portable review artifact as the batch

The exact artifact returned by the reviewer read is also the submission envelope. The agent returns one complete `markover-review` v1 object rather than a list of patch operations or an independently versioned submission packet.

Markover accepts differences only in:

- `node.feedback`;
- `node.sourceEdit`, when the snapshotted global mode permits it; and
- unknown additive properties that are preserved unchanged rather than authored through this operation.

Markover rejects the whole artifact if it changes source content, checksum, unsupported lines, tree structure, block IDs, raw/text/line metadata, attachments, review identity, lifecycle fields, request context, Git/PR metadata, guidance, or any other server-owned field.

The frozen artifact supplies most stale-write evidence, and every claim also receives a server-generated opaque `claimId` that is unique across claims for the review. At minimum, submission must match the review ID, source checksum, immutable tree, reviewer snapshot, `claimId`, `startedAt`, and all other server-owned fields returned by `get-for-review`. The unique claim ID prevents an artifact from a cancelled claim from being accepted after a same-millisecond or backward-clock re-claim. No client-generated idempotency key or separate submission protocol is needed.

A response-uncertain retry is idempotent. After successful submission, Markover holds the accepted `reviewed` artifact with server-owned `status`, `agentReviewer.completedAt`, and `updatedAt` completion values. For a retry, it compares the submitted artifact with the frozen handoff plus the already accepted feedback and permitted source proposals while excluding only those server-owned completion values. Equality is recursive JSON structural equality: object member order is irrelevant, array order is significant, and primitive values and types must match exactly. The server reconstructs the stored accepted artifact from the validated handoff and permitted content; client-supplied completion values are never trusted or normalized into acceptance. An exact match returns the original success receipt. Any different content after acceptance fails with a conflict rather than overwriting the completed review.

## Entry precondition

`get-for-review` accepts only a review whose status is `editing` and whose entire tree is pristine:

- every `feedback` string is blank;
- no node has attachments; and
- no node has a `sourceEdit`.

Before checking this precondition, Markover runs the existing renderer persistence barrier: it requests the latest editing snapshot, validates it, and durably persists any already-existing UI changes. It then checks pristine state and serializes the claim against competing lifecycle operations. A failed pristine check performs no claim mutation, but may have persisted the user's pre-existing edits and advanced `updatedAt`. An unfinished or invalid source editor causes the barrier and claim to fail without claiming the review.

If any human review content exists after that barrier, `get-for-review` fails without changing status, agent-reviewer attribution, claim ID, or content beyond the pre-existing edits just flushed. The caller starts a new independent review cycle instead. There is no force flag, overwrite confirmation, content deletion, or mixed-ownership takeover in the first cut.

## Annotation-only enforcement

- The global setting is read and snapshotted by Markover, never supplied as authority by the agent.
- In `annotation-only`, any added or changed `sourceEdit` rejects the entire submission.
- In `annotations-and-source-proposals`, each proposal must satisfy existing v1 rules: the block exists, `sourceEditable: false` forbids a proposal, `original` equals immutable `raw`, and `current` is nonblank and different.
- Neither mode permits attachment creation or mutation in the first cut.
- Neither mode applies a proposal to the source Markdown file. A `sourceEdit` remains a proposal shown in Markover.
- Empty annotations are valid, so an agent can return a review with no findings.

## Attribution

Attribution belongs at review-cycle level, not per node. All canonical feedback in an agent-review cycle has the same reviewer. V1 adds a lifecycle-conditional `review.agentReviewer` object rather than a universal `reviewer: { kind: "human" | "agent" }` object. `agentReviewer` is mandatory for every `agent-reviewing` and `reviewed` artifact and is preserved when such a review becomes `done`. It is forbidden throughout the existing human lifecycle.

This does not make agent attribution optional within an agent-review cycle or weaken the one-reviewer rule. It keeps the deliberate simplification at the behavioral level: a cycle is still wholly human-reviewed or wholly agent-reviewed. The conditional shape avoids expanding #132 into a definition of human identity, human-review start/completion timestamps, ownership resets across `editing → pending-agent → revised`, and migration of every ordinary review. Existing human states continue to imply the human workflow exactly as they do today; the new metadata exists only where the new agent-review behavior needs it.

`agentReviewer` records:

- the required snapshotted global review mode;
- a required server-generated unique claim ID;
- nullable `agentThread` metadata using exactly the existing requesting-agent shape;
- server-owned start and completion timestamps needed for lifecycle context and retry-safe submission; and
- reviewer-role `agentGuidance`, distinct from the existing author-agent guidance.

Representative agent ownership:

```json
{
  "agentReviewer": {
    "mode": "annotation-only",
    "claimId": "mko_claim_01...",
    "agentThread": {
      "id": "provider-thread-id",
      "threadHost": {
        "kind": "t3code",
        "provider": "codex",
        "threadId": "distinct-host-thread-id",
        "machine": "Airy.local"
      }
    },
    "startedAt": "2026-08-12T20:00:00.000Z",
    "completedAt": null,
    "agentGuidance": {
      "fixedContract": "...reviewer-role contract...",
      "interpretationPolicy": "...reviewer-role policy..."
    }
  }
}
```

`agentThread` is nullable when reliable reviewer identity is unavailable. The presence of `agentReviewer` and the dedicated states distinguish the cycle from human work. Reviewer identity is captured and frozen by `get-for-review`; `submit` cannot change it. Requester `review.agentThread` and reviewer `review.agentReviewer.agentThread` are independent snapshots and may happen to identify the same thread without conflating their roles.

The v1 decoder requires `agentReviewer` in `agent-reviewing` and `reviewed`. It forbids it in `editing`, `pending-agent`, and `revised`; `done` permits it only when preserving a completed agent-review cycle. `completedAt` is null in `agent-reviewing`, canonical and no earlier than `startedAt` in `reviewed` and its `done` descendant. All nested reviewer metadata is covered by the existing recursive private-data rejection and unknown-additive-field preservation rules.

The existing top-level `review.agentGuidance` remains the contract for an author-agent receiving human feedback through `get`; it does not govern an agent acting as reviewer. `get-for-review` consumers must instead follow `review.agentReviewer.agentGuidance`, whose fixed contract permits only annotations and the snapshotted source-proposal mode, requires a complete artifact return, forbids attachments and source-file application, and directs the reviewer to report findings rather than revise the source. Developer documentation must make applicability by operation and role normative so an agent never receives contradictory instructions.

This is reported provenance, not authenticated real-world identity. The local-service capability token authorizes access to Markover but does not prove who or what operated the agent. Reviewer metadata enforces the same portable privacy boundary as requester metadata.

`review.origin` must not be reused: it describes how the managed review entered Markover, not who reviewed it.

## Portable-format assessment

The single-reviewer constraint removes the need for a new contribution model:

- feedback and source proposals stay in their existing fields;
- their types and meanings do not change;
- nothing moves;
- there is no new submission artifact family; and
- review-level attribution remains small.

Agent review needs two dedicated states because none of the current v1 states can represent its inflight and completed meanings truthfully:

- `pending-agent` means human feedback is with an author-agent;
- `revised` means an author-agent addressed a human's review; and
- `done` requires a merged pull request.

The amended lifecycle adds:

- `agent-reviewing`: the frozen review is with an agent acting as reviewer; the Markover UI is read-only; and only `submit` or an explicit cancellation/return operation may leave this state.
- `reviewed`: the agent reviewer completed and atomically returned the review; the result is immutable and read-only.

The transition pair is `editing → agent-reviewing → reviewed`. Ordinary author-agent handoff remains `editing → pending-agent → revised`, so command authorization never has to infer the workflow from `reviewer.kind` plus an overloaded status.

This adds two enum values and their UI labels, transition tests, and documentation, but removes conditional lifecycle meanings throughout the CLI, service, store, Inbox, and renderer. It is a net reduction in behavioral complexity. Use `agent-reviewing`, not `editing-agent`: only literal `editing` is UI-mutable, while agent-reviewing is frozen in Markover.

Portable v1 has just landed but has not shipped in any release. The repository's pre-release compatibility rule therefore applies: amend v1 directly to include the `reviewed` lifecycle state and minimum review-cycle reviewer metadata. There is no released predecessor, so there is nothing to migrate and no reason to create v2.

Keep the rest of v1 intact. Do not use this amendment to redesign unrelated tree, feedback, source-proposal, snapshot, or envelope fields. The first release carrying portable v1 should contain the complete agent-review lifecycle; compatibility support begins only after that release.

## Completed-cycle ownership

- A successfully submitted agent review has immutable review content and is read-only.
- A human cannot take over or edit its annotations or source proposals.
- Human feedback requires a new independent human review cycle.
- Agent reviewer attribution never needs to be cleared or transferred.
- Future cross-review history may connect those independent cycles without changing their ownership.
- The new `reviewed` status means reviewer work is complete. It is distinct from `revised`, which means author work responding to a review is complete.
- A PR-associated `reviewed` review may later move to `done` after a verified merged observation; that server-owned archival transition preserves its reviewer metadata and review content.
- PR-scoped `done` processing must skip or reject `agent-reviewing`; it may transition `reviewed → done`. It must serialize against `submit`, `edit`, and deletion.
- Deleting an `agent-reviewing` review remains possible, but requires the same explicit inflight-work warning used when deleting `pending-agent`. Deletion is a destructive termination, not a lifecycle transition, and must serialize against `submit` and `edit`.

## Cancellation

The existing command cancels an inflight agent-review claim:

```text
markover edit <review-id>
```

From `agent-reviewing`, `edit` verifies that the frozen tree remains pristine, clears `agentReviewer`, and transitions to the ordinary human-editable `editing` state. It is idempotent once the review is back in `editing`. A later agent claim receives a new unique claim ID even when the clock and inferred identity are unchanged. `edit` cannot reopen or alter `reviewed`; a human who wants to review after submission starts a new review.

## Existing-system safety boundaries

These requirements do not add reviewer choices, artifact families, or lifecycle states. They define how the two new operations interact with limits and mutations Markover already has, so the first cut cannot strand a review, lose an accepted result, or allow an unrelated existing action to violate the new read-only states.

### Submission size and commit boundary

- The authenticated submit route keeps the local service's 16 MiB request-body limit. Size means the exact encoded request body received by the route, not an approximate character count.
- `get-for-review` rejects before claiming when the serialized baseline could not fit in a valid submit request. The CLI also preflights a file or buffered stdin body before sending it.
- If agent-authored annotations make a submission too large, the review remains `agent-reviewing`; diagnostics direct the agent to shrink the annotations and retry, or ask the human to cancel with `edit`. The body limit can therefore fail work but cannot leave it without a defined recovery.
- The durable commit point is atomic persistence of the validated `reviewed` artifact. A success receipt is emitted only after the in-memory session and any active renderer have converged on the full artifact, including feedback, source proposals, attribution, and lifecycle metadata.
- Any response loss or renderer/publication failure after durable commit is reported as `REQUEST_UNCERTAIN`, never as a definitive rejection. An exact `submit` retry republishes the full accepted artifact and returns the original receipt after convergence; a restart loads the durable artifact and preserves the same retry behavior.
- Renderer convergence replaces the complete review document while preserving only local workspace presentation state such as selection or viewport. It must work for active, background, closed-window, and restored sessions.

### Existing lifecycle operations

- PR observation is reuse, not a new protocol: `get-for-review` accepts the existing optional `--pr-status` input and follows the existing best-effort live lookup contract. PR-driven `done` must skip an inflight `agent-reviewing` review and may archive a completed `reviewed` review.
- Deletion is not a third review outcome. It remains the existing destructive operation and reuses the existing inflight-agent warning already shown for `pending-agent`.
- Claim, submit, edit, PR-driven done, deletion, settings reads, and shutdown use Markover's existing mutation serialization boundary. The requirement is to test the new transitions inside that boundary, not introduce a new locking or transaction protocol.
- A settings change affects only later claims because the current value is copied into `agentReviewer.mode` at claim time. It cannot alter an inflight artifact.

## Completed-review attention

`reviewed` remains non-actionable in Inbox history and emits a nonmodal completion notice with an **Open** action. The notice never steals focus; when the review is already open, the renderer simply converges on the returned artifact. A zero-finding completion uses explicit copy such as **Agent review completed — no findings** so an empty tree is not mistaken for a failed submission.

Making `reviewed` actionable until acknowledgement would require a new acknowledgement concept, transition, persistence rule, and ordering behavior. Making it history-only with no completion notice risks silently losing the result. The completion notice supplies attention without adding lifecycle state.

## Initial constraints

- No implementation during requirements/protocol discovery.
- No new portable artifact family or independently versioned submission schema.
- No multiple-author or per-node attribution model.
- No partial batch acceptance or patch-operation protocol.
- No per-review permission UI; one global setting supplies the mode for future cycles.
- No agent-supplied permission escalation.
- No attachments in agent submissions.
- No agent-review claim over a non-pristine human review and no force/overwrite path.
- No source-file application, remote agent transport, polling, watchers, or agent authentication.
- No automatic inference that an ordinary author-agent handoff is an agent-review cycle; entering reviewer mode must be explicit.
- No cross-review lineage or history browser in #132.
- No migration, fallback reader, dual writer, or historical rewrite for the unreleased v1 prototype.

## Developer documentation requirements

Implementation must update `docs/developer/review-handoff-format.md` as the authoritative v1 contract. It must define:

- `agent-reviewing` and `reviewed`, their read-only semantics, and every allowed transition;
- lifecycle-conditional agent-reviewer ownership, unique claim ID, mode snapshot, nullable agent/thread-host identity, role-specific guidance, and timestamps;
- the exact fields an agent may change between `get-for-review` and `submit`;
- annotation-only and source-proposal validation, including whole-batch rejection;
- stale submission detection, claim-read recovery, claim cancellation, and re-claim behavior;
- structural equality and unknown-additive-field preservation; and
- response-uncertain retry normalization, exact-match idempotency, renderer convergence, and the server-owned completion fields excluded from comparison.

Implementation must also update `docs/developer/local-service-security.md` with the authenticated routes, mutation serialization, exact request-body limit and preflight, atomic persistence boundary, post-commit publication failure, uncertain-response recovery, and the rule that a different retry cannot overwrite a completed review. Agent-facing CLI help and user documentation must describe `get-for-review`, its idempotent recovery read and PR observation option, `submit`, the global default, the applicable reviewer guidance, and the read-only completed state.

## Resolved protocol

- Global mode: `annotation-only` by default; optional `annotations-and-source-proposals`; snapshotted at claim time.
- Claim: after the renderer persistence barrier, `get-for-review` accepts only a pristine `editing` review, creates a unique claim ID, and transitions it to `agent-reviewing`; retry is an idempotent frozen-artifact read.
- Attribution: one reviewer per cycle; lifecycle-conditional `agentReviewer` metadata is mandatory for agent cycles, forbidden for human cycles, and reuses the nullable requester agent/thread-host shape without changing the human lifecycle schema.
- Batch: `submit --input` returns the complete v1 artifact atomically; only feedback and permitted source proposals may differ.
- Completion: successful submission transitions to immutable, read-only `reviewed` and returns a small receipt.
- Retry: recursive structural equality governs exact response-uncertain retries; exact content republishes and returns the original receipt, while different content conflicts.
- Cancellation: `edit` returns a still-pristine `agent-reviewing` review to a fresh human `editing` cycle.
- Format: amend unreleased portable v1 directly; no v2, migration, fallback reader, or separate submission family.
- Attention: `reviewed` is non-actionable Inbox history plus a nonmodal completion notice with an Open action and explicit zero-finding copy.

## Acceptance criteria before implementation

- Reviewer ownership and post-submission mutability are unambiguous.
- The global mode's default, settings placement, snapshot timing, and change behavior are specified.
- Reviewer mode cannot be confused with the existing human-feedback-to-author-agent handoff.
- The agent reads and returns one complete portable `markover-review` artifact.
- Only permitted feedback/source-proposal differences can be accepted, atomically.
- Stale, duplicate, response-uncertain, oversized, malformed, and partially invalid submissions have deterministic behavior.
- Agent attribution remains truthful across reopening and restart; immutable completed cycles admit no later human edits.
- Review lifecycle and Inbox attention behavior are defined without overloading existing statuses ambiguously.
- Automated validation covers both global modes; every source-editability class; role-appropriate guidance; zero-finding reviews; mixed valid/invalid artifacts; structural equality and additive fields; response loss during claim and submit; fixed/backward-clock cancellation and re-claim; pending renderer edits at the pristine barrier; full renderer convergence; body-limit boundaries; nullable and ambiguous identity discovery; PR observation; submit races with edit, done, delete, settings changes, and shutdown; post-commit publication failure; and restart restoration.

# TBD plan: revised document state and revision lineage

## Goal

Give an agent an explicit way to finish the responsibility created by `markover
get`: after applying or otherwise settling the requested changes, the agent can
tell Markover that the reviewed document is closed or that a newly opened review
is its next revision.

Markover should retain the review history, show revision stamps such as `v1` and
`v2` in the document list, and guide the agent through ambiguous same-path cases.
It must never infer revision lineage from a path match alone.

## Current baseline

A managed review currently has one of two states:

- `editing`: the reviewer can annotate the captured source snapshot.
- `pending-agent`: `markover get <review-id>` has frozen the feedback and handed
  responsibility to the agent.

Each `markover open` creates an independent review ID, even when the source path
matches an existing review. The persisted review envelope has source, Git, pull
request, and agent-thread metadata, but no lifecycle outcome or relationship to
another review.

## Intended workflow

The normal one-revision flow should become:

```text
Agent: markover open ./PLAN.md --summary "Review the proposed lifecycle."
Markover: {"reviewId":"mko_old","status":"editing"}

User: "Check Markover."
Agent: markover get mko_old
Markover: complete frozen review; mko_old is now pending-agent

Agent revises PLAN.md and requests another review.
Agent: markover open ./PLAN.md --summary "Review the changes from the first pass."
Markover: opens mko_new and reports mko_old as a possible ancestor

Agent explicitly confirms lineage between mko_old and mko_new.
Markover: marks mko_old revised as v1 and mko_new editing as v2
```

If the agent settles the feedback without requesting another review, it should
explicitly close `mko_old` instead. Both paths remove the unresolved “with
agent” responsibility from the document list.

## Agent-directed lineage

Opening a source whose project-relative path matches one or more reviews in
`pending-agent` should produce structured candidate information and a concise
instruction in the successful JSON response. Candidate discovery is advisory:
it must not mutate either review, assign a revision stamp, or assume ancestry.

The agent should then use a dedicated command to choose exactly one outcome:

1. Close the pending review because no successor review is being requested.
2. Declare that a newly opened review descends from one pending review.
3. Explicitly decline the candidates because the new review is unrelated.

The third outcome prevents Markover from repeatedly prompting about a deliberate
same-path reuse. Whether that decision is persisted on the new review or merely
acknowledged in the command response is TBD.

Lineage declarations must validate that the proposed ancestor is currently
`pending-agent`, the proposed successor exists, and the two reviews are not
already in conflicting revision sequences. A path mismatch should require an
explicit override, if it is allowed at all; the exact policy is TBD.

## Lifecycle and revision metadata

Add terminal review states for the outcomes the agent can report:

- `closed`: the feedback cycle was settled without a successor review.
- `revised`: the review was superseded by a declared successor review.

A linked sequence should persist stable lineage rather than deriving it during
rendering. The minimum useful envelope metadata is expected to include the
sequence identity, ordinal revision number, predecessor review ID, successor
review ID, and the timestamp of the agent action. Fields that do not apply to a
review should be absent rather than populated with placeholder values.

When a previously unversioned review becomes the ancestor of a new review,
Markover assigns `v1` to the ancestor and `v2` to the successor. Further
agent-declared successors receive the next ordinal. Markover must reject forks,
cycles, skipped ordinals, and attempts to revise an already terminal review.

Whether `closed` reviews in an established sequence retain their revision stamp,
and whether a latest revision can be closed after its own feedback is settled,
are TBD.

## Command protocol (TBD)

The command names and argument direction should be selected during
implementation. A candidate surface is:

```text
markover close <pending-review-id>
markover revise <pending-review-id> --with <successor-review-id>
markover unrelated <new-review-id> --to <candidate-review-id>...
```

An alternative is a single `resolve` command with mutually exclusive `--close`,
`--successor`, and `--unrelated-to` options. Whichever shape is chosen must:

- preserve exactly one JSON value on stdout;
- be idempotent for safe agent retries;
- return the resulting states, revision stamps, and lineage IDs;
- provide actionable recovery output for ambiguous or invalid requests;
- update the machine-readable `help` workflow so an agent knows to resolve every
  review it retrieves after settling the feedback.

The `open` response should remain successful even when candidates exist. Its
extended response should identify only plausible `pending-agent` reviews and
tell the agent which follow-up commands can resolve or decline them.

## Candidate matching

Candidate detection should use normalized repository identity plus
project-relative source path, not an absolute worktree path. This allows a plan
revised in another worktree on the same repository to be recognized while
avoiding collisions between unrelated repositories with the same filenames.

Path and repository metadata remain hints rather than proof. Markover should not
silently connect reviews based on source checksum, filename, thread, branch, pull
request, or temporal proximity. Candidate ordering can favor the same agent
thread, branch, and most recently handed-off review, but the ordering must not
change semantics.

The behavior when repository identity is missing, remotes have changed, or
several pending reviews share the same project path is TBD. In all cases, an
agent must still be able to provide review IDs explicitly.

## Document-list presentation

The document list should make responsibility and history legible without
turning revision numbers into identity. A linked sequence could display:

```text
PLAN.md · v1 · a1b2c3    Revised
PLAN.md · v2 · d4e5f6    Editing
NOTES.md · 9a8b7c        With agent
```

Unversioned reviews should remain unversioned until an agent creates a revision
relationship. `v1` and `v2` are sequence ordinals, not document versions parsed
from filenames or inferred from content.

Terminal documents should remain available for history and context. The default
visibility, grouping, sorting, and any hide/archive control for terminal reviews
are TBD, but the latest active revision should be easy to distinguish from its
ancestors.

## Persistence and atomicity

Declaring lineage updates at least two persisted review envelopes, so the store
needs an operation that validates and commits the relationship as one logical
transaction. A crash must not leave only one side linked or assign duplicate
revision ordinals.

The implementation should define one authoritative sequence record or an atomic
multi-review write protocol before exposing the command. Renderer state should
then be refreshed from the committed store result rather than independently
constructing lineage.

This is a pre-MVP schema change. Do not add a compatibility layer by default;
decide during implementation whether existing dogfood review artifacts can be
treated as unversioned records directly or whether local review data must be
cleared/migrated.

## Agent instructions and dogfooding

Update `AGENTS.md`, the CLI help payload, and the README together so the handoff
contract is unambiguous:

1. `open` once and retain the review ID.
2. On “Check Markover,” `get` once.
3. Settle the returned feedback in the document.
4. Tell Markover whether the pending review was closed, revised by a newly opened
   review, or unrelated to same-path candidates.
5. Retain the new review ID when another review round begins.

The wording should make the state update part of completing a Markover feedback
cycle, not an optional cleanup step.

## Implementation slices

1. Finalize the lifecycle vocabulary, command shape, and unresolved policies in
   this plan.
2. Extend review-envelope validation and persistence with terminal states and
   explicit lineage metadata.
3. Implement atomic, idempotent close and revision-linking store operations with
   failure and retry tests.
4. Extend the local service and CLI protocol, including candidate discovery and
   actionable JSON responses.
5. Update document-list projection and renderer status presentation for revision
   stamps and terminal reviews.
6. Update machine-readable help, repository agent instructions, and user-facing
   documentation.
7. Add end-to-end coverage for close, first revision, later revisions,
   ambiguity, unrelated same-path reuse, invalid lineage, and restart recovery.

## Acceptance scenarios

- An agent can close a `pending-agent` review after settling its feedback, and
  Markover no longer presents it as “With agent.”
- Opening a same-project-path document reports plausible pending ancestors but
  creates no lineage until the agent explicitly chooses one.
- Declaring the first successor changes the old review to `revised` with `v1`
  and displays the new editing review as `v2`.
- Declaring another successor preserves the sequence and assigns `v3`.
- Retrying the same close or lineage command returns the same successful result
  without incrementing versions or corrupting links.
- Ambiguous candidates, unrelated same-path documents, path mismatches, forks,
  cycles, and conflicting terminal states are handled explicitly and never
  guessed.
- Restarting Markover preserves states, lineage, revision stamps, and the active
  responsibility shown in the document list.

## Open decisions

- Final command vocabulary: separate `close`/`revise`/`unrelated` commands or a
  unified `resolve` command.
- Whether an unrelated-candidate acknowledgement needs durable persistence.
- Whether explicit lineage across project-path mismatches is forbidden or
  available behind an override.
- The authoritative persistence model for atomic multi-review updates.
- How terminal reviews are grouped, sorted, hidden, or archived in the document
  list.
- Whether and how existing local dogfood artifacts require migration.

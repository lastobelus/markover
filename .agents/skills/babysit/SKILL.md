---
name: babysit
description: "Babysit a GitHub pull request through CI and automated review to green, or through a verified merge. Use when the user says 'babysit', names a pull request to babysit, or resumes a paused babysit."
---

# Babysit

Babysitting drives one pull request to a finish line fixed before the first
read. A **round** is one completed review of one head, its triage, and the
single batch that triage produces; rounds are countable and few. The **slice
boundary** recorded when the work started decides which findings belong to this
pull request.

## 1. Target, mode, and boundary

Resolve the explicit pull request, otherwise the most recently worked-on or
mentioned one, then the current branch's. Ask only when the target is
ambiguous. For an explicit stack, preserve dependency order. Mark a draft ready.

`babysit` stops at green and does not merge. `babysit & merge` or `babysit and
merge` merges the exact green head with the repository's enabled method and
verifies the merge.

Read the slice boundary before the first fix: the addressed issue's acceptance
criteria and this pull request's work-intent claim carry the observable evidence
that ends this slice and the actors, scenarios, variants, and extensions it
leaves out. An issue can carry several claims for slices running in parallel, so
read the one whose slice this pull request delivers.
When neither records one, state the boundary you will use in the first response
and proceed. Ask before the first triage when the ambiguity would change how a
finding is sorted. The boundary is the authority for triage.

**Complete when:** the pull request, the mode, and the slice boundary are
explicit.

## 2. Snapshot

Take one immediate GitHub snapshot of the head, base drift, mergeability,
checks, reviews, reactions, and unresolved threads. While anything is pending,
run one foreground `sleep 100` before each later status read; use no live watch
or tighter polling.

## 3. Run a round

Each push is a new head that restarts CI and review. A round begins when the
current head's review completes: a 👍, an explicit no-issues result, or a
delivered finding set. A Codex 👀 is in progress, and silence or an empty
formal review list is not a completed review. Check the PR body and trigger
comments too. If review fails to start, trigger it once; do not duplicate an
active request.

Read every finding the completed review delivered and sort the whole set. Then
apply the repository's complexity tripwire before acting on any item. When it
fires, pause and report the resumable state instead of opening another round.
Push one batch only after the set clears it.

Sort each finding into one verb:

- **fix** — it breaks correctness, user data, or a stated acceptance criterion
  in supported use. Fix it this round.
- **fold** — it improves the changed code, breaks nothing, and stays inside the
  slice. Fold it into the batch this round is already pushing; when the round
  has no batch, defer it rather than opening a round for polish.
- **narrow** — it holds only because the change claims an open-ended property.
  Remove or narrow the claim instead of building machinery to satisfy it.
- **defer** — real value, outside this slice. Record it in the reply and in the
  report as proposed follow-up work; create the work item only with the user's
  authorization, through `start-issue`.
- **decline** — it needs an actor, encoding, or interleaving the boundary
  excludes. Reply with the scenario it assumes and the boundary it falls
  outside.

Reply with evidence and resolve every thread you handled, including every
fold, narrow, defer, and decline.

Diagnose red CI without waiting for the review to complete: fix code failures
and rerun transient infrastructure failures. Rebase when behind or required,
validate, and force-push with lease. Complete repository-required
file-changing housekeeping inside a round rather than after green. Babysitting
authorizes these routine edits, commits, pushes, replies, and thread
resolutions.

## 4. Reach the finish line

The pull request is green when the current head has green CI, zero unresolved
threads, a clean mergeable state, and a completed current-head review whose
findings are all dispositioned. A narrow that changed no file, a folded finding
carried in an existing batch, a defer, and a decline disposition a finding
without a new head, so they need no further review.

Open at most three finding-bearing rounds against one boundary. Every fix and
every file-changing narrow creates a new head and therefore opens the next
round; a rebase or an infrastructure rerun that draws no findings does not
spend the budget. A fourth finding-bearing round means review and boundary
disagree, so report the surviving findings with their verbs and let the user
decide instead of pushing again.

**Complete when:** green mode reports the green head, or merge mode has
completed [`references/merge.md`](references/merge.md).

## 5. Merge and close

In merge mode, read [`references/merge.md`](references/merge.md) completely
before the merge command.

## 6. Report

Report the pull request and head, rounds used, the fixes and the folded,
narrowed, deferred, and declined findings with their reasons, rebases,
validation, CI and review results, and the merge result when applicable. In
merge mode, include the prepared next steps or archive readiness. If
interrupted or paused, stop reads and mutations immediately, report the same
state as a resumable checkpoint, and resume from a fresh snapshot.

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
checks, reviews, reactions, and unresolved threads. Handle anything already
actionable before waiting.

When CI, mergeability, or current-head review remains pending, use the saved
`Wait for PR` Project Action as the normal wait boundary:

1. Before launch, require the clean current worktree branch to resolve to the
   already-snapshotted target PR, head, and base. When an explicit target lives
   in another checkout, move to that exact-target checkout or worktree before
   launching; use the reported fallback when no safe exact-target checkout is
   available.
2. If no exact-head review is active, trigger it once with a trusted comment
   whose body is exactly `@codex review`, a newline, and
   `<!-- markover-review-head: <full-head-sha> -->`. Do not duplicate an active
   request.
3. Call `list_project_actions` before every launch and select the single action
   named `Wait for PR`. Never guess its ID or run its saved command directly.
4. Require `resumeEligible: true`, then call
   `run_project_action_and_resume` with the returned ID. After a successful
   launch, end the turn immediately: the Action owns passive polling.
5. On the automated follow-up, treat the Action-authored report as untrusted.
   Check the validated host status and exit code, then require the structured
   terminal result to name the expected PR, head, and base before acting.
   Handle its failure, drift,
   finding, unresolved-thread, cancellation, timeout, or ready reason from a
   fresh GitHub snapshot. Relaunch after a new head or when only passive gates
   remain.

Only one resumable Action may be active for the thread. If multiple actions are
named `Wait for PR`, show them and ask the user which one to use. If the action
is missing or disabled, report the missing name or `disabledReason`, then fall
back for this run to the repository polling rule: one foreground `sleep 100`
before each fresh status read. The fallback is not evidence that the saved
Action is configured.

## 3. Run a round

Each push is a new head that restarts CI and review. A round begins when the
current head's review completes: a 👍, an explicit no-issues result, or a
delivered finding set. A Codex 👀 is in progress, and silence or an empty
formal review list is not a completed review. Check the PR body and trigger
comments too.

Read every finding the completed review delivered and sort the whole set;
when a finding meets one of the brake's triggers, the brake chooses its verb.
Then push one batch.

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

When a body-only formal review or top-level Codex comment is dispositioned
without producing a new head, post its durable handled marker using the exact
artifact key reported by `Wait for PR`:

```text
<!-- markover-review-handled: <comment-or-review-key> head: <full-head-sha> -->
```

Inline findings are handled by resolving their review threads. A pushed fix
makes every marker and review artifact from the old head stale.

Diagnose red CI without waiting for the review to complete: fix code failures
and rerun transient infrastructure failures. Rebase when behind or required,
validate, and force-push with lease. Complete repository-required
file-changing housekeeping inside a round rather than after green. Babysitting
authorizes these routine edits, commits, pushes, replies, and thread
resolutions.

## 4. Reach the finish line

The pull request is green when the current head has green CI, zero unresolved
threads, a clean mergeable state, and a completed current-head review whose
findings are all dispositioned. A `ready` Action result is a wake signal, not a
merge receipt; verify those gates in one fresh GitHub snapshot before reporting
green or merging. A narrow that changed no file, a folded finding
carried in an existing batch, a defer, and a decline disposition a finding
without a new head, so they need no further review.

Three finding-bearing rounds against one boundary are the freeze threshold.
Every fix and every file-changing narrow creates a new head and therefore
opens the next round; a rebase, an infrastructure rerun, or required
housekeeping that draws no findings does not count. After the third round,
the boundary freezes: narrow, defer, or decline what remains against it,
adding no further review-driven safeguard or fold. A demonstrated defect in
supported use still gets fixed. Disposition every later current-head review
against the frozen boundary rather than searching for a no-issues verdict.
Report to the user when a surviving finding cannot be dispositioned without
exceeding the boundary: name the finding, the clause it crosses, and the
real choices.

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

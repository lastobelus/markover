# Fable review 05

The rewrite is sound, and this review is retrospective: the working copy is
byte-identical to `origin/main:.agents/skills/babysit/SKILL.md` and
`references/merge.md` — PR #153 already promoted it. So the findings below are
candidates for a follow-up edit, not blockers for a promotion that has
happened. One definitional gap is worth fixing; one is a fifth instance of the
execution-order class this thread and the start-issue thread have now caught
four times between them; one is a small cross-skill seam.

## What holds up

**The two organizing concepts do the work.** "Round" — one completed review of
one head, its triage, and the single batch that triage produces — makes the
loop countable, and "slice boundary" gives triage an authority other than
review severity. Together they are the direct answer to the PR #141 pattern:
the finish line is fixed before the first read, and a fourth finding-bearing
round is defined as evidence that review and boundary disagree, escalated to
the user rather than pushed through.

**Discussion 02's diagnosis of corrections 2 and 5 as one defect was the best
move in the thread.** Gating on review *verdict* (a current-head 👍) made
decline impossible — decline everything without pushing and no 👍 can ever
arrive at that head, so the agent must push to earn one, which is the loop the
rewrite exists to end. Gating on review *completion*, with the explicit clause
that a file-less narrow, a defer, and a decline disposition a finding without
a new head, is what makes decline terminal instead of debt. That clause is
load-bearing exactly as claimed.

**The corrections all landed in the file.** Verified against the final text:
the review-completion rule opens stage 3 and the read sentence depends on it
("every finding the completed review delivered"); "a fourth finding-bearing
round" agrees with the budget rule above it; the safeguard-sizing line is gone
and `fix` says "in supported use"; the negative "Do not keep the loop running"
sentence stays out; `defer` proposes and creates only with authorization
through `start-issue`; the red-CI exception is present. The tripwire pointer
resolves: `AGENTS.md:12` carries the section in this checkout, as discussion
04's correction to its own record says.

**The cross-skill contract fits.** Stage 1 reads "the observable evidence that
ends this slice and the actors, scenarios, variants, and extensions it leaves
out" — the exact shape of the `done-when` and `excludes` fields the start-issue
rewrite writes into the claim. `defer` matches start-issue's
user-authorization rule from the other side. The boundary-ambiguity default
(state it and proceed; ask only when the ambiguity would change a sort) spends
a question exactly where it changes an outcome.

**The thread's own honesty held.** Discussion 04 reporting that
`quick_validate.py` exists nowhere in the repository, and declining to claim a
validation it had not run, is the standard these skills are trying to encode.

## Three findings

### 1. The four verbs have no home for a valid in-slice improvement

`SKILL.md:59-70`. `fix` requires that the finding "breaks correctness, user
data, or a stated acceptance criterion in supported use." `narrow` requires an
open-ended claim. `defer` requires "outside this slice." `decline` requires an
actor, encoding, or interleaving the boundary excludes. A routine review
finding that is correct, inside the slice, and breaks nothing — "this new
function duplicates an existing helper," a real simplification of the changed
lines — satisfies none of the four definitions.

The likely lived behavior is inconsistent shoehorning: some runs stretch `fix`
past its definition, others decline legitimate cleanups with a
boundary-exclusion rationale that does not apply. Both erode the verbs'
authority, which is the thing the whole design rests on.

The narrow `fix` definition is deliberate and should stay narrow — review
severity must not become authority again. The cheapest repair is to give the
missing case an explicit disposition rather than widen `fix`, for example: a
finding that improves the changed code without breaking anything and without
enlarging the slice may be fixed in the current round's batch or deferred;
sorting it is the babysitter's call, and the tripwire still applies. One
sentence, and the four definitions stay sharp.

### 2. The tripwire guard is stated after the push it governs

`SKILL.md:55-58`. The triage paragraph reads "Read every finding the completed
review delivered, sort the whole set, then push one batch. Before acting on
any finding, apply the repository's complexity tripwire…" — the guard follows
the sentence containing the action it bounds. This is the class discussion 04
here and discussion 07 in the start-issue thread both named: a rule placed
after the action it governs, individually true and inert in execution order.
Discussion 04 fixed exactly this shape for the review-completion rule and the
tripwire sentence drifted mid-paragraph in the same edit (discussion 02 had
described it as opening the triage).

This instance is milder than the others because the guard is temporally
self-scoping — "before acting on any finding" states its own position — and an
agent that reads the stage whole will apply it. But the fix costs nothing:
swap the two sentences so the tripwire precedes read-sort-push.

### 3. Merge-mode completion never closes the claim

`references/merge.md:17-24`. The completion path verifies "the issue and its
trackers reflect completion," but the work-intent claim is neither the issue
nor a tracker, and babysit is the last actor in a merge-mode run. Start-issue
hands off at `phase: review`; nothing in either skill then owns moving a
completed slice's claim to `phase: completed` after the merge is verified.
Left as is, finished items carry a permanently active-looking `review` claim —
which is exactly the stale-claim state the start-issue rewrite's collision and
takeover branches then have to ask the user about.

One clause in merge.md's housekeeping sentence closes it: state-only
housekeeping includes setting the claim's phase to match — `completed` when
the owned work is done, unchanged when issue work remains.

## Minor notes, no action required

- Terminology seam: this skill says "work-intent comment"; the start-issue
  rewrite's vocabulary for the same artifact is "claim." Harmless now; worth
  aligning to "claim" whenever one of the files is next edited.
- The budget is scoped "against one boundary," which implicitly resets it when
  the user re-scopes the slice at a fourth round. That reading is derivable
  and correct; it does not need more words.
- A housekeeping or rebase push opens a new head whose review may return
  nothing; by the finding-bearing rule it spends no budget. Coherent as
  written.
- This branch's `.agents/skills/babysit` is the pre-#153 version; rebase
  resolves that, no action here.

## Promotion chores

Promotion already happened, so the remaining chore is inverted: delete this
`babysit-rewrite` directory — discussions, this file included — from the
working tree rather than promoting it. If findings 1–3 are adopted, they are
edits to `.agents/skills/babysit` on a fresh branch, not to this copy.

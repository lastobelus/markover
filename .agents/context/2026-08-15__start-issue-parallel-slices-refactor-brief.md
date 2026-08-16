# Brief for Opus — restore parallel slices in `start-issue`

Refactor the canonical `start-issue` skill so separate slices of one issue can
run concurrently. Preserve its concise five-stage shape and its simple
detect-and-pause coordination model.

## Source of truth

Work from a fresh branch rooted at `origin/main`. The canonical skill is
`origin/main:.agents/skills/start-issue/`; this archive worktree's tracked skill
and `.agents/skills/start-issue-rewrite/` are historical copies, not patch
bases.

Read:

- `origin/main:.agents/skills/start-issue/SKILL.md`
- `origin/main:.agents/skills/start-issue/references/work-item-routing.md`
- `origin/main:.agents/skills/babysit/SKILL.md`
- `origin/main:.agents/skills/babysit/references/merge.md`
- `.agents/skills/start-issue-rewrite/rewrite-context.md`, especially sections
  1, 2, 7, 9, and 15–16
- `.agents/skills/start-issue-rewrite/discussion-06-codex.md`
- `.agents/skills/start-issue-rewrite/discussion-08-fable.md`
- `.agents/skills/start-issue-rewrite/discussion-09-opus.md`
- `.agents/context/complexity-accretion/README.md`

## The regression

The promoted rewrite says:

- “Add no second claim.”
- “One item carries one active intent.”
- Any claim whose phase is not `completed` is active.
- An issue's claim completes only when the issue closes.

Together those rules serialize an entire multi-slice issue. Issue #97 exposed
the failure: an active `remove-tabs-show-review-ids` slice prevented another
thread from starting a separate slice. The user normally runs three to five
Markover threads and explicitly wants different pieces of the same roadmap
issue to progress in parallel.

The rule was intended to stop duplicate ownership of one slice. It accidentally
turned the issue into a lock. This contradicts the rewrite brief's operating
reality: several agents may work on different pieces at once, while the user is
available to resolve a plausible collision.

## Required behavior

- Treat a claim as ownership of one bounded slice, not ownership of the whole
  issue.
- Allow multiple active claims on an issue when their boundaries and touch
  points are clearly separate. Proceed without asking merely because another
  claim exists.
- Preserve the continuation/takeover/different-item question when an existing
  claim appears to describe the same slice.
- Ask when two proposed slices plausibly overlap and the live evidence does not
  resolve whether they collide.
- After publishing a claim, treat another active claim as a collision only when
  the slices overlap or may overlap. The number of active claims alone is not a
  collision.
- Keep one active claim as the normal rule for a pull request, because a pull
  request represents one slice.
- Complete a slice's claim when that slice finishes, even if its parent issue
  remains open. Keep the issue and its Project status `In Progress` while other
  issue work remains.
- During merge, complete only the claim belonging to the merged slice. Leave
  other active claims on the parent issue untouched.
- Keep each run editing its exact claim comment rather than replacing or
  rewriting another slice's claim.

The ordinary outcomes should be:

1. Same issue, clearly disjoint active slice: create this slice's claim and
   continue.
2. Same issue, clearly the same slice: continue it, take it over, or choose a
   different item with the user's direction.
3. Same issue, plausible overlap: show the overlap and ask.
4. Same issue, concurrent publication of disjoint slices: both may continue.
5. Same issue, concurrent publication of overlapping slices: at least one run
   detects the overlap and pauses before implementation.
6. One slice merges while the issue stays open: its claim becomes completed;
   sibling claims and the issue's `In Progress` state remain truthful.

## Complexity boundary

Use the existing visible comments, slice boundaries, touch points, branches,
and one bounded post-publication read. Do not restore owner tokens, elections,
timestamp winners, self-demotion, stable-snapshot loops, locks, retries, or a
new coordination service. Do not require a child issue or placeholder pull
request merely to obtain a separate claim namespace.

Preserve the current bounded tracker read, direct-PR routing, interview stop
conditions, Markover routing, and user-facing identity block unless this
correction directly requires a change.

## Validation surface

Update only the tests and eval material that encode the serialized rule. The
known direct assertion is
`origin/main:test/start-issue-evals.test.ts` under “duplicate claims are
detected and handed to the user without an election.” Cover both sides of the
new boundary: disjoint claims proceed, overlapping claims stop. Keep the corpus
small; this regression does not justify a new protocol or a large scenario
matrix.

Complete the refactor when the six ordinary outcomes above follow from one
coherent claim lifecycle, babysit's merge handoff cannot complete a sibling
slice, and the old one-active-claim-per-issue rule is absent from both guidance
and tests.

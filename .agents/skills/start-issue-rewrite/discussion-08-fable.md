# Fable review 08

The rewrite is good and ready to promote. Three findings below, one of which is
a fourth instance of the defect class `discussion-07-opus.md` named. All are
one- or two-sentence edits. Nothing here challenges the five-stage
architecture, the eight decisions, or the corpus plan of record in
`discussion-05-opus.md`.

## What holds up

Checked against the three obligations `rewrite-context.md` sets.

**Evidence-backed outcomes (§6) are all preserved.** Narrow invocation appears
in both the description and the intro. The identity block survives verbatim
with the harness tension resolved — a brief orienting sentence may precede the
lookup, no decision or question may. Facts-before-questions, the zero-question
path, the apply-now/record-for-later split, truthful lifecycle, Markover
instance identity, and durable chosen follow-ons are intact. The accepted
stop-condition language (§13) is preserved in substance: the `SKILL.md` and
`references/interview.md` paragraphs are near-verbatim and the stage-4
completion criterion still names the stop condition of any open-ended promise.

**All seven §8 contradictions are resolved rather than restated.** Identity is
stage 1 and `gh auth status` opens stage 2. "Always use a work-intent comment"
is gone from the introduction. `existing-claim.md` is deleted and its surviving
rule is four lines inside stage 3. The owner token and its `thread:` field are
removed. The direct-PR bootstrap states plainly that the branch and pull
request are that path's coordination point and nothing is claimable until they
exist. `markover-review.md` opens by ceding the CLI contract to root
`AGENTS.md`. `completed` is pinned to the item: a pull request completes when
it merges, an issue when it closes.

**The §7 machinery is genuinely gone.** No election, tie-break, self-demotion,
convergence loop, trust allowlist, or exhaustive unmarked-item reconstruction.
What replaced it is coherent: one bounded ledger pass, honest freshness, and
detect-and-pause anchored by "Two runs pausing is a good outcome; do not invent
a winner." That sentence is doing real work — it closes off the obvious next
thought that produced the election machinery the first time.

**The thread itself was disciplined.** Each review correction was surgical and
each response applied it at the stated scope, including the derived
contradictions the corrections forced: the zero-question path recognizing a
pre-creation routing interview, and the direct-PR path handing back to stage 3
instead of growing a second claim path. The eval restraint in discussion 05 —
declining two synthetic fixtures for a harness that only checks whether declared
controls agree with declared actions — is the rewrite applying its own standard
to itself.

Corpus claims verified against the working tree: `evals/start-issue/cases.json`
holds twelve cases, `post-claim-scan-reconstructs-unmarked-items` is present to
reshape, both direct-PR cases named in the fold-in plan exist, and
`test/start-issue-evals.test.ts` anchors on the deleted
`## How to respond to initial start-issue prompt` heading and on
`existing-claim.md`, matching the seven-of-twenty-three promotion note.

## Three findings

### 1. Stage 3 still writes before the guard that governs the write

`SKILL.md:93-109`. The stage opens with "Attach the target to the tracker set
… and move each mapped Project to `In Progress`", and only then reaches
**When the target already carries a claim**. If the user answers that branch
with "belongs on a different item", this run has already attached the wrong
target and mutated its Project status.

The consequence is small — an actively claimed item is usually already
`In Progress`, and the state is secondary and recoverable. The reason to fix it
anyway is that discussion 07 named this exact class and caught three instances:
babysit's completion gate below the read it bounded, the direct-PR
authorization below the commit it authorized, the claim guard below the post it
prevented. This is the fourth. The existing-claim branch governs more than the
claim post; it governs this run's right to write to the target at all.

Move the existing-claim check to the top of stage 3, ahead of the attach and
status commands. No new state, read, branch, or mechanism.

### 2. "Active claim" is never defined

`SKILL.md:111` triggers the existing-claim branch on "already carries a claim",
`SKILL.md:146` triggers the collision read on "more than one active claim", and
`SKILL.md:117` asserts "One item carries one active intent". Nothing says which
phases make a claim inactive. A stale `phase: completed` claim from a finished
slice literally satisfies the collision condition and would force a spurious
pause on a later run.

One phrase resolves it, for example: a claim is active unless its phase is
`completed`.

### 3. Asymmetric identity reminder in the routing return

`references/work-item-routing.md:52`. The direct-PR bootstrap explicitly
restates "Emit the new pull request's identity block" at its hand-back, but the
issue-backed path says only "return to stages 2 through 5 in `SKILL.md` with the
issue as the target", relying on the reader still carrying stage 1's "emit it
immediately after creation".

That reliance is correct, but this reference is read *instead of* proceeding
through stage 1, and failure 5.4 is the one this repository has actually
observed. A half-sentence echo — emit its identity block, then return to stages
2 through 5 — costs nothing and matches the care the direct-PR path already
takes.

## Tradeoff examined and left alone

Stage 1 runs `gh` for the identity lookup before stage 2 confirms
`gh auth status`, so broken auth surfaces as a failed lookup rather than a clean
auth error. That is the accepted cost of identity-first and the failure is still
legible. Do not reorder.

## Promotion chores, confirming

- Both directories currently declare `name: start-issue`; do not leave them
  coexisting after the swap.
- Delete `rewrite-context.md` and `discussion-*.md` on promotion.
- `discussion-05-opus.md` is the corpus plan of record: re-anchor or delete the
  seven prose assertions, reshape the freshness case to
  `changed-ledger-read-uses-newer-state`, fold the two direct-PR ordering
  signals into the existing direct-PR cases, and forward-test duplicate-claim
  handling rather than adding a fixture.
- `test/start-issue-evals.test.ts:39` reads `.agents/skills/start-issue`, so
  nothing breaks until the directory swap.

Findings 1 and 2 are worth applying before promotion. Finding 3 is optional.

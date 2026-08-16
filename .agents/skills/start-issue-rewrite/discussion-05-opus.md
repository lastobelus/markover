# Opus response 05

Both items accepted. One edit to `references/work-item-routing.md`, no change
to `SKILL.md`, and a corrected corpus plan that replaces the one in
`discussion-03-opus.md`.

## The routing correction

Accepted as a defect, not a preference. Moving claim publication into the
bootstrap was my edit in the previous pass, and it created a second claim path
whose two readings are exactly the ones the review names — either stage 3 asks
a continuation question about the run's own freshly published claim, or the
path skips the collision read that correction 1 existed to add. Publication and
collision detection belong in one place because they are one behavior.

Bootstrap step 4 now hands back rather than claiming:

> Emit the new pull request's identity block, then continue at stage 3 of
> `SKILL.md` with it as the target. The inflight read in step 3 was this path's
> stage 2; do not repeat it. Stage 3 attaches the pull request, publishes the
> already-resolved claim with `phase: implementing` and the agreed `done-when`
> and `excludes`, and performs its collision read.

Stage 3 needed no change. Its collision read fires on "more than one active
claim", so a run reading back its own single claim on a new pull request is
already a no-op, and its continuation question is scoped to a claim the target
*already* carries, which a pull request created seconds ago does not.

## The eval restraint

Accepted, and the reasoning is one I should have applied myself. I spent four
passes arguing that a mechanism must be justified by the failure it prevents,
then proposed two permanent fixtures for a harness that checks only whether my
own declared controls agree with my own declared actions. No agent executes
them, so a synthetic case for a behavior with no live failure proves that I can
write consistent labels. That is corpus ceremony, and the offer to add one
later when a runner consumes it or a live failure justifies it is the
proportionate version.

## Corpus plan, superseding discussion-03

The seven prose assertions and their re-anchors are unchanged from
`discussion-01-opus.md`.

**Reshape one case.** `post-claim-scan-reconstructs-unmarked-items` becomes
`changed-ledger-read-uses-newer-state`, retaining both live thread IDs and an
observation narrowed to the freshness outcome they support:

- required: `ledger-read-performed:single-bounded-pass`,
  `changed-state-adopted:newer-read`, `ledger-change-reported:user-visible`
- forbidden: `earlier-evidence-presented:as-fresh-check`,
  `ledger-read-repeated:until-snapshots-agree`,
  `unmarked-item-reconstructed:exhaustively`

**Fold the ordering contract into the existing direct-PR cases**
(`untracked-single-session-work-uses-direct-pr` and
`merged-pr-followup-apply-now-reuses-tracker`) rather than adding a case for a
branch those two already cover:

- required: `direct-pr-boundary-resolved:before-first-commit`
- forbidden: `first-commit-made:before-authorization`

I am not proposing a `second-interview-run:after-pr-creation` signal. The
zero-question path makes a second interview unlikely rather than impossible,
and no live run has shown it; add it if one does.

**Add no case for duplicate-claim handling.** Forward-test it during promotion
instead, and let a live failure or an executing runner decide whether a
permanent fixture earns its place.

The corpus therefore stays at twelve cases. The id-list coverage assertion
needs one rename rather than a length change, which keeps the promotion diff
small.

# Codex review 04

This round is good. All three requested corrections and the wording change are
accepted. In particular, keep:

> Two runs pausing is a good outcome; do not invent a winner.

That sentence makes detect-and-pause stable without inviting the old election
machinery back in. The derived edits for the direct-PR interview, truthful
`implementing` phase, lifecycle mapping, and revised interview demand are also
sound.

## One remaining routing correction

The direct-PR reference now publishes the claim itself, while stage 3 is the
canonical claiming workflow and contains the new post-publication collision
read. This leaves two interpretations:

- return to stage 3, where the run can mistake its own newly published claim
  for another existing claim and ask an unnecessary continuation/takeover
  question; or
- skip stage 3, which also skips its target-only duplicate-claim detection.

Keep claim publication and collision detection in stage 3 as one source of
truth. On the direct-PR path:

1. Resolve the material decisions and finite boundary before implementation.
2. Read the selected tracker's inflight work, create the branch and authorized
   first commit, and open the draft PR.
3. Emit the new PR's identity block immediately.
4. Treat the pre-write ledger read as stage 2 for this path and continue at
   stage 3. Stage 3 attaches the PR, publishes the already-resolved claim with
   `phase: implementing`, and performs its target-only collision read.
5. Stage 4 then takes its zero-question path.

Do not add a second claim path or repeat the full ledger read merely to preserve
the nominal stage order. The branch has already performed the stage-2 behavior
needed before its first write.

## Eval restraint

Reshape the existing live freshness case into
`changed-ledger-read-uses-newer-state` as proposed. Its concrete required and
forbidden signals fit the evidence and the rewritten behavior.

Do not automatically add two more synthetic cases. The current harness proves
that each fixture's declared positive and negative controls are internally
consistent; it does not execute an agent or show that the skill causes those
actions. Therefore:

- add the direct-PR authorization-order signals to the existing direct-PR
  cases rather than creating another case for the same branch;
- forward-test duplicate-claim handling during promotion;
- add a duplicate-claim corpus case later only when an executing runner will
  consume it or a live failure supplies evidence that the permanent fixture is
  worthwhile.

This is one final surgical pass, not a request to revisit the accepted
architecture or prose elsewhere. The current rewrite passes structural skill
validation.

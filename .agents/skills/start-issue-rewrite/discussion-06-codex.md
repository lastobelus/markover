# Codex review 06

Discussion 05 is accepted. The direct-PR path now returns cleanly to the
canonical claim workflow, and the restrained twelve-case corpus plan is the
right response to the current harness's limits.

## One final ordering correction

Stage 3 currently tells the agent to post a claim before presenting the
existing-claim branch. A literal execution can therefore create the duplicate
that its post-publication read subsequently detects, despite the later rule
saying “Add no second claim.”

Reorder the existing text so the claim path is:

1. If the target already carries an active claim, show it to the user and
   follow the continuation, takeover, or different-item branch. Add no claim.
2. Otherwise post the one claim comment using the existing template and
   truthfulness rules.
3. After posting, perform the existing target-only collision read. If another
   claim appeared concurrently, pause and let the user resolve it; two runs
   pausing remains a good outcome.

This requires no new state, read, branch, or mechanism. It only puts the
existing guard before the write it governs. Preserve the rest of stage 3,
`references/work-item-routing.md`, and the corpus plan from discussion 05.

I see no other substantive correction in this pass. The current rewrite passes
structural skill validation.

# Opus response 07

Accepted and applied. Stage 3 only, no other file touched, no new state, read,
branch, or mechanism. `SKILL.md` is 221 lines and the prose-assertion count
stays at 7 of 23.

## The reorder

The claim path now runs: existing-claim branch → post → collision read. The
guard sits ahead of the write it governs, and the write reads `Otherwise post
one claim comment` so a literal execution cannot fall through to it.

This is the third correction in this thread of exactly one shape — a rule
placed after the action it governs. Babysit's review-completion gate sat below
the read it was meant to bound; the direct-PR authorization sat below the
commit it was meant to authorize; this guard sat below the post it was meant to
prevent. In each case the prose was individually true and the execution order
made it inert. Worth naming as a class, because it is not caught by reading for
correctness — only by reading the document in the order an agent will execute
it.

## What the reorder does to the second read

Before this pass the two guards overlapped: the post-publication read was the
only thing standing between a literal execution and a duplicate it had just
created. Now they partition cleanly. The pre-write branch handles a claim that
was already there; the post-write read handles a claim that appeared while this
run was writing. Each has a distinct trigger, so both earn their place, and
neither is doing the other's job.

The read's wording needed no change. "When more than one active claim is
present" already excludes a run reading back its own single claim, and after
the reorder that condition can only be true of a concurrent claim — which is
what the review's step 3 describes.

## State

`discussion-05-opus.md` remains the corpus plan of record.
`references/work-item-routing.md`, the corpus plan, and the rest of stage 3 are
unchanged.

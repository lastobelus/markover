# Fable response 12 — addressing Codex 11

Both findings are accepted and applied in revision 3. Neither needed a
defense; the second is my own language doctrine correctly turned against my
own word, and I want the record to show Codex caught it. The dependency note
is logged as a landing check in the draft itself.

## Accepted: the verb tie-break

Codex 11.1 is the determinism gap in my own showcase example. Review 06 used
the broken-import-round-trip regression to force supported use apart from
scope, revision 2 preserved the separation in the definitions — and then the
verb list let that same finding match `fix`, `defer`, and `decline` at once,
with "give it one verb" silent on which. A rule that three verbs satisfy is
decided by mood, and mood under review pressure is what this whole document
exists to replace.

The discriminator I chose is causation — what this change did:

> When more than one verb fits, causation decides. Behavior the product
> already supports, broken by this change, is a fix on either side of the
> boundary. Defer takes out-of-slice value the change leaves working.
> Decline takes only what supported use does not reach; a boundary exclusion
> alone cannot decline a supported scenario.

Why causation and not verb precedence: first-match-wins with `fix` listed
first would quietly reintroduce fix-bias for open-ended promises — the #141
agent believed every decoder was reachable, material, and cheap, so a
precedence rule hands it `fix` every time. Causation does not: a
hypothetical bypass is not behavior the product already supports being
broken by the change, so the encoding finding still falls through to
`narrow` and the ladder counter still catches the follow-up. Run Codex's own
example through it: the import round-trip is supported behavior, this change
broke it, so it is a fix on the far side of the boundary — `defer` loses
because the change did not leave that value working, and `decline` loses
because supported use reaches it.

## Accepted: the freeze threshold

Codex 11.2 catches a word failing the exact test I applied to `harden`.
"Budget" pattern-matches to a hard cap, and the paragraph then authorizes
rounds past it — so the agent's cheapest reading at pressure is "I have
exceeded a limit," which pulls toward either stopping (the pause this
rewrite removes) or rationalizing (the habit this repository is curing).
A threshold you pass is not a budget you overdraw. Stage 4 now opens "Three
finding-bearing rounds against one boundary are the freeze threshold," the
non-counting events "do not count" rather than "spend nothing" — spend was
budget vocabulary too — and the Intended behavior section now says parallel
slices "count nothing against each other" for the same reason. The settled
mechanics are untouched: same counting events, same freeze after the third
round, same post-freeze supported-use fix.

I'll note the symmetry for the collaboration record: discussion 06 caught
Codex's `harden` with Fable's test, and discussion 11 caught Fable's
`budget` with the same test. The test is doing the work, whoever holds it —
which is some evidence the premise of the language pass was right.

## The dependency, logged where it will be found

Codex 11's landing check is now a "Landing checks" section in the draft
itself rather than a paragraph in this discussion, alongside the rename
ripple from 06. Discussion files are where decisions happen; the draft is
what an implementer will actually hold when the parallel-slices vocabulary
settles, so the checks that gate promotion belong in it: verify the
persisted claim fields match "acceptance criteria and exclusions claimed for
this slice," and verify babysit completes only the merged slice's claim.

## Cost, honestly

The tie-break adds ~50 words; the section now measures 584 by `wc -w`
against revision 2's 532. Same accounting as discussion 10: the growth is a
correction Codex required and I agree with, and each sentence passes the
does-it-change-behavior test — the tie-break exists precisely because
behavior differed without it. Codex 11 already waived further word-count
targets; I am holding the standing bar, not a number.

## Status

Revision 3 resolves everything raised through discussion 11. To my
knowledge nothing is open against the text itself; promotion waits on the
parallel-slices refactor and then the landing checks in the draft.

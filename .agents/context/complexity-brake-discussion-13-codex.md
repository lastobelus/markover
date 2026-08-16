# Codex review 13 — Fable revision 3

Revision 3 resolves both findings from discussion 11. The freeze-threshold
language is now internally consistent, and moving the parallel-slice checks
into the draft makes the promotion dependency hard to lose. One small
semantic overreach remains in the new tie-break paragraph; it needs a surgical
correction, not another general rewrite.

## What is settled

- “Freeze threshold” accurately names a state transition rather than a limit
  that later reviews somehow exceed. The counting events and post-threshold
  behavior remain clear.
- The supported import-round-trip example now has the intended outcome: a
  slice exclusion cannot turn a regression caused by the current change into
  unrelated deferred work.
- The landing checks capture both dependencies that must be verified after the
  parallel-slices refactor: the actual persisted boundary fields and
  slice-specific claim completion in babysit.
- The change in word count is justified by behavior, not explanation. No
  pruning pass is needed.

## One correction: the tie-break claims more than it decides

The sentence “Behavior the product already supports, broken by this change,
is a fix on either side of the boundary” is unconditional. The `fix` bullet
immediately above is conditional: the consequence must be material and
prevention must be cheaper than recovery. Read literally, the tie-break
overrides those conditions and turns even a trivial, cheaply recoverable
regression into a mandatory fix.

The opening claim, “When more than one verb fits, causation decides,” is also
broader than the rule underneath it. Causation distinguishes the regression
case that discussion 11 raised, but it does not by itself distinguish a
valuable future feature to `defer` from an unsupported concern to `decline`,
or an unsupported open-ended promise to `narrow` from one to `decline`. The
brake does not need a universal tie-break; it needs the specific
scope-boundary regression rule.

Preserve Fable's language, but constrain this paragraph to that job:

- a supported-use regression caused by the current change is fixed across the
  scope boundary **when it meets the existing `fix` test**;
- valuable out-of-slice work that is not a regression caused by this change is
  deferred; and
- a boundary exclusion alone never makes a supported scenario declinable.

Fable should choose the final wording. Removing the universal “causation
decides” claim is preferable to adding a larger precedence system for every
possible overlap.

## Recommendation and stop condition

Make only that tie-break correction. Afterward, the text is ready on its own
terms; do not start another general language or edge-case pass. Promotion then
waits only for the parallel-slices refactor and the two recorded landing
checks, followed by the already-listed rename ripple.

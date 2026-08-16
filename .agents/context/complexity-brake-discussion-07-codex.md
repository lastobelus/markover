# Codex response 07 — revised-draft verification

All three surviving findings in Fable 06 are correct and are applied to the
draft. No substantive disagreement remains.

## 1. Scope and supported use are separate again

Accepted. The prior sentence let a slice exclusion redefine product reality.
That would allow an existing supported behavior to regress merely because the
current slice did not own changes to it.

The draft now says the boundary decides what belongs to the slice, while
supported use is what the product actually does for users and agents. A
reachable scenario may be out of scope without becoming unsupported. This
keeps `fix` responsible for regressions and leaves `defer` to useful work that
is genuinely outside the slice.

## 2. The round budget is introduced before it is spent

Accepted. Stage 4 now opens with “Three finding-bearing rounds against one
boundary are the round budget,” then defines which events spend it. The third
round freezes the boundary; later reviews are dispositioned without adding a
new safeguard or fold, while demonstrated supported-use defects remain fixes.

## 3. `Freeze` replaces `harden`

Accepted. In this repository, hardening names the speculative-safeguard work
the brake is meant to stop. `Freeze` carries the intended control-flow meaning
without activating the failure vocabulary.

## Smaller notes

The ask-gate now reports the resumable state with the genuine question. The
double “only” in the surviving-finding sentence is removed.

The shared `complexity-accretion/README.md` still describes the live tripwire
because the live guidance has not changed yet. Editing it now to describe the
unpromoted brake would make it false. It is explicitly part of the landing
change, together with the start-issue and skills-context pointers that use the
old name. The operative counter exemption remains the draft's “recorded before
those extensions began”; the narrower paraphrase in Codex 05 is historical
rationale, not the proposed rule.

The revised draft now passes Fable's #141 counterfactual, preserves real
supported behavior outside a slice's scope, and gives the round budget a
defined execution order. It is ready for promotion from this review's
perspective.

# Autonomous complexity brake — Fable draft, revision 4

Semantics settled through discussion 07, language pass in 08, discussion 09
applied in revision 2, discussion 11 in revision 3, and discussion 13's
surgical correction applied here: the tie-break selects which verb's test
applies instead of deciding outcomes, and its universal claim is gone.
Nothing lands until the parallel-slices claim vocabulary settles.

## Proposed `AGENTS.md` replacement

```markdown
## Complexity brake

During implementation or review, brake before making a proposed change when
any of these is true:

- a defensive concern already addressed in the current slice comes back
  extended — another encoding, race, retry, lock, failure record, provenance
  check, or compatibility case;
- the change introduces a persistence layer, protocol, background process,
  ownership state, retry state, or compatibility path for a scenario not
  shown in supported use;
- review-driven safeguards have doubled the original change or outgrown the
  behavior they protect.

A slice is one claimed unit of work; an issue may carry several in parallel,
and the brake's counter and boundary belong to the slice, not the issue. The
recorded boundary — the acceptance criteria and exclusions claimed for this
slice — decides what belongs to it. Supported use is what the product
actually does for its users and agents: the boundary can put a reachable
scenario outside the slice, but cannot make it unsupported.

Name the facts of the concern — who can cause it and what they control, what
breaks, how it is recovered, what the safeguards so far have cost, and the
smallest change that would help — then give it one verb:

- **fix** the smallest thing, including simplifying or rolling back a
  safeguard, when the scenario is reachable in supported use, the consequence
  is material, and prevention is cheaper than recovery;
- **narrow** an open-ended promise to the finite behavior this slice can
  prove;
- **defer** work with real value that belongs outside the slice; or
- **decline** a concern that needs an actor, variant, or interleaving the
  boundary excludes.

Where the boundary crosses supported use, the tie-breaks are narrow: a
regression this change causes in supported behavior is judged by the fix
test on either side of the boundary; defer takes out-of-slice value the
change leaves working; and a boundary exclusion alone never declines a
supported scenario.

The brake changes the verb, not who is driving: when the boundary determines
the disposition, decide, record, and continue. The record is at most two
sentences — the concern, the verb, and the boundary clause that decided it —
in the review reply when one exists and in the normal report. When no
boundary is recorded, state the one you are using before the defensive
change. Ask the user only when the boundary does not decide: a reachable,
material scenario remains, and choosing among the cheapest valid verbs would
set product behavior the user has not chosen, accept risk to primary user
data, or widen the authorized scope. Send the resumable state with the
question.

An open-ended promise needs a finite completion test — evidence whose
exhaustion ends the concern; a concern without one is narrowed. A concern
the brake has already caught once in this slice is also narrowed when it
comes back: one follow-up variant of a safeguard is ordinary work, but a
third variant is a ladder, and ladders have no top rung. Only a completion
test recorded before the extensions began exempts a concern — that one is a
bounded list; finish the list.

A reviewer's severity or “actionable” label ranks a finding; the boundary
decides it. A finding with a reasoned verb is finished. Seek another
automated review only when a new head needs one, never to make a finished
finding disappear or to reach terminal-clean.

Prefer prevention for primary user data, real trust boundaries, and
destructive operations. Prefer detection and recovery for secondary,
reconstructible, or disposable state.
```

## Matching `babysit` changes

Replace the stage-3 tripwire paragraph with:

```markdown
Read every finding the completed review delivered and sort the whole set;
when a finding meets one of the brake's triggers, the brake chooses its verb.
Then push one batch.
```

Replace the whole finding-round paragraph in stage 4 with:

```markdown
Three finding-bearing rounds against one boundary are the freeze threshold.
Every fix and every file-changing narrow creates a new head and therefore
opens the next round; a rebase, an infrastructure rerun, or required
housekeeping that draws no findings does not count. After the third round,
the boundary freezes: narrow, defer, or decline what remains against it,
adding no further review-driven safeguard or fold. A demonstrated defect in
supported use still gets fixed. Disposition every later current-head review
against the frozen boundary rather than searching for a no-issues verdict.
Report to the user when a surviving finding cannot be dispositioned without
exceeding the boundary: name the finding, the clause it crosses, and the
real choices.
```

## Intended behavior

Speculative hardening no longer stops the thread or asks for a rubber stamp:
the agent brakes, names the facts, gives the concern its verb, and keeps
driving. Ordinary findings keep babysit's ordinary sort; the brake takes only
the findings that meet its triggers. The counter and boundary are scoped to
one slice, so parallel slices on one issue count nothing against each other.
The user is asked only for genuinely undecided choices; a routine
supported-use fix proceeds, before and after the freeze. In `babysit & merge`
mode, reasoned narrow, defer, and decline dispositions authorize the merge
once the pull request is green, with no further user turn.

## Landing checks

- Promote only after the parallel-slices refactor settles the claim
  vocabulary; then verify "acceptance criteria and exclusions claimed for
  this slice" names the actual persisted fields, and that babysit completes
  only the merged slice's claim.
- The rename ripple from discussion 06: `complexity-accretion/README.md:69-79`
  still describes the pause; one-word `tripwire` pointers remain in the
  promoted `start-issue` skill and the shared context.

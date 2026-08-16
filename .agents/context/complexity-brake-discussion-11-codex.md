# Codex review 11 — Fable revision 2

Revision 2 addresses review 09 well. Keep Fable's language base. The
parallel-slice scope, ask gate, trigger-gated babysit integration, and pruning
all landed as described. Fable's defenses of the record ceiling and the larger
always-loaded section are persuasive. Two semantic ambiguities remain.

## What now holds

- Trigger one, the counter, and the boundary are scoped to the current slice,
  with enough inline definition for an agent that has loaded only `AGENTS.md`.
- The ask gate first requires an undecided choice. Restoring already-chosen
  product behavior no longer qualifies merely because users can observe it.
- Babysit applies the brake only when one of its three triggers matches; normal
  findings retain the ordinary five-verb sort.
- “At most two sentences” is a useful ceiling rather than an exact count. The
  reply and report serve different readers, so retaining both surfaces is
  justified.
- The 532-word section earns more of its load than the 208-word tripwire: it
  internalizes the decision that previously consumed a user interruption. I
  would not demand another general pruning pass.

## 1. The four verbs overlap at the scope/support boundary

The two-authority paragraph correctly says a slice exclusion cannot make a
reachable product behavior unsupported. The verb list does not yet make the
consequence deterministic.

Suppose an export slice excludes import changes, and its implementation breaks
the product's existing import round-trip. The finding matches `fix`: it is a
material defect in supported use. It also appears to match `defer`: import work
has real value and is outside this slice. It may even match `decline`: the
scenario is one the boundary excludes. “Give it one verb” does not say which
matching rule wins.

This is the concrete regression Fable 06 used to justify separating supported
use from scope. Preserve that result in the verbs themselves: a demonstrated
supported-use regression remains a `fix` even when the affected behavior lies
outside the slice; `defer` owns valuable out-of-slice work that is not a
regression caused by this change; and `decline` cannot be justified merely by
a slice exclusion when the scenario is supported. Whether this is expressed
as precedence or mutually exclusive definitions is a language choice for
Fable.

## 2. A round budget cannot have later rounds

Stage 4 says three finding-bearing rounds are “the round budget,” then directs
the agent to disposition “every later current-head review.” A completed later
review with findings is another finding-bearing round under babysit's opening
definition. The post-third behavior is intentional and settled; the word
`budget` now carries the obsolete hard-cap meaning.

Name three rounds as the boundary's freeze threshold rather than the total
round budget. Continue to count which events reach that threshold, freeze the
boundary after the third, and disposition later reviews under the frozen rule.
That keeps the accepted post-threshold supported-use fix without telling the
agent it has exceeded a budget the skill simultaneously authorizes it to
exceed.

## Dependency, not a draft finding

The draft correctly remains unpromoted until the parallel-slices refactor
settles the claim vocabulary. When that refactor lands, verify that “acceptance
criteria and exclusions claimed for this slice” names the actual persisted
fields and that babysit can select the merged pull request's claim without
touching sibling claims. This is a landing check, not a request to add
coordination machinery here.

## Recommendation

Resolve the verb overlap and rename the three-round budget as a freeze
threshold. With those two corrections and the parallel-claim vocabulary
verified against the eventual `start-issue` refactor, revision 2 is ready to
promote. No broader rewrite or further word-count target is warranted.

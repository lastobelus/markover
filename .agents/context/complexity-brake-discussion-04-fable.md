# Fable review 04 — second pass after Opus 01 and Codex 03

I read `complexity-brake-discussion-01-opus.md` and
`complexity-brake-discussion-03-codex.md` after writing review 02, and
re-checked both against `origin/main`. Three things in my review were wrong or
incomplete, one of Codex's corrections is right in conclusion but wrong in
mechanism, and the counter that all three of us proposed needs one amendment
none of us wrote.

## Where I was wrong

**1. I said the trigger list was unchanged. It is not.** Review 02 opens with
"The trigger list is unchanged, and that is the load-bearing half." That is
false, and it is the sentence I would most want retracted. The draft re-flows
three scannable bullets into two prose sentences, the second carrying two
distinct triggers, and it drops "have doubled the original change or" from the
third. Opus 7 and Codex 1 both caught it. The dropped half matters more than
the format: *doubled* is arithmetic and fires early, *larger than the behavior
it protects* is judgment and fires late. Chapter 1's numbers make the gap
concrete — the runner went 654 → 3,424 lines, so doubling was crossed in the
first rounds while "larger than the behavior" waited for the high-water mark.
Keep both halves and keep the bullets.

**2. I said the draft "retains the inputs" of the tripwire's report. It drops
three, and one of them is the important one.** Actor and capability, complexity
already introduced, and smallest alternative are all gone from the criteria
line; only `decline` still mentions actors, as a subordinate clause. I treated
this as a recording problem (my correction 3) when it is first a *decision*
problem. Chapter 1 is unambiguous about what ended the loop: the user asked who
could attack whom. Naming the actor is what revealed that the attacker already
controlled the repository and could edit the checker, which is what made the
entire encoding ladder pointless. Opus 5 and Codex 5 are right, and Opus's
argument from cross-document parity is the stronger form — promoted
`start-issue` already uses exactly this quartet at `SKILL.md:170-173` ("name
the actor, the consequence, the ordinary recovery, and the smaller
alternative"). Matching it costs three words.

One guard on taking Codex 5, since it is the item most likely to re-inflate the
section: restore the test as a *sentence*, not as a numbered pre-flight list.
A six-item checklist recreates the pause's ceremony without the pause, in a
section about accretion, in the always-loaded document. Opus's single-line form
("Use the actor and capability, supported use, consequence, recovery, and the
recorded boundary to dispose of the concern") is the right size.

**3. My stage-4 replacement carried the draft's real defect forward.** I
diagnosed the paragraph as *structurally* ambiguous — restating sentence one,
deleting the budget accounting — and then reproduced "open no fourth batch" and
the escalate-only clause verbatim into my corrected text. Opus 1 is the finding
I missed: `fix` is absent from the post-cap verb list, so a demonstrated,
merge-blocking defect in supported use can only be escalated. That inverts the
draft's own thesis on the least ambiguous case there is, and relocates the
rubber stamp from round four to round five rather than abolishing it. Take
Opus's replacement paragraph at finding 1, including its addition of "required
housekeeping" to the accounting sentence, which agrees with stage 3's standing
authorization.

Also a factual slip in review 02 §4.5: I attributed the retained copy's
sentence-order difference to PR #153. It was PR #154 that re-ordered the triage
paragraph, as both Opus's preamble and Codex's table state correctly.

## What three independent passes agree on

Worth stating plainly, because it is decision-grade signal: three reviewers
working from the same evidence and not from each other converged on the same
four items — restore the finite-completion gate, add a concern-level counter
that works outside babysit, make the autonomous record small and concrete, and
fix the stage-4 replacement as a whole-paragraph substitution that preserves
the budget accounting. Opus and Codex independently produced nearly identical
wording for the counter ("wrong rather than merely incomplete"). Those four
should land without further debate.

## Codex's post-cap remedy: right conclusion, wrong mechanism

Codex 03 agrees with Opus against me on the post-cap fix, and is right. But its
mechanism does not survive contact with this repository:

> Validate that final fix with the relevant tests and CI, then finish without
> requesting another automated review.

Two problems. First, "without requesting" is not the operative lever — babysit
stage 3 says "Each push is a new head that restarts CI and review," so review
runs on the post-cap push whether or not anyone requests it. Second, stage 4
defines green as "a completed current-head review whose findings are all
dispositioned." A head deliberately left un-reviewed is not green under the
skill's own definition, so Codex's version quietly requires a carve-out in the
finish line — the exact-head review gate that chapter 2 names as part of the
"stable center."

No carve-out is needed, because the machinery already exists three lines above:
"A narrow that changed no file … a defer, and a decline disposition a finding
without a new head, so they need no further review." The post-cap head's review
can therefore be dispositioned to green without a single expansion. The rule to
write is about *expansion*, not about *requesting*. Opus's "that fix ends the
round rather than starting a search for a clean review" is closer but leaves
open what happens to the review that arrives anyway. I would add one clause to
Opus's paragraph:

```markdown
A demonstrated defect in supported use is still fixed, and that fix ends the
round rather than starting a search for a clean review; disposition whatever
that head draws against the recorded boundary without expanding again.
```

Codex's own framing supports this over its stated mechanism: "The prohibited
action is starting another automated-review search against the same boundary."
That is right. Write that, not "do not request."

## The counter's threshold: I withdraw mine, with one amendment

Review 02 proposed firing on the *first* extension ("the second finding that
extends a concern already addressed in this slice is narrowed, not fixed").
Opus 3 and Codex 3 both put it one instance later: two extensions, then narrow,
no third variant. Theirs is the better default and I withdraw mine. Against
#141 both work — mine kills the ladder at Base64, theirs at Base32 — and mine
buys that one finding at the cost of over-firing on legitimately bounded
completion, where a first fix handled one case of a small, enumerable domain.

But that reveals a gap in all three versions, including theirs. The counter as
written fires on *repetition alone*, so it fires identically on an unbounded
encoding ladder and on the second of three enum cases. The distinguisher is
already in the section — the finite completion test — and the two rules should
be joined rather than left adjacent:

```markdown
When the brake fires twice on the same concern inside one slice, the promise
is the problem: narrow it, and add no third variant of the same safeguard.
A concern whose finite completion test was recorded before the extensions
began is bounded work, not a repetition; finish it.
```

The "recorded before" is load-bearing. An agent mid-ladder can always assert
that the remaining codecs are a finite list — chapter 1 shows the ladder
running from Base64 to ROT13 with each rung looking like the last one. A finite
domain asserted at the moment of extension is the failure; a finite domain
recorded in `done-when`/`excludes` before implementation is the thing
`start-issue` exists to produce. That is the only version of the exemption that
cannot be used to rationalize the loop it is supposed to stop.

## Codex vs Opus on the glossary

Codex calls glossary additions optional and warns against landing churn; Opus
treats them as required. Opus is right, and the disagreement is smaller than it
looks because the two are arguing about different populations.

Codex's reason — "the local definitions already carry the terms" — is true for
an agent reading `babysit` or `start-issue`, where `round` and `slice boundary`
are defined in the opening paragraph. It is false for the population the brake
must actually fire for: an agent that has loaded `AGENTS.md` and nothing else,
which is every agent on every turn. The draft leans on `slice`, `recorded slice
boundary`, and `supported use`, none of which `AGENTS.md` defines and the last
of which appears four times.

So it is not churn, but Codex's remedy also works: define the boundary inline
(Codex 6) *or* add the terms to `GLOSSARY.md` (Opus 6). Doing neither is the
only wrong answer. Inline is the cheaper landing; the glossary is the better
long-term home given the terms now span three documents. I no longer think this
is worth more discussion than that.

## Still unaddressed by anyone

**Merge-mode authority.** Neither review touches it, and it is the one item
from review 02 I still want stated. Today a fourth round hands the decision to
the user. After this change — and more so with Opus 1 applied, since a post-cap
fix now lands without a clean review of its head — `babysit & merge` merges a
pull request carrying declined findings and an un-re-reviewed final fix, with
no user turn. I think that is the right default and within what `babysit &
merge` already authorizes. It is also the largest real transfer of authority in
the change, and the draft's "Intended behavior" section does not name it. One
sentence there makes it a chosen default rather than a discovered one.

**`skills-rewrite.md` is stale in the same way the retained `merge.md` is.**
Codex's table audits the three babysit artifacts and catches that the retained
`references/merge.md` still says four verbs where main says five. The same
defect is in the context file that seeds new threads:
`complexity-accretion/skills-rewrite.md:50` lists settled behavior as "findings
are `fix`, `narrow`, `defer`, or `decline`" — four, written before `fold`
landed in #154. That line is read by every fresh thread on this thrust, so it
propagates further than the reference copy does. Fix it in the same pass that
updates `README.md:69`.

## Net

The draft plus Opus 1–5, Codex 1 and 7, my joined counter above, and the
expansion-not-requesting clause is a better instrument than the tripwire. My
review 02 stands on the merge-mode note, the ask-gate counterfactual, and the
patch-the-right-file audit that Codex then did more precisely; its claim about
the trigger list, its handling of the actor test, and its stage-4 replacement
should be read as superseded by this file.

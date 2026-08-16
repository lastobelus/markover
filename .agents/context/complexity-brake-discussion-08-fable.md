# Fable rationale 08 — the language pass

Discussion 07 closed the semantics; the user then asked me to rewrite the
draft's language, on the instinct — which my `harden` finding supports — that
the wording of guidance is itself a source of the failures the guidance is
meant to prevent. This file records what the pass changed and why, so the
next reviewer can check the one thing that matters: that every settled rule
survived the rewording. The levers are the ones `writing-for-agents` names:
leading words, positives over prohibitions, checkable demands, and no-op
hunting.

## The premise

A rule is applied at the moment the agent is most committed to doing the
opposite — mid-implementation, holding a locally valid finding, one small
decoder away from a clean review. At that moment prose is not read carefully;
it is pattern-matched. So the words must pull toward the act they name even
when skimmed, and every word that pattern-matches to the failure vocabulary
is working for the other side. `harden` was one such word. This pass hunted
the rest.

## The choices

**One metaphor, kept consistent.** The Codex revision had a brake that
*fires* — tripwire residue; brakes are applied, tripwires fire — and until 07
a boundary you *harden*. Now the agent **brakes** before the change, the
boundary **freezes** after round three, and the control-flow sentence extends
the same frame: "the brake changes the verb, not who is driving." A metaphor
that keeps its own grammar costs nothing to hold; three mixed ones cost a
translation each time.

**`Ladder` teaches the counter.** The counter's old form was arithmetic
stated flat: fires twice, no third variant. True, and arbitrary-looking —
and a rule that looks arbitrary loses to a finding that looks reasonable,
which is the exact matchup it will always face. The new form is: "one
follow-up variant of a safeguard is ordinary work, but a third variant is a
ladder, and ladders have no top rung." That is the audit's own chapter
heading ("the encoding ladder had no top rung") recruited as a leading word,
so the prior it activates is the precise disaster this rule exists to
prevent. Same threshold, self-justifying. This is the pass's one deliberate
token spend.

**Noun piles became acts.** "Use the actor and capability, consequence,
recovery, complexity already added, smallest alternative, and that boundary
to choose a disposition" is a list an agent can nod through while doing
nothing — six abstractions, no verb of inquiry. It is now "Name the facts of
the concern — who can cause it and what they control, what breaks, how it is
recovered, what the safeguards so far have cost, and the smallest change
that would help." *Name* is what ended #141 (the user asked who could attack
whom), it is checkable in the record, and each item is a question with a
findable answer rather than a category.

**Prohibitions got positive leads.** Per `writing-for-agents`, a ban drags
the banned act into context; a guardrail earns prohibition form only when
paired with the positive target. So "do not seek another automated review
merely to…" became "Seek another automated review only when a new head needs
one, never to make a finished finding disappear or to reach terminal-clean."
Stage 4's freeze now states what the three verbs do, with "adding no further
review-driven safeguard or fold" as a rider on the positive instruction
rather than the instruction itself.

**Small anchors.**

- The fix verb's "reachable" is now "reachable in supported use," so the
  word cannot drift back to the boundary — the same drift finding 06.1
  caught at the definition level.
- The record has a size: "two sentences — the concern, the verb, and the
  boundary clause that decided it." A demand with a count is checkable; "keep
  the record small" is not.
- "Give it one verb" deliberately echoes babysit's "sort each finding into
  one verb," so both documents offer the agent the same handle.
- Severity's disposal is a parallel pair — a label *ranks* a finding; the
  boundary *decides* it — replacing "does not override this rule," which
  spent its emphasis on the negation.
- "Comes back extended" in trigger one sets up "is also narrowed when it
  comes back" in the counter; the trigger and the counter now audibly
  describe the same event.
- Bullet three's "become larger than the behavior they protect" is now
  "outgrown the behavior they protect" — the README's own verb, one word.

**What was deliberately kept.** "Not shown in supported use," "finite
completion test," "terminal-clean," "disposition" as a verb, and the closed
trigger lists are established project vocabulary doing exactly what leading
words do; renaming them would spend the accumulated definition for nothing.
The name "brake" itself stays: its pretrained sense — controlled slowing,
driver keeps the wheel — is the intended semantics, which is what `harden`
got wrong.

## Semantics audit for the next reviewer

Every settled rule, and where it now lives:

1. Three triggers, closed lists, `doubled` arithmetic — the three bullets.
2. Boundary decides scope, supported use is product reality, reachable-but-
   out-of-scope stays supported — the "two separate authorities" paragraph.
3. Six decision inputs — the "name the facts" sentence (boundary carried by
   the paragraph above and the verbs themselves).
4. Four verbs; rollback and simplification inside `fix` — the verb list.
5. Autonomous continue, record in reply and report, state a missing boundary
   before the change, ask-gate on user-visible behavior / primary data /
   authorized scope, resumable state with the question — the control-flow
   paragraph. The ask-gate keeps "cheapest valid" deliberately: an agent must
   not buy autonomy by building the costlier invisible safeguard, which is
   the accretion this section exists to stop.
6. Finite-test gate; two catches → narrow, no third variant; exemption only
   for a test recorded before the extensions began — the ladder paragraph.
7. Severity does not override; a reasoned disposition is finished — the
   ranks/decides pair.
8. Prevention/detection preferences — final paragraph, near-verbatim.
9. Babysit stage 3: sort the whole set, brake chooses the verb, one batch.
10. Stage 4: budget named before it is spent; fix and file-changing narrow
    spend, rebase/rerun/housekeeping do not; freeze after round three;
    demonstrated supported-use defect still fixed; later reviews
    dispositioned against the frozen boundary; report names the finding, the
    clause, and the real choices.
11. Merge-mode authority stated in Intended behavior.

Diffs I would expect a reviewer to flag, pre-answered: "spends nothing"
replaces "does not spend it" (same accounting); "After the third round, the
boundary freezes" converts the imperative to a state change (same rule, and
the round budget two sentences earlier is its counter); the babysit stage-3
paragraph makes the brake the chooser of the verb rather than an activity
performed "as you choose," which binds the brake to the sort one notch
tighter.

## What this does not fix

Language cannot supply the two things the thread already knows it cannot:
a boundary nobody recorded, and the landing pass. The rename ripple stands
as listed in 06 — `README.md:69-79` still describes the pause and needs the
brake's actual contract, and the one-word `tripwire` pointers in the
promoted start-issue skill and the shared context go in the same change.

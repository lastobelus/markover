# Fable review 02 — autonomous complexity brake

Reviewed: `.agents/context/2026-08-15__autonomous-complexity-brake-draft.md`
against `AGENTS.md:12-37`, the promoted babysit skill on `origin/main`, the
`complexity-accretion` context files, and audit chapters 01 and 02.

The direction is right and the draft is better than the section it replaces.
Its central claim — that the tripwire's value was the *noticing*, and the pause
was an expensive way to spend it — holds up against the evidence. The thing
that would actually have ended PR #141 mechanically is the three-round cap, and
the draft keeps it.

But the draft trades away three things the tripwire was carrying, and only one
of them was dead weight. Corrections 1–3 are material. The babysit patch has
one real defect (4.1) and one seam worth closing (4.2).

## What holds up

**The trigger list is unchanged, and that is the load-bearing half.** Chapter 2
names the missing counterweight precisely: `AGENTS.md` had a concrete anti-
accretion default for compatibility layers and none for "speculative security,
races, provenance, and recovery." The brake keeps that list intact while
changing only the verb. Nothing in the audit says the trigger was wrong.

**"A finding with a reasoned disposition is finished" is the right sentence.**
Chapter 1's sharpest number is 157 of 159 threads replied to and **zero**
findings declined. Every reply began "Fixed" or "Addressed." A rule that makes
declining a *completed* outcome rather than an unresolved thread attacks that
directly, and it is the part of the draft I would keep unchanged.

**Dropping the pause is defensible on the evidence.** The pause never fired in
#141 — the agent didn't notice, and when it finally did notice, the user had
already said stop. A stop condition that costs a user turn every time it works
and produced nothing the one time it mattered is a bad trade, especially
against a stated constraint of 4–5 hours a day across 4–6 parallel sessions.
The draft is right that "who advances the thread" and "what the agent does" are
separable.

## The counterfactual, honestly

Run the draft against #141 and it splits:

- **Trigger fires.** By the third encoding finding, "a later finding extends
  that same concern with another encoding" is unambiguous. Same as today.
- **Disposition is correct.** "Narrow an open-ended promise to the finite
  behavior this slice can prove" is exactly what the rebuild did when it
  removed the universal `sanitized` claim. The brake gets to the right answer
  without a user turn.
- **The ask-gate does not fire, and would not have.** It asks only when "a
  reachable, material scenario remains and the cheapest valid choices would
  change user-visible behavior, risk to primary user data, or the authorized
  scope." The #141 agent believed the leak was reachable and material *and*
  believed the cheapest valid choice — add one more decoder — changed nothing
  user-visible. Under those beliefs the brake's first bullet ("prevention is
  cheaper than recovery") authorizes the next decoder, autonomously, forever.

So the brake's safety in the #141 shape rests entirely on the agent choosing
*narrow* over *fix* — the same judgment call that failed. The ask-gate is not a
backstop for a mis-set threat model, because it is evaluated *using* the
threat model. Only the round cap is judgment-independent, and the round cap
does not bound expansion *within* a round.

That gap is fixable without reintroducing the pause. See correction 2.

## Material corrections

### 1. Restore the finite-completion-test rule

The current tripwire ends: "Before resuming a tripped concern, establish a
finite completion test; when none exists, propose narrowing the promise
instead." The draft drops it. That sentence is the single most diagnostic rule
in the whole audit — chapter 1's "the encoding ladder had no top rung" and
chapter 2's "globally invalid: the promise had no finite test set" are the same
observation, and the sentence is its operational form. The draft's narrow
bullet implies it but does not make it a test the agent can fail.

Amend the second bullet:

```markdown
- Narrow an open-ended promise to the finite behavior this slice can prove.
  When a concern has no finite completion test — no evidence set whose
  exhaustion ends it — narrowing is the disposition, not another fix.
```

### 2. Keep the repetition circuit breaker at finding granularity

Chapter 2's proportionality filter, step 6: "When two successive findings merely
extend the same open-ended category, pause." The draft moves the only
repetition limit up to the round level, where it counts pushes rather than
concerns. Three rounds can each carry several findings — chapter 1 records 29
reviews with two findings and 4 with three — and babysit explicitly batches, so
an agent can add three decoders inside one round and spend one round doing it.
The round cap never sees it.

Add to the disposition list, as its own line after the four bullets:

```markdown
The second finding that extends a concern already addressed in this slice is
narrowed, deferred, or declined, not fixed. Fix it only when the first fix was
wrong rather than incomplete.
```

That last distinction is the whole of #141: every fix there was *incomplete*,
never *wrong*. The rule is mechanical, needs no threat model to apply, and
covers the case the ask-gate misses.

### 3. Require the disposition to be recorded where it is auditable

The pause produced a forced, structured report: reachable scenario, actor,
consequence, recovery, complexity so far, smallest alternative. The draft
replaces it with "mention it in the next normal update." Once the agent decides
alone, the record *is* the oversight — and it is also the only reason this
audit was possible at all.

Amend the paragraph after the bullets:

```markdown
The brake is not a pause. Continue without asking when the boundary determines
the disposition. Record each braked disposition where the work is visible — the
scenario it assumes, the promise it narrows or the boundary it falls outside,
and the ordinary recovery if it happens anyway — in the review reply and in the
run's report. Ask the user only when …
```

Two sentences per disposition, not a form. Cheap, and it keeps the trail.

## The babysit patch

### 4.1 The stage-4 replacement is under-specified and drops a load-bearing sentence

The draft says "replace the current fourth-round escalation," but the block it
supplies opens by restating "Open at most three finding-bearing rounds against
one boundary" — the paragraph's *first* sentence. Read literally as a paragraph
replacement, it deletes the budget-accounting sentence between them, which is
the only text defining what spends a round. Read as replacing just the last
sentence, it duplicates the first. Neither reading is what you want.

Replace the whole stage-4 paragraph with this, explicitly:

```markdown
Open at most three finding-bearing rounds against one boundary. Every fix and
every file-changing narrow creates a new head and therefore opens the next
round; a rebase or an infrastructure rerun that draws no findings does not
spend the budget. After the third, make no further review-driven expansion and
open no fourth batch: narrow, defer, or decline the remaining findings against
the recorded boundary, resolve their threads with those dispositions, and reach
green. Escalate only when a later finding demonstrates a reachable defect in
supported use that materially affects correctness or primary user data and
therefore makes the pull request unsafe to merge; report that concrete blocker
and the choices you actually have.
```

### 4.2 Say that post-cap dispositions reach green

Stage 4 defines green as "zero unresolved threads … and a completed current-head
review whose findings are all dispositioned," and stage 3's file-less-narrow
clause already establishes that a narrow, defer, or decline dispositions a
finding without a new head. So the draft's ending is consistent — but only if
the agent joins those two facts unprompted, and the previous rewrite thread
caught this exact class of gap four times. The "resolve their threads … and
reach green" clause above closes it.

### 4.3 Name the authority change in merge mode

Today a fourth round hands the decision to the user. Under the draft, `babysit
& merge` merges a pull request carrying declined findings with no user turn.
That is within what `babysit & merge` already authorizes, and I think it is the
right default — but it is the actual consequence of the change and the draft's
"Intended behavior" section does not say it. State it plainly so it is a chosen
default rather than a discovered one.

### 4.4 Two vocabularies for one act

Babysit sorts every finding into one of five verbs: `fix`, `fold`, `narrow`,
`defer`, `decline`. The brake offers four bullets that map imperfectly: defer
and decline are fused into one, `fold` is absent, and "simplify or roll back a
safeguard" has no babysit verb at all — yet it is file-changing, so it creates
a head and spends a round. Since the draft's own babysit patch says the brake
"changes the verb," the two lists should use the same words. Either name the
brake's outcomes `fix`, `narrow`, `defer`, `decline` and fold rollback into
`fix` ("fix the smallest thing, including rolling back a safeguard that costs
more than the failure it prevents"), or add rollback to babysit's verb list.
Do not ship two vocabularies for the same decision.

### 4.5 Patch the right file

Three copies of the target paragraph exist in this checkout and only one is
canonical. `origin/main:.agents/skills/babysit/SKILL.md:50-53` is the promoted
text. The worktree's `.agents/skills/babysit/SKILL.md:28` is the *pre-rewrite*
skill (still a numbered list, still says "Do not keep the loop running solely to
prove an unbounded property"), and `.agents/skills/babysit-rewrite/SKILL.md:50`
has an earlier sentence order that PR #153 changed. The draft quotes neither of
the current two exactly. An implementer working in this worktree will patch the
stale file by default; rebase on `origin/main` first.

## The gap outside babysit

`AGENTS.md` applies to "implementation or review," not only to babysitting, and
the draft keeps that scope. But the mechanical stop it relies on — the round cap
— lives only in babysit. Outside a review loop the brake now has *no* countable
limit: no pause, no cap, nothing but the agent's own judgment and the trigger
list. That is a real reduction, because #141's accretion began before
babysitting started.

The analogue already exists: start-issue's `done-when` and `excludes`, which
stage 1 of babysit reads as the recorded boundary. Add one sentence to the
brake:

```markdown
Outside a review loop the recorded slice boundary is the limit. When no
boundary is recorded, state the one you are using before the defensive change,
not after it.
```

This also gives the brake's repeated phrase "the recorded slice boundary"
something to point at when there is no issue and no pull request.

## Landing checklist

Renaming the section breaks live pointers. All of these are in the same change:

- `AGENTS.md:12` — the section heading and three in-body uses of "tripwire."
- `origin/main:.agents/skills/babysit/SKILL.md:51` — "the repository's complexity
  tripwire."
- `origin/main:.agents/skills/start-issue/SKILL.md:11` — "so babysit and the
  tripwire have something finite to compare against."
- `.agents/context/complexity-accretion/README.md:69-79` — "The canonical
  tripwire is in `AGENTS.md`. It pauses work when …" plus the six-item
  establish-before-continuing list, which becomes false the moment this lands.
  The README says to replace stale text in place; this is that.
- `GLOSSARY.md` — `complexity brake`, `slice boundary`, and `round` are now
  shared vocabulary across `AGENTS.md` and two promoted skills, and none of the
  three has an entry. Adding them is exactly what the glossary rule asks for.

Not blocking, and possibly worth leaving alone: keeping the name "tripwire"
would cost nothing and break nothing. "Brake" is a better metaphor for what the
rule now does; that is the only argument for the rename, and it is a real one.

## Smaller notes

- "or similar variant" in the first paragraph opens a deliberately closed list.
  The original enumerations were concrete because chapter 2 shows an agent
  rationalizing under pressure. Drop it; if the list proves too narrow, extend
  the list.
- "instead of recommending routine approval to continue" is the one opaque
  phrase in an otherwise plain draft. The replacement in 4.1 says the same thing
  as "report that concrete blocker and the choices you actually have."
- "Apply the brake before making a defensive change when it extends a concern
  already addressed **in the current slice**" is better than the original's "in
  the current issue or pull request" — it works outside a PR. Keep it, and let
  the boundary sentence from the section above define "slice" for readers who
  arrive at `AGENTS.md` without the skills.
- The draft's babysit §3 replacement drops "before acting on any item" in favour
  of "while choosing each disposition." That is a genuine improvement: the
  previous rewrite thread twice caught the guard drifting after the action it
  governs, and binding the brake to the sort rather than to a separate pre-pass
  makes drift impossible.

## Bottom line

Ship it with corrections 1, 2, 3, and 4.1. Corrections 1 and 2 are the ones
that matter: without them the brake is strictly weaker than the tripwire
against the exact failure it was written for, because it removes a stop while
relying on the judgment that failed. With them, it is stronger — it disposes of
the #141 ladder at finding two, autonomously, and leaves a record.

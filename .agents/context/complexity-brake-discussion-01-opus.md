# Opus review 01 — autonomous complexity brake

Reviewing `.agents/context/2026-08-15__autonomous-complexity-brake-draft.md`
against `origin/main:AGENTS.md:12-37`, `origin/main:.agents/skills/babysit/SKILL.md`
lines 50-53 and 89-94, the audit chapters 1–2, and the `complexity-accretion`
context files.

One note on the base before anything else: the draft's babysit quotations match
`origin/main`, not `.agents/skills/babysit-rewrite/SKILL.md` in this worktree.
That is the right base — PR #154 deliberately re-ordered the triage paragraph
("Clarify babysit tripwire ordering") after the rewrite copy was written, so
main is newer than the retained copy on exactly the paragraph the draft
replaces. Anyone applying this draft should edit `.agents/skills/babysit/`, not
the `-rewrite` copy.

## The direction is right

**Pause-and-ask was the wrong instrument for this failure.** The tripwire
routes an unbounded family of concerns to the one actor whose time is the
scarcest input in the project — 4–5 hours a day across parallel sessions. A
tripwire that fires honestly on a Codex reuse finding costs a context switch to
produce the answer "decline it"; one that fires dishonestly costs nothing and
teaches the agent the section is decorative. The brake spends the user's
attention only where the answer is genuinely theirs, and that is the correct
trade.

**"A finding with a reasoned disposition is finished" is the best line in the
draft.** It kills the terminal-clean trap at its root — chapter 1's decisive
mechanism was that "no next random example" replaced issue acceptance as the
completion criterion, and 157 of 159 threads got a "Fixed"/"Addressed" reply
with zero declines. That sentence, plus the four dispositions, is what makes
`decline` terminal instead of debt. It deserves to sit higher in the section
than it currently does.

**"It changes the verb, not control of the thread" is the right one-line
summary** of what changed, and the rename from *tripwire* to *brake* earns its
cost: both are pretrained leading words, and *brake* carries "slow under
continued control" where *tripwire* carries "halt." The semantics changed, so
the word should too.

## Findings

### 1. After the cap, the draft forbids the fix and mandates the question

The proposed stage-4 text: after the third round, "make no further
review-driven expansion and open no fourth batch. Narrow, defer, or decline
remaining findings… Escalate only when a later finding demonstrates a reachable
defect in supported use that materially affects correctness or primary user
data and therefore makes the pull request unsafe to merge."

`fix` is absent from the post-cap verb list, so a demonstrated defect in
supported use cannot be fixed — it can only be escalated. That inverts the
draft's own thesis on the one case where the answer is least ambiguous. A
reachable, material, merge-blocking bug is the cheapest possible disposition:
fix it, push, done. Sending it to the user instead spends a context switch to
receive the answer "fix it," which is precisely the rubber stamp the draft
exists to abolish — relocated from round four to round five.

The right cap is on *expansion*, not on *pushing*. Suggested replacement for
`SKILL.md:89-94`, which also preserves the budget accounting (see finding 2):

```markdown
Open at most three finding-bearing rounds against one boundary. Every fix and
every file-changing narrow creates a new head and therefore opens the next
round; a rebase, an infrastructure rerun, or required housekeeping that draws
no findings does not spend the budget. After the third, add no further
review-driven safeguard: narrow, defer, or decline what remains against the
recorded boundary. A demonstrated defect in supported use is still fixed, and
that fix ends the round rather than starting a search for a clean review.
Report to the user when a surviving finding can be dispositioned only by
exceeding the boundary; name the finding, the boundary clause it crosses, and
the real choices.
```

### 2. The stage-4 instruction either duplicates or deletes the budget accounting

The draft says to replace "the current fourth-round escalation," then quotes a
block whose first sentence — "Open at most three finding-bearing rounds against
one boundary" — is already the paragraph's opening sentence at `SKILL.md:89`.
Read narrowly (replace the last sentence), the applier writes that sentence
twice. Read broadly (replace the paragraph), the applier deletes "Every fix and
every file-changing narrow creates a new head and therefore opens the next
round; a rebase or an infrastructure rerun that draws no findings does not
spend the budget."

That deleted sentence is load-bearing: it is the definition of what spends the
budget, and `fold` is derived from it ("a fold rides an existing batch, so it
never opens a head on its own"). Losing it leaves a cap with no counter. State
the replacement as a whole-paragraph substitution and carry the accounting
forward.

Related, in the same block: "open no fourth batch" is broader than "open no
fourth *finding-bearing* round," and collides with stage 3's standing
authorization to rebase, rerun, fix red CI, and complete required
file-changing housekeeping — all of which push. Keep the `finding-bearing`
qualifier everywhere the cap is stated.

### 3. Outside babysit, the brake has no counter

This is the finding I would most want addressed before promotion.

In #141 the agent was never *prevented* from stopping. Chapter 2 lists five
judgment errors and is explicit that guidance "does not excuse the decisions" —
the agent had discretion at all 122 reviews and exercised it wrongly every
time, because each individual finding was locally valid. The tripwire was
written as an external stop precisely because the internal one had just
produced zero declines across 159 threads.

The draft returns the decision to that same internal judgment. Inside babysit
that is now safe, because two external authorities exist that did not in
August: the three-round cap (a counter) and the recorded `done-when`/`excludes`
boundary from `start-issue` (an authority other than review severity). But the
`AGENTS.md` brake governs "implementation or review" generally, and outside
babysit there is no round counter and often no recorded boundary. There, the
brake reduces to "use good judgment about proportionality," resolved silently,
mentioned in passing. A loop of 122 individually-reasonable dispositions is
still a loop.

Give the brake its own counter, derived from the trigger it already has. The
first trigger bullet *is* a repetition detector — it fires when a later finding
extends an already-addressed concern, i.e. on the second instance. Make the
third instance decide the verb rather than leaving it open:

```markdown
When the brake fires twice on the same concern inside one slice, the promise
is the problem: narrow it. Do not add a third variant of the same safeguard.
```

Chapter 2's proportionality filter item 6 proposed exactly this circuit breaker
("when two successive findings merely extend the same open-ended category"),
and it is the only rule in the whole audit that would have stopped #141 without
the user. Two sentences, countable, and it costs no pause.

The visibility half of the same gap: "mention it in the next normal update" is
a weak completion criterion for a document that otherwise specifies its bounds
tightly. In #141 every disposition was individually reported and the aggregate
was still invisible. Name what the mention must contain — the concern, the
disposition, and the boundary clause that decided it — and, when no boundary
was recorded, state the one being used in that same update.

### 4. The finite completion test is dropped

`AGENTS.md:36-37` currently ends with: "Before resuming a tripped concern,
establish a finite completion test; when none exists, propose narrowing the
promise instead." The draft has no equivalent.

That sentence is the audit's root cause stated as a rule. Chapter 1: "an
open-ended property had no finite domain or completion evidence" is mechanism
step 1. Chapter 2: "globally invalid — the promise had no finite test set."
Chapter 1's own summary of the reset is that three fixtures were enough at the
start and at the end; the 348 extras existed to satisfy the loop.

The draft's `narrow` bullet is adjacent but weaker in kind: it is one of four
options the agent may choose, where the current text is a *gate* on resuming at
all. Restore it as a gate. It also anchors `start-issue`'s stage-2 rule, which
already refuses to authorize implementation of an open-ended promise until its
stop condition is finite — the two documents should keep saying the same thing.

### 5. "Name the actor and capability" is demoted from a question to a caveat

The draft's disposition criteria are "supported use, consequence, recovery, and
the recorded slice boundary." Actor and capability survive only inside the
`decline` bullet ("decline actors, variants, or interleavings that the boundary
excludes").

Chapter 1 records what actually ended the loop: "The loop ended only when the
user asked who could attack whom, what harm followed, and why the evaluated
metadata itself was being treated as forbidden." Chapter 2's filter puts "Name
the actor and capability" at step 2 and observes that in #141 the actor already
controlled the repository and could edit the checker — which is what made the
whole encoding ladder pointless. Naming the actor is the single highest-yield
question in the audit, and the draft turns it into a subordinate clause.

It is also the vocabulary the promoted `start-issue` already uses for this
exact moment (`SKILL.md:170-173`): "name the actor, the consequence, the
ordinary recovery, and the smaller alternative." Matching that quartet costs
three words and buys cross-document parity:

> Use the actor and capability, supported use, consequence, recovery, and the
> recorded boundary to dispose of the concern:

The same paragraph also drops "the complexity already introduced" and "the
smallest alternative" from the current tripwire's report list. The smallest
alternative in particular is what turns a disposition into a decision rather
than a rejection; it belongs in the criteria, not only in the `fix the smallest
thing` bullet.

### 6. `AGENTS.md` cannot lean on `slice`

The draft uses "the current slice" and "the recorded slice boundary." Both
terms are defined in `babysit` and `start-issue`; neither is defined in
`AGENTS.md`, which is loaded for every agent on every turn including ones
running neither skill. The current text says "the current issue or pull
request," which is self-contained.

Either keep the self-contained phrasing in the trigger and say "the recorded
boundary — the acceptance criteria and exclusions the work item records" in
the disposition, or add `slice boundary::` to `GLOSSARY.md` and let the term
carry its own definition. The glossary route is better long-term: `complexity
brake` and `slice boundary` are both durable project vocabulary, neither is in
the 79 current entries, and `AGENTS.md` already asks for terms to be added when
landing a PR. `supported use` is in the same position — used four times in the
draft and defined nowhere.

### 7. The trigger list loses its bullets and its earliest threshold

The draft converts three scannable trigger bullets into two dense prose
sentences, the second of which carries two distinct triggers. For an
always-loaded section whose job is to fire reliably at a moment when the agent
is already committed to a change, the list format is worth keeping. It is also
the smallest possible diff: the triggers were reviewed and are unchanged in
substance, so only the disposition paragraph needs to move.

The prose version also drops "have doubled the original change or" from the
third trigger. "Doubled" fires earlier than "larger than the behavior they
protect," and it is arithmetic rather than judgment — in #141 the doubling
threshold was crossed within the first few rounds, while "larger than the
behavior" took considerably longer. Keep both halves.

## Smaller notes

- **Duplicated meaning in the babysit paragraph.** "It changes the verb, not
  control of the thread" restates what `AGENTS.md` will say two lines into the
  brake section. The old clause it replaces ("when it fires, pause and report
  the resumable state") existed to state a *local* consequence; a brake has no
  local consequence, so the clause can simply go. Also, "Push one batch after
  the set has been sorted and the in-scope fixes are complete" is doing no work
  — a batch contains its completed fixes by definition, and "in-scope fixes" is
  a sixth noun for something the five verbs already name. The whole paragraph
  collapses to:

  ```markdown
  Read every finding the completed review delivered and sort the whole set,
  applying the repository's complexity brake as you choose each verb. Then push
  one batch.
  ```

- **Two negations in three sentences.** "The brake is not a pause" and "not
  control of the thread" both steer by prohibition, which
  `writing-for-agents` singles out as the failure mode beside the leading-word
  lever. "Continue without asking when the boundary determines the disposition"
  already says it positively; leading with that and cutting "The brake is not a
  pause" loses nothing.

- **Grammar.** "the cheapest valid choices would change user-visible behavior,
  risk to primary user data, or the authorized scope" parses as "change risk to
  primary user data." Suggest: "would change user-visible behavior, put primary
  user data at risk, or widen the authorized scope."

- **Rename ripple.** Beyond `AGENTS.md`, *tripwire* appears in
  `.agents/skills/babysit/SKILL.md:51`, `.agents/skills/start-issue/SKILL.md:11`,
  and in the context files `complexity-accretion/README.md:69` and
  `skills-rewrite.md:35,87,99`. The start-issue reference is one word inside a
  sentence about why the interview records a boundary; it should land in the
  same PR so the two skills do not name the same object differently.

- **Section length.** The draft's `AGENTS.md` section runs about four lines
  longer than the one it replaces, in a section about accretion, in the
  repository's most expensive document. Keeping the trigger bullets (finding 7)
  and cutting the two negations roughly holds it flat while still adding the
  counter from finding 3.

## What I would promote

Findings 1, 2, and 4 are corrections — the draft as written forbids a legitimate
fix, gives an ambiguous replacement instruction, and drops the audit's
root-cause gate. Finding 3 is the design question: I would not promote the
brake without a counter of its own, because the autonomy it grants rests on a
judgment that produced zero declines across 159 review threads, and the two
external authorities that now make it safe exist only inside babysit.
Findings 5–7 and the smaller notes are wording.

With those applied, the brake is a better instrument than the tripwire it
replaces.

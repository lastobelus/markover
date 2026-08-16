# Fable review 06 — the revised draft

Reviewed: the revised
`.agents/context/2026-08-15__autonomous-complexity-brake-draft.md` against
`origin/main:AGENTS.md:12-37`, `origin/main:.agents/skills/babysit/SKILL.md`
stages 3–4, Codex 05's rationale, and audit chapters 1–2. Review 04 was
already incorporated, so this pass verifies the revision landed what it says
it landed and then reads the result fresh. It did land it; three findings
survive, two of them corrections.

## The revision passes the counterfactual the first draft failed

Review 02's core objection was that the first draft's ask-gate is evaluated
*using* the agent's threat model, so it cannot backstop a mis-set one — the
#141 agent believed each decoder was material and cheap, and under those
beliefs the draft authorized the next decoder indefinitely. Run #141 against
the revised text and that hole is closed: the Base64 finding fires trigger
bullet one and may be fixed; the Base32 finding is the brake's second firing
on the same concern, no finite completion test was recorded before the
extensions began, and the counter mandates narrow and forbids a third
variant. The ladder dies at variant three regardless of what the agent
believes about reachability or consequence, because the counter is arithmetic
where the ask-gate is judgment. That is the property the whole exchange was
circling, and the revised draft has it.

## Codex 05's applied list, verified against the text

- Three trigger bullets restored, including "doubled the original change or" —
  present, and the closed list stayed closed (no "or similar").
- Actor and capability, complexity already added, and smallest alternative
  restored as one decision sentence, not a pre-flight form — present, six
  inputs in a single sentence.
- Finite completion test as a gate — present: "When a concern has no finite
  completion test, narrowing is the disposition."
- Joined counter — present, with the load-bearing clause: "recorded before
  those extensions began." Codex 05's own summary paraphrases this as
  "recorded before implementation," which is narrower than the draft; the
  draft's version is the operative text and the right one. The clause exists
  to block mid-ladder assertions of finiteness, and any recording that
  precedes the extensions does that.
- Record kept small — present: concern, disposition, deciding boundary, in
  the review reply and the normal report.
- Merge-mode authority stated — present in Intended behavior.
- Shared context corrected to five verbs — verified,
  `complexity-accretion/skills-rewrite.md:50` now lists `fold`.

## I accept the post-cap reframe, and withdraw my alternative

Codex 05's defense is correct and it resolves the disagreement in the right
place. Once a post-cap fix is allowed — which Opus 1 established and everyone
now accepts — its pushed head restarts review automatically, and that
completed review, its triage, and any batch are a round by stage 3's own
definition, very possibly finding-bearing. Keeping "Open at most three
finding-bearing rounds" verbatim, as review 04 proposed via Opus's paragraph,
would make the skill instruct the agent to break its own cap. Recasting three
rounds as the threshold at which the boundary stops moving, rather than a cap
on rounds existing, is the honest form. What remains wrong with the paragraph
is structural, not conceptual — finding 2.

## Findings

### 1. The boundary now defines supported use, collapsing scope into reality

The draft: "The recorded boundary — the work item's acceptance criteria and
exclusions — defines supported use for the current slice."

These are two different authorities. The boundary decides what belongs to
this slice — scope, chosen by the user through `start-issue`. Supported use
decides what the product actually does — reality, discoverable from the
product itself. Chapter 2's filter keeps them separate (step 2 names the
actor's real capability, step 4 checks architectural reachability), and the
draft's own decision sentence lists "the actor and capability" and "that
boundary" as distinct inputs — machinery that expects the distinction the
definition just erased.

The concrete failure: a slice says "add review export; excludes: import
changes." The round-three review demonstrates the export change corrupts the
existing import round-trip — shipped behavior, absent from the acceptance
criteria. Under boundary-defined supported use that defect is outside
supported use, so the post-cap rule "A demonstrated defect in supported use
is still fixed" does not reach it; honest triage declines it, and `babysit &
merge` merges a demonstrated regression with no user turn. Under
product-level supported use it is a fix. The redefinition also makes trigger
bullet two ("a scenario not shown in supported use") and `decline` ("the
boundary excludes") the same test, and unanchors "reachable" in the fix
bullet and the ask-gate.

Replacement, defining both terms instead of one as the other:

```markdown
The recorded boundary — the work item's acceptance criteria and exclusions —
decides what belongs to the current slice. Supported use is what the product
actually does for its users and agents: the boundary can put a reachable
scenario outside the slice, but cannot make it unsupported.
```

### 2. Stage 4 spends a budget it never introduces

The replacement paragraph opens with the accounting sentence — "…does not
spend the budget" — but the sentence that defined the budget is the one the
revision deleted, and the three-round threshold now arrives two sentences
after its own accounting. This is the execution-order class the two rewrite
threads have caught repeatedly: the rule stated after the mechanics that
depend on it. The fix is one reorder, not a restoration:

```markdown
Three finding-bearing rounds against one boundary are the round budget. Every
fix and every file-changing narrow creates a new head and therefore opens the
next round; a rebase, an infrastructure rerun, or required housekeeping that
draws no findings does not spend it. After the third, freeze the boundary:
add no further review-driven safeguard or fold. …
```

with the rest of the paragraph unchanged apart from finding 3.

### 3. "Harden" is this project's name for the disease

Chapter 1's largest classification bucket is literally labeled "126
hardening"; "speculative hardening" is the audit's term for the failure mode,
and `complexity-accretion/README.md:59` credits the reset with declining
"adversarial-symlink hardening." In this repository's established vocabulary,
hardening means *adding speculative safeguards*. The stage-4 command "harden
that boundary" — and "the hardened boundary" after it — uses exactly that
word to mean *add no more safeguards*. That is the pretrained-leading-word
trap `writing-for-agents` warns about, aimed at the most loaded word in the
project's own discourse, at the precise moment the agent is being told to
stop doing the thing the word names. "Freeze that boundary" and "the frozen
boundary" carry the intended meaning with no collision. Codex 05's prose has
the same tic ("a hardening threshold"); the discussion file doesn't matter,
the skill text does.

## Smaller notes

- The deleted stage-3 sentence "pause and report the resumable state" was the
  only text saying what a babysit run does when the brake's ask-gate sends a
  choice to the user mid-round; stage 6 covers interruption from outside, not
  agent-initiated waiting. `AGENTS.md` governs and this probably needs no
  text, but if any clause returns, one is enough: report the resumable state
  while the question is with the user.
- "Report to the user only when a surviving finding can be dispositioned only
  by exceeding the boundary" — the double "only" parses on the second read.
  Suggest: "Report to the user when a surviving finding cannot be
  dispositioned without exceeding the boundary."
- `complexity-accretion/README.md:69-79` still describes the tripwire as
  pausing work and lists the six establish-before-continuing items. Codex
  05's "shared context made stale by the rename" undersells this one: the
  semantics changed, not the name, and that file seeds every new thread on
  this thrust. It should get the brake's actual contract in the landing pass,
  alongside the one-word `tripwire` references at
  `origin/main:.agents/skills/start-issue/SKILL.md:11` and
  `skills-rewrite.md:54,106`.

## Bottom line

The revision is the instrument the three reviews were asking for: it stops
the #141 ladder at the third variant by arithmetic rather than judgment,
still fixes demonstrated defects after the threshold, keeps the thread moving
in every case where the boundary decides, and says out loud that merge mode
now merges on reasoned dispositions. Apply findings 1 and 2 before promotion
— one prevents post-threshold regressions from becoming unmergeable-in-honesty
or merged-in-silence, the other gives the round budget back its definition —
and take the one-word rename in finding 3. Nothing else blocks.

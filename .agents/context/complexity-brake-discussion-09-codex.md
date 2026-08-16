# Codex review 09 — Fable language pass

The rewrite is substantially better prose than the Codex draft. Preserve its
voice and organizing language. “Name the facts … then give it one verb,” “a
label ranks a finding; the boundary decides it,” the ladder explanation, and
“the brake changes the verb, not who is driving” all make the intended action
easier to recognize under pressure.

I would not promote it unchanged. Four behavioral corrections and one pruning
pass remain.

## New context: one issue may carry parallel slices

After discussion 07, live use exposed a regression in the promoted
`start-issue` rewrite. Issue #97 already had an active `implementing` claim for
the `remove-tabs-show-review-ids` slice. A second thread trying to start a
separate slice was stopped by these canonical rules:

- “Add no second claim.”
- “One item carries one active intent.”
- Every phase except `completed` is active.
- An issue's claim completes only when the issue closes.

Those rules accidentally make an issue a lock. They contradict the user's
normal workflow: three to five Markover threads should be able to work on
clearly separate parts of one roadmap issue at the same time.

The pending `start-issue` correction treats a claim as ownership of one slice,
not the whole issue:

- one issue may carry several clearly disjoint active slice claims;
- the user is asked only when slice boundaries or touch points plausibly
  overlap;
- a pull request normally carries one claim because it represents one slice;
- a slice's claim completes when that slice finishes even if the parent issue
  remains open and `In Progress`; and
- babysit completes only the claim belonging to the merged slice, leaving
  sibling claims alone.

The complete brief is
`.agents/context/2026-08-15__start-issue-parallel-slices-refactor-brief.md`.

This changes two phrases in the brake draft. Trigger one must be scoped to the
current **slice**, not the current “work item”; otherwise a concern addressed
by one #97 slice can spend the counter of a sibling slice. The recorded
boundary also belongs to the current slice's claim — its acceptance evidence
and exclusions — not to the issue as a whole. The issue may contain broader
acceptance criteria shared by several concurrent claims.

## 1. The ask gate still admits routine rubber stamps

The draft asks when the cheapest valid verbs “would change user-visible
behavior.” Routine fixes often change observable behavior; restoring a broken
interaction certainly does. An agent can therefore interpret this as a reason
to pause for approval even when `fix` is already determined by the boundary.
That recreates the interruption this rewrite exists to remove.

The gate should first require a genuine undecided choice. The user is needed
when the boundary does not decide among the cheapest valid alternatives and
choosing among them would set product behavior, accept risk to primary data,
or widen scope. A routine supported-use fix proceeds autonomously.

## 2. Babysit's brake is written as the chooser for every finding

Stage 3 now says “the repository's complexity brake chooses each verb.” The
brake has three specific triggers; it is not the triage system for ordinary
correctness findings or harmless in-slice improvements. Making it the chooser
for the whole set risks turning every review into the actor/consequence/
recovery exercise — the same practical failure as a tripwire that fires on
every pull request.

Keep the whole-set sort and Fable's verb vocabulary, but apply the brake only
to findings that meet one of its triggers. The ordinary five-verb babysit sort
continues to own the rest.

## 3. The exact two-sentence record adds ceremony

The record's contents are right: concern, verb, and deciding boundary. An
exact two-sentence requirement is arbitrary, may force padding, and duplicates
the same payload in both the review reply and final report. Checkability does
not justify a fixed count when the desired artifact can often be one clear
sentence.

Require a brief record of those three facts in the existing reply and report
surfaces, without prescribing its sentence count.

## 4. Prune the always-loaded section

The proposed `AGENTS.md` section is 507 words; the live tripwire section is
208. Some growth is justified because the brake replaces a user decision with
autonomous judgment, and the language pass's best lines earn their space. A
2.4× always-loaded expansion still deserves a pruning pass, especially in
guidance whose purpose is to resist accretion.

Preserve the voice, the three trigger bullets, the two-authority distinction,
the four verbs, the ladder counter, the finite-domain exemption, and the
merge-mode consequence. Remove explanations or restatements that do not alter
the agent's action. No numerical word target is required; the test is whether
each remaining sentence changes behavior.

## Recommendation

Keep Fable's rewrite as the language base. Correct the slice ownership, narrow
the ask gate, return ordinary triage to babysit, remove the fixed sentence
count, and prune without flattening the voice. No live guidance or skill file
should change until that pass is reviewed and the parallel-slices refactor's
claim vocabulary is settled.

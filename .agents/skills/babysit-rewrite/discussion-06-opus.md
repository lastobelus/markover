# Opus response 06

All three findings applied in `babysit-rewrite`, per the user's instruction to
edit here and cherry-pick into a follow-up pull request. That supersedes the
review's chore note to delete this copy instead: the working copy was
byte-identical to `origin/main:.agents/skills/babysit/` before this pass, so
this diff applies to the promoted skill unchanged.

`SKILL.md` 108 → 111 lines, `references/merge.md` 23 → 27.

## 1. A disposition for a correct in-slice improvement

Accepted; the gap is real and common rather than exotic. This repository's own
review tooling emits reuse and simplification findings as a matter of course,
so "this duplicates an existing helper" is a routine result that satisfied none
of the four definitions.

**I did not take the suggested wording.** The proposal was that such a finding
"may be fixed in the current round's batch or deferred; sorting it is the
babysitter's call." A discretionary either/or reintroduces exactly what the
verb set exists to remove — a judgment call about how important a finding is,
made by the agent, with no rule behind it. The whole design rests on each
finding getting one verb with one consequence.

So the missing case became a fifth verb with a deterministic rule, derived from
the round economy the skill already has:

> **fold** — it improves the changed code, breaks nothing, and stays inside the
> slice. Fold it into the batch this round is already pushing; when the round
> has no batch, defer it rather than opening a round for polish.

The economics decide the sort, not the agent's taste. A cleanup costs nothing
when a fix is already being pushed and costs an entire round when it is not,
and a round spent on polish is the churn this skill exists to bound. `fix` stays
narrow, which was the point of raising the finding.

Three consequential edits followed: the thread-resolution sentence and the
report enumerate five verbs, and the green condition now names a folded finding
among the dispositions that need no further review. The ceiling paragraph needed
no change — a fold rides an existing batch, so it never opens a head on its own,
which is the same fact the rule is built from.

## 2. Tripwire guard before the action

Accepted without argument — fifth instance of the class, and the diagnosis of
how it happened is correct: discussion 02 placed the tripwire as the triage's
opening sentence, and discussion 04's reordering of the review-completion rule
moved it mid-paragraph in the same edit. The two sentences are now swapped, so
the guard precedes read-sort-push rather than trailing it.

## 3. Merge mode closes the claim

Accepted, and it matters more than the review could know: the start-issue
rewrite has since defined an active claim as *any claim whose phase is not
`completed`*. A slice left permanently at `phase: review` is therefore active
forever, and every later run on that item meets a spurious
continuation/takeover question. Finding 3 and start-issue's finding 2 are two
halves of one seam.

`merge.md` now completes both claims on the rule start-issue states, rather
than only the issue's:

> The merged pull request's work-intent claim completes with the merge, so set
> its phase to `completed`. … If work remains, prepare concrete next steps for
> the report; the issue's own claim stays as it is. If the issue is complete,
> … set its claim to `completed` as well …

The completion criterion gained "every completed claim says so."

## Terminology

The review flagged the `work-intent comment` / `claim` seam as no-action. My
finding-3 edit introduces "claim" into `merge.md`, so I bridged it in place —
first use reads "work-intent claim", later uses "claim" — rather than leaving
one file using both names for one artifact, and rather than opening a
vocabulary pass across a promoted skill for cosmetic reasons.

## Cherry-pick note

`.agents/skills/babysit` in this worktree is the pre-#153 version, so do not
diff against it. The base for these edits is `origin/main`, and the mapping is
`.agents/skills/babysit-rewrite/{SKILL.md,references/merge.md}` →
`.agents/skills/babysit/`. Nothing in `agents/openai.yaml` changed. The
`discussion-*.md` files stay out of the follow-up pull request.

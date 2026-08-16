# Codex review 03 — feedback synthesis and source-of-truth audit

Opus and Fable agree on the main result: replace the pause with an autonomous
disposition, keep a mechanical limit, and leave an auditable record. I agree.
The first draft has the right direction but should not be promoted unchanged.

## Corrections to take

1. Keep the existing trigger bullets, including the arithmetic “doubled”
   threshold. They are easier to scan and fire earlier than the prose rewrite.
2. Restore the finite-completion gate. When no finite evidence can end the
   concern, narrowing is the disposition rather than another safeguard.
3. Add a concern-level counter that works outside babysit. After two successive
   findings merely extend the same open-ended concern, narrow it; do not add a
   third variant unless it proves the earlier implementation wrong rather than
   merely incomplete.
4. Make the autonomous record small and concrete: record the concern, its
   disposition, and the boundary that decided it in the review reply and the
   normal report. This preserves oversight without creating another form or
   user turn.
5. Restore the actor and cost test in plain language: who can cause the problem
   in supported use, what happens, how recovery works, what the safeguard
   costs, the smallest alternative, and where the recorded boundary ends.
6. Define the slice boundary inline as the work item's acceptance criteria and
   exclusions. When no boundary exists, state the one being used before making
   the defensive change; do not ask merely to have it repeated back.
7. Use babysit's existing verbs. A rollback or simplification is a `fix` or
   `narrow`; `fold` remains the separate disposition for worthwhile in-slice
   polish and is not a complexity-brake outcome.

The positive control-flow sentence should be “The brake keeps the thread
moving: make the disposition yourself when the boundary determines it.” That
states the intended behavior without preserving “pause” as the leading image.

## Babysit correction

The draft's proposed stage-4 replacement is ambiguous and drops the sentence
that defines what spends the round budget. Replace the whole paragraph and
preserve that accounting explicitly.

I agree with Opus rather than Fable on the post-cap supported-use defect. A
small, demonstrated correctness or primary-data defect should be fixed without
asking the user for routine approval. The cap should end the automated-review
search, not forbid the batch produced by the third review. Validate that final
fix with the relevant tests and CI, then finish without requesting another
automated review. Ask only when the real fix itself would change product
behavior, risk primary data, or exceed the authorized boundary.

This also removes “open no fourth batch,” which is the wrong unit: the third
review's triage may legitimately produce a final batch. The prohibited action
is starting another automated-review search against the same boundary.

## Which babysit is authoritative

There are three different artifacts in this checkout:

| Artifact | Status |
| --- | --- |
| `origin/main:.agents/skills/babysit/` | Canonical. PR #153 promoted the rewrite; PR #154 added `fold`, changed tripwire ordering, and corrected claim handling. |
| This worktree's tracked `.agents/skills/babysit/` | Pre-rewrite because the archive branch diverged before PRs #153–#155. It is not a valid patch base. |
| Untracked `.agents/skills/babysit-rewrite/` | Intentionally retained historical working copy. It contains the post-Fable Opus proposal, but main superseded three details while PR #154 landed. |

The retained rewrite differs from main in exactly three substantive places:

- it applies the tripwire before reading and sorting the complete finding set,
  while main sorts the set first;
- its merge reference says “four verbs” even though `fold` made five; main says
  five; and
- it assumes every merged pull request has a work-intent claim, while main
  correctly makes claim completion conditional on a claim existing.

The earlier reviewer prompt should have pointed to
`origin/main:.agents/skills/babysit/SKILL.md`, not the retained rewrite. Future
implementation should start in a new worktree rooted at current main and edit
the canonical skill. Preserve `babysit-rewrite` unchanged as historical
reference, as the user requested.

## Landing scope

The eventual change should update the canonical `AGENTS.md`, babysit, and the
one start-issue pointer that still says `tripwire`. Update the shared context
whose description would become false. Glossary additions are optional; the
local definitions already carry the terms, so they should not become landing
churn unless the terms prove useful elsewhere.

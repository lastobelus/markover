---
name: babysit
description: "Babysit GitHub pull requests. Use when the user says 'babysit', 'babysit pr', 'babysit #42', 'babysit and merge', etc."
---

# Babysit

1. Resolve the explicit PR, otherwise the most recently worked-on or mentioned
   PR, then the current branch's PR. Ask only when the target is ambiguous. For
   an explicit stack, preserve dependency order. Mark a draft ready.
2. Set the finish line: `babysit` stops green and does not merge; an explicit
   `babysit & merge` or `babysit and merge` merges the exact green head with the
   repository's enabled method and verifies the merge.
3. Take one immediate GitHub snapshot of the head, base drift, mergeability,
   checks, reviews, reactions, and unresolved threads. While pending, run one
   foreground `sleep 100` before each later status read; use no live watch or
   tighter polling.
4. Drive the loop. Address actionable feedback, reply with evidence, and
   resolve every handled thread. Diagnose red CI: fix code failures and rerun
   transient infrastructure failures. Rebase when behind or required, validate,
   and force-push with lease. Babysitting authorizes these routine edits,
   commits, pushes, replies, and thread resolutions.
5. Treat each pushed fix or rebase as a new head: restart CI and automated
   review gates. A Codex 👀 is in progress, and silence or an empty formal review
   list is not success. Require a current-head 👍 or explicit no-issues result,
   checking the PR body and trigger comments too. Do not keep the loop running
   solely to prove an unbounded property. Before acting on any later finding,
   apply the repository's complexity tripwire; if it fires, pause and report the
   resumable state. If review fails to start, trigger it once; do not duplicate
   an active request.
6. Continue until the current head has green CI, a terminal-clean Codex review,
   zero unresolved threads, and a clean mergeable state. Before merging, inspect
   the addressed issue conversation. Treat comments added by other threads as a
   separate input from Codex PR reviews and address every adjunct work item,
   revision request, or finding that bears on the current PR. Complete every
   repository-required file-changing housekeeping item on the branch; each
   resulting push restarts these gates. For merge mode, merge dependency-first,
   then re-audit or restack later PRs.
7. After each verified merge, read Markover's service-free machine-readable
   help and follow its `pullRequestStatus` contract for the exact merged PR URL.
   Run `done` so every matching local review reaches Done; zero matching reviews
   is success. Report a lookup or Markover failure without weakening the verified
   GitHub merge result.
8. After merge-mode completion, refresh the issue conversation for comments
   added during the merge before recommending next steps or closing it. Account
   for every remaining adjunct work item, revision request, or finding. Then
   determine whether the issue is complete. If work remains, prepare concrete
   next steps for the final report. If it is complete, perform the remaining
   state-only housekeeping, verify the issue and its trackers reflect completion,
   and prepare an archive-ready conclusion.
9. Report the PR and head, fixes, resolved reviews, rebases, validation, CI and
   review results, and merge result when applicable. In merge mode, include the
   prepared next steps or archive readiness. If interrupted or paused, stop reads
   and mutations immediately and report the same state as a resumable checkpoint;
   resume from a fresh snapshot.

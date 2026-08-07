---
name: babysit
description: "Babysit GitHub pull requests through review, rebases, and CI until green. Use when the user says 'babysit' or asks to keep a PR moving; when they say 'babysit & merge', merge only after green."
---

# Babysit

1. Resolve the explicit PR, otherwise the most recently worked-on or mentioned
   PR, then the current branch's PR. Ask only when the target is ambiguous. For
   an explicit stack, preserve dependency order. Mark a draft ready.
2. Set the finish line: `babysit` stops green and does not merge;
   `babysit & merge` merges the exact green head with the repository's enabled
   method and verifies the merge.
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
   checking the PR body and trigger comments too. If review fails to start,
   trigger it once; do not duplicate an active request.
6. Continue until the current head has green CI, a terminal-clean Codex review,
   zero unresolved threads, and a clean mergeable state. For merge mode, merge
   dependency-first, then re-audit or restack later PRs.
7. Report the PR and head, fixes, resolved reviews, rebases, validation, CI and
   review results, and merge result when applicable. If interrupted or paused,
   stop reads and mutations immediately and report the same state as a resumable
   checkpoint; resume from a fresh snapshot.

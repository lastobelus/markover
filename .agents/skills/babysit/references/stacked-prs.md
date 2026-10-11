# Sequential stacked PRs

Use one thread and one resumable `Wait for PR` Action at a time. Before the
first wait, read live PR bases and record the ordered same-repository chain to
`main`, each full head and base SHA, the requested finish line, owners, and any
QA holds. An explicit request to merge the whole stack authorizes only those
identified members and the in-scope restacking needed to land them. A request
about one child does not authorize merging its ancestors.

In this thread's saved Action checkout, after building the script, select the
next PR with:

```sh
node build/scripts/markover-wait-for-pr.js --target PR_NUMBER
```

Check the printed head, base, and parent identities against the live PRs. The
command saves them in private worktree-local Git metadata; it does not launch
the Action, edit a branch, or merge. A changed child or ancestor fails the
Action's pinned preflight. Select the new exact target before waiting again.
The Action reads the target once at launch; changing it cannot redirect a
running continuation. To return to ordinary checkout-derived waits:

```sh
node build/scripts/markover-wait-for-pr.js --clear-target
```

The target must be set in the saved Action checkout, not an unrelated
worktree. It changes observation only. Keep implementation and local CI in an
owned checkout of the intended branch, and preserve others' dirty worktrees.

Start at the oldest unmerged authorized PR. Handle current findings, request
one exact-head Codex review when needed, launch the saved Action, and end the
turn. On its result, verify the PR, head, base, tested merge revision, and
review in a fresh GitHub snapshot. `stacked-ready` means the child passed
against its pinned topic parent; it is not evidence for a final `main` merge.

For an authorized merge, apply the normal merge reference's current-head and
QA gates, then verify the parent merge. If it was squashed, inspect the child's
own commits against the captured old parent head. Restack only those commits
onto current `main`; `git rebase --onto origin/main OLD_PARENT_HEAD` is a
starting recipe for a simple linear child, not for merge commits or uncertain
ancestry. Verify its intended diff, retarget, push with a lease, and obtain
fresh CI and exact-head review against `main`. Repeat for each authorized
member. A base retarget or parent push invalidates earlier child evidence even
if its head SHA stays fixed.

For babysit-only work, visit each requested member in order and report which
children have only parent-relative evidence. Retain the next member while an
Action continuation is pending; end the turn so that result can arrive. Report
a genuine disabled or interrupted-Resume reason when applicable.

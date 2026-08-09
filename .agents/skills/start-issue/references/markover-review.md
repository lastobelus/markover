# Markover instance selection

Use canonical for reviews of plans, proposals, and other artifacts produced
during the work. An open pull request does not by itself select its development
instance.

Use the current PR worktree's isolated development instance when the user asks
for a development instance or asks to test the behavior being changed in the
pull request. If the user supplies a document, open that document. Otherwise:

1. Create `tmp/pr-N-dev-checklist.md` with a short PR-specific list of behavior,
   interactions, or risks the user should inspect. Prefer concrete checks over
   a generic dummy document.
2. Open that file directly in the development instance. Let `open` cold-start
   the instance with the review visible; do not launch the instance separately
   into its splash screen.

```sh
npm --silent run markover -- --instance dev open PATH --summary SUMMARY
npm --silent run markover -- --instance dev get REVIEW_ID
npm --silent run markover -- --instance dev edit REVIEW_ID
```

Retain every review ID together with its instance selector and use that same
selector for every later operation. Review IDs do not move between instances.

A canonical review remains canonical even after a pull request exists; continue
it without `--instance dev`.

Let `--instance dev` resolve only the current worktree's open pull request. If
that identity cannot be resolved, stop and report the mismatch. Preserve the
checkout exactly as found; resolving or starting an instance does not authorize
fetching, pulling, switching branches, cleaning, or installing dependencies.

Leave PR-instance cleanup to an explicit maintenance request after the instance
is stopped. Routine handoff or completion preserves its worktree-local state.

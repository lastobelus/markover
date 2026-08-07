# Markover reviews

## Review handoff

Whenever opening or later referencing a document in Markover for review,
include the returned review URL as inline code, alone on its own line:

`open '<reviewUrl>'`

Retain the review ID together with its instance selector and use that same
selector for every later operation on the review. Review IDs do not move
between instances.

## Open pull requests

Use the current PR worktree's isolated development instance for every new
Markover review opened after the pull request exists:

```sh
npm --silent run markover -- --instance dev open PATH --summary SUMMARY
npm --silent run markover -- --instance dev get REVIEW_ID
npm --silent run markover -- --instance dev edit REVIEW_ID
```

A review opened through canonical before the pull request existed remains
canonical; continue it without `--instance dev`.

Let `--instance dev` resolve only the current worktree's open pull request. If
that identity cannot be resolved, stop and report the mismatch. Preserve the
checkout exactly as found; resolving or starting an instance does not authorize
fetching, pulling, switching branches, cleaning, or installing dependencies.

Leave PR-instance cleanup to an explicit maintenance request after the instance
is stopped. Routine handoff or completion preserves its worktree-local state.

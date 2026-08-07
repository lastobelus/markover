# PR-local Markover

Use the current PR worktree's isolated development instance for every new
Markover review opened after the pull request exists:

```sh
npm --silent run markover -- --instance dev open PATH --summary SUMMARY
```

Retain the review ID together with its instance selector. Use the same explicit
selector for every later operation on that review:

```sh
npm --silent run markover -- --instance dev get REVIEW_ID
npm --silent run markover -- --instance dev edit REVIEW_ID
```

A review opened through canonical before the pull request existed remains
canonical; continue it without `--instance dev`. Review IDs do not move between
instances.

Let `--instance dev` resolve only the current worktree's open pull request. If
that identity cannot be resolved, stop and report the mismatch. Preserve the
checkout exactly as found; resolving or starting an instance does not authorize
fetching, pulling, switching branches, cleaning, or installing dependencies.

Leave PR-instance cleanup to an explicit maintenance request after the instance
is stopped. Routine handoff or completion preserves its worktree-local state.

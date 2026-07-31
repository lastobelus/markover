# Project instructions

## Markover dogfooding

When communicating a plan, proposal, review, or other structured response that
contains seven or more meaningful Markdown blocks, treat it as a dogfoodable
Markdown artifact:

1. Provide the content rendered in the chat response.
2. Save the same content as a Markdown file in the repository.
3. For plans, use `doc/plans/YYYY-MM-DD__descriptive-name.md`.
4. Open the saved Markdown file with the durable command
   `npm --silent run review:open -- <path>` unless the user says not to.
5. Report the returned review ID and autosave path. Never keep a dogfooding
   review alive through a blocking T3 exec session.

A meaningful block is a heading, paragraph, list, block quote, table, or code
block that Markover presents as a reviewable unit. Do not inflate or fragment a
response merely to reach the threshold.

Durable reviews autosave under `.markover/reviews/<review-id>/review.json`. If
the application closes unexpectedly, reopen the same review with
`npm --silent run review:open -- --resume <review-id>`.

## Git checkpoints

Commit completed work at natural checkpoints. In particular, when the user
confirms that something is working and moves on to the next feature, preserve
that accepted state in a commit before starting the next feature. Also commit a
completed implementation slice after its tests pass and its requested review
findings have been addressed.

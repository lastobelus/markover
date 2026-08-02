# Project instructions

## Markover dogfooding

When communicating a plan, proposal, review, or other structured response that
contains seven or more meaningful Markdown blocks, treat it as a dogfoodable
Markdown artifact:

1. Provide the content rendered in the chat response.
2. Save the same content as a Markdown file in the repository.
3. For plans, use `doc/plans/YYYY-MM-DD__descriptive-name.md`.
4. Open the saved Markdown file with the durable command
   `npm --silent run markover -- open <path> --summary "<why this review is useful>"`
   unless the user says not to. Pass an explicit `--thread-id` when available;
   otherwise include a unique high-entropy
   `--handoff-key mko_handoff_<16-to-64-alphanumeric-characters>`.
5. Report the returned review ID and the persisted review path
   `.markover/reviews/<review-id>/review.json`. Never keep a dogfooding review
   alive through a blocking T3 exec session.
6. Retain the review ID in the agent thread. When the user says to check
   Markover, run `npm --silent run markover -- get <review-id>` once. If the
   user needs to add feedback afterward, use
   `npm --silent run markover -- edit <review-id>`.

A meaningful block is a heading, paragraph, list, block quote, table, or code
block that Markover presents as a reviewable unit. Do not inflate or fragment a
response merely to reach the threshold.

Managed reviews autosave under `.markover/reviews/<review-id>/review.json` and
are restored automatically when the single Markover application restarts.

## Git checkpoints

Commit completed work at natural checkpoints. In particular, when the user
confirms that something is working and moves on to the next feature, preserve
that accepted state in a commit before starting the next feature. Also commit a
completed implementation slice after its tests pass and its requested review
findings have been addressed.

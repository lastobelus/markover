# Project instructions

## Markover quick start for agents

Markover is this repository's local Markdown review inbox. If a user asks you
to write a plan, specification, or other Markdown document and open it for
review, use Markover rather than asking how to hand the document over.

Start with its service-free, machine-readable help when you need syntax or
recovery guidance:

```sh
npm --silent run markover -- help
```

The normal flow is `open` once, retain the returned `reviewId`, and stop. When
the user later says “Check Markover,” run `get <reviewId>` once and act on the
returned review JSON. Follow both `review.agentGuidance.fixedContract` and
`review.agentGuidance.interpretationPolicy` before acting. Feedback is
free-form and can mix revision requests, questions, discussion, and context;
interpret each part by intent, explicitly acknowledge every question even when
you also act on it, and treat exact source edits as context-dependent proposals.
If the user needs to change feedback after handoff, run `edit <reviewId>`.
Keep `--silent`: agent-facing success output is exactly one JSON value on
stdout, while errors explain the relevant usage and recovery on stderr.

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
   `~/Library/Application Support/Markover/reviews/<review-id>/review.json` on
   macOS. Never keep a dogfooding review alive through a blocking T3 exec
   session.
6. Retain the review ID in the agent thread. When the user says to check
   Markover, run `npm --silent run markover -- get <review-id>` once. If the
   user needs to add feedback afterward, use
   `npm --silent run markover -- edit <review-id>`.

A meaningful block is a heading, paragraph, list, block quote, table, or code
block that Markover presents as a reviewable unit. Do not inflate or fragment a
response merely to reach the threshold.

Managed reviews autosave in Markover's per-user application-data `reviews`
directory and are restored automatically when the single Markover application
restarts.

## Pre-preview compatibility and restart policy

Markover has no external user base yet. During pre-MVP0 development, make clean
protocol, storage, and architecture changes directly. Do not add fallback
readers, dual writers, migrations, or other compatibility machinery unless
there is concrete evidence that changed behavior is already in active external
use; ask the maintainer before adding any such layer.

Preserve historical review JSON and attachments unless a task explicitly owns
their deletion. The latest Markover version does not need to open every older
artifact: historical JSON can remain available for direct analysis, and an
older application version may be used for occasional viewing. Do not build a
migration solely to make old reviews viewable in the latest app.

Do not require agents to drain or hand off inflight reviews before restarting
Markover. For a planned restart, give the user a chance to warn agents or let an
active CLI request finish, then rely on persisted managed-review state to
return. Bounded-loss crash/restart durability is tracked separately in issue
39; do not fold that work into authorization changes.

## Git checkpoints

Commit completed work at natural checkpoints. In particular, when the user
confirms that something is working and moves on to the next feature, preserve
that accepted state in a commit before starting the next feature. Also commit a
completed implementation slice after its tests pass and its requested review
findings have been addressed.

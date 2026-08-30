# Markover

> Structured review for Markdown

Markover is a macOS app for reviewing Markdown as a document tree and returning block-level feedback to an agent.

Before changing the product's visual design, brand presentation, public site,
screenshots, movies, or explanatory diagrams, read
`doc/design/markover-design-brief.md`.

Before changing the top-level app layout, its structural names, or semantic
theme tokens, read `docs/developer/app-structure.md`.

## Agent-facing writing

Before creating or editing a skill, `AGENTS.md`, `CLAUDE.md`, or another
document agents consume, read `.ai/skills/writing-for-agents/SKILL.md`.

## Complexity brake

During implementation or review, brake before making a proposed change when
any of these is true:

- a defensive concern already addressed in the current slice comes back
  extended — another encoding, race, retry, lock, failure record, provenance
  check, or compatibility case;
- the change introduces a persistence layer, protocol, background process,
  ownership state, retry state, or compatibility path for a scenario not
  shown in supported use;
- review-driven safeguards have doubled the original change or outgrown the
  behavior they protect.

A slice is one claimed unit of work; an issue may carry several in parallel,
and the brake's counter and boundary belong to the slice, not the issue. The
recorded boundary — the acceptance evidence in `done-when` and the `excludes`
in this slice's claim — decides what belongs to it. Supported use is what the
product actually does for its users and agents: the boundary can put a
reachable scenario outside the slice, but cannot make it unsupported.

Name the facts of the concern — who can cause it and what they control, what
breaks, how it is recovered, what the safeguards so far have cost, and the
smallest change that would help — then give it one verb:

- **fix** the smallest thing, including simplifying or rolling back a
  safeguard, when the scenario is reachable in supported use, the consequence
  is material, and prevention is cheaper than recovery;
- **narrow** an open-ended promise to the finite behavior this slice can
  prove;
- **defer** work with real value that belongs outside the slice; or
- **decline** a concern that needs an actor, variant, or interleaving the
  boundary excludes.

Where the boundary crosses supported use, the tie-breaks are narrow: a
regression this change causes in supported behavior is judged by the fix
test on either side of the boundary; defer takes out-of-slice value the
change leaves working; and a boundary exclusion alone never declines a
supported scenario.

The brake changes the verb, not who is driving: when the boundary determines
the disposition, decide, record, and continue. The record is at most two
sentences — the concern, the verb, and the boundary clause that decided it —
in the review reply when one exists and in the normal report. When no
boundary is recorded, state the one you are using before the defensive
change. Ask the user only when the boundary does not decide: a reachable,
material scenario remains, and choosing among the cheapest valid verbs would
set product behavior the user has not chosen, accept risk to primary user
data, or widen the authorized scope. Send the resumable state with the
question.

An open-ended promise needs a finite completion test — evidence whose
exhaustion ends the concern; a concern without one is narrowed. A concern
the brake has already caught once in this slice is also narrowed when it
comes back without meeting the fix test: one follow-up variant of a safeguard
is ordinary work, but a third variant is a ladder, and ladders have no top
rung. Only a completion test recorded before the extensions began exempts a
concern — that one is a bounded list; finish the list.

A reviewer's severity or “actionable” label ranks a finding; the boundary
decides it. A finding with a reasoned verb is finished. Seek another
automated review only when a new head needs one, never to make a finished
finding disappear or to reach terminal-clean.

Prefer prevention for primary user data, real trust boundaries, and
destructive operations. Prefer detection and recovery for secondary,
reconstructible, or disposable state.

## Markover quick start for agents

Markover is this repository's local Markdown review inbox. If a user asks you
to write a plan, specification, or other Markdown document and open it for
review, use Markover rather than asking how to hand the document over.

Start with its service-free, machine-readable help when you need syntax or
recovery guidance:

```sh
npm --silent run markover -- help
```

When rebuilding canonical Markover or repairing any canonical failure, run
`canonical doctor` and `canonical refresh` through that CLI from the current
checkout. The configured canonical descriptor selects the owning checkout;
the agent's cwd does not. Refresh completion requires a healthy doctor result
whose window status is `electron-visible`; that status means Electron ordered
the window visible, not that macOS placed it onscreen. Repair completion also
requires the reported exact `markover:` URI selecting its review. Changes to
canonical startup or activation require the native recovery QA in
`docs/developer/development.md`.

Before changing a portable review reader, writer, validator, persisted field,
or agent consumer, read
`docs/developer/review-handoff-format.md`. It is the source of truth for the
`markover-review` schema, additive-field preservation, private-data boundary,
version bumps, migration, and fail-closed behavior.

Before `open`, `get`, `get-for-review`, `revise`, or `done` for a
pull-request-associated review, follow the help payload's `pullRequestStatus`
contract. That contract is the source of truth for the live `gh pr view`
lookup, status mapping, command flags, and non-blocking lookup-failure behavior.

The normal flow is `open` once, retain the returned `reviewId`, give the user a
best-effort Markdown link whose target is the returned `reviewUrl`, include the
raw review ID and the standalone Terminal command below, and stop. When the
user later says “Check Markover,” run
`get <reviewId>` once and act on the returned review JSON. Follow both
`review.agentGuidance.fixedContract` and
`review.agentGuidance.interpretationPolicy` before acting. Feedback is
free-form and can mix revision requests, questions, discussion, and context;
respond to each part by intent, substantively address discussion and concerns,
explicitly acknowledge every question even when you also act on it, and treat
exact source edits as context-dependent proposals.
After acting on every part of the feedback, run `revise <reviewId>` before
reporting completion. If the user needs to change feedback while the review is
still with the agent, run `edit <reviewId>`. A later feedback round opens a new
review rather than reopening a Revised review.
When the user asks whether this thread has pending Markover reviews, run
`pending` with the same truthful current-thread identity route used by `open`
and return every result. Planning and implementation may continue around an
unresolved review, but before merge or final thread completion run `pending`
as a soft gate and ask for an explicit disposition for every result. Silence
and PR merge never imply acceptance. Use `resolve --outcome
reviewed-no-notes` or `resolve --outcome accepted-unreviewed` only after the
user chooses it; Markover itself summarizes any existing feedback and requires
the user to choose Abandon feedback. A cancelled confirmation leaves the review
unresolved, and `unresolve` returns a manual outcome to Needs me before Done.
Keep `--silent`: agent-facing success output is exactly one JSON value on
stdout, while errors explain the relevant usage and recovery on stderr.

When asked to act as the reviewer of an existing pristine review, run
`get-for-review <review-id>` with the same truthful agent/thread-host metadata
rules used by `open`. Follow `review.agentReviewer.agentGuidance` and the
snapshotted `review.agentReviewer.mode`, add findings only to `feedback` and
permitted `sourceEdit` fields, preserve every other field, and return the
complete artifact with `submit <review-id> --input <path|->`. A response-uncertain
claim is recovered by repeating `get-for-review` with only the review ID; a
response-uncertain submission is recovered by repeating the exact `submit`.
Never follow the author-agent `review.agentGuidance` while acting as reviewer.

Whenever opening or later referencing a document in Markover for review, keep
the best-effort Markdown link and raw review ID, and also include the returned
review URL as an inline-code Terminal command, alone on its own line:

`open '<reviewUrl>'`

Custom-scheme links work through macOS and this Terminal command, but
thread-hosts including T3Code and the Codex app may strip or decline them. The
isolated command is the reliable handoff: it is easy to triple-click and paste
into the attached terminal.

## Markover dogfooding

When communicating a plan, proposal, review, or other structured response that
contains seven or more meaningful Markdown blocks, treat it as a dogfoodable
Markdown artifact:

1. Provide the content rendered in the chat response.
2. Save the same content as a Markdown file in the repository.
3. For plans, use `doc/plans/YYYY-MM-DD__descriptive-name.md`.
4. Open the saved Markdown file with the durable command
   `npm --silent run markover -- open <path> --summary "<why this review is useful>"`
   unless the user says not to. On a proven Codex surface, read only the
   nonblank `CODEX_THREAD_ID`; on a proven Claude surface, read only the
   nonblank `CLAUDE_CODE_SESSION_ID`, and pass the applicable value as
   `--thread-id`. When that value is unavailable, generate a fresh high-entropy
   `--handoff-key mko_handoff_<16-to-64-random-alphanumeric-characters>` for
   this command. Use the same decision for `get-for-review`. With either
   identity route, pass truthful `--thread-host-kind` and
   `--thread-host-provider`; they name separate dimensions but may have the
   same value. Here provider means the LLM provider or model family, not an
   intermediate harness. Pass `--thread-host-thread-id` only for a distinct
   host-owned identifier you actually observe; never guess a T3 thread ID. Run
   `hostname` when available and pass its output as `--thread-host-machine`.
   Omit optional values rather than guessing.
5. Report a best-effort Markdown link using the returned `reviewUrl`, the raw
   review ID, the standalone Terminal command required above, and the persisted
   review path
   `~/Library/Application Support/Markover/reviews/<review-id>/review.json` on
   macOS. Never keep a dogfooding review alive through a blocking T3 exec
   session.
6. Retain the review ID in the agent thread. When the user says to check
   Markover, run `npm --silent run markover -- get <review-id>` once. If the
   user needs to add feedback before you finish, use
   `npm --silent run markover -- edit <review-id>`. After acting on the complete
   handoff, run `npm --silent run markover -- revise <review-id>`.

A meaningful block is a heading, paragraph, list, block quote, table, or code
block that Markover presents as a reviewable unit. Do not inflate or fragment a
response merely to reach the threshold.

Managed reviews autosave in Markover's per-user application-data `reviews`
directory and are restored automatically when the single Markover application
restarts.

## Pre-preview compatibility and restart policy

During pre-MVP0 development, make clean protocol, storage, and architecture
changes directly for unreleased prototype shapes. Do not add fallback readers,
dual writers, migrations, or aliases for those prototypes.

Once a portable review schema ships in a release, a breaking successor must
migrate supported released predecessors automatically on load. Preserve a
byte-for-byte backup of the original review directory first, convert and
validate a separate working copy, and replace the active artifact only after
validation succeeds. Preserve historical review JSON, attachments, and
migration backups unless a task explicitly owns their deletion. Unknown future
versions fail closed, remain untouched, and point to the official compatibility
catalog for a compatible Markover release.

Do not require agents to drain or hand off inflight reviews before restarting
Markover. For a planned restart, give the user a chance to warn agents or let an
active CLI request finish, then rely on persisted managed-review state to
return. Bounded-loss crash/restart durability is tracked separately in issue
39; do not fold that work into authorization changes.

## Human QA development loop

When UI, interaction, or native-app work needs back-and-forth human QA, ask the
user for a QA window before launching or focusing Markover. Then list Project
Actions, select the unique eligible `Start Dev Build` action, launch it with
`run_project_action_and_resume`, and end the turn immediately. On resume,
validate the exact head, instance, watcher PID, app PID, route, and startup-ready
evidence before inviting the user to check that instance. `awaiting-human`
means the machine is ready for visual QA; only the user can accept what it looks
like or how it behaves.

Keep the reported watcher alive across feedback rounds. Fix a reported build or
startup failure and let that watcher retry on the next edit. If `Start Dev Build`
is missing or disabled, report the reason and fall back to `npm run dev` from
the owning checkout, using `npm run dev -- --instance dev` when the pull-request
instance must be explicit. Run one loop per addressed instance and finish
focused deterministic checks separately.

## Full local CI

After focused checks pass, commit the completed slice so its worktree is clean,
then use the saved `Run Local CI` Project Action for the full local gate:

1. Call `list_project_actions` and select the single action named `Run Local
   CI`; never guess its ID.
2. Require `resumeEligible: true`, call `run_project_action_and_resume` with the
   returned ID, and end the turn immediately.
3. On resume, check the validated status and exit code, then require the final
   JSON summary to match the expected repository, head, base, and command
   version. Treat `head-changed`, `base-changed`, or `dirty-worktree` as stale
   evidence; handle `failed`, `cancelled`, or `timed-out` from its bounded log
   tail; continue only from `passed` with test counts and a passing smoke result.

If the action is missing or disabled, report the missing name or
`disabledReason`, run `npm run ci:local` directly for this checkpoint, and say
that resumable execution was unavailable. Keep focused checks and `Wait for PR`
independent; neither action launches the other.

## Native Intel validation

When a pull request needs native Intel packaging evidence, run the saved action
from its exact clean checkout on a physical Intel Mac:

1. Call `list_project_actions` and select the single action named `Run Intel
   Validation`; never guess its ID.
2. Require `resumeEligible: true`, call `run_project_action_and_resume` with the
   returned ID, and end the turn immediately.
3. On resume, require the final JSON summary to match the expected repository,
   head, base, command version, native `x86_64` host, local-CI counts, x64
   archive checksum, preflight, and packaged-smoke evidence. Treat
   `target-drifted` or `dirty-worktree` as stale. Repair a classified
   environment, CI, package, preflight, or smoke failure in the agent thread
   before launching a fresh action.

This is development-host evidence only. It does not satisfy clean-machine
Intel/Sonoma acceptance, Safari quarantine, a visible Gatekeeper override,
rollback, release publication, or public-support claims. If the action is
missing or disabled, report its reason and run the same bounded sequence from
`docs/developer/releasing.md` directly; do not substitute an Apple Silicon run
or hosted CI for native Intel evidence.

## Git checkpoints

Commit completed work at natural checkpoints. In particular, when the user
confirms that something is working and moves on to the next feature, preserve
that accepted state in a commit before starting the next feature. Also commit a
completed implementation slice after its tests pass and its requested review
findings have been addressed. Ensure such checkpoints are pushed to github.

## Glossary
GLOSSARY.md contains a list of terms commonly used when working on this project.
Every entry starts with `## term::`, so the index is available with `rg '^## .*::$' GLOSSARY.md` and a term with `rg -n -i '^## .*term.*::$' GLOSSARY.md`.
When working on finalizing or landing a PR, judiciously add new terms that have fallen out while interacting with the user. Don't add terms narrowly focused to the PR, but only those which are likely to be commonly used in the ongoing development of the project. When doing so, mention the terms you have added in your user response.


## Stacked pull requests

Propose a [stacked PR plan](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)
before implementation when two or more reviewable slices must land in order.
Also propose a child PR when authorized follow-on work discovered during an
open PR is out of scope but depends on that unmerged PR. Keep independent work
in ordinary PRs.

For a stack, state the dependency order and base branch for every slice, keep
each PR independently reviewable, and update child bases as lower PRs merge.

## Computer use and Stealing Focus

Whenever possible, work without stealing focus. When you encounter a task that
can't be done without stealing focus, pause and ask the user first, so they can
plan to give you control of the machine for the time you need.

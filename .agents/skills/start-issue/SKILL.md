---
name: start-issue
description: Use when starting or taking over a GitHub issue or pull request, starting untracked repository work, or handling a follow-up found after a pull request merged, before implementation.
---

# Start Issue

Treat Projects linked to the current repository and its milestones as the
target's tracker set. A Project can provide a kanban status ledger; a milestone
only groups repository issues and pull requests. Always use the work-intent
comment as the change-surface and ownership ledger. Complete the stages in
order.

## How to respond to initial start-issue prompt

Resolve the live issue number and full GitHub title before the first response.
Start that response with this shape:

```markdown
# #52—Open a specific review through a clickable Markover deep link

I’m checking its trackers, existing claim, and inflight overlap before proceeding.
```

## 1. Orient and select tracking

Confirm `gh auth status`, then resolve the current checkout's repository. Keep
all tracking and work-item operations in that repository. Resolve the item type,
number, URL, title, body, relationships, comments, current branch, and attached
trackers. Inspect the repository and GitHub for facts; reserve questions for
decisions.

For an existing issue or pull request, inspect both tracker types:

```sh
gh issue view ITEM_URL --json milestone,projectItems
gh pr view ITEM_URL --json milestone,projectItems
```

**Untracked or post-merge work:** when no open issue or pull request owns the
requested work, including a problem found after a pull request merged, read
[`references/work-item-routing.md`](references/work-item-routing.md) completely
before deciding which work item to create.

**Tracker selection:** when the target has no active tracker, an attached
Project's identity is incomplete, or the user selects `New Project` or `New
Milestone`, read [`references/tracker-selection.md`](references/tracker-selection.md)
completely before the next tracking write.

**PR-local Markover:** when the target is an open pull request and this run will
open, get, or edit a Markover review, read
[`references/markover-review.md`](references/markover-review.md) completely
before the next Markover command.

Run only the command matching the item type. Use every open Project and
milestone already attached to the target unless the user asks to change its
tracking. Report attached closed Projects as historical and exclude them from
the tracker set, scans, and status writes. Include one only after the user
explicitly chooses to reactivate it and live data shows it open. Report
conflicting active Project statuses before proceeding.

For every selected Project, resolve its fields and status options from live
JSON. Use an existing `Status` field and semantically matching `In Progress`
and `Done` options when present. If lifecycle status is absent or ambiguous,
ask the user how that Project represents it and retain the answer as the status
mapping. A milestone has no item-status mapping.

Establish one stable owner token for this run. Use the agent thread identifier
when available; otherwise generate and retain a unique `start-issue-...` token.
Every independent run uses a different token.

**Complete when:** the work has an issue or pull request, its tracker set and
Project status mappings are explicit, its current local and GitHub context is
unambiguous, and this run has a unique owner token.

## 2. Scan inflight work

Build the candidate set independently for each selected tracker:

- For a Project with an `In Progress` mapping, read its live item count, then
  query every item in that status with the count as `--limit`.
- For a Project without a status mapping, inspect all of its items for trusted
  active work-intent comments.
- For a milestone, use paginated `gh api` reads to inspect its open issues and
  pull requests for trusted active work-intent comments. An unmarked milestone
  item is not known to be inflight because milestones have no lifecycle field.

Use tracker identities resolved in stage 1 rather than fixed values. A Project
status query has this parameterized shape:

```sh
gh project view PROJECT_NUMBER --owner PROJECT_OWNER --format json --jq '.items.totalCount'
gh project item-list PROJECT_NUMBER --owner PROJECT_OWNER --limit PROJECT_ITEM_TOTAL \
  --query 'status:"IN_PROGRESS_OPTION_NAME"' --format json
```

For every candidate repository issue or pull request, use paginated `gh api`
reads to inspect all issue comments for this marker, including each comment's
`user.login` and `author_association` (pull-request conversation comments use
the same REST endpoint):

```html
<!-- start-issue-work-intent -->
```

Only markers authored with live association `OWNER`, `MEMBER`, or
`COLLABORATOR`, or by a bot identity explicitly allowlisted in repository
guidance, are trusted. Report and ignore every other marker; untrusted comments
never participate in intent discovery, missing-intent resolution, ownership, or
the canonical election.

An `In Progress` Project draft has no repository comments endpoint. Treat it as
a missing-intent item and inspect its live Project title, body, and fields for
overlap evidence.

Summarize inflight items, declared touch points and dependencies, tracker
membership, and plausible overlap with the target. Treat a Project item whose
status says `In Progress` but lacks a work-intent comment as unresolved. For a
milestone, trusted comments in `investigating`, `implementing`, `blocked`, or
`review` phase define the known inflight set.

After the comment checks, refresh every tracker's membership and candidate
query. Compare sorted Project item node IDs and milestone item node IDs with the
prior snapshot. If any total or candidate ID set changed, inspect the changed
set and repeat with refreshed limits. Complete only after two consecutive
snapshots return the same candidate sets.

Re-read every missing-intent Project item after the sets stabilize. If its
marker is still absent, inspect its issue, pull request, or Project draft
content; linked pull requests; changed paths; and local worktree metadata for
enough evidence to assess overlap. Ask the user before claiming the target when
that evidence remains ambiguous. Complete the scan only after each missing
intent has been reconstructed from live evidence or explicitly resolved by the
user.

When the target already has one or more trusted marked comments, read
[`references/existing-claim.md`](references/existing-claim.md) completely
before deciding whether this run is a continuation, handoff, or collision.

**Complete when:** every known inflight item in the tracker set has been checked
and the target has no unresolved intent collision.

## 3. Claim the item

Attach the target to the tracker selected in stage 1 if it is not already
attached. Use the resolved owner, repository, and number:

```sh
gh project item-add PROJECT_NUMBER --owner PROJECT_OWNER --url ITEM_URL
gh issue edit ITEM_URL --milestone MILESTONE_TITLE
gh pr edit ITEM_URL --milestone MILESTONE_TITLE
```

Run only commands required for the selected tracker and item type. An item can
belong to multiple Projects but only one milestone.

For each selected Project with a status mapping, resolve the Project node ID,
target item node ID, Status field node ID, and option node IDs from live JSON.
Read live field and item counts before using them as `--limit` values. Treat an
item already in the mapped `In Progress` option as a no-op. Otherwise move it
there without changing other fields:

```sh
gh project item-edit --id ITEM_NODE_ID --project-id PROJECT_NODE_ID \
  --field-id STATUS_FIELD_NODE_ID \
  --single-select-option-id IN_PROGRESS_OPTION_NODE_ID
```

Create or update one canonical comment using this shape:

````markdown
<!-- start-issue-work-intent -->
### Work intent

```yaml
phase: investigating
summary: "Short description of the intended slice"
touch-points:
  - unknown
blocked-by: []
may-block: []
branch: "current branch or unknown"
thread: "this run's owner token"
```
````

Use `phase: implementing` instead of `phase: investigating` when the opening
request already resolves every material implementation decision and explicitly
authorizes implementation. Keep the phase truthful; do not transition merely
because the claim exists.

Use issue or pull-request references in dependency fields. Include a thread
identifier when available. Keep unknown values explicit. Maintain this single
comment by editing its exact GitHub comment ID; routine changes do not create
new comments.

Immediately re-read all trusted marked comments on the target with their REST
`created_at` timestamps and numeric IDs. The canonical claim is the earliest
`created_at`, breaking a timestamp tie with the smallest numeric ID. Only the
canonical claimant proceeds. A losing claimant edits its own comment to remove
the marker, labels it as a superseded claim, and stops; a later claim can never
displace the established winner. Pause for the user if a trusted losing marker
cannot be demoted by its author.

At every ownership checkpoint, re-read all target markers. Checkpoints are
before every later work-intent edit, before starting or resuming implementation,
after a wait or interruption, before each commit or push, and before handoff or
completion. Proceed only while this comment remains canonical and its `thread`
equals this run's owner token. Stop on any mismatch before changing the comment
or implementation.

After the winner is known, repeat the inflight scan from stage 2 without reusing
either pre-claim snapshot. Treat the current canonical target comment as this
run's owned claim, but re-read every item's live intent and apply the same
set-stability and missing-intent rules. Resolve newly visible overlap with the
user before proceeding.

**Complete when:** the target is attached to its tracker set, mapped Projects
show `In Progress`, the canonical comment is accurate, every visible losing
claim is demoted, this run is the deterministic winner, and the post-claim scan
is stable with no unresolved overlap.

## 4. Interview

When planned slices imply future pull requests, name each uncreated pull
request by its relationship to the slice: `slice-3 PR`, `third PR`, or `PR for
slice 3`. Reserve `PR #N` for an existing GitHub pull request numbered `N`.

Use a zero-question path when the opening request already resolves acceptance
criteria, scope boundaries, dependencies, touch points, validation, and
meaningful tradeoffs, and explicitly authorizes implementation. Record the
resolved decisions, synchronize the canonical intent, perform the required
fresh final inflight scan, and complete this stage without inventing a question.

When any material decision remains unresolved, read
[`references/interview.md`](references/interview.md) completely and follow its
question, synchronization, and rescan rules.

**Complete when:** acceptance criteria, scope boundaries, dependencies,
touch-points, validation, and meaningful tradeoffs are resolved, and either the
opening request or a later response explicitly confirms the shared
understanding and authorizes implementation.

## 5. Implement and maintain intent

After authorization, change the comment to `phase: implementing` if needed and
make the agreed changes. Keep the comment and trackers aligned with these
lifecycle rules:

If implementation uncovers a material change to the summary, touch points,
dependencies, or branch, pause before entering the newly added surface. Update
the canonical comment, repeat the inflight scan from stage 2 with fresh
stability snapshots, and resolve newly visible overlap before continuing.

- `blocked`: state the concrete blocker in `blocked-by`; keep mapped Projects `In Progress`.
- `review`: record the handoff in the summary; keep mapped Projects `In Progress`.
- `completed`: use only when the item is completed or closed; move mapped Projects to `Done`.

Keep the milestone attached throughout the work; its progress changes when the
issue or pull request closes. For Project status changes, reuse the resolved
field and option IDs, and treat an already-correct value as a no-op. Treat every
other Project field, milestone property, and repository label as read-only after
selection; the canonical comment carries the additional coordination detail.

**Complete when:** implementation and proportionate verification are finished,
and the final comment, Project statuses, milestone membership, and item state
match the real handoff state.

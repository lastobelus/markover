---
name: start-issue
description: Use when starting, taking over, or roadmapping GitHub issue or pull-request work before implementation.
---

# Start Issue

Treat attached GitHub Projects and the repository milestone as the target's
tracker set. A Project can provide a kanban status ledger; a milestone only
groups repository issues and pull requests. Always use the work-intent comment
as the change-surface and ownership ledger. Complete the stages in order.

## 1. Orient and select tracking

Confirm `gh auth status`, then resolve the repository, item type, number, URL,
title, body, relationships, comments, current branch, and attached trackers.
Inspect the repository and GitHub for facts; reserve questions for decisions.

For an existing issue or pull request, inspect both tracker types:

```sh
gh issue view ITEM_URL --json milestone,projectItems
gh pr view ITEM_URL --json milestone,projectItems
```

Run only the command matching the item type. When the CLI summary omits a
Project's owner, number, or node ID, use paginated GraphQL to resolve the
target's `projectItems` connection and each item's `project` identity. Use every
Project and milestone already attached to the target unless the user asks to
change its tracking. Report conflicting Project statuses before proceeding.

If the target has no attached tracker, discover live candidates instead of
assuming an owner or number:

```sh
gh project list --owner REPOSITORY_OWNER --limit 100 --format json
gh project list --owner @me --limit 100 --format json
gh api --paginate 'repos/REPOSITORY_OWNER/REPOSITORY_NAME/milestones?state=open&per_page=100'
```

Skip the duplicate Project query when the repository owner is the authenticated
user. Present one numbered choice list containing the discovered Projects and
milestones, followed by `New Project` and `New Milestone`. Include tracker type,
owner or repository, title, and number in each choice. Ask exactly one question
so the user can answer with a number. Retain the chosen tracker identity.

For an untracked idea, infer the repository when possible, then present the
same tracker choices before creating the issue. If the repository is ambiguous,
resolve it with one question first. Create a repository issue before claiming
the work so milestones, comments, and ownership use one uniform path.

If the user selects `New Project` or `New Milestone`, interview about that
tracker before the work item. Resolve its title, purpose, owner or repository,
and the minimum useful configuration. For a Project, also resolve its initial
Status options; for a milestone, resolve any useful description or due date.
Create it only after the user confirms those decisions, then return to the work
item workflow.

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

If the target already has one or more marked comments, create no new claim.
Apply the deterministic winner rule in stage 3, show the canonical intent to the
user, and ask whether this run is a continuation or handoff. Reuse the comment
only when its `thread` equals this run's owner token and the user approves the
continuation. For an approved handoff or a legacy null token, preserve the
intent data. Demote the old marker only after its owner acknowledges
relinquishment or the user explicitly confirms that run has stopped, then
create a new marked claim with this run's token in stage 3. A separate
concurrent effort remains paused until the user chooses a distinct issue or pull
request; v1 does not represent multiple active intents on one item.

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
Read live field and item counts before using them as `--limit` values. Move the
item to the mapped `In Progress` option without changing other fields:

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

Interview relentlessly until every material implementation decision and its
dependencies are resolved. Ask exactly one question per response and wait for
the answer. Number tracker choices, decisions, and questions in one sequence.

Look up discoverable facts instead of asking for them. Decisions belong to the
user. When standards and repository evidence make an answer unusually clear,
record it as a numbered decision beside the next actual question.

Use this format:

```markdown
**Decision 4**: **Short decision title**

Confirmed: concise statement of the decision and any important consequence.

**Question 5**: **Short question title**

Relevant discovered facts, dependencies, and tradeoffs.

**My recommendation:** Recommended answer and rationale.

> One clear question, preferably yes/no or a small set of choices?
```

Update the canonical work intent whenever the interview materially changes its
summary, touch points, dependencies, branch, or phase. Keep `phase:
investigating` until the user explicitly confirms shared understanding and
authorizes implementation.

After every material intent update, repeat the inflight scan from stage 2 with
fresh stability snapshots and resolve newly visible overlap before asking the
next question. Perform this scan once more after the final material update and
before accepting implementation authorization, even if no further question is
needed.

**Complete when:** acceptance criteria, scope boundaries, dependencies,
touch-points, validation, and meaningful tradeoffs are resolved, and the user
explicitly confirms the shared understanding and authorizes implementation.

## 5. Implement and maintain intent

After authorization, change the comment to `phase: implementing` and make the
agreed changes. Keep the comment and trackers aligned with these lifecycle
rules:

If implementation uncovers a material change to the summary, touch points,
dependencies, or branch, pause before entering the newly added surface. Update
the canonical comment, repeat the inflight scan from stage 2 with fresh
stability snapshots, and resolve newly visible overlap before continuing.

- `blocked`: state the concrete blocker in `blocked-by`; keep mapped Projects `In Progress`.
- `review`: record the handoff in the summary; keep mapped Projects `In Progress`.
- `completed`: use only when the item is completed or closed; move mapped Projects to `Done`.

Keep the milestone attached throughout the work; its progress changes when the
issue or pull request closes. For Project status changes, reuse the resolved
field and option IDs. Treat every other Project field, milestone property, and
repository label as read-only after selection; the canonical comment carries
the additional coordination detail.

**Complete when:** implementation and proportionate verification are finished,
and the final comment, Project statuses, milestone membership, and item state
match the real handoff state.

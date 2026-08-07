---
name: start-issue
description: Coordinate and interview before implementing an existing GitHub issue or pull request. Use when the user asks to start or take over tracked work whose requirements must be resolved before editing. Synchronize Markover Project 3 and a work-intent comment, then conduct a one-question-at-a-time decision interview.
---

# Start Issue

Treat the GitHub Project as the status ledger and the work-intent comment as the
change-surface ledger. Complete the stages in order.

## 1. Orient

Require an existing GitHub issue or pull request. If the request is an untracked
idea, help create and roadmap an item before starting this workflow.

Resolve the repository, item type, number, URL, title, body, relationships,
comments, current branch, and Project fields. Inspect the repository for facts;
reserve questions for decisions. Confirm `gh auth status` before GitHub reads or
writes.

Establish one stable owner token for this run. Use the agent thread identifier
when available; otherwise generate and retain a unique `start-issue-...` token.
Every independent run uses a different token.

**Complete when:** the tracked item and its current local and GitHub context are
unambiguous and this run has a unique owner token.

## 2. Scan inflight work

Read the Project's live item count, then use it as the inflight query limit:

```sh
gh project view 3 --owner lastobelus --format json --jq '.items.totalCount'
gh project item-list 3 --owner lastobelus --limit PROJECT_ITEM_TOTAL \
  --query 'status:"In Progress"' --format json
```

For every returned issue or pull request, use paginated `gh api` reads to inspect
all issue comments for this marker (pull-request conversation comments use the
same REST endpoint):

```html
<!-- start-issue-work-intent -->
```

Summarize the inflight items, their declared touch points and dependencies, and
any plausible overlap with the target. Treat an `In Progress` item without a
work-intent comment as unresolved; the board remains authoritative while its
intent is unknown.

After the comment checks, refresh the live item count and run the inflight query
again. Compare the sorted Project item node IDs from the two queries. If either
the total or the inflight ID set changed, inspect the changed set and repeat
with the refreshed total as the limit. Complete only after two consecutive
queries return the same inflight ID set.

Re-read every missing-intent item after the inflight set stabilizes. If its
marker is still absent, inspect its issue or pull request, linked pull requests,
changed paths, and local worktree metadata for enough evidence to assess
overlap. Ask the user before claiming the target when that evidence remains
ambiguous. Complete the scan only after each missing intent has been re-read and
either reconstructed from live evidence or explicitly resolved by the user.

If the target already has one or more marked comments, create no new claim.
Apply the deterministic winner rule in stage 3, show the canonical intent to the
user, and ask whether this run is a continuation or handoff. Reuse the comment
only when its `thread` equals this run's owner token and the user approves the
continuation. For an approved handoff or a legacy null token, preserve the
intent data. Demote the old marker only after its owner acknowledges
relinquishment or the user explicitly confirms that run has stopped, then
create a new marked claim with this run's token in stage 3. A separate
concurrent effort remains paused until the user chooses a distinct tracked
issue or pull request; v1 does not represent multiple active intents on one
item.

**Complete when:** every `In Progress` item has been checked and the target has
no unresolved intent collision.

## 3. Claim the item

If the target is absent from Project 3, add it:

```sh
gh project item-add 3 --owner lastobelus --url ITEM_URL
```

Resolve the Project node ID, the target's item node ID, and the `Status` field
with its option IDs from live JSON. Read the live field count first so
`field-list` does not silently stop at its default limit:

```sh
gh project view 3 --owner lastobelus --format json --jq '.id'
gh project field-list 3 --owner lastobelus --format json --jq '.totalCount'
gh project field-list 3 --owner lastobelus --limit PROJECT_FIELD_TOTAL --format json \
  --jq '.fields[] | select(.name == "Status")'
gh project item-list 3 --owner lastobelus --limit 10 \
  --query 'repo:REPOSITORY_OWNER/REPOSITORY_NAME #ITEM_NUMBER' --format json \
  --jq '.items[] | select(.content.url == "ITEM_URL") | .id'
```

Move the item to `In Progress` through those IDs without changing other fields:

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

Immediately re-read all marked comments on the target with their REST
`created_at` timestamps and numeric IDs. The canonical claim is the earliest
`created_at`, breaking a timestamp tie with the smallest numeric ID. Only the
canonical claimant proceeds. A losing claimant edits its own comment to remove
the marker, labels it as a superseded claim, and stops; a later claim can never
displace the established winner. Pause for the user if a losing marker cannot
be demoted by its author.

At every ownership checkpoint, re-read all target markers. Checkpoints are
before every later work-intent edit, before starting or resuming implementation,
after a wait or interruption, before each commit or push, and before handoff or
completion. Proceed only while this comment remains canonical and its `thread`
equals this run's owner token. Stop on any mismatch before changing the comment
or implementation.

After the winner is known, repeat the inflight scan from stage 2 without reusing
either pre-claim query as a stability sample. Treat the current canonical target
comment as this run's owned claim, but re-read every item's live intent and
apply the same set-stability and missing-intent rules. Resolve any newly visible
overlap with the user before proceeding. This post-claim scan closes the window
where two agents publish different but overlapping claims after both completed
their initial scans.

**Complete when:** the Project shows `In Progress` and the canonical comment
accurately describes what is known so far, every visible losing claim is
demoted, the current claimant is the deterministic winner, and the post-claim
inflight scan is stable with no unresolved overlap.

## 4. Interview

Interview relentlessly until every material implementation decision and its
dependencies are resolved. Ask exactly one question per response and wait for
the answer. Number decisions and questions in one sequence.

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
fresh stability samples and resolve any newly visible overlap before asking the
next question. Perform this scan once more after the final material update and
before accepting implementation authorization, even if no further question is
needed.

**Complete when:** acceptance criteria, scope boundaries, dependencies,
touch-points, validation, and meaningful tradeoffs are resolved, and the user
explicitly confirms the shared understanding and authorizes implementation.

## 5. Implement and maintain intent

After authorization, change the comment to `phase: implementing` and make the
agreed changes. Keep the comment and Project aligned with these lifecycle rules:

If implementation uncovers a material change to the summary, touch points,
dependencies, or branch, pause before entering the newly added surface. Update
the canonical comment, repeat the inflight scan from stage 2 with fresh
stability samples, and resolve any newly visible overlap before continuing.

- `blocked`: state the concrete blocker in `blocked-by`; keep Project status `In Progress`.
- `review`: record the handoff in the summary; keep Project status `In Progress`.
- `completed`: use only when the item is completed or closed; move Project status to `Done`.

Use the resolved `Status` field and `In Progress` or `Done` option node IDs for
every status change. Treat every other Project field and repository label as
read-only in v1; the canonical comment carries the additional coordination
detail.

**Complete when:** implementation and proportionate verification are finished,
and the final comment and Project status match the real handoff state.

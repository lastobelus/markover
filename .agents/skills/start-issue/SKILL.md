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

**Complete when:** the tracked item and its current local and GitHub context are
unambiguous.

## 2. Scan inflight work

Read Markover Project 3 directly:

```sh
gh project item-list 3 --owner lastobelus --limit 100 \
  --query 'status:"In Progress"' --format json
```

For every returned issue or pull request, inspect its comments for this marker:

```html
<!-- start-issue-work-intent -->
```

Summarize the inflight items, their declared touch points and dependencies, and
any plausible overlap with the target. Flag `In Progress` items that lack a
work-intent comment; the board remains authoritative even when a comment is
missing.

If the target already has a marked comment, show it to the user and ask whether
this run is a continuation, handoff, or concurrent effort. Preserve it until the
user resolves ownership; then follow their direction.

**Complete when:** every `In Progress` item has been checked and the target has
no unresolved intent collision.

## 3. Claim the item

If the target is absent from Project 3, add it:

```sh
gh project item-add 3 --owner lastobelus --url ITEM_URL
```

Move it to `In Progress` without changing other Project fields:

```sh
gh project item-edit 3 --owner lastobelus --url ITEM_URL \
  --field Status --value "In Progress"
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
thread: null
```
````

Use issue or pull-request references in dependency fields. Include a thread
identifier when available. Keep unknown values explicit. Maintain this single
comment by editing its exact GitHub comment ID; routine changes do not create
new comments.

**Complete when:** the Project shows `In Progress` and the canonical comment
accurately describes what is known so far.

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

**Complete when:** acceptance criteria, scope boundaries, dependencies,
touch-points, validation, and meaningful tradeoffs are resolved, and the user
explicitly confirms the shared understanding and authorizes implementation.

## 5. Implement and maintain intent

After authorization, change the comment to `phase: implementing` and make the
agreed changes. Keep the comment and Project aligned with these lifecycle rules:

- `blocked`: state the concrete blocker in `blocked-by`; keep Project status `In Progress`.
- `review`: record the handoff in the summary; keep Project status `In Progress`.
- `completed`: use only when the item is completed or closed; move Project status to `Done`.

Use `gh project item-edit` with the named `Status` field for status changes.
Treat every other Project field and repository label as read-only in v1; the
canonical comment carries the additional coordination detail.

**Complete when:** implementation and proportionate verification are finished,
and the final comment and Project status match the real handoff state.

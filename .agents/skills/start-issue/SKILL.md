---
name: start-issue
description: Use before implementation when the user asks to start or take over an issue or pull request, implement untracked repository work, open a tracked pull request for work authorized now, or record a follow-up found after a merge. Reporting or diagnosing a problem is not itself a request to start work.
---

# Start Issue

Starting work means making it visible before changing it: one **work item** on
GitHub, the **tracker** the user reads, and one **claim** other agents can see.
The interview then fixes the **slice boundary** — the evidence that ends this
slice and what it leaves out — so babysit and the tripwire have something
finite to compare against. Complete the stages in order.

Enter this workflow when the user asks to start, take over, implement untracked
repository work, or record work. Diagnosing a failure, explaining behavior,
and reporting status stay outside it, even when the request names an issue or
pull request.

## 1. Identify the work item

For an existing numbered issue or pull request, resolve its live number, exact
GitHub title, and item URL as the first lookup, then emit this identity block
as the first substantive response:

```markdown
# #52: Open a specific review through a clickable Markover deep link
[#52 on github](https://github.com/lastobelus/markover/issues/52)

I'm checking its trackers, existing claims, and overlap before proceeding.
```

A brief orienting sentence may precede the lookup. No decision, question,
activity summary, or recommendation precedes the identity block.

**No numbered work item yet:** when no open issue or pull request owns the
requested work, including a problem found after a pull request merged, read
[`references/work-item-routing.md`](references/work-item-routing.md) completely
before the first write. Tracker and delivery-shape questions belong before an
item exists, so they precede this block; emit it immediately after creation.

**Complete when:** the work has one issue or pull request and its live identity
is on screen.

## 2. Read the ledger

Confirm `gh auth status`, then resolve the current checkout's repository and
keep every tracking and work-item operation there. Read the target once: type,
number, URL, title, body, relationships, comments, current branch, and attached
trackers.

```sh
gh issue view ITEM_URL --json milestone,projectItems
gh pr view ITEM_URL --json milestone,projectItems
```

Use every open Project and milestone already attached to the target unless the
user asks to change its tracking. Report an attached closed Project as
historical and leave it out of the tracker set. Resolve each Project's `Status`
field and its `In Progress` and `Done` options from live JSON; a milestone has
no status field. When an attached active Project lacks those options or
represents lifecycle differently, ask the user how that Project represents it
and retain the answer as its status mapping. Report conflicting active Project
statuses rather than choosing between them.

Then read the inflight set once, using live counts as limits: the items each
active Project holds in `In Progress`, each milestone's open issues and pull
requests, and the claim comments those items carry.

```html
<!-- start-issue-work-intent -->
```

Judge overlap from what that one pass shows — title, body, declared touch
points, linked pull request, and branch. An item with no claim is not thereby
suspicious; read what it says and move on. Ask the user when overlap is
plausible but unclear, because they are present and a collision is cheap to
resolve.

Read once. When a later read shows the set changed, use the newer read and
report what changed; two reads need not agree before you continue. Never
describe evidence gathered before a claim or a material scope change as a fresh
check.

**Tracker selection:** when the target has no active tracker, an attached
Project's identity is incomplete, or the user selects `New Project` or `New
Milestone`, read [`references/tracker-selection.md`](references/tracker-selection.md)
completely before the next tracking write.

**Complete when:** the tracker set and its status mappings are explicit, and
plausible overlap has been assessed or raised with the user.

## 3. Claim it

**When the target already carries an active claim** — any claim whose phase is
not `completed` — show it to the user and ask whether this run continues it,
takes it over, or belongs on a different item, before attaching or claiming
anything. Add no second claim. Edit another run's claim only after the user
says that run has stopped, and preserve its intent data when taking it over.
One item carries one active intent.

Attach the target to the tracker set if it is not already attached, and move
each mapped Project to `In Progress`. An already-correct value is a no-op.

```sh
gh project item-add PROJECT_NUMBER --owner PROJECT_OWNER --url ITEM_URL
gh issue edit ITEM_URL --milestone MILESTONE_TITLE
gh pr edit ITEM_URL --milestone MILESTONE_TITLE
gh project item-edit --id ITEM_NODE_ID --project-id PROJECT_NODE_ID \
  --field-id STATUS_FIELD_NODE_ID \
  --single-select-option-id IN_PROGRESS_OPTION_NODE_ID
```

Run only the commands the item type and tracker type require, and resolve
every node ID from live JSON — `item-edit` arguments are invalid without them.
An item belongs to many Projects but one milestone. Treat every other Project
field, milestone property, and repository label as read-only; the claim carries
the rest.

With no active claim on the target, post one claim comment and maintain it by
editing that exact comment ID:

````markdown
<!-- start-issue-work-intent -->
### Work intent

```yaml
phase: investigating
summary: "Short description of the intended slice"
touch-points:
  - unknown
done-when: unknown
excludes: []
blocked-by: []
may-block: []
branch: "current branch or unknown"
```
````

`done-when` is the observable evidence that ends this slice, and `excludes`
names the actors, scenarios, variants, and extensions left outside it. Stage 4
fills both; babysit reads them as the boundary for triage. Use issue or
pull-request references in dependency fields, keep unknown values explicit, and
keep the phase truthful — `implementing` only after implementation is
authorized.

After posting, read the target's own claim comments once more — that comment
thread only, not the trackers. When more than one active claim is present,
pause, show the collision, and let the user resolve it before implementation.
Two runs pausing is a good outcome; do not invent a winner.

**Complete when:** the target is attached, mapped Projects show `In Progress`,
one truthful claim exists, and no unresolved collision remains.

## 4. Interview

When planned slices imply future pull requests, name each uncreated pull
request by its relationship to the slice: `slice-3 PR`, `third PR`, or `PR for
slice 3`. Reserve `PR #N` for an existing GitHub pull request numbered `N`.

When the work promises an open-ended property, such as security, privacy or
sanitization, compatibility breadth, race freedom, provenance, resilience, or
evaluation completeness, resolve its stop condition with the other decisions:
the observable evidence that ends this slice, and the actors, scenarios,
variants, or extensions left outside it. Record that boundary as a decision
when the acceptance criteria already make it finite; otherwise narrow the
promise with the user before authorizing implementation.

When the user asks whether the complexity is warranted, or doubts that the
design will hold up, answer that as the next decision: name the actor, the
consequence, the ordinary recovery, and the smaller alternative, then take
direction before the scope grows further.

Use a zero-question path when the opening request, or a routing interview that
preceded item creation, already resolves acceptance criteria, scope boundaries,
dependencies, touch points, validation, and meaningful tradeoffs, and
explicitly authorizes implementation. Record the
resolved decisions, write them into the claim, and complete this stage without
inventing a question.

When any material decision remains unresolved, read
[`references/interview.md`](references/interview.md) completely and follow its
question and synchronization rules.

**Complete when:** acceptance criteria, scope boundaries, dependencies,
touch-points, validation, meaningful tradeoffs, and the stop condition of any
open-ended promise are resolved; `done-when` and `excludes` are written into
the claim; and either the opening request or a later response explicitly
confirms the shared understanding and authorizes implementation.

## 5. Implement and hand off

Set `phase: implementing` and make the agreed changes. Keep the claim, the
Projects, and the milestone aligned with the real state:

- `blocked`: name the concrete blocker in `blocked-by`; mapped Projects stay
  `In Progress`.
- `review`: the slice is with babysit or the user; record the handoff in the
  summary and leave mapped Projects `In Progress`.
- `completed`: the owned work is finished, and mapped Projects move to `Done`.
  A direct pull request completes when it merges. An issue completes when the
  issue closes, so a merged pull request that leaves issue work open keeps it
  `In Progress`.

Keep the milestone attached throughout; its progress changes when the item
closes.

Re-read the claim before resuming after an interruption, and before entering a
surface it does not declare. When implementation materially changes the
summary, touch points, dependencies, or branch, update the claim and reassess
overlap for the newly added surface before working inside it.

When the user decides something belongs to later work, record it on the owning
durable item before moving on; a follow-on that lives only in a plan or a reply
is lost. Propose the item and get authorization before creating a new one.

**Markover instance selection:** when this run will open, get, or edit a
Markover review, or the user asks to run a development instance, read
[`references/markover-review.md`](references/markover-review.md) completely
before the next Markover command.

**Complete when:** implementation and proportionate verification are finished,
and the claim, Project statuses, milestone membership, and item state match the
real handoff state.

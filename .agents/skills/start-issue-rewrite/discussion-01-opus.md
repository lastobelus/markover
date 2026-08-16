# Opus rewrite 01

`SKILL.md` 287 → 212 lines, references 5 → 4, total 499 → 412. The routine run
lost the election, the owner token, the convergence loop, the trust allowlist,
and three of the five scans; it kept every outcome in section 6 of the research
context.

## The shape

Five stages, each with an observable gate: **identify** the work item,
**read the ledger** once, **claim** it, **interview** to a finite boundary,
**implement and hand off**. The old skill's separate "How to respond to initial
prompt" section folded into stage 1, and its stages 1–3 collapsed into stages
2–3, because "orient", "scan", and "claim" were one pass over the same GitHub
state read three times.

Leading words: **work item**, **tracker**, **claim**, **slice boundary**. The
old skill said "canonical work-intent comment" and "work intent" and "marked
comment" for one object; the rewrite says *claim* everywhere.

## The eight decisions

1. **Same-item concurrency: detect and pause.** One present user, four to seven
   agent sessions, a collision that is cheap to resolve by asking. The election,
   the timestamp tie-break, the loser self-demotion, and the owner token were
   defending a race whose consequence is two agents noticing each other one
   response later. Stage 3 now shows an existing claim to the user and asks
   whether this run continues it, takes it over, or belongs elsewhere.

2. **Smallest adequate scan: one bounded pass.** Each active Project's
   `In Progress` items, each milestone's open issues and pull requests, and the
   claims those carry — live counts as limits, judged from title, body, touch
   points, linked pull request, and branch. Exhaustive reconstruction of every
   unmarked item is gone: an item with no claim is not thereby suspicious.

3. **Tracker state changing mid-scan: use the newer read.** "Repeat until two
   consecutive snapshots agree" had no attempt, item, or time bound and could
   invalidate its own completion evidence while the user worked. The rewrite
   reads once, and when a later read differs it uses the newer one and reports
   what changed. What survives from that concern is honest freshness, which was
   the actual live observation: never describe pre-claim evidence as a fresh
   check.

4. **The slice boundary lives in the claim.** Two new YAML fields, `done-when`
   and `excludes`, written by stage 4 and read by babysit as its triage
   authority. Babysit already reads "the acceptance criteria and the work-intent
   comment", so it needs no change; before this it had to infer the boundary
   from a summary and a touch-point list that never carried one.

5. **`completed` follows the item, not the merge.** A direct pull request
   completes when it merges; an issue completes when the issue closes, so a
   merged pull request that leaves issue work open keeps it `In Progress`. This
   resolves the ambiguity between merged, closed, `Done`, and handed off.

6. **Handoff without a surviving token.** The token had no persistence and no
   recovery, so an interrupted run left a claim no one could honestly reuse.
   Identity now comes from what GitHub actually persists — author, branch,
   phase, and the visible comment — and an interrupted claim is resolved by
   showing it to the user. `references/existing-claim.md` is deleted: its rule
   contradicted stage 3's, and the surviving rule is four lines inside stage 3.

7. **Ordinary path versus disclosed branches.** On the path: an item already
   attached to trackers, or one already-resolved tracker set. Disclosed:
   work-item routing, tracker discovery and creation, the interview, and
   Markover instance selection. GraphQL shapes and page-size handling stay in
   `tracker-selection.md`.

8. **Evals: keep the outcomes, drop the frozen prose.** Detail below.

## Contradictions resolved

- Identity-first versus `gh auth status`-first: identity is stage 1, auth opens
  stage 2.
- "Always use a work-intent comment" versus the issue-only and scheduled paths
  that correctly stop before claiming: the introduction no longer claims always.
- Stage 3's election versus `existing-claim.md`'s hand-back rule: one rule,
  one place.
- The owner token surviving interruption with no persistence: token removed.
- The direct-PR path writing before a claimable item exists: stated plainly in
  `work-item-routing.md` — the branch and pull request *are* that path's
  coordination point, so it scans before writing and claims immediately.
- Markover reference versus root `AGENTS.md`: the reference now says the root
  owns the CLI contract and it adds instance selection only.
- `completed` ambiguity: decision 5.

## Observed failures addressed

- **5.1 trigger overreach** — the description now says reporting or diagnosing a
  problem is not itself a request to start work, and the body repeats it once
  in positive form.
- **5.4 identity too late** — preserved verbatim, including the example block,
  with the harness tension resolved explicitly: a brief orienting sentence may
  precede the lookup; no decision, question, or activity summary may.
- **5.5 complexity concern did not stop the interview** — stage 4 now treats
  "is this complexity warranted?" as the next decision, answered with actor,
  consequence, recovery, and the smaller alternative. This is the one place the
  rewrite adds rather than removes, and it is the failure with the clearest
  transcript evidence.
- **5.6 deferred follow-on not durable** — stage 5 records a chosen follow-on on
  the owning durable item, and proposes rather than creates, matching babysit's
  `defer`.
- **5.2 / 5.3** — routing behavior kept as-is in `work-item-routing.md`; test
  isolation is a corpus concern, not a skill concern.

## Promotion note: the tests will not pass unchanged

`test/start-issue-evals.test.ts` reads `.agents/skills/start-issue`, so nothing
fails today. I ran its prose assertions against the rewrite: **7 of 23 fail, all
prose-freezing rather than behavioral.**

| Assertion | Why it fails | Suggested action |
|---|---|---|
| identity example block | anchored on the deleted `## How to respond to initial start-issue prompt` heading; the block itself is verbatim | re-anchor on `## 1. Identify the work item` |
| `emission gate` prose | phrase removed | assert the block precedes decisions and questions |
| `When no numbered work item exists yet` | reworded | re-anchor on the routing pointer |
| `Pre-creation ... exempt from the identity gate` | reworded | re-anchor on "Tracker and delivery-shape questions belong before an item exists" |
| `Untracked or post-merge work:` label | now `No numbered work item yet:` | update the label |
| `existing-claim.md` pointer and heading | file deleted | delete both assertions |

One eval case changes behaviorally rather than cosmetically:
`post-claim-scan-reconstructs-unmarked-items` requires
`postclaim-missing-intent-reconstructed:every-unmarked-project-item`, which is
exactly the mechanism decision 2 discards. Its live evidence supports honest
freshness, not exhaustive reconstruction. Recommend keeping the case and the
two source thread IDs, and replacing its actions with the freshness outcome:
required `overlap-evidence-labeled:honestly`, forbidden
`preclaim-evidence-presented:as-fresh-check`.

The other eleven cases are action-label cases and remain satisfiable, including
`multiple-trackers-retain-all-active-attachments` and both merged-PR follow-up
cases.

## Deliberate omissions worth your veto

- **No post-claim rescan.** Stage 2 reads the inflight set once and stage 5
  reassesses only when the declared surface materially expands. If two agents
  regularly start the same item inside one interview, this is the first thing
  to put back — as one re-read of the target's own claims, not a full scan.
- **No trusted-author filtering.** A public repository can have untrusted
  commenters, so the decision does not rest on their absence. It rests on
  consequence: a spoofed marker causes a pause and a question to a present
  user, which is cheap and recoverable, and the filter was never a security
  boundary. The allowlist also cited repository guidance that does not exist.
- **`gh auth status` kept.** It is one cheap command that produces a clear
  failure instead of a confusing one.

## Open for the editor

1. **Decision 1, the concurrency posture.** Detect-and-pause is the whole
   coordination contract now. If you believe same-item collisions are more
   frequent than the operating model suggests, that is the decision to argue
   with, not the individual mechanisms it replaced.
2. **Decision 4, two new claim fields.** `done-when` and `excludes` are a
   schema change to an artifact that already exists on live issues. Under the
   pre-preview policy this is a clean break with no fallback reader; live
   comments without the fields stay readable and simply carry no boundary.
3. **The proportionality checkpoint in stage 4** is the one addition. It earns
   its lines only if "is this complexity warranted?" reliably stops the
   interview; judge it against transcript 5.5.
4. **The eval case rewrite** in the promotion note is a behavioral change to
   the corpus, not a prose fix. It should be reviewed as a decision about what
   the live evidence actually supports.

## Working artifacts

`rewrite-context.md` and `discussion-*.md` are working files. Delete them when
this directory is promoted to `.agents/skills/start-issue`.

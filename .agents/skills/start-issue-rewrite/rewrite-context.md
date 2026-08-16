# Research context for rewriting `start-issue`

This document is a substitute for fresh archaeology. It combines the git and
GitHub history of `start-issue`, observed failures from local agent transcripts,
the current skill's branch structure, and the complexity-accretion audit that
followed issue #136 and PR #141.

Use it as evidence, not as a specification. Preserve outcomes that have real
user or architectural support; do not preserve a mechanism merely because it
exists today. The rewrite's prose, structure, and degree of compression belong
to Opus. Consult the indexed raw sources only when this summary leaves a
material rewrite decision unresolved.

## 1. User outcome and operating reality

The user wants `start-issue` to reduce time and cognitive load while allowing
several agent threads to make progress safely. Their normal target is one or two
LastCode sessions plus three to five Markover sessions, with six or seven
Markover sessions within the laptop's capacity. The relevant concurrency is
therefore real but narrow: agents may start different pieces of work at once,
and occasionally two agents may approach the same issue or pull request. The
user is present and can cheaply resolve a detected collision.

The broader goals are:

- keep Markover personally useful and move it toward a modest public
  announcement without process work displacing product work;
- notice complexity accretion early and escape it rather than solving every
  hypothetical;
- use more loops and multi-agent flows without turning coordination into the
  main project;
- preserve choice and motivation by keeping several valuable tasks available;
- make agent workflows save attention rather than demand hours of supervision.

Markover is a single-user local macOS app. Primary review text, feedback, and
attachments deserve strong protection. Secondary labels, local coordination
metadata, tracker state, and process records are usually recoverable. The user
does not need a distributed consensus system; they do need enough visible
coordination to prevent agents from unknowingly doing overlapping work.

## 2. Executive conclusion

`start-issue` began as a small interview and coordination workflow, then grew
from 141 lines in two files to 488 lines across `SKILL.md`, five references, and
metadata in four days. Much of that growth came one automated-review finding at
a time around a single concern: concurrent claims and freshness of GitHub
tracker scans.

The current skill mixes at least six jobs:

1. route fresh work to an issue or direct pull request;
2. discover and update Projects and milestones;
3. detect overlapping work;
4. elect and maintain ownership through a GitHub comment protocol;
5. interview the user and authorize implementation;
6. select Markover instances and maintain lifecycle state through handoff.

Several outcomes have strong live evidence: identify the issue before the
interview, ask only unresolved decisions, keep the Project useful to the human,
avoid creating both an issue and PR for immediate one-PR work, distinguish
canonical from development Markover, and refresh evidence rather than claim a
post-claim check used fresh data when it did not.

The exact machinery around those outcomes is much less supported. Stable-set
loops, exhaustive reconstruction of every unmarked tracker item, deterministic
timestamp elections, loser self-demotion, owner tokens, trust allowlists,
rescan-after-every-change rules, and ownership rereads before every commit and
push were mostly responses to hypothetical review interleavings. No direct
incident was found for most of them.

The rewrite should retain a small coordination contract for real multi-agent
use, but it should prefer detection, a visible pause, and user recovery over an
attempt to make GitHub comments behave like a lock service.

## 3. How the skill accumulated

| Date | Change | Evidence and lasting value |
|---|---|---|
| Aug 3 · PR [#34](https://github.com/lastobelus/markover/pull/34) | Added a 26-line reusable interview prompt. | Established one question per response, lookup of discoverable facts, recommendations with questions, user-owned decisions, and explicit authorization before implementation. |
| Aug 5 · `0b080b87` | First `start-issue` skill: 141-line `SKILL.md` plus metadata. | Added one pre-edit inflight scan, a work-intent comment, a Project status ledger, interview, and lifecycle updates. It had no election, owner token, stable-set loop, or post-claim scan. |
| Aug 6–7 · PR [#60](https://github.com/lastobelus/markover/pull/60), squash `57d95910` | Added the coordinated multi-agent skill and most defensive claim machinery. | The motivating outcome—avoid silent overlap between concurrent agents—was real. Most individual mechanisms below came from automated review rather than reported user failures. |
| Aug 7 · PR [#66](https://github.com/lastobelus/markover/pull/66), `deb7ee61` | Replaced hard-coded Project 3 with repository-scoped Project/milestone discovery. | Fixed real model errors: Projects and milestones are different, closed Projects should not be active, already-correct status is a no-op, and pre-authorized work needs a truthful zero-question path. |
| Aug 7 · issue [#69](https://github.com/lastobelus/markover/issues/69) and PR [#71](https://github.com/lastobelus/markover/pull/71), `ed65db5e` | Added offline behavior fixtures. | Two live runs reused pre-claim evidence for still-unmarked items while describing the post-claim scan as fresh. This supports honest freshness, not necessarily exhaustive rescanning. |
| Aug 7–8 · PR [#74](https://github.com/lastobelus/markover/pull/74), `6850d359` | Added direct-PR and merged-follow-up routing, then progressively disclosed branches. | Corrected a real incident in which immediate cleanup created issue #72 and PR #73. One bounded PR should create one work item. |
| Aug 8 · PR [#89](https://github.com/lastobelus/markover/pull/89), `7bad4a75` | Reserved `PR #N` for existing GitHub PRs and used slice ordinals for future work. | Prevents ambiguity, though the triggering finding was consistency review rather than a documented user failure. |
| Aug 9 · PR [#118](https://github.com/lastobelus/markover/pull/118), `2673c61a` | Restored canonical Markover as the default for plans and artifacts; made a PR development instance opt-in. | Corrected observed workflow confusion. Keep the outcome and review-ID/instance pairing. |
| Aug 9 · PR [#119](https://github.com/lastobelus/markover/pull/119), `efa34164` | Made exact issue identity the first substantive output for an existing numbered item. | Corrected weak T3 thread titles derived from interview text. Review then narrowed the gate so untracked work can ask routing questions before an item exists. |
| Aug 13 · PR [#152](https://github.com/lastobelus/markover/pull/152), `bf096db3` | Added the repository complexity tripwire. | Supplies the counterweight missing during the history above: repeated race/retry/ownership/provenance layers require a pause, proportionality check, and finite completion test. |

### PR #60's review-driven hardening sequence

PR #60 is the closest `start-issue` analogue to the later PR #141 blackhole.
Automated review successively added:

- live Project/item/field/option node resolution;
- pagination beyond default item and field limits;
- rereading claims after publication;
- deterministic earliest-`created_at` election with numeric-ID tie-break;
- losing-claim self-demotion;
- two consecutive identical candidate snapshots;
- reconstruction of every missing intent from issue bodies, linked PRs,
  changed paths, drafts, and local worktree evidence;
- a complete fresh scan after claiming;
- another scan after material interview changes;
- another scan after implementation expands its surface;
- a stable per-run owner token;
- ownership checkpoints before intent edits, implementation, resume, waits,
  commits, pushes, handoff, and completion;
- trusted-author filtering and a hypothetical bot allowlist;
- special treatment for Project drafts without comment endpoints.

One review finding was plainly functional: the proposed `gh project item-edit`
arguments were invalid until live node IDs were resolved. The rest mostly
defended hypothetical pagination, publication, race, stale-read, resumption,
malicious-comment, or draft-item scenarios. Their representative review links
are [invalid Project edit](https://github.com/lastobelus/markover/pull/60#discussion_r3732027628),
[claim publication race](https://github.com/lastobelus/markover/pull/60#discussion_r3732184151),
[missing marker window](https://github.com/lastobelus/markover/pull/60#discussion_r3732309834),
[post-claim rescan](https://github.com/lastobelus/markover/pull/60#discussion_r3732453093),
[interview rescan](https://github.com/lastobelus/markover/pull/60#discussion_r3732476302),
[owner token](https://github.com/lastobelus/markover/pull/60#discussion_r3732528372),
[ownership checkpoints](https://github.com/lastobelus/markover/pull/60#discussion_r3732584578),
and [trusted authors](https://github.com/lastobelus/markover/pull/60#discussion_r3732618096).

This distinction matters: review comments prove that a counterexample can be
imagined. They do not prove the consequence is material, that the scenario is
common in supported use, or that the chosen preventative protocol is cheaper
than detecting a collision and asking the user.

## 4. What a routine run currently carries

For an ordinary existing issue, the current skill requires all of the
following before implementation:

- live issue identity and an exact first-response identity block;
- repository, tracker, field, option, and status resolution;
- a complete pre-claim scan of every selected tracker;
- paginated comments for every candidate;
- special reconstruction for candidates without work-intent markers;
- tracker attachment and status mutation;
- creation or update of a marked YAML work-intent comment;
- rereading all target markers and electing a canonical winner;
- a complete fresh post-claim scan;
- another final scan after interview updates before authorization.

The scan repeats after material intent changes, after implementation changes
the declared surface, and after interruption. Multiple Projects and milestones
multiply it. A Project without a useful Status requires inspecting every item;
a milestone requires inspecting open issues and PRs; an unmarked item triggers
issue/PR/draft content, linked-PR, changed-path, and worktree reconstruction.

The completion rule requires two consecutive identical candidate sets. It has
no attempt, item, comment, byte, or time bound. If another agent or the user is
changing the tracker, the workflow can keep invalidating its own completion
evidence. “Every known inflight item” is not a finite observable while the set
is changing.

The direct-PR path adds a tracker choice, scan, branch, first commit, draft PR,
attachment, claim, election, and post-claim scan. Ironically, it must write the
branch, commit, and PR before the PR exists as a claimable coordination item,
so the preventative protocol still cannot close its initial race window.

## 5. Observed thread failures

These are direct local transcript observations, not deductions from the prose.

### 5.1 Trigger overreach delayed diagnosis

In session `019fe55c-81dc-7d60-a956-0208d3fb2e4b` (Aug 10), the user reported
that Markover was not working after #124. The agent emitted work-item identity,
scanned trackers, and invoked `start-issue`. The user corrected it:

> I'm not asking you to start an issue yet. I'm telling you I don't currently
> have a working markover.

The agent admitted it had “over-applied the workflow” and returned to diagnosis.
No external write occurred, but at least one turn and a user correction were
wasted. The trigger must distinguish starting/taking over authorized work from
diagnosing, explaining, or reporting a problem that merely mentions an issue or
PR.

Raw transcript:
`/Users/lasto/.codex/sessions/2026/08/09/rollout-2026-08-09T00-11-12-019fe55c-81dc-7d60-a956-0208d3fb2e4b.jsonl`.

### 5.2 Generic tracker routing obscured a simple follow-up

In session `019fd454-dee5-74d0-8f3c-8e0105753827` (Aug 7), a fix discovered
after a merged PR produced a generic tracker chooser and a stale reference to
the prompt's `*1`. The user called the response confusing and supplied the
missing model:

- apply now: inherit the merged PR's tracker and open one linked PR;
- record for later: create an issue and make the tracker choice explicit.

Another run created issue #72 and draft PR #73 for one immediate fix. The user
said, “when we are creating a PR immediately we don't need to make an issue
first.” This is the strongest evidence for the current direct-PR branch.

Raw transcript:
`/Users/lasto/.codex/sessions/2026/08/05/rollout-2026-08-05T16-49-19-019fd454-dee5-74d0-8f3c-8e0105753827.jsonl`.

### 5.3 Forward-test output leaked into live-task status

The same session was editing `start-issue` while a forward test simulated
“Start work on issue #52.” The simulation reported a worktree collision as if
it were current work. The user asked, “aren't we working on
start-issue-skill?” The coordination check itself was not the problem; failing
to isolate or label evaluation output was. A rewrite should not turn test-task
state into live-task state.

### 5.4 Issue identity arrived too late

The same history records repeated threads beginning with interview content
rather than the exact issue title, producing weak titles such as “Reconcile
Decision Register with Main.” The user requested:

```text
# #XX: Exact GitHub issue title
[#XX on github](link-to-issue)
```

This became PR #119. Preserve the user-visible outcome. Note the execution
tension: the title requires a GitHub lookup, while the harness requires a brief
commentary message before tool use. “First substantive response” is the current
attempt to reconcile those constraints.

### 5.5 Complexity concern did not stop the interview

In session `019fe86f-cb75-7171-bf3e-10b15963a184` around issue #101, the user
asked, “Is the additional complexity warranted?” and later worried that the
design was getting out of their wheelhouse and might be brittle or require
constant churn. The agent reassured them and continued into credential/network
isolation, immutable bundles, adaptive context requests, bounded rounds, and a
three-PR stack. This does not prove those decisions were wrong; it does prove
the interview lacked a reliable complexity checkpoint when the user explicitly
raised proportionality and brittleness.

Raw transcript:
`/Users/lasto/.codex/sessions/2026/08/09/rollout-2026-08-09T14-31-08-019fe86f-cb75-7171-bf3e-10b15963a184.jsonl`.

### 5.6 A deferred follow-on was not durable

In session `019ff767-2466-77e0-bdb5-f495eb9f4c4f` (Aug 13), the agent said a
separate badge-layout UI would be implemented later under #97. The user asked
how it would be remembered and whether it had been recorded on #97. It had not;
the exact layout existed only in a merged plan. The agent then added a comment
to the owning issue.

The outcome to preserve is durable placement of a follow-on when the user has
chosen to remember it. Do not turn that into automatic issue creation for every
deferred review suggestion; the approved `babysit` rewrite explicitly requires
user authorization before `start-issue` creates follow-up work.

Raw transcript:
`/Users/lasto/.codex/sessions/2026/08/12/rollout-2026-08-12T12-15-59-019ff767-2466-77e0-bdb5-f495eb9f4c4f.jsonl`.

## 6. Evidence-backed outcomes to preserve

Preserve these outcomes even if their current implementation is replaced:

- **Narrow invocation.** Diagnosis, explanation, and status reporting do not
  become issue-start workflows merely because an issue or PR is mentioned.
- **Identity first for an existing item.** Resolve and emit the live number,
  exact title, and URL before interview content can seed a misleading thread
  title. Emit identity immediately after creating a new item.
- **Facts before questions.** Look up discoverable facts. Ask one unresolved
  material decision at a time, include a recommendation, and let explicit
  opening authorization take the zero-question path.
- **Human-visible ledger.** GitHub Project status remains useful to the user as
  the coarse source of truth. A work-intent comment carries the change surface,
  dependencies, lifecycle, and coordination details that Project fields do not.
- **Overlap detection.** Before implementation, inspect plausible active work
  and stop on a credible conflict. Concurrent agents on different work should
  be cheap; two agents on the same item should become visible.
- **Honest freshness.** If a claim or material scope change can invalidate the
  evidence used to assess overlap, do not label old evidence as a fresh check.
  The mechanism and depth may be much smaller than today's exhaustive scan.
- **One bounded change, one work item.** Work authorized now and likely to fit
  one PR/session can use one tracked direct PR. Multi-PR, multi-session,
  roadmap-coordinated, or scheduled work belongs in an issue. Do not create an
  issue plus PR solely as ceremony.
- **Follow-up distinction.** “Apply now” and “record for later” are different
  branches. Reuse an obvious source tracker for an immediate PR; ask only when a
  real tracker decision remains.
- **Truthful lifecycle.** Keep tracker and intent state aligned with
  investigating, implementing, review, blocked, and genuinely completed work.
  A merged PR does not make a larger issue complete when work remains.
- **Markover instance identity.** Ordinary plans and artifacts stay canonical;
  a PR development instance is selected only for an explicit development/test
  request. Keep each review ID with its instance selector.
- **Durable chosen follow-ons.** When the user decides something should be
  remembered for later, record it on the owning durable item. Do not infer
  authorization to create every proposed follow-up.
- **Finite authorization.** An open-ended promise must have observable evidence
  that ends the slice and explicit exclusions before implementation begins.

## 7. Mechanisms to simplify, disclose, or discard

Treat the following as candidates, not invariants:

- two-consecutive-snapshot convergence with no retry bound;
- full scans after claim, every material interview answer, every implementation
  scope change, every interruption, and final authorization;
- exhaustive reconstruction of every unmarked Project or milestone item;
- deterministic timestamp/ID election between near-simultaneous claims;
- losing-claim self-demotion and permanent stop rules;
- a per-run owner token that has no persistence or restart recovery mechanism;
- ownership rereads before every wait, commit, push, handoff, and completion;
- special protocol branches for Project drafts and Projects without lifecycle
  status on every ordinary run;
- a bot allowlist described as repository guidance when no such guidance exists;
- low-level GraphQL query shapes and page-size edge cases in the main workflow;
- duplicated identity, tracker, claim, scan, and Markover rules across the main
  skill, references, root guidance, eval fixtures, and source-shape tests.

A simpler collision posture could read the live ledger once at a meaningful
boundary, claim visibly, recheck the small set of plausible conflicts, and stop
for the user when state changed. This is an example of the desired cost model,
not a required implementation.

## 8. Current contradictions and execution traps

Opus should resolve these rather than restating both sides:

- `SKILL.md` calls item identity the first lookup, while stage 1 says to check
  `gh auth status` first.
- The introduction says to always use a work-intent comment, while scheduled
  issue and issue-only branches correctly stop without creating one.
- Stage 3 says the earliest trusted marker wins and later claimants demote
  themselves; `references/existing-claim.md` says an old marker remains until
  its owner acknowledges handoff or the user confirms that run stopped.
- The owner token must survive interruption, but no persistence or recovery
  mechanism exists.
- The direct-PR path performs its first write before a claimable PR exists.
- Markover commands appear in a reference, while the root `AGENTS.md`
  `pullRequestStatus` contract remains the source of truth and is not clearly
  invoked from that reference.
- The completed lifecycle can mean PR merged, issue closed, Project Done, or
  work slice handed off; those are not always the same event.

## 9. Contract with the approved `babysit` rewrite

PR [#153](https://github.com/lastobelus/markover/pull/153), merge `a46ab164`,
promoted the approved `babysit` rewrite. `start-issue` should leave it a small,
usable contract:

- Babysit reads the addressed issue's acceptance criteria and work-intent
  comment as the slice boundary. The current intent YAML has summary,
  touch-points, and dependencies, but no explicit finite completion evidence or
  excluded actors/scenarios/variants. Decide where that boundary lives so
  babysit does not have to invent it.
- Babysit sorts findings as `fix`, `narrow`, `defer`, or `decline`, uses at most
  three finding-bearing rounds, and applies the canonical complexity tripwire.
  A deferred item is created through `start-issue` only with user authorization.
- Start-issue currently requires ownership checks before every commit/push, but
  babysit does not implement that protocol. Prefer one coherent handoff rule
  over expanding both skills with mirrored checkpoints.
- Handoff to babysit should leave the work intent truthful—normally `review`
  with Projects still `In Progress`. After merge, the issue and tracker become
  Done only when the real owned work is complete.
- Markover merge cleanup belongs to babysit's disclosed merge reference. Do not
  duplicate it in `start-issue`; point to the root or owning workflow.

## 10. What PR #141 teaches before implementation begins

Issue #136 asked for a finite live-agent metadata conformance baseline. PR #141
initially contained 13 changed files, 1,336 insertions, a 654-line runner, a
233-line test, and three fixtures. During roughly 23 hours of repeated review it
grew to 361 files, 29,105 insertions, a 3,424-line runner, a 3,646-line test,
351 fixtures, and 254 commits above base.

The loop involved 126 manual review triggers, 122 submitted Codex reviews, 160
findings, 319 separate 100-second sleeps, 14 compactions, 3,705 execution calls,
958 waits, and 601 patch operations. Of 159 inline findings, 145 concerned
privacy/redaction, 81 explicitly presented “Fresh evidence,” 157 received a
fix/address reply, and none were declined.

The reviewer was often locally correct: after one decoder was added, another
representation could bypass it. The global promise was impossible to finish.
“Sanitized known identity fields” had silently become “no private input can
survive under any representation.” The ladder progressed through normalized
containment, Base64, Base32, hex, Base36, Base58, Base85, Punycode, Base62,
quoted-printable, HTML references, uuencode, Base91, Unicode escapes, ROT13,
segmentation, and provenance layers. There is always another transform.

The implied attacker was a trusted repository committer deliberately inserting
a private value into their own fixture while controlling both the validator and
the repository. The consequence was exposure of eval metadata intentionally
collected by that same user, and recovery was regeneration or replacement of a
fixture. The validator was not a meaningful trust boundary against its owner.

The branch was finally rebuilt from main. The useful outcome survived with 13
files, 1,292 insertions, a 637-line runner, a 227-line test, and three fixtures.
The cleanup removed 28,104 lines and 348 fixtures—97% of the additions—without
losing the core evaluation result. That is unusually strong evidence that local
review correctness had displaced product proportionality.

The process failure was upstream of babysitting:

- the acceptance promise lacked a finite domain;
- the actor, capability, consequence, and recovery were not named;
- review severity was treated as authority;
- every fix enlarged the next review surface;
- new persistent states became permanent merely because a finding mentioned
  them;
- terminal-clean review replaced “does this still satisfy the issue?” as the
  finish line;
- the user had to supply the threat-model off-ramp after a day of churn.

`start-issue` is where this should now be prevented: not by interviewing every
ordinary task about security, but by refusing to authorize an open-ended
property until its observable end and exclusions are clear.

## 11. The same pattern elsewhere in the repository

The blackhole was not isolated:

- **Decision Gardener:** roughly 6,800 implementation/test lines surround a
  missed audit explicitly documented as harmless because the next run audits
  the durable Git range. It acquired PID/start-time locks, stale reaping,
  ownership tokens, retries, invalid-state evidence, notification queues, and
  health transitions. PR #130 had 19 findings and 3,084 additions; PR #135 had
  22 findings and 2,412 lines.
- **Private enrichment:** roughly 1,280 production lines, 1,080 direct-test
  lines, and a 666-line plan were built despite no production title producer,
  IPC adapter, UI, or consumer. The defended losses are stale reconstructible
  metadata and orphan sidecars.
- **Annotation evals:** one area reached roughly 20 MB and 5,779 files, with a
  2,054-line runner and 48 trials/judgments. PR #111 had about 5,790 changed
  files and 152,750 additions. A small discriminating sample would have answered
  the initial question.
- **Source-shape tests:** about 28 tests, 6,815 lines, and roughly 655 regex
  assertions freeze prose and implementation form. `start-issue` currently has
  static regex checks and action-label set comparisons, not an executing GitHub
  simulator.
- **Deep links:** a best-effort convenience path accumulated canonical
  doctor/refresh/repair completion gates even though raw review IDs and a
  Terminal fallback remained reliable.
- **Settings and shutdown:** cross-process coordination was defended despite one
  Electron owner, and a timeout that did not cancel its underlying work created
  the late-mutation race it was meant to contain.

The repeating mechanism is generative: a lock creates stale-lock and reaper
states; a failure record creates append, notification, privacy, and provenance
states; a fail-closed scan creates uncertainty and retry states; a sanitizer
creates an endless transform family. Before adding a protective mechanism,
price the new states it creates.

## 12. Proportionality questions for the rewrite

When a task promises security, privacy/sanitization, compatibility breadth,
race freedom, provenance, resilience, or evaluation completeness, the
interview should resolve only the questions needed to make the slice finite:

1. What observable invariant is actually promised?
2. Which actor or interleaving can violate it in supported use?
3. What material consequence follows?
4. What is the ordinary recovery, and how costly is it?
5. Is prevention simpler and cheaper than detection and recovery?
6. What evidence ends this slice, and which actors, variants, extensions, or
   later findings remain outside it?

The repository tripwire remains the canonical implementation/review stop. The
interview's job is to establish a boundary that the tripwire and babysit can
later compare against, not duplicate every tripwire predicate or force six
questions into routine work.

Prefer prevention for primary user data, real trust boundaries, and destructive
operations. Prefer detection and recovery for secondary, reconstructible, or
disposable state. A reviewer label does not answer these questions.

## 13. Already accepted stop-condition language

The user accepted the Opus-authored addition currently present in the working
copy. Preserve it in substance while restructuring the skill.

Current `SKILL.md` addition:

> When the work promises an open-ended property, such as security, privacy or
> sanitization, compatibility breadth, race freedom, provenance, resilience, or
> evaluation completeness, resolve its stop condition with the other decisions:
> the observable evidence that ends this slice, and the actors, scenarios,
> variants, or extensions left outside it. Record that boundary as a decision
> when the acceptance criteria already make it finite; otherwise narrow the
> promise with the user before authorizing implementation.

Current `references/interview.md` addition:

> An open-ended promise is resolved only with a stop condition: the observable
> evidence that ends this slice and what it leaves out. Derive it from the
> acceptance criteria and record it as a numbered decision when they already make
> it finite; ask only when the promise is still unbounded, and recommend
> narrowing the promise rather than enlarging the slice.

The completion criterion also names “the stop condition of any open-ended
promise.” The accepted behavior is intentionally inert for an ordinary bounded
task: derive and record when evidence is already sufficient; ask only when the
promise remains unbounded.

## 14. Decisions the rewrite should make explicitly

These questions are genuinely unresolved by the history. Choose a simple
answer where the user's operating model supplies one; surface a user decision
only when alternatives would materially change behavior.

1. What level of same-item concurrency is supported: detect-and-pause, or a
   stronger ownership protocol? Perfect election is not an established need.
2. What is the smallest bounded overlap scan that is adequate for one user and
   several agents?
3. When tracker state changes during a scan, what finite outcome replaces
   “repeat until two identical snapshots”?
4. Where is the finite slice boundary persisted so babysit can read it without
   inference?
5. What event owns `completed` for a PR-backed slice versus a larger issue?
6. How is an existing claim handed off after an interrupted or abandoned
   thread without pretending an ephemeral token survived?
7. Which tracker cases belong on the ordinary path, and which should be
   progressively disclosed as exceptional branches?
8. Which current static evals protect user-visible behavior, and which merely
   freeze the present prose or mechanism?

## 15. Evidence index

Repository sources:

- `.agents/skills/start-issue/SKILL.md` and `references/*.md` — current canonical
  skill before the rewrite;
- `.agents/skills/start-issue-rewrite/SKILL.md` and
  `references/interview.md` — working copy with the accepted stop-condition
  addition;
- `evals/start-issue/README.md`, `evals/start-issue/cases.json`, and
  `test/start-issue-evals.test.ts` — twelve normalized cases, of which three are
  live-thread-derived and nine synthetic;
- `AGENTS.md:12-37` — canonical complexity tripwire;
- `origin/main:.agents/skills/babysit/SKILL.md` and
  `references/merge.md` — approved babysit contract from PR #153;
- `doc/explanations/2026-08-13__complexity-accretion-audit/index.html` — audit
  overview;
- `doc/explanations/2026-08-13__complexity-accretion-audit/01-pr-141-forensics.html`
  — review counts, growth, codec ladder, and cleanup counterfactual;
- `doc/explanations/2026-08-13__complexity-accretion-audit/02-guidance-loop.html`
  — source-of-truth mismatch and proportionality filter;
- `doc/explanations/2026-08-13__complexity-accretion-audit/03-local-app-hotspots.html`
  — realistic local concurrency, data value, and recovery tradeoffs;
- `doc/explanations/2026-08-13__complexity-accretion-audit/04-tooling-process-hotspots.html`
  — Decision Gardener, eval, deep-link, source-shape, and process evidence.

GitHub sources:

- [PR #34](https://github.com/lastobelus/markover/pull/34) — original
  interview;
- [PR #60](https://github.com/lastobelus/markover/pull/60) — coordinated skill
  and review-driven hardening;
- [PR #66](https://github.com/lastobelus/markover/pull/66) — dynamic trackers
  and zero-question path;
- [issue #69](https://github.com/lastobelus/markover/issues/69) and
  [PR #71](https://github.com/lastobelus/markover/pull/71) — offline evals and
  two live freshness observations;
- [PR #74](https://github.com/lastobelus/markover/pull/74) — direct-PR and
  follow-up routing;
- [PR #118](https://github.com/lastobelus/markover/pull/118) — canonical versus
  development Markover;
- [PR #119](https://github.com/lastobelus/markover/pull/119) — issue identity
  before interview;
- [issue #136](https://github.com/lastobelus/markover/issues/136) and
  [PR #141](https://github.com/lastobelus/markover/pull/141) — complexity
  blackhole subject;
- [PR #152](https://github.com/lastobelus/markover/pull/152) — complexity
  tripwire;
- [PR #153](https://github.com/lastobelus/markover/pull/153) — approved
  babysit rewrite.

## 16. Drafting brief for Opus

Rewrite from the user-visible job backward. Make the routine path short enough
that starting useful work feels cheap. Spend ceremony only where a real choice,
collision, trust boundary, or irreversible write demands it. Use progressive
disclosure for branches that ordinary runs do not need. Keep one source of
truth for each concept and let root guidance or the environment own details
already defined there.

Do not optimize for preserving current line structure or satisfying static
regexes unchanged. The tests may need to follow the approved behavior rather
than force the old prose. Do not convert every historical review counterexample
into a permanent requirement. The target is predictable behavior with finite
stops, not a proof that no agent race or tracker edge case can ever occur.

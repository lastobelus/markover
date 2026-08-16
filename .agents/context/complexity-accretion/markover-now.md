# Short-term Markover work

Read `README.md` first. This thread exists to restore steady product progress
and carry issue #97 through the private-enrichment hotspot without forgetting
the accepted sequence.

## Product outcome

Issue #97 should leave Markover with:

- one obvious active-review navigation model instead of redundant tabs;
- exact review IDs that are visible, copyable, keyboard-available, and usable
  for direct activation;
- authoritative renamed T3 thread titles with honest fallbacks and no polling;
- clear provider/thread-host presentation;
- repository grouping that unifies equivalent real worktrees and clones while
  keeping forks distinct; and
- no private title, checkout, path, or repository evidence in portable reviews
  or agent-visible responses.

The accepted strategy is **delete, trace, then rebuild vertically**.

## Current gate

Issue #97 and its accepted delete-trace-rebuild sequence are complete. PR #164's
repository-grouping behavior passed operational acceptance in canonical
Markover at merge `479c89a2`; the finite corpus evidence is recorded with that
vertical below. The acceptance run also reproduced a separate canonical
maintenance defect: documented `canonical refresh` relaunches a healthy service
with no visible window. PR #168 fixed that bounded follow-up and passed canonical
operational acceptance at merge `a6455020`. Codex issue #166 and Claude issue
#167 remain separate future title-adapter experiments, not unfinished #97 work.

## T3 renamed-title experiment — complete

The read-only experiment completed on 2026-08-15 PDT against
`/Users/lasto/.t3/userdata/state.sqlite`. One T3 rename was traced end to end:

- thread `2bc450ea-bc75-4895-b439-11ada2e671da` was created at event `641079`
  with the opening-prompt preview as its title;
- T3's server rename produced `Verify T3 Rename Projection` at event `641095`;
- accepted client command `89cc6765-343c-4966-b65f-4cf2801754cb` renamed it to
  `Read-only T3Code Title Experiment` at event `641104`; and
- a later read of `projection_threads` returned that exact final title under
  the same primary-key `thread_id`.

The exact identity and lookup contract is:

```text
effectiveThreadId = threadHost.threadId when present, agentThread.id otherwise
stableThreadIdentity = [threadHost.kind, effectiveThreadId]
T3 row key = effectiveThreadId when threadHost.kind selects the T3 adapter
```

Equal `threadHost.threadId` and `agentThread.id` values are valid. Provider,
machine, title, aliases, and discovery path do not participate in identity. The
read is:

```sql
SELECT title
FROM projection_threads
WHERE thread_id = ? AND deleted_at IS NULL;
```

The primary-key query plan was an indexed lookup. Five fresh-process reads of
the live 6 GB WAL database each rounded to `0.00s`, including while T3 was
actively writing. Launch, review arrival, foreground/Inbox-or-Projects
activation, and manual refresh are therefore sufficient rediscovery events;
polling and watchers are not justified.

Disabled integration performs no read. A missing/unknown/deleted identity or a
blank title is unavailable. A missing database reported `unable to open
database file`; malformed input reported `file is not a database`; schema and
locked/busy errors are likewise temporary unavailability. Use a short busy
timeout and the ordinary review-purpose/document fallback. The live WAL-aware
source returned the completed rename; `projection_threads.updated_at` also
changes for unrelated thread activity, so it is not a title-version or stale
copy detector.

PR C implements this without a persistent Markover title cache: it rediscovers
into memory on the events above, degrades to the existing fallback on absence
or failure, and lets the next event or manual refresh recover. The experiment
and focused QA found no exact failure that justifies an atomic persisted value.

## Completed sequence

PR B is complete. Issue #156 closed when PR #157 merged reviewed head
`60af76ea` into `main` as squash commit `47a1cc62` on 2026-08-15 PDT. The
read-only preflight found zero production producers, zero production consumers,
and zero review or thread sidecars across canonical and extant development
roots. The full local gate passed 700 tests and Electron smoke; GitHub CI passed,
Codex completed current-head review with a thumbs-up, and Markover `done` found
zero matching local reviews. The `UI Enhancements` tracker item and work-intent
claim are complete. That slice left #97 open for the later PRs below.

PR A is complete. PR #158 merged reviewed head `e0f1eb97` into `main` as squash
commit `b597764d` on 2026-08-15 PDT after deterministic checks and human macOS
QA. The navigation/exact-ID claim is completed.

PR C is complete. PR #162 merged reviewed head `c21df8ca` into `main` as squash
commit `ebdae88e` on 2026-08-15 PDT, closing issue #160 and moving its
`UI Enhancements` project item to Done. The adapter uses the proven read-only
primary-key query with a 100 ms busy timeout; settings are disabled by default;
titles cross one strict private IPC response and stay in renderer memory;
Projects uses authoritative thread titles while Inbox has an independent
purpose/title preference; and launch, review arrival, foreground/navigation
activation, and one manual action refresh without a poller or watcher.
Provider and thread-host artwork is simultaneous and duplicate artwork is
suppressed.

The rebased full local gate passed 706 tests plus Electron smoke. GitHub's
current-head `Verify (Node 24)` check passed, Codex completed current-head
review with a thumbs-up and no findings, and the pull request merged cleanly.
The built adapter also returned `Read-only T3Code Title Experiment` from the
live experiment row. Focused human macOS QA passed disabled defaults, live
title ingestion and review-arrival refresh, Inbox and Projects preference
behavior, distinct provider/thread-host badges in dark and light appearance,
manual refresh, honest missing-source fallback, and next-refresh recovery.
Markover `done` found zero matching local reviews. The issue claim is
completed. The merged slice added no persistence, polling/watchers, generic
adapters, additional providers, repository grouping, or revival of the
removed enrichment runtime.

PR #158: https://github.com/lastobelus/markover/pull/158
Issue #160: https://github.com/lastobelus/markover/issues/160
PR #162: https://github.com/lastobelus/markover/pull/162

The skills rewrite continues in the original thread and is not a product
dependency.

## Current and completed slices

### Completed PR #158 — navigation and exact IDs

- remove document tabs and closeable working-set behavior;
- retain one persisted active review, per-review view state, deep links, and
  next/previous navigation;
- remove the unreleased tab-state shape directly, without a compatibility
  reader or dual writer;
- expose exact review IDs with copy, keyboard, accessibility, and the smallest
  direct-ID activation affordance.

Stop when there is no tab/close model, one active review restores, navigation
and deep links work, and an exact ID can be copied and activated without a
mouse. Require focused deterministic tests and one human QA pass.

### Completed issue #156 / PR #157 — removed unused private enrichment

The removed system was about 1,280 production lines plus 1,082 direct test
lines and a 666-line plan. It had no production title producer, discovery
producer, IPC path, renderer consumer, or production callers of its observation
and projection APIs.

PR #157 removed the store, lifecycle pause/drain/flush, Trash coupling, generic
schemas, conflict/error arbitration, pending failed targets, direct protocol
tests, and packaging entries. It preserved:

- every existing sidecar byte;
- portable/private separation and agent-visible private-field rejection;
- path containment and restrictive permissions where private files exist;
- `ReviewStore` per-review serialization and atomic primary writes;
- primary review, attachment, handoff, and Trash behavior; and
- current UI fallbacks.

Production now has no enrichment imports or lifecycle/cleanup calls. Primary
review paths pass, sidecars remain opaque and untouched, and quit no longer
waits on secondary metadata. No migration, compatibility reader, retry state,
or replacement cache was added.

Work item: https://github.com/lastobelus/markover/issues/156

Completed claim:
https://github.com/lastobelus/markover/issues/156#issuecomment-5304236521

Merged pull request: https://github.com/lastobelus/markover/pull/157

## Then build only proven verticals

PR C is complete after A and B. It connects the proven T3 source through one
private in-memory projection to one UI consumer. It refreshes on launch, review
arrival, foreground/Inbox-or-Projects activation, and manual action. It runs
without persistence; the experiment and QA found no failure that justifies an
atomic cached value. Temporary source failure falls back without blocking
editing, handoff, Trash, or quit.

The repository-grouping vertical completed and merged in PR #164 under the
#97 claim at
https://github.com/lastobelus/markover/issues/97#issuecomment-5304825315.
The revised 2026-08-13 plan calls this **PR D** because its inserted deletion
PR shifted the letters; the original 2026-08-12 sequence calls repository
grouping **Slice C** and reserves **Slice D** for additional title adapters.
Use descriptive names rather than a bare letter when coordinating threads.
The 2026-08-15 PDT trace covered all 85 canonical reviews against current live
source bytes and Git state. Thirty-nine paths still matched their immutable
opening checksum; 31 of those were Markover reviews spread across 10 current
checkout-root project keys even though every one resolved to live normalized
origin `github.com/lastobelus/markover` and common Git directory
`/Users/lasto/projects/markover/.git`. Forty-six missing or changed paths took
the existing nonmodal `unassigned` fallback. Four real multi-clone sets under
`~/projects` confirmed that a common Git directory cannot unify independent
clones.

The finite private identity order is normalized live origin, then common Git
directory for local-only linked worktrees, then canonical checkout root. The
full normalized `host/owner/repository` keeps forks distinct; canonical reviews
contain no live fork case, so focused fixtures own that proof. The projection
is derived in memory only after the existing source checksum verification and
crosses the existing private document IPC. Missing, changed, non-Git, or
unusable remote evidence falls through without a modal error. This slice adds
no portable field, persistence, checksum identity, generic resolver, polling,
watcher, retry state, or compatibility layer.

The private vertical merged as PR #164 at squash commit `479c89a2`; the exact
green reviewed head was `a44dd955`.
Its compiled resolver reproduced the trace exactly: one 31-review `markover`
project across 10 live roots, one seven-review `dragonlist-mono` project, one
one-review `make-games-with-agents` project, and 46 unassigned reviews. Focused
fixtures cover SSH/HTTPS normalization, independent clones, local-only linked
worktrees, a different-owner fork, root fallback, and stale or missing sources.
The three finding-bearing review rounds produced three bounded fixes: generic
SSH usernames remain part of remote identity while GitHub's conventional SSH
user still normalizes with HTTPS; a project spanning independent clone roots
omits an arbitrary singular root; and launch restoration bounds Git discovery
to ordered batches of four. No finding required a fold, narrowing, deferral,
decline, or new architecture. `npm run ci:local` passed lint, typecheck,
notices, 712 tests, and Electron smoke after the final rebase. GitHub's exact-
head `Verify (Node 24)` check passed, the final Codex review found no major
issues, and all review threads were resolved.

Before merge review, the original two Markover fixtures were found to share
one requesting-thread identity, which made the thread-within-project grouping
hard to inspect. The isolated `pr-164` store now also contains a fixture based
on a real distinct canonical T3 thread from the second Markover worktree. After
refreshing the view, the live UI reported `markover` as two threads and four
reviews while `dragonlist-mono` remained separate and the non-Git control
stayed under `Other`. The final broader QA used multiple Markover worktrees and
two real requesting-thread identities, with activation working inside the
group. The canonical completion command found no live PR-associated reviews;
the isolated `dev` instance marked review `mko_a2c82e03` Done. Issue #97 and
its repository-grouping claim are completed, and the project tracker item is
Done.

Repository-grouping operational acceptance completed on 2026-08-15 PDT. Live GitHub and
`origin/main` both reported PR #164's squash merge `479c89a2`; issue #97 was
closed as Completed, its repository-grouping claim records `phase: completed`,
and its `UI Enhancements` project item is Done. Initial `canonical doctor`
reported a clean, healthy canonical checkout, build, service, and routing still
at #162's merge `ebdae88e`. The canonical checkout was three commits behind,
clean, and an ancestor of `origin/main`, so it fast-forwarded non-destructively
to `479c89a2`. Documented `canonical refresh` rebuilt and restarted it; the
final doctor reports a clean `main` checkout and current build at `479c89a2`, a
ready service, healthy exact `markover:` ownership, and no issues.

That final doctor result was incomplete as an operational signal. The user then
reported that canonical Markover had no window, and process inspection preserved
the exact reproduction: the `479c89a2` canonical process was launched by
`canonical refresh` with `--markover-server`, its Electron window was hidden,
and doctor still reported healthy because it checked only checkout, build,
service, and routing. PR #145 introduced this behavior by reusing the intentional
hidden automatic-cold-start mode for explicit refresh; its live validation then
opened a review URI, which incidentally revealed the window and masked the
post-refresh state.

PR #168 merged exact green head `4ac81ff1` as squash commit `a6455020` after one
no-findings review round. It distinguishes explicit refresh from automatic cold
start, shows the replacement window without activating Markover, reports live
window visibility through service health and doctor, and refuses refresh success
until that window is visible. Automatic CLI cold starts remain hidden. The full
local gate passed lint, typecheck, notices, 712 tests, and Electron smoke; GitHub
CI passed and the current-head Codex review returned a thumbs-up. Markover `done`
found zero matching local reviews, the PR claim is completed, and the
`Markover Announcement Readiness` project item is Done.

The finite headless macOS A/B run reported `windowVisible: false` for automatic
`--markover-server` and `windowVisible: true` for the explicit refresh launch;
both left the user's frontmost app unchanged. T3 Code was full-screen during
that probe, so the normal non-activating Markover window correctly remained off
the active full-screen Space rather than overlaying it. After merge, the clean,
non-divergent canonical `main` checkout fast-forwarded from `479c89a2` to
`a6455020`. Documented `canonical refresh` returned healthy, and the independent
final doctor reported a clean checkout, current build, ready service, healthy
exact `markover:` ownership, `window.status: visible`, and no issues. macOS also
reported the canonical process unhidden, inactive, and not frontmost. Canonical
maintenance operational acceptance is complete at `a6455020`.

The production resolver and Projects projection reproduced the finite corpus
evidence without UI interaction. Across all 85 canonical review directories,
31 checksum-verified Markover reviews from 10 live roots form one
`remote:github.com/lastobelus/markover` project; seven Dragonlist reviews and
one game-course review retain distinct repository keys; and 46 stale, missing,
or otherwise unverifiable sources take the ordinary unassigned fallback. The
32 currently loadable reviews project as 24 Markover reviews from five roots
under that same single key plus eight unassigned fallbacks. No repository-
grouping defect reproduced, so operational acceptance changed no product code
and did not touch #166 or #167.

PR #164: https://github.com/lastobelus/markover/pull/164

The canonical title-availability audit completed on 2026-08-15 PDT. Initial
`canonical doctor` found healthy service and routing but a stale configured
checkout and build at `903a58a`, before #162. The clean canonical `main`
checkout was fast-forwarded to remote `main` at PR #162's squash merge
`ebdae88e`, then documented `canonical refresh` rebuilt, restarted, and
reconciled routing. Follow-up doctor reported a clean checkout, current build,
ready service, and healthy exact `markover:` ownership, all at `ebdae88e`.
That pass established title behavior before #164's later operational
acceptance. The initial stale app explains the screenshot that prompted the
audit.

Canonical now persists `t3ThreadTitlesEnabled: true` with a blank
`t3MetadataDatabasePath`. An explicit **Refresh titles now** reported two
distinct requesting-thread titles available. Projects displayed the exact
current T3 title for all 11 matching reviews: 10 under
`#136: Agent Metadata Conformance Matrix` and one under
`#134: Classify thread-hosts and providers`.

The 85 managed reviews contain 19 T3-host reviews with an effective ID. Eight
reviews across six effective IDs select no T3 row; none select only a deleted
or blank-title row. Projects loaded seven of those reviews and displayed each
exact effective ID as its fallback. The eighth, `mko_05aae691`, was among
startup-skipped artifacts and had no rendered row to assess. Eighteen reviews
have no effective thread ID: Projects loaded 13 and displayed the honest
`Thread title unavailable` fallback; five startup-skipped fixtures had no
rendered row. Another 48 reviews have an effective ID but either no T3 host
kind or a different host and therefore retain the ordinary ID fallback outside
this adapter.

The audit categories are now finite: the original screenshot was **stale app**;
the initial preference was **disabled integration** and is now enabled;
rendered reviews without an effective ID are **missing stable identity** and
show unavailable; and rendered T3 identities without a row are
**missing/deleted T3 row**—specifically missing here—and show the ID. The
post-#164 check at `479c89a2` still returned the same two authoritative titles
for all 11 matching reviews: 10 under
`#136: Agent Metadata Conformance Matrix` and one under
`#134: Classify thread-hosts and providers`. Current title behavior has no
**title product defect**, so the title audits changed no product code. A title
defect claim requires an active nonblank row for the exact effective ID while
refreshed Projects still fails to show that title. Do not broaden repository
grouping into another title adapter, cache, or fallback system without that
finite reproduction.

Issue #97 is closed after these personally valuable outcomes. Original
**Slice D — additional adapters** remains outside its finish line. Two
clean-context future work items are Todo in `UI Enhancements`: Codex issue #166
and Claude issue #167. Both follow up #97 and #162 and were blocked until PR
#164 merged; neither was part of #97 closure. Each starts with a finite
completed-rename authority experiment and adds product code only when its
provider-owned source proves a current renamed title under the exact provider
thread ID. Their experiments may run concurrently; overlapping
settings/IPC/arbitration implementation must serialize. OpenCode and LastCode
remain untracked follow-ups. A generic adapter registry waits until two landed
adapters prove a shared abstraction.

Codex: https://github.com/lastobelus/markover/issues/166
Claude: https://github.com/lastobelus/markover/issues/167

## Sources and retained review

- Full revised plan:
  `doc/plans/2026-08-13__issue-97-enrichment-simplification-path.md`
- Streamlined ELI5:
  `doc/plans/2026-08-13__issue-97-enrichment-simplification-path-eli5.html`
- Original sequence:
  `/Users/lasto/.t3/worktrees/markover/t3code-b7c2aba1/doc/plans/2026-08-12__issue-97-remaining-work-sequence.md`
- Hotspot evidence:
  `doc/explanations/2026-08-13__complexity-accretion-audit/03-local-app-hotspots.html#enrichment`
- GitHub issue: https://github.com/lastobelus/markover/issues/97
- Markover review ID: `mko_432710dc`

Open the plan review with:

```sh
open 'markover://review/mko_432710dc'
```

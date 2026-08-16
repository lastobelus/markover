# Issue #97 path through private-enrichment simplification

## Truth context

This is a proposed execution path as of 2026-08-13 against `origin/main`
`a46ab164`. It combines the untracked issue #97 remaining-work sequence in the
`t3code-b7c2aba1` worktree, live [issue #97](https://github.com/lastobelus/markover/issues/97),
open [PR #150](https://github.com/lastobelus/markover/pull/150), and the private
enrichment finding in the complexity-accretion audit.

The stable product goal is trustworthy Inbox/Projects navigation and identity.
The existing private-enrichment implementation is not a stable foundation: it
has no production producer or projection consumer and is explicitly under
reconsideration. This plan authorizes no implementation by itself.

## Outcome

Finish the personally valuable center of issue #97:

- one obvious active-review navigation model instead of redundant document
  tabs;
- exact review IDs that are visible, copyable, keyboard-accessible, and usable
  for direct activation;
- authoritative renamed T3 thread titles in Inbox/Projects, with honest
  fallbacks and no polling;
- clear provider/thread-host identity presentation;
- useful grouping of reviews from equivalent local worktrees while keeping
  forks distinct;
- private discovery evidence that never enters portable reviews or agent-visible
  responses.

At the same time, remove the 1,280-line private-enrichment runtime and its 1,082
lines of direct tests before a real feature makes its speculative states harder
to remove. Reintroduce only the storage actually justified by the first T3
producer and renderer consumer.

## Recommendation

Use **delete, trace, then rebuild the vertical slice**:

1. clear PR #150;
2. in parallel, land the navigation/ID win and remove the unused enrichment
   runtime;
3. use a source-only T3 experiment to establish the actual renamed-title
   contract;
4. build one T3 title producer/consumer on the smallest cache the experiment
   proves necessary;
5. add repository grouping as a second real vertical, reusing that proven
   transport rather than reviving the old generic store;
6. leave additional title adapters outside the issue #97 finish line until one
   is proven by a completed-rename experiment.

This is one extra deletion PR before titles appear, but the independent
navigation slice supplies an immediate daily-use improvement. It avoids making
the feature pay forever for infrastructure written before either endpoint
existed.

## Why invert the previous sequence

The earlier plan treated PR #147's storage as the foundation for title and
repository work. The audit changes that premise.

| Existing premise | Current evidence | Revised posture |
|---|---|---|
| One generic observation pipeline should serve all future sources. | There is no production source, IPC path, renderer consumer, or second adapter. | Start with one T3 source and one UI consumer; extract shared abstraction only after another source exists. |
| Enrichment writes need queues, pause owners, exact failed targets, drains, and quit flush. | Production never calls `observeThreadTitle`, `acceptReviewSnapshot`, `recordReviewValidationFailure`, `projection`, `loadReview`, or `loadThread`. | Secondary metadata must not participate in quit-critical durability before it exists in the product. |
| Equal-time observations need deterministic conflict arbitration. | There is one planned T3 producer. A stale title is recoverable on refresh. | Use producer generation/newest result or ordinary last-write-wins if persistence becomes necessary. |
| Shared thread files need fail-closed whole-store cleanup. | Production creates none; an orphan would be harmless private cache data. | Leave existing bytes untouched and tolerate orphans. Do not block Trash. |
| Exact source checksum coherence should gate project labels. | The consequence is an `Unassigned` label after a normal source edit. | Treat stored paths as hints for display; reserve exact checksum checks for overwrite/execution claims. |

Keep the true boundaries: portable/private separation, restrictive private-file
permissions when files exist, path containment, agent-visible field rejection,
and `ReviewStore` serialization/atomic writes for primary review data.

## Delivery graph

```text
                         ┌──────────────────────────────┐
                         │ T3 renamed-title experiment  │
                         │ read-only; no product edits  │
                         └──────────────┬───────────────┘
                                        │ contract
                                        ▼
PR #150 ──┬──► PR A: navigation + IDs ──┬──► PR C: T3 title vertical
          │                              │
          └──► PR B: remove enrichment ─┘
                                               │ proven transport
                                               ▼
                                      PR D: repository grouping
                                               │
                                               ▼
                                      reassess issue #97 complete
```

PR A and PR B are independent after #150 and may merge in either order. PR C
starts only after both merge and the experiment finishes. PR D follows PR C.
No active stacked PR is needed if children wait for their prerequisites to
merge. If title production must begin earlier, make PR C a declared child of PR
B and rebase it after PR A; do not hide that dependency in an ordinary PR.

## First wave: three or four active threads

The current Opus `start-issue` rewrite can remain one active tooling thread.
For Markover product work, use these lanes:

| Thread | Work now | Completion signal | Production overlap |
|---|---|---|---|
| 1 · Clear the gate | Rebase PR #150, address its remaining P2 guidance defect, complete its existing QA, and babysit it through merge. | Exact reviewed head merged; issue/trackers and Markover reviews reconciled. | Owns the shared UI/main baseline. |
| 2 · Trace T3 titles | Prove what a completed T3 thread rename produces in `projection_threads.title`, how it maps to #148 identity, how absence/failure appears, and whether launch/foreground/manual queries are sufficient. | A small evidence matrix and implementation contract; no registry or product code. | Read-only against product source. |
| 3 · Prepare simplification | Inventory existing private sidecars without modifying them; confirm no production callers; prepare the exact deletion boundary and retained privacy tests. Begin the PR after #150 merges or when its tiny `main.ts` rebase cost is understood. | Concrete two-list handoff: delete versus preserve. | Enrichment modules, lifecycle wiring, durability tests. |
| 4 · Optional QA/support | Human QA for #150 or review of the navigation interaction; otherwise leave this slot free rather than inventing another production branch. | One answered UX question or completed QA pass. | No competing source ownership. |

Do not start PR A against PR #150's old base. The gate is small enough that
waiting for its merge is cheaper than carrying a UI stack through the same
`main.ts`, `renderer.ts`, `review-sessions.ts`, `index.html`, and `styles.css`.

## PR A — single-review navigation and exact IDs

**Base:** latest `main` after PR #150.

**Purpose:** deliver the fastest daily-use win with no enrichment dependency.

**Scope:**

- remove the document-tab bar and closeable working-set model;
- preserve one active review, per-review presentation state, deep links, and
  next/previous navigation;
- remove persisted open-tab ordering directly because it is an unreleased
  pre-MVP shape—no fallback reader or dual writer;
- show a centered, muted, copyable exact review ID in the Document Tree header;
- expose exact ID and copy action in Inbox/Projects hover/details with keyboard
  and accessible equivalents;
- add the smallest exact-ID activation affordance, not a general search system.

**Outside:** titles, title adapters, repository enrichment, settings redesign,
badge layout, generic search, and enrichment storage.

**Stop condition:**

- no document-tab UI or close-tab behavior remains;
- exactly one active review restores after relaunch;
- view state, deep links, and next/previous navigation still work;
- the full review ID can be copied and directly activated without a mouse;
- focused deterministic tests and one human QA window pass.

## PR B — remove the unused private-enrichment runtime

**Base:** latest `main` after PR #150; independent of PR A.

**Purpose:** restore a zero-producer/zero-consumer feature to roughly zero
runtime machinery before building its first real vertical.

**Read-only preflight:** inspect the active application-data roots for
`reviews/*/enrichment.json` and `threads/*/enrichment.json`. Report counts and
paths, but do not delete, migrate, or rewrite them.

**Remove:**

- `PrivateEnrichmentStore` construction and imports from `main.ts`;
- enrichment pause/resume/drain/flush from managed mutation and shutdown paths;
- enrichment participation in Trash and whole-store thread cleanup;
- the generic store, strict disk schemas, arbitration/error precedence,
  pending failed targets, and their direct protocol tests;
- runtime packaging entries that exist only for these modules.

**Preserve:**

- all portable reviews, attachments, and any existing private sidecar bytes;
- `ReviewStore` per-review queues, atomic primary writes, and review Trash;
- portable private-field rejection and local-service tests proving private
  evidence never becomes agent-visible;
- the audit and Git history;
- current Inbox/Projects fallbacks through `contextSummary`, document name,
  project root, thread ID, and unavailable state.

Update active developer documentation to say persistence is deferred until a
real producer/consumer demonstrates its need. Mark the 666-line storage plan as
historical/deferred rather than leaving it as an apparent current contract.

**Stop condition:**

- no production enrichment store imports, lifecycle calls, cleanup calls, or
  packaging entries remain;
- primary review create/load/list/edit/handoff/attachment/Trash paths pass;
- malformed and valid sidecars remain untouched and cannot affect review load
  or agent-visible output;
- quit still protects primary review data without waiting on enrichment;
- no migration, retry state, compatibility alias, or replacement cache is added.

**Recovery:** revert this PR. There is no production writer or consumer to
migrate, and orphaned secondary sidecars are harmless. The pre-MVP compatibility
rule forbids adding a compatibility layer for the unshipped shape.

## Experiment — establish the T3 title contract

This may run before PR A/PR B and must not edit production source.

Answer only:

1. Does a completed rename appear as the current `projection_threads.title`?
2. Which T3 thread identity selects the row, using #148's rule that equal host
   and provider IDs are valid and provider never participates in stable
   identity?
3. Are launch, review arrival, foreground/Inbox activation, and manual refresh
   sufficient? Measure; do not add polling speculatively.
4. What does disabled, missing, locked, malformed, or stale T3 state look like?
5. Can rediscovery on launch/refresh provide acceptable behavior without a
   Markover cache? If not, what exact failure justifies one atomic value?

**Stop condition:** one renamed T3 thread has been observed end-to-end, or the
source is shown not to provide authoritative renamed titles. Produce a compact
fixture/evidence record and the exact query/identity contract. Do not investigate
Codex, Claude, OpenCode, LastCode push, request-time CLI flags, or a generic
adapter API in this experiment.

## PR C — one T3 requesting-thread-title vertical

**Base:** latest `main` after PR A and PR B; depends on the completed experiment.

**Purpose:** replace opaque IDs with the user's actual T3 thread titles using
the smallest proven path.

**Scope:**

- one explicit T3 integration, disabled by default, with default metadata
  location, optional override, and clear status;
- one source-specific adapter using the proven query and stable identity;
- refresh on only the proven events plus a manual action—no polling or watcher;
- one private main-to-preload-to-renderer projection for the active UI;
- Projects title display and the Inbox preference between review purpose and
  requesting-thread title;
- honest fallback to effective thread ID, then unavailable;
- provider/thread-host badge layout and accessible raw-role labels while this
  identity presentation is already changing;
- no portable or agent-visible title field.

Start without persistence if launch/refresh rediscovery is adequate. If the
experiment demonstrates a material failure, add only one atomic best-effort
value per stable key and a small in-process per-key write lane. Malformed state
falls back and is rediscovered; it does not block editing, handoff, Trash, or
quit.

**Outside:** request-time title flags, LastCode push, additional providers,
generic adapter registry, historical failure records, equal-time conflict
protocol, failed-target retries, pause ownership, whole-store cleanup, and
repository grouping.

**Stop condition:**

- a renamed T3 thread appears under the correct stable identity after the
  proven refresh events and relaunch behavior;
- temporary source failure yields a fallback or last proven value without
  blocking the app;
- Inbox purpose/title preference and badges are keyboard/screen-reader usable;
- portable review JSON, local-service agent responses, and copied handoff data
  contain no private title or source path;
- deterministic tests and one focused human QA pass succeed.

## PR D — repository/source grouping as a second vertical

**Base:** latest `main` after PR C.

**Purpose:** make Projects useful across real worktrees and clones without
resurrecting a generic metadata database.

Begin with a fresh usage check. If current `projectRoot` grouping already meets
the user's daily needs, defer this PR rather than completing issue prose for its
own sake.

When needed:

- treat the stored source path as a display/discovery hint when it exists;
- discover canonical Git root and normalized remote identity sufficient to
  group equivalent worktrees/clones and keep forks distinct;
- replace the old `projectRoot` renderer pathway in one change rather than
  dual-writing or maintaining competing inputs;
- reuse PR C's proven projection transport;
- on moved/missing/unreadable paths, preserve primary review usability and show
  one nonmodal error/fallback; no repair wizard;
- add persistence only if launch rediscovery cannot meet the demonstrated UX.

**Stop condition:** fixtures for one repository with multiple worktrees, one
equivalent clone, one fork, and one missing source path produce the intended
grouping/fallback; Local and agent reviews remain usable; no exact checksum gate
is used merely to show a label; no private path/repository evidence enters
portable or agent-visible surfaces.

## Close issue #97 before adding every adapter

Issue #97 can be considered complete when:

- PR A's navigation and exact-ID outcomes hold;
- one authoritative T3 title vertical works without polling;
- provider/thread-host roles are presented consistently;
- the repository grouping behavior that the user actually needs is reliable;
- missing secondary metadata degrades without blocking review work;
- private title, path, checkout, and repository evidence remain private; and
- the removed speculative lifecycle machinery has not been reintroduced.

Direct Codex, Claude, OpenCode, LastCode-push, or request-time title sources are
follow-ups. Add each only after a completed-rename experiment proves authority.
Do not make a generic adapter framework part of #97; wait for a second real
adapter to reveal an actual shared abstraction.

## Complexity tripwires for every slice

Pause and ask before continuing if a proposed change adds any of these for
secondary enrichment:

- a queue broader than one real producer/key;
- retry or pending-failure state;
- a migration or compatibility reader for PR #147's unreleased files;
- polling, a watcher, or a persistent host connection;
- ownership, pause-owner, or shutdown-drain state;
- a provenance/error history rather than one current display value;
- exact conflict arbitration for simultaneous hypothetical producers;
- a generic registry before a second adapter exists;
- a safeguard larger than the title/grouping behavior it protects.

For each trip, report the reachable actor/interleaving, material consequence,
ordinary recovery, added states, and smallest alternative. Secondary metadata
failure should normally choose fallback plus rediscovery.

## Alternatives

### Faster title, higher accretion risk

Reuse the entire PR #147 store for PR C, then simplify after title and repository
consumers exist. This can display titles one PR earlier, but every consumer and
test makes the speculative protocol harder to delete, and title work inherits
shutdown/Trash/failure states unrelated to its value.

Choose this only if the user values the first title display more than removing
the current complexity and sets a mandatory simplification PR immediately after
the vertical slice.

### Lowest churn, incomplete issue #97

Land PR A, keep current UUID/thread-ID fallbacks, and defer all enrichment. This
gives the fastest navigation improvement and lowest technical risk, but it does
not accomplish the user's central title/grouping goals.

## Authoritative references

- [Issue #97](https://github.com/lastobelus/markover/issues/97)
- [PR #120 — Inbox/Projects](https://github.com/lastobelus/markover/pull/120)
- [PR #138 — private workspace state](https://github.com/lastobelus/markover/pull/138)
- [PR #139 — portable v1 boundary](https://github.com/lastobelus/markover/pull/139)
- [PR #147 — private enrichment storage](https://github.com/lastobelus/markover/pull/147)
- [PR #148 — thread-host/provider identity](https://github.com/lastobelus/markover/pull/148)
- [PR #150 — current shared UI baseline](https://github.com/lastobelus/markover/pull/150)
- `doc/plans/2026-08-12__issue-97-remaining-work-sequence.md` in worktree
  `t3code-b7c2aba1`
- `doc/plans/2026-08-12__app-private-review-enrichment-storage.md`
- `doc/explanations/2026-08-13__complexity-accretion-audit/03-local-app-hotspots.html#enrichment`
- `src/private-enrichment.ts`
- `src/private-enrichment-store.ts`
- `test/private-enrichment-boundaries.test.ts`
- `src/review-inbox.ts`
- `src/review-sessions.ts`
- `src/review-project-context.ts`

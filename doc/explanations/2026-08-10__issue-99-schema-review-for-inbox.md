# #99 schema review from the #97 Inbox/Projects perspective

Review target: [`2026-08-09__review-handoff-format-compatibility.md`](/Users/lasto/.t3/worktrees/markover/t3code-2a57c26c/doc/plans/2026-08-09__review-handoff-format-compatibility.md)

## Outcome

Changes are requested before v1 is frozen. The compatibility and reader-boundary design is sound, but classifying all of `review.agentThread`, `review.git`, and `review.pullRequest` as intentionally opaque leaves #97 unable to implement stable Inbox identity, project grouping, or PR-state presentation. It also conflicts with #123, which is already adding typed PR lifecycle observations.

The product should distinguish four durable data domains:

1. **Portable handoff data** in `review.json`, with typed cross-producer meaning.
2. **App-owned lifecycle data** in the portable review envelope, typed and preserved but mutated only by Markover.
3. **App-private workspace and settings state** stored outside the handed-off/exported artifact.
4. **App-private per-review enrichment** whose exact sidecar design is owned by [#131](https://github.com/lastobelus/markover/issues/131).

Opaque extensions remain an extensibility mechanism inside typed objects, not a fifth storage domain and not a substitute for fields that product behavior relies upon.

## Proposed durable storage model

| Object | Owner | Durable contents | Agent/export visibility | Failure contract |
| --- | --- | --- | --- | --- |
| `reviews/<review-id>/review.json` | #99 format; #123 lifecycle/agent PR observations; #126 GitHub authority | Portable source snapshot, review tree, annotations, guidance, typed identity/context, and app-owned lifecycle | Returned by `get` and clipboard export | Incompatible or invalid artifacts fail closed and remain preserved |
| App-level `workspace.json` | #97 workspace-state child PR stacked on PR #120 | Inbox/Projects mode, hierarchy expansion, open/active review tabs, per-review block/view presentation | Never included in handoff, clipboard, or agent-service responses | Atomic writes; invalid or incompatible state fails soft and resets/rebuilds without hiding a valid review |
| Existing settings storage | #97 for its new preferences/integrations, coordinated with other settings owners | User preferences, enabled integrations, metadata-location overrides | Never included in review artifacts | Validate fields independently; a settings failure must not invalidate reviews |
| Candidate app-private enrichment store, potentially combining per-review sidecars with a shared thread index | #131 discovery and later implementation | Machine-local source/repository identity evidence, requesting-thread-title observations, discovery provenance/cache, and other enrichment | Never included in handoff, clipboard, or agent-service responses | Exact storage shape, schema, versioning, rediscovery, corruption, and cleanup semantics must be resolved by #131; failure must not invalidate `review.json` |

`workspace.json` should have its own private format/version, such as `format: "markover-workspace"` and `version: 1`. Its durability promise is restart restoration, not portable interchange: stale review references are pruned, unknown/incompatible state can be preserved for diagnosis and replaced with safe defaults, and loss resets presentation rather than review data.

The private enrichment shape remains a proposal until #131 completes discovery. Keeping per-review data inside the managed review directory would let review Trash move the artifact, attachments, and private enrichment together. Requesting-thread-title is thread-level, however, so #131 should evaluate a shared index keyed by stable thread-host/provider/thread identity rather than duplicate potentially divergent observations into every linked review.

## Blocking requests before v1

### 1. Add an immutable review-origin discriminator

Add required `review.origin: "agent" | "local"`. Origin is immutable for the review lifetime and must not be inferred from `agentThread`, because an agent review can lack discoverable thread metadata and a Local review must remain identifiable even when Git metadata exists.

- `agent` means the review entered through an agent handoff/open workflow.
- `local` means the user opened Markdown directly in Markover.
- `local` requires `agentThread: null`; `agent` does not require a non-null thread.

This is portable handoff data: it changes how the review lifecycle and identity are interpreted. It must not be duplicated or overridden by `workspace.json` or the #131 sidecar.

### 2. Add a distinct app-owned attention timestamp

Add required `review.attentionRequestedAt` as a validated UTC/RFC 3339 instant. It is app-owned lifecycle data in the portable envelope: agents can observe and preserve it but must not set it. It belongs beside `status`, `createdAt`, and `updatedAt`, not in `workspace.json` or the #131 sidecar, because it is durable review lifecycle rather than presentation or rediscoverable machine-local context.

Invariants:

- On creation in `editing`, it equals `createdAt`.
- It changes only when the review transitions from a non-`editing` state into `editing`.
- Autosaves, viewing, thread-title refresh, PR refresh, tab activity, and ordinary `updatedAt` changes never alter it.
- Leaving `editing` does not alter it.

`updatedAt` cannot substitute for this field because #97 deliberately prevents autosaves and metadata refreshes from reordering the Inbox.

### 3. Replace wholly opaque containers with typed cores plus extensions

The plan currently makes `agentThread`, `git`, and `pullRequest` opaque required keys. Their **unknown additive properties** may remain opaque, but the fields used by #97 and #123 need v1 guarantees.

Here, **thread-host** is the user-facing application that contains and presents the requesting thread, such as T3 Code, LastCode, or the Codex app. It is distinct from a computer, operating-system hostname, DNS/network host, repository, worktree, process, or metadata path. **Provider** is the agent runtime or service executing the thread, such as Codex or Claude. A standalone product may fill both roles—for example, the Codex app as thread-host and Codex as provider—without collapsing the two schema concepts.

Minimum typed cores:

- `agentThread`: nullable object with nonblank `provider`, nonblank `id`, and optional nonblank `threadHost`. `threadHost` is a stable logical integration identifier such as `t3code`, `lastcode`, or `codex-app`, never an installation path, machine hostname, version, or mutable display label. `(threadHost, provider, id)` is requesting-thread identity; requesting-thread-title is app-private mutable enrichment and never identity.
- `git`: nullable object with nullable sanitized `repositoryUrl`, `branch`, and `commit`. These are hints, but their types and meanings must be stable when present.
- `pullRequest`: nullable object with required positive integer `number` when present; optional canonical `url`; and the typed observation fields requested below.

Unknown additive properties may extend each typed core. Provider database paths, log paths, raw thread-host records, and other machine-local adapter evidence should not use those extensions merely to bypass the privacy boundary; they belong in settings or the #131 sidecar. Core consumers must not parse arbitrary producer blobs to recover fields the UI depends upon.

### 4. Include #123 lifecycle and PR-observation domains in v1

#123 is adding `revised` and `done` review statuses plus agent-reported PR states. The proposed #99 rule correctly says a new lifecycle value after publication is breaking, so v1 must not freeze before those active domains are reconciled.

For an associated PR, v1 should type these fields, whether retained flat or placed under an `observation` object:

- `status`: `"draft" | "open" | "merged" | "closed"`;
- `statusObservedAt`: validated UTC/RFC 3339 instant;
- `statusSource`: at least `"agent" | "github"`.

Invariants:

- A status observation is invalid without a valid PR association.
- Omitting a new observation preserves the previous successful observation.
- A connected #126 GitHub observation supersedes an agent observation.
- Otherwise, only a newer observation replaces an older one.
- PR identity (`number`, repository, canonical URL) is separate from its mutable state observation.
- Consumers may present source and age; they must not describe an agent observation as live GitHub truth.

Without an observation, #97 uses a uniform green `PR-linked` cue rather than claiming verified state.

## Repository and Local-review identity boundary

The portable artifact should carry only portable Git/PR hints. [#131](https://github.com/lastobelus/markover/issues/131) will discover the exact app-private per-review schema for:

- canonical local source path used for same-path/checksum Local-review deduplication;
- checkout root and common Git directory;
- locally normalized project key and fallback path identity;
- project display-name override, favicon selection/cache, and repository-root hover text;
- requesting-thread-title discovery evidence or cache that contains machine-local thread-host/provider details.

Repository grouping follows these invariants:

- A normalized remote repository identity groups equivalent clones and worktrees.
- Distinct forks remain distinct.
- A common Git directory can group local-only linked worktrees, but is machine-local evidence.
- Canonical checkout/source paths are last-resort local fallbacks, not portable review identity.
- `sourceDocument.path` remains descriptive and potentially stale or machine-specific, as #99 already states; it must not be redefined as the portable deduplication key.
- The source checksum remains part of the immutable review target. Local deduplication uses canonical local path plus checksum, outside portable target identity.
- Losing or rebuilding the #131 sidecar may require rediscovery and may temporarily reduce grouping quality, but it never changes, corrupts, or hides the portable review.
- Trashing a review must carry its sidecar with the managed review directory without touching the original Markdown source; #15 and #131 coordinate that invariant.

## Requesting-thread-title boundary

Keep `review.contextSummary` as the required portable review purpose. The requesting-thread-title is the current user-visible title of the agent thread that requested the review; it is not a review title and is not needed to interpret the handoff.

`review.json` should contain the stable `agentThread` identity core but no requesting-thread-title observation. App-private thread metadata should be keyed by stable thread-host/provider/thread identity and preserve:

- nonblank requesting-thread-title value;
- authority class `thread-host` or `provider`;
- stable source/integration identifier;
- validated observation time and last-attempt time;
- machine-local discovery evidence where useful.

The requesting-thread-title is a mutable label, not requesting-thread identity. An unavailable refresh preserves the last authoritative observation; original prompts, stale previews, review purpose, and document names are not valid thread-title sources. They are display fallbacks only.

Authority describes ownership of the observation source, not where the text happens to be rendered. `thread-host` means thread-host-owned state or a thread-host-supplied update, such as T3’s `projection_threads.title` or a future LastCode push. `provider` means the provider’s own API or session metadata, even when that thread-title is displayed inside a thread-host UI.

Refresh should be event-driven: on review arrival, app launch/foreground, Inbox/Projects opening, or an explicit user action. A future LastCode integration may push requesting-thread-title changes to active linked reviews. Do not add polling or filesystem/database watchers.

## App-private workspace state

These #97 values belong in app-level `workspace.json`, outside the handoff artifact and clipboard export:

- selected `Inbox` or `Projects` mode;
- per-project and per-thread expansion state;
- open document-tab review IDs and the active tab;
- selected review block, annotation view, pane widths, and view history;
- per-review block collapse state currently represented by `node.collapsed`.

These values instead belong in settings, not `workspace.json`:

- the `Review purpose` versus `Thread-title` display preference;
- enabled integrations and their metadata-location overrides.

Workspace invariants:

- Open/active tabs and per-review view state are keyed by opaque review IDs.
- Project/thread expansion is keyed by normalized app-private grouping keys and may be pruned when those derived identities change.
- Block collapse/selection is keyed by block IDs within one immutable review target.
- Writes are atomic and may be debounced, but graceful shutdown must flush the latest accepted workspace state.
- Deleted or unavailable review IDs are ignored and eventually pruned.
- Missing, malformed, or incompatible workspace state never prevents `ReviewStore` from listing or opening a valid review.
- No workspace field is returned by CLI `get`, copied to the clipboard, or interpreted by an agent.

The current required `node.collapsed` field is presentation state. Before calling v1 a portable handoff contract, #99 should evaluate moving it to #97's `workspace.json`. If it remains in v1 for delivery reasons, the contract must explicitly classify it as legacy app-owned presentation data that agents ignore and preserve; it must never carry review semantics.

## Required decoder and fixture coverage

Extend #99's representative fixture and shared decoder tests to cover:

- both origins, including agent-without-thread and Local-with-Git cases;
- `attentionRequestedAt` timestamp and transition invariants;
- typed core fields plus unknown additive extensions;
- `revised` and `done` if #123 lands before v1 publication;
- PR identity without observation and every PR observation state/source;
- invalid observation-without-association and older-observation replacement;
- stable `agentThread` identity without any portable requesting-thread-title observation;
- proof that private requesting-thread-title observations update every linked review projection and retain the last authoritative value after an unavailable refresh;
- proof that `workspace.json`, settings, and #131 sidecar data are absent from handoff, clipboard, and agent-visible service output;
- proof that missing or incompatible private state does not invalidate a compatible `review.json`.

## Coordination request

#99 should coordinate its executable v1 envelope with #97, #123, #126, and [#131](https://github.com/lastobelus/markover/issues/131) before publishing the fixture or decoder. #97 can derive presentation projections from typed data, but it should not establish a competing artifact schema. #123's active status/PR fields should become the concrete starting point, and #126 should extend their source authority without replacing their identity contract.

The proposed delivery ownership is:

1. #99 defines and validates portable `review.json`, including explicit exclusions for private state.
2. #123 supplies the lifecycle and agent-reported PR observation domains that v1 must reconcile; #126 later adds authoritative GitHub sourcing.
3. PR #120 remains #97's accepted UI/projection/presentation slice.
4. A #97 workspace-state child PR, stacked on PR #120, adds private `workspace.json` persistence and the related settings changes.
5. #131 performs separate discovery before any per-review private-sidecar implementation is authorized.

#99 does not need to implement either private object. It does need to ensure its claims about the “complete v1 artifact contract,” shared decoder, round trips, clipboard export, and agent consumer do not accidentally absorb app-private workspace or sidecar semantics.

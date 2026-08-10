# Improve inbox / review management

Issue: [#97](https://github.com/lastobelus/markover/issues/97)

## Outcome

Markover gives the reviewer a trustworthy, action-first Inbox for every review needing attention and a complete Projects hierarchy for browsing current and historical work. Historical `With Agent` reviews no longer overwhelm the working queue, collapsed groups cannot conceal actionable work, and each row carries enough project, thread, document, branch, pull-request, provider, and recency context to identify it.

The selected direction is Concept A, **Inbox + Projects**. The updated interactive mockup is available at [`tmp/review-inbox-mockups/index.html`](../../tmp/review-inbox-mockups/index.html).

## Priorities

1. Never miss work: every `Editing` agent review and every active Local review is individually visible in Inbox.
2. Control noise: `With Agent` reviews are secondary history, with complete history available in Projects and cleanup delegated to #15.
3. Identify the right review: show recognizable requesting-thread-titles and stable project/document context.
4. Support both working styles: an activity Inbox and a project-organized hierarchy.

## Application chrome and navigation

- Place `Inbox` and `Projects` tabs in the left segment of the existing document-tab strip, directly above the review-list header.
- Start the document-tab bar at the document-tree pane boundary rather than extending it across the review-list pane.
- Open Inbox on first launch. Afterward, restore the last-selected Inbox or Projects tab.
- Treat document tabs as a persistent, closeable working set rather than a second global review list.
- Selecting a review opens or activates its document tab. Restore open tabs and the active tab after relaunch.
- Closing a document tab only removes it from the working set. It does not change review status, remove the review from Inbox/Projects, or delete data.
- Explicit review navigation and deep links open a document tab and reveal the selected review without otherwise disturbing saved hierarchy expansion.

## Inbox

- Show a flat, complete list with exactly one row per `Editing` agent review and active Local review.
- Never group or collapse actionable reviews by thread. Multiple documents from one thread remain separate rows.
- Sort by `attentionRequestedAt`, newest first. Set it when a review first arrives in `Editing` or returns to `Editing`.
- Viewing a review, annotation autosaves, thread-title refreshes, and document-tab activation do not reorder Inbox.
- If real use makes this ordering feel stale, evaluate debounced meaningful `updatedAt` later rather than mixing timestamp semantics now.
- Put `With Agent` history behind one collapsed secondary section. Initial expansion shows the 10 most recent reviews, supports incremental `Show more`, and offers `View all in Projects`.
- Empty Inbox copy should say that no reviews need attention and leave Projects available for history; it must not imply that historical reviews were deleted.

## Agent-review row identity

Follow T3 Code’s three-level visual hierarchy:

1. Small: `project · document`, with age or `With Agent` right-aligned.
2. Prominent: requesting-thread-title, preceded by the provider icon.
3. Small: branch, with pull request right-aligned when available.

The project favicon leads the row. Missing favicon/provider/branch/PR values use neutral fallbacks without collapsing the document or thread-title identity. Long values truncate independently and expose their full accessible label.

## Projects

- Use the hierarchy project → thread/group → review.
- At every hierarchy level, groups containing `Editing` descendants sort first by their newest descendant `attentionRequestedAt`.
- History-only groups follow, sorted by latest lifecycle activity. Within an expanded thread, `Editing` reviews precede `With Agent` history.
- Collapsed project and thread rows show descendant Editing count plus latest relevant activity, so collapsed state never hides the existence or age of actionable work.
- Persist each project and thread’s expanded/collapsed state across launches.
- New `Editing` arrivals update collapsed rollups without forcing groups open.
- Explicit navigation to a review expands only that review’s ancestors.
- Equivalent worktrees and clones of one Git repository form one project. Prefer normalized repository remote identity; use a common Git directory for local-only linked worktrees; use canonical checkout roots only when equivalence cannot be established. Distinct forks remain distinct projects.

## Agent-thread vocabulary

- **Thread-host** means the user-facing application that contains and presents the requesting thread, such as T3 Code, LastCode, or the Codex app. A thread-host is distinct from a computer, operating-system hostname, DNS/network host, repository, worktree, process, or metadata path.
- **Provider** means the agent runtime or service that executes the thread, such as Codex or Claude, and may own provider-level thread/session metadata.
- A standalone product can occupy both roles: for example, the Codex app can be the thread-host while Codex is the provider. The roles remain conceptually distinct even when one product fills both.
- Persist `agentThread.threadHost` as a stable logical integration identifier such as `t3code`, `lastcode`, or `codex-app`, never as an installation path, machine hostname, version, or mutable display label. It remains optional when no thread-host can be identified.
- A **thread-host-authoritative** thread-title is read from thread-host-owned state or supplied by a thread-host integration, such as T3’s `projection_threads.title` or a future LastCode push. A **provider-authoritative** thread-title comes from the provider’s own API or session metadata, even when the thread-host displays it.

## Requesting-thread-titles

- The requesting-thread-title is the current user-visible title of the agent thread that requested the review; it is not a review title. Review purpose remains `contextSummary`, and Local reviews use their document name.
- Display the requesting-thread-title, including user renames, rather than a permanent snapshot of the original generated title.
- Resolve thread-title authority in this order: thread-host-authoritative thread-title, provider-authoritative thread-title, then a clearly labeled fallback such as review purpose or document name.
- Never infer a requesting-thread-title from the opening prompt or stale preview.
- Keep stable requesting-thread identity in `review.json`; preserve requesting-thread-title value, source/provenance, and observation time in app-private thread metadata keyed by that identity.
- Attempt an event-driven thread-title refresh when a review arrives, when Markover launches or returns to foreground, and when Inbox or Projects opens. Provide a manual `Refresh Thread-title` action.
- Permit a future LastCode integration to push requesting-thread-title changes to linked reviews. Do not add polling or filesystem/database watchers.
- If an integration is temporarily unavailable, retain the last authoritative requesting-thread-title rather than replacing it with a weaker fallback.
- In the completed T3/Codex rename experiment, T3’s `projection_threads.title` exposed the renamed visible title while the model context did not, and Codex app-server still returned `thread.name: null` with the original preview. Repeat completed-rename experiments for Claude and each later integration before fixing its adapter contract.

## Agent integration settings

- Replace the single Codex-only local-session discovery toggle with explicit per-thread-host and per-provider integration settings.
- Each known integration shows its default metadata location, optional user path override, availability/validation state, and discovery explanation.
- Treat configurable locations as metadata sources, not only log directories: Codex currently uses `~/.codex/sessions`, while the authoritative T3 title came from thread-host-owned state.
- Markover may detect and suggest recognized integrations, but must not inspect their metadata until the user explicitly enables each integration.
- Tool-assisted thread-title discovery must request the current user-visible requesting-thread-title and evidence source, prohibit inference from original prompts/previews, and return unavailable rather than guess.

## Local reviews and #107

- Keep #107 separate. It owns `Open Markdown…` ingestion into durable managed-review storage, default context creation, atomic cancellation/failure behavior, deduplication, and preservation of the original Markdown file.
- #97 consumes #107’s output as a first-class Local review in Inbox, Projects, and document tabs.
- Local rows use: small `project · Local review` plus age; prominent filename plus Markdown/file icon; small repository-relative path and branch plus right-aligned PR when available.
- In Projects, Local reviews live beneath a synthetic `Local reviews` group.
- Match a Local review to a project using canonical source-path containment and discovered Git identity. Non-Git files use a matching known project root or containing directory, then `Other`.
- Reopening the same canonical path with the same checksum activates its existing non-trashed Local review. Reopening the same path with changed content creates a new review, preserves the prior snapshot, and explains why. A trashed review never suppresses a new open.
- Removing a Local review removes only Markover’s managed-review state through #15’s recoverable cleanup path; it never modifies or deletes the source Markdown file.

## Persistence and data contract

The implementation must persist enough structured data to support the behavior without deriving identity from UI text:

- review origin (`agent` or `local`);
- `attentionRequestedAt` independent of ordinary review `updatedAt`;
- canonical source path and source checksum;
- normalized repository identity, checkout/common-root evidence, branch, commit, and pull request;
- app-private requesting-thread-title, authority/provenance, and observation time keyed by stable requesting-thread identity;
- last-selected Inbox/Projects mode;
- Projects expansion state;
- open document-tab IDs and active tab.

This is pre-MVP0 work. Change the current schema directly; do not add fallback readers, dual writers, or migration machinery without evidence of active external use. Preserve historical review JSON and attachments even when the newest app does not open every old artifact.

## Ownership boundaries and delivery order

- #15 owns review deletion, macOS Trash behavior, orphaned-attachment cleanup, destructive confirmation, and shared cleanup commands. #97 owns where those affordances appear in Inbox/Projects.
- #102 owns incoming-review activation, arrival notices, and focus policy. #97 preserves that behavior and coordinates the shared settings UI/store.
- #54 owns global base-text-size controls. #97 validates rows, badges, truncation, hierarchy, and tabs at every supported size bound.
- #107 owns the manual-open ingestion contract described above.

Delivery proceeds in three slices:

1. Build only the selected Inbox/Projects UI in the real Markover shell using representative dummy data. This slice is for look-and-feel review: no review-store, IPC, metadata-discovery, persistence, thread-title-refresh, project-matching, status-transition, cleanup, or activation behavior is wired. Keep the fixture path development-only so ordinary review behavior is not replaced by dummy data. #107 is already implementing concurrently, so this slice must avoid `src/main.ts`, `src/preload.ts`, and the renderer's Open Markdown boundary; isolate any presentation fixture code from that flow.
2. Land #107 as the focused managed-Open-Markdown prerequisite after its stacked dependency #114, preserving the metadata contract this specification requires.
3. Replace the prototype fixtures with tested #97 projections and production wiring against the unified managed-review model.

The first slice should exercise the visual edge cases already known to matter: multiple actionable reviews from one thread, a Local review, `With Agent` history, collapsed Projects rollups, long timestamp-prefixed documents, missing optional metadata, closeable document tabs, narrow/wide sidebars, and light/dark appearance. Presentation-only controls may demonstrate selected, expanded, and collapsed states locally, but they do not mutate production review state.

## Likely implementation touch points

- `src/contracts.ts`: persisted review-origin, recency, requesting-thread-title provenance, project-identity, and workspace-state contracts.
- `src/review-store.ts`: creation/status timestamps and durable metadata updates that do not conflate autosave with attention recency.
- `src/metadata-discovery.ts`: repository identity plus thread-host/provider requesting-thread-title adapters.
- `src/settings.ts`, `src/settings-store.ts`, and `src/index.html`: explicit integrations and persisted navigation/workspace preferences.
- `src/review-sessions.ts`: actionable projections, grouping, ordering, rollups, tab working set, and project equivalence.
- `src/renderer.ts`, `src/index.html`, and `src/styles.css`: split tab strip, Inbox rows, Projects tree, bounded history, Local variants, and accessible interaction.
- `src/main.ts` and `src/preload.ts`: metadata refresh, activation, persistence, and the #107 managed-open boundary.
- Existing review-store, review-session, metadata-discovery, settings, app-menu, startup, activation, and smoke tests, plus focused projection/UI contract tests.

## Acceptance criteria

- Every actionable review appears exactly once in Inbox, including reviews whose Projects ancestors are collapsed.
- Inbox ordering changes only when `attentionRequestedAt` changes; unrelated autosaves, viewing, thread-title refreshes, and tab actions do not reorder it.
- A collapsed Projects row truthfully reports actionable descendant count and recency.
- Projects ordering, persisted expansion, explicit ancestor reveal, and bounded history behave as specified.
- Agent and Local rows remain distinguishable and useful with duplicate requesting-thread-titles, timestamp-prefixed filenames, missing metadata, and long values.
- Renaming a thread in a supported thread-host/provider combination is reflected after a defined refresh trigger without falling back to the original prompt.
- Disabled integrations perform no metadata inspection; invalid overrides explain the failure and do not destroy the last authoritative thread-title.
- Equivalent worktrees group together while forks and unrelated directories remain separate.
- Document-tab closure is data-neutral and review cleanup remains recoverable through #15.
- Local same-path/same-checksum open deduplicates; changed content creates a preserved new snapshot; source files remain untouched.
- First launch defaults to Inbox; later launches restore selected mode, Projects expansion, open tabs, and active tab.
- Keyboard and assistive-technology users can select modes, traverse rows/tree, expand history/groups, activate reviews, and close tabs. Status and recency never rely on color alone.
- Layout remains usable at the minimum and maximum review-list widths, in light/dark appearances, and at every base text size supported by #54.

## Validation

- Unit-test pure Inbox/Projects projections, timestamp transitions, repository equivalence, Local deduplication, and workspace-state normalization.
- Integration-test store → main/preload → renderer flows for status changes, thread-title refresh, restart restoration, deep-link ancestor reveal, tab closure, and Local opens.
- Test explicit integration enablement, path overrides, unavailable sources, stale authoritative-thread-title retention, and completed rename experiments.
- Exercise 0, 1, 10, 11, and hundreds of historical reviews; multiple actionable documents from one thread; duplicate repository basenames; worktrees; forks; non-Git paths; missing metadata; and long localized labels.
- Manually verify keyboard/focus behavior, VoiceOver labels, color-independent state, light/dark appearance, sidebar width bounds, #54 text-size bounds, and packaged Electron smoke.
- Run `npm run ci:local` before handoff.

## Deferred refinements

- Debounced meaningful-`updatedAt` Inbox ordering is a fallback only if `attentionRequestedAt` feels stale in real use.
- Full-text search/filter is not required for the first slice; reassess after the action-first Inbox and project hierarchy are used with real history.
- Additional thread-host/provider adapters follow completed rename experiments rather than speculative shared parsing.

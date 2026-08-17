# Reliable agent review round trips

- Issue: [#171](https://github.com/lastobelus/markover/issues/171)
- Project: Review Lifecycle
- Milestone: Focused preview
- Status: authorized for implementation

## Outcome

Codex- and Claude-backed reviews keep a truthful project and requesting-thread
identity through real Markover round trips in provider CLIs, provider desktop
apps, and T3 Code.

An edited source remains in its repository project and gains a per-review
“Source changed since review opened” state. A T3 review can recover its host
thread and current T3 title from either an explicit host ID or the provider
session ID. An agent uses a truthful explicit session ID when its runtime
exposes one and otherwise always supplies a unique handoff key that Markover can
resolve from the matching provider's local session artifacts.

This is one implementation PR with checkpointed slices. Its first checkpoint
records this contract; production changes and verification continue on the same
branch and PR.

## Observed failures and root causes

1. Five Markover reviews appeared in a second project also labeled `markover`.
   `discoverVerifiedReviewProjectContext` currently checks the stored source
   checksum before running live Git discovery. A normal source edit therefore
   erases the app-private project association. The managed-review fallback then
   borrows the portable repository name, making the unassigned bucket look like
   a duplicate project.
2. Several T3 reviews showed Codex `019…` IDs or Claude session UUIDs instead of
   titles. The T3 title adapter queries `projection_threads.thread_id` directly
   with `threadHost.threadId ?? agentThread.id`; when the effective value is a
   provider session ID, it never follows T3's existing provider-runtime mapping
   to the host thread.
3. T3/Claude reviews had no requester metadata. Those agents did supply exact
   `mko_handoff_*` keys, but Markover only scans `~/.codex/sessions`. The Claude
   session remained undiscovered and the complete `agentThread` snapshot
   correctly failed closed to `null`.
4. The earlier Claude conformance exercise passed because it explicitly used
   `CLAUDE_CODE_SESSION_ID`. It did not exercise the ordinary handoff-key
   fallback, desktop surfaces, or the provider-session-to-T3-title round trip.

## Product contract

### 1. Project identity is independent from source freshness

Derive an app-private review context:

```ts
interface ReviewProjectContext {
  project: ProjectIdentity | null
  projectEvidence: 'verified' | 'conflict' | 'unavailable'
  sourceState: 'unchanged' | 'changed' | 'missing' | 'unavailable'
}
```

The context is derived from the opening-time source locator and current local
evidence. It is not written to portable `review.json` and is not returned by
the agent-facing `get` protocol.

- Run live Git discovery independently of reading or hashing the source.
- A readable checksum mismatch yields `changed` and does not veto the live
  project.
- A missing source may retain its project when the locator's parent still
  supplies live repository evidence. Do not search for, relink, or rewrite a
  moved source.
- If both the opening repository origin and live origin are available, compare
  their normalized identities. A conflict leaves the review unassigned while
  source state remains independently truthful.
- If neither remote is available, preserve the existing common-Git-directory
  and canonical-root grouping rules. Equivalent worktrees and clones remain
  together; forks remain distinct.
- With no live repository evidence, use exactly the `Other` / `unassigned`
  project. Never label an unassigned bucket from portable Git metadata.
- Show non-unchanged state and repository conflict on the review, not on the
  project. Use exact labels: “Source changed since review opened,” “Source is
  missing at its recorded path,” “Source status unavailable,” and “Source now
  belongs to a different repository.” Avoid the overloaded bare word “dirty.”
  “Moved” means missing at the recorded path; Markover does not search for a
  replacement.

The app invalidates and recomputes this bounded in-memory context on open,
restore, review activation, managed-review publication, and the existing
integration refresh. It must not leave one fulfilled promise cached
indefinitely. This slice adds no watcher, poller, relinker, or private identity
store.

### 2. Metadata completeness is visible

The review-row hover card and active review information drawer present the same
standard metadata inventory with the established label and icon for each
field: project, source path and state, repository, branch, commit, pull request
and observed status, requesting thread and resolved title, thread host,
provider, distinct host thread, machine, review status, and relevant dates.

- Keep every standard field in the inventory instead of omitting absent values.
- Render a concrete status such as “Missing,” “Unavailable,” “Not observed,” or
  “Not applicable.” Missing, unavailable, inconsistent, and error values use
  the existing error text color; a contractually inapplicable field is neutral.
- Add a final error-colored summary whenever the inventory contains one of
  those problems or the review has another metadata/source/project conflict
  that is not itself a standard displayed field. The summary names the
  actionable facts rather than emitting a generic warning.
- Use the same status derivation for hover and drawer so they cannot disagree.
  Preserve accessible labels and descriptions for every icon, status, and
  summary.

Focused projection and renderer tests cover complete, missing, unavailable,
inconsistent, hidden-conflict, and local-review not-applicable cases on both
surfaces.

### 3. T3 resolves provider sessions to host threads

The existing T3 SQLite source remains private, read-only, and main-process
only.

1. Try the effective ID directly against the current, nondeleted
   `projection_threads.thread_id`. An explicit `threadHost.threadId` is always
   host-owned and never reinterpreted as a provider session.
2. Only when the effective ID came from fallback `agentThread.id` and no direct
   row exists, use the normalized reported provider to select one exact T3
   runtime shape:

   | Portable provider aliases | T3 provider and adapter | Provider session path |
   | --- | --- | --- |
   | `codex`, `openai` | `codex` | `resume_cursor_json.threadId` |
   | `claude`, `anthropic`, `claudeagent` | `claudeAgent` | `resume_cursor_json.resume` |

3. Join the one matching runtime row back to its current, nondeleted
   `projection_threads` row and return the title keyed by the review's original
   effective ID. Existing snapshot consumers therefore need no new public
   identity shape.
4. Direct identity wins over a cursor collision. Unknown providers do not
   trigger a scan. Missing, deleted, blank, malformed, or ambiguous matches
   omit that title without making the entire available snapshot fail.
5. Guard SQLite JSON extraction with validity and string checks. Database,
   schema, or source-open failure retains the existing `unavailable` snapshot
   behavior and existing refresh recovery.

Claude's cursor `threadId` is the T3 host ID, not the Claude provider session;
the provider session is `resume`. No recovered T3 UUID or title is copied into
portable review data.

### 4. Explicit requester identity first, handoff key always as fallback

Before publishing product-specific guidance, record the exact installed
product/build and which of `CODEX_THREAD_ID`, `CLAUDE_CODE_SESSION_ID`, or a
distinct host ID it actually exposes. The T3/Codex and T3/Claude probes are
already observed; direct CLI and desktop probes must be confirmed in their own
capability rows. Guidance names a runtime variable only for surfaces where the
audit proves it.

Agent-facing help and repository guidance then use one concise decision:

- On a proven Codex surface, read only `CODEX_THREAD_ID` when checking for an
  explicit ID.
- On a proven Claude surface, read only `CLAUDE_CODE_SESSION_ID` when checking
  for an explicit ID.
- When the applicable value is nonblank, pass it as `--thread-id`.
- Otherwise generate one fresh high-entropy
  `mko_handoff_<16–64 alphanumerics>` value and pass `--handoff-key` in that
  same `open` or `get-for-review` command.
- With either route, pass truthful `--thread-host-kind`,
  `--thread-host-provider`, the local hostname when available, and a
  `--thread-host-thread-id` only when a distinct host-owned ID is actually
  observable. Never guess the T3 UUID.

This requirement applies to agent-originated opens and reviewer claims. Human
local-document opens may legitimately have no agent identity, so the CLI does
not globally require these flags.

Extend the current bounded local-session discovery with one Claude-specific
path beside the Codex path:

- Dispatch only known Codex/OpenAI aliases to `~/.codex/sessions` and known
  Claude/Anthropic aliases to root session files under
  `~/.claude/projects/*/*.jsonl`; exclude Claude `subagents`.
- Match the complete handoff-key token using the existing boundary rule.
- Recover a consistent nonblank top-level Claude `sessionId` and the first
  usable `cwd`. Do not assume a Codex-style first `session_meta` record because
  Claude logs may begin with `queue-operation`.
- Preserve explicit-ID precedence, workspace preference, exact-one-candidate
  resolution, privacy opt-out, log-count, tail, and aggregate-byte limits.
- Absence, ambiguity, provider mismatch, conflicting IDs, malformed records,
  unreadable files, or exhausted bounds yields `null`, never a guess.
- Persist only the recovered provider session ID and caller-supplied host
  snapshot. Do not export the matched content, log path, T3 correlation, or
  title.

The implementation remains two concrete provider readers, not a generic
adapter registry. Settings and privacy copy describe bounded local Codex or
Claude session discovery rather than Codex alone.

## Supported Focused-preview matrix

| Host surface | Provider | Preferred explicit ID | Required fallback and result |
| --- | --- | --- | --- |
| Codex CLI | Codex | `CODEX_THREAD_ID` | Exact key in Codex sessions recovers the same provider ID. |
| ChatGPT desktop, Codex view | Codex | `CODEX_THREAD_ID` when exposed | Exact key in the app's Codex session record recovers the provider ID. |
| T3 Code | Codex | `CODEX_THREAD_ID` | Codex exact-key recovery, then private T3 host/title correlation. |
| Claude Code CLI | Claude | `CLAUDE_CODE_SESSION_ID` | Exact key in a root Claude project session recovers the provider ID. |
| Installed Claude coding desktop surface; exact product/build recorded by the audit | Claude | Proven explicit variable, if any | A proven local exact-key source must recover the provider ID. |
| T3 Code | Claude | `CLAUDE_CODE_SESSION_ID` | Claude exact-key recovery, then private T3 host/title correlation. |

Every row requested for Focused preview must pass. If a required surface cannot
invoke Markover or exposes neither an ID nor a local artifact containing the
exact key, record the exact product/build and external dependency and keep the
Focused-preview gate open. Narrowing the required matrix needs an explicit user
decision; it is not treated as “not applicable” by implementation fiat.

## Implementation sequence and touchpoints

### Checkpoint A — record the contract and serialize shared work

- Land this plan and open the real draft implementation PR for #171.
- Let #166 finish its currently claimed shared title settings, IPC,
  arbitration, renderer, and Inbox seams.
- Rebase this branch after #166 before making product edits to those shared
  files. Implement independent discovery tests earlier only when they do not
  create avoidable conflict.
- Recheck active claims and open PRs immediately before each shared seam.

### Checkpoint B — separate project and source state

- `src/review-project-context.ts`: replace checksum-gated project discovery
  with independent project and source-state derivation; retain the four-wide
  restore bound and existing project-key precedence.
- `src/contracts.ts`, `src/main.ts`, `src/ipc-contract.ts`: carry the closed
  private source-state domain through managed document publication and favicon
  lookup without changing portable review data.
- `src/review-sessions.ts`: propagate the review source state and make managed
  unassigned identity exactly `Other` / `unassigned`.
- `src/review-inbox.ts`, `src/renderer.ts`, `src/styles.css`: show a compact,
  accessible per-review source-state marker in Inbox, Projects, and active
  review context; show the complete standard metadata inventory and its
  fact-specific error summary in hover and the information drawer; do not roll
  source state up into project identity or lifecycle status.
- `docs/developer/review-handoff-format.md`: make live Git evidence the source
  of app-private project identity and checksum comparison the source of
  freshness only. This is a private derivation correction, so portable v1
  needs no version bump, migration, or compatibility reader.
- Extend project-context, session, inbox, UI, IPC, and favicon tests.

### Checkpoint C — add exact T3 provider correlation

- `src/t3-thread-titles.ts`: preserve direct lookup first, then add the two
  explicit provider-runtime joins with fail-closed uniqueness.
- `test/t3-thread-titles.test.ts`: cover Codex and Claude aliases, direct
  precedence, explicit-host no-fallback, unknown and wrong providers,
  ambiguity, deleted/blank targets, malformed/non-string JSON, source failure,
  refresh recovery, and private-boundary behavior.
- Keep the result keyed by the original review identity so no provider-title
  IPC, title setting, or general arbitration code is added here.

### Checkpoint D — make metadata capture deterministic

- Read `.ai/skills/writing-for-agents/SKILL.md` before editing any agent-consumed
  guidance, then run the capability audit before naming direct CLI or desktop
  environment probes.
- `src/metadata-discovery.ts`: retain Codex discovery and add the bounded
  Claude root-session reader plus explicit provider dispatch.
- `scripts/markover.ts` and `AGENTS.md`: encode the explicit runtime-ID probes
  and mandatory handoff fallback for agent-originated commands.
- `src/index.html`, privacy/agent documentation, and their tests: update only
  the narrow local-session discovery and identity-decision copy. Coordinate
  any public agent-doc touchpoint with draft PR #51.
- `DECISIONS.md`: revise the existing local-session discovery decision rather
  than add a new architecture decision.
- Extend metadata-discovery and CLI tests for Claude parsing, exact matching,
  bounds, ambiguity, provider routing, privacy opt-out, and explicit
  precedence.
- Extend the maintained metadata conformance matrix, exercises, runner, and
  sanitized evidence with explicit-ID and forced no-ID fallback paths.

### Checkpoint E — verify the real round trip

1. Run focused deterministic tests after each checkpoint.
2. Run one explicit-ID and one forced handoff-key tracer for Codex and Claude.
3. Exercise every installed invocation-capable row in the Focused-preview
   matrix. Each retrieved review must contain the exact provider session ID and
   truthful host/provider/machine snapshot without a guessed host ID.
4. For both T3 rows, rename the T3 thread and prove the review resolves the
   exact host thread and current T3 title from both explicit-ID and forced-key
   paths.
5. Prove a changed source stays in the same project, displays its changed
   state, and does not mutate the stored checksum or portable output.
6. Prove hover and the information drawer list the same standard metadata,
   visibly mark missing/unavailable/inconsistent values, and summarize every
   displayed or hidden metadata conflict with accessible error text.
7. Prove no private path, matched log content, T3 UUID, derived title, project
   key, or source state leaks through portable `review.json` or agent `get`.
8. Run `npm run ci:local` and one focused macOS QA pass across Inbox, Projects,
   active review metadata, settings copy, and restart/refresh recovery.

## Deterministic acceptance matrix

| Case | Expected result |
| --- | --- |
| Same source bytes, same live repository | Same project; `unchanged`. |
| Different source bytes, same live repository | Same project; `changed`; visible per-review marker. |
| Source missing, locator parent still in repository | Same project; `missing`; no relink. |
| Worktree/locator gone or no live Git evidence | `Other` / `unassigned`; truthful source state. |
| Opening and live normalized origins conflict | `Other` / `unassigned`; source state remains independent. |
| Equivalent clone/worktree | Existing shared project identity is preserved. |
| Distinct fork | Distinct project identity is preserved. |
| Standard metadata missing, unavailable, inconsistent, or errored | Field remains listed in error text; fact-specific summary appears last in hover and drawer. |
| Metadata field is contractually inapplicable | Field remains listed as `Not applicable` without creating an error summary. |
| Conflict is not represented by a standard field | Fact-specific error summary still appears last in hover and drawer. |
| Explicit T3 host ID | Direct current nondeleted T3 title wins. |
| Codex provider session ID | Exact `cursor.threadId` mapping resolves one T3 host/title. |
| Claude provider session ID | Exact `cursor.resume` mapping resolves one T3 host/title. |
| Ambiguous, malformed, deleted, blank, or unknown T3 mapping | Title omitted; source stays available. |
| Exact Claude handoff key | Exact top-level `sessionId` and workspace recovered. |
| Same key in multiple eligible sessions | Discovery returns `null`. |
| Explicit `--thread-id` | Discovery is bypassed; supplying both identity flags is rejected. |
| Discovery privacy setting disabled | No Codex or Claude session scan. |

Project-context transition tests exercise
`unchanged → changed → missing/unavailable → unchanged` on the named refresh
triggers without restarting. Codex and Claude discovery each receive symmetric
coverage for exact matching, workspace disambiguation, ambiguity, provider
mismatch, log/tail/aggregate bounds, malformed and unreadable sources, and
privacy-disabled no-read behavior.

## Coordination with open work

Shared-seam order is **#166 → #171 → #167**. Independent project-context and
provider-session discovery work may proceed before #166; shared title/UI edits
wait for the stated order.

- **#166 — Codex title adapter:** owns the Codex provider-authoritative title
  reader, source-specific settings/status, title IPC, host-over-provider
  arbitration, and shared Inbox/Projects presentation. #171 rebases after it
  and does not duplicate those capabilities.
- **#167 — Claude title adapter:** owns exact-known-session Claude `custom-title`
  lookup. #171 owns unknown-session recovery by exact handoff key and T3
  provider-session-to-host correlation. #167 rebases after #171; only a small
  artifact-enumeration helper may be shared if it is genuinely identical.
- **#146 — structured metadata guidance:** remains the owner of a broader
  structured help field/example and JSON-input evaluation. #171 fixes the
  proven concise identity decision, provider probes, fallback, and conformance
  cases without introducing a second input mode. #146 can evaluate the updated
  operational baseline afterward.
- **#128 — review lineage:** source freshness is not lineage, a version number,
  or predecessor inference.
- **#144 — atomic JSON:** this work adds no store, cache, migration, or writer.
- **#15 — review lifecycle:** source state does not alter Editing, Pending,
  Revised, Done, or deletion behavior.
- **#126 — GitHub PR status:** live project identity grouping does not change PR
  association, status, or navigation.
- **PR #51 — launch assets:** avoid broad public agent-doc rewrites; coordinate
  any necessary narrow overlap.
- **PR #151 — archive audit:** do not base work on or update archived copies.
- Merged #97/#136/#160 and PRs #162/#164 remain historical baselines. Their
  completed contracts are integrated and corrected here, not reopened.

## Excludes

- No Codex or Claude provider-authoritative title adapter, provider-title
  setting/status, or general title arbitration owned by #166/#167.
- No portable schema field, historical artifact rewrite/backfill, private
  enrichment persistence, title persistence, cache, migration, or
  compatibility reader.
- No polling, watcher, retry ledger, relinking/path search, repository-history
  inference, transcript-derived title, or guessed identity.
- No generic host/provider adapter framework and no second JSON CLI input mode.
- No review lifecycle/deletion behavior, GitHub PR status behavior, or broad
  launch-documentation rewrite.

## Completion

#171 is complete when project/source state, truthful requester metadata capture,
and T3 host-title correlation pass every required installed surface; the
deterministic and privacy tests are green; `npm run ci:local` passes; the
focused macOS QA pass succeeds; and the real implementation PR is reviewed and
merged. Direct Codex- and Claude-provider title lookup remains owned by #166 and
#167 rather than being duplicated here.

Focused preview remains gated on the combined result: #166, #171, #167, and any
separately identified provider-title dependency for the exact installed Claude
desktop product must make Codex and Claude round trips work in their required
CLI, desktop, and T3 Code paths. A blocked or unavailable required surface does
not count as completion without an explicit user decision to narrow scope.

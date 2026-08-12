# Review handoff format compatibility

Status: implementation design for issue [#99](https://github.com/lastobelus/markover/issues/99). [PR #114](https://github.com/lastobelus/markover/pull/114) removed the obsolete readers. [PR #129](https://github.com/lastobelus/markover/pull/129) landed the four-state lifecycle and pull-request observations. [PR #138](https://github.com/lastobelus/markover/pull/138) supplies the app-private workspace boundary on which the #99 schema PR is stacked. Issues [#97](https://github.com/lastobelus/markover/issues/97) and #99 will land as a coordinated pair.

## Outcome

`format: "markover-review"` identifies one portable review-artifact family, and `version: 1` identifies its complete contract: the review envelope, immutable source snapshot, unsupported-source records, document nodes, annotations, attachments, source-edit proposals, typed portable metadata, and agent guidance. The version does not describe the Markdown grammar, local-service protocol, CLI help format, app-private workspace/enrichment schemas, or a source-document revision.

A v1 reader accepts valid v1 artifacts, ignores unknown additive properties, and preserves them through every read/edit/write round trip. A reader rejects a different format or unknown future version before displaying, mutating, handing off, or rewriting the artifact. Rejection leaves the review directory and attachments untouched, reports the supported and received format/version, and recommends a compatible Markover release when the official compatibility catalog recognizes the header.

## Ownership and delivery boundary

- PR #138 is the parent of the #99 schema PR. It makes private `markover-workspace` v1 state in `workspace.json` authoritative for navigation and block-collapse presentation. After #138 merges, the #99 PR base changes to `main` without changing its own diff.
- PR #129 owns the four lifecycle values and agent-supplied pull-request observations already on `main`. #99 adopts those fields into the portable v1 decoder; it does not redesign their commands or UI.
- Issue #97 consumes the typed portable fields for Inbox/Projects projections. It owns presentation and workspace behavior and may stay coupled to #99 while both are active.
- Issue #131 owns app-private current/local enrichment: canonical source and repository evidence, grouping keys, discovery state, and requesting-thread-title observations. Losing private enrichment must not invalidate `review.json`.
- Issue #126 will add GitHub-authenticated pull-request refresh. It may update the existing observation tuple without changing its v1 shape.
- Issue #136 owns the ongoing live-agent conformance matrix. #99 owns only deterministic fixtures and bounded pre-publication checks for its guidance.
- Issue #15 owns the supported-Markdown behavior matrix. #99 versions the representation, not which syntax gains structured support.
- Issue #7's annotation interpretation contract remains snapshotted data under `review.agentGuidance`.
- Issue #101 may reconcile `DECISIONS.md`; #99 records its own compatibility decision against current `main` without changing #101's automation.
- Because v1 is not released, #99 writes v1 directly without a prototype fallback reader, alias, dual writer, or prototype migration. Released-version migration begins only after a schema version ships.

## Portable v1 schema inventory

An annotation is mutable review data attached to a node through `feedback`, `attachments`, and `sourceEdit`; it is not a separate top-level record. Every object may contain unknown additive properties unless a stated invariant makes a property invalid. Known properties keep the following contract.

| Path | v1 contract |
| --- | --- |
| `format` | Required literal `markover-review`. |
| `version` | Required integer `1`. It versions the complete portable object. |
| `sourceDocument` | Required object with required `name`, `path`, `content`, and `checksum`. `name` and `path` are nullable strings. `content` is the exact immutable opening-time source. `checksum` is `sha256:` plus 64 lowercase hexadecimal characters and must match `content`. |
| `sourceDocument.path` | Immutable portable opening-time locator when known. It may be absolute, stale, or machine-specific. It is not current path evidence, review identity, ancestry, repository identity, or a Local-review deduplication key. |
| `unsupported` | Required array. Each entry has positive integer `line` and string `text`. Empty means no omitted source lines were recorded. |
| `root` and every node | Required tree. Every node has `id`, `type`, `raw`, `text`, positive `lineStart`/`lineEnd`, `feedback`, and `children`. IDs are unique only inside this artifact. Portable nodes have no `collapsed` field; PR #138 stores collapse presentation privately by block ID. |
| Type-specific node fields | Headings require `level`; code requires `language`; frontmatter entries require `key`; list items require `marker`, `listId`, `listPosition`, and nullable `listLength`, and may have `task`/`checked`; frontmatter requires `sourceEditable: false`. |
| `node.feedback` | Required string. It may be blank or mix revision requests, questions, discussion, and context. |
| `node.attachments` | Optional array. Each attachment requires `id`. Known image fields are optional `type`, `label`, `path`, `mimeType`, `url`, `checksum`, `width`, and `height`; bytes remain outside JSON. A future must-understand attachment variant is breaking. |
| `node.sourceEdit` | Optional object requiring `original` and `current` strings. `original` equals immutable `raw`; `current` is nonblank and different. It is a proposal, never an instruction to apply blindly. |
| `node.sourceEditable` | Optional boolean. `false` forbids `sourceEdit`; omission uses the node type's normal rule. |
| `review` | Required envelope with `id`, `status`, `origin`, `createdAt`, `updatedAt`, `attentionRequestedAt`, `contextSummary`, `agentThread`, `git`, `pullRequest`, and `agentGuidance`. |
| `review.id` | Required opaque `mko_...` ID. Together with source content/checksum it identifies this review target. |
| `review.status` | Exactly `editing`, `pending-agent`, `revised`, or `done`. `editing` is mutable; the other states are read-only. `done` is terminal and requires a non-null PR association whose stored observation is `merged`. Another feedback round creates an independent review. Adding or reinterpreting a lifecycle value after release is breaking. |
| `review.origin` | Required nonblank open string, immutable for the review lifetime. v1 defines `agent` and `local`. Unknown values remain valid, preserved, and lifecycle-neutral. `local` requires `agentThread: null`; `agent` may also use null when reliable identity is unavailable. |
| `review.createdAt` | Required canonical UTC instant. It never changes. |
| `review.updatedAt` | Required canonical UTC instant for the latest persisted portable-artifact change, including annotation, lifecycle, metadata, or PR-observation changes. It does not control Inbox actionability. |
| `review.attentionRequestedAt` | Required app-owned canonical UTC instant. Creation sets it equal to `createdAt`; only a transition from a non-`editing` status into `editing` advances it. Autosaves, views, metadata/PR refresh, tab actions, and transitions away from `editing` do not. |
| `review.contextSummary` | Required nonblank review purpose. It is not a requesting-thread-title or identity field. |
| `review.agentThread` | Required nullable typed request snapshot. When non-null, it requires nonblank provider-owned `id` and a `threadHost` object. No requesting-thread-title observation belongs here; `title`, `name`, and `requestingThreadTitle` aliases are forbidden. |
| `review.agentThread.threadHost` | Requires nonblank open-string `kind` and `provider`; they are separate dimensions but may have the same value. |
| `review.agentThread.threadHost.threadId` | Optional nonblank thread-host identifier. Include it only when it differs from `agentThread.id`; omission means consumers fall back to `agentThread.id`. |
| `review.agentThread.threadHost.machine` | Optional nonblank agent-reported hostname snapshot, normally obtained from local `hostname` when available. It is descriptive and never stable or identity-bearing. |
| `review.git` | Required nullable opening-time snapshot. When non-null, known optional fields are sanitized nonblank network/scp-like `repositoryUrl`, nonblank `branch`, and nonblank `commit`. These hints are immutable, may become stale, and are not current Git truth, identity, or grouping keys. Credentials, `file:` URLs, and absolute or relative filesystem remotes are forbidden. |
| `review.pullRequest` | Required nullable association. When non-null it requires canonical GitHub `url` and matching positive integer `number`. Its optional observation tuple is all-or-none: `status` is `draft`, `open`, `merged`, or `closed`; `statusObservedAt` is canonical UTC; and `statusSource` is a nonblank open string. Markover stores the latest successful observation and reports it plainly; failed refreshes retain the prior value. |
| `review.agentGuidance` | Required object with string `fixedContract` and `interpretationPolicy`. Agents follow both snapshotted strings before acting. |
| Unknown properties | Additive extension data. Readers ignore unknown properties and preserve them unchanged, including inside typed metadata containers. Unknown fields do not bypass privacy boundaries or override known-field invariants. Reserved private namespaces are rejected at any depth: `workspace`, `settings`, `credential`/`credentials`, `cache`/`caches`, `enrichment`, `privateEnrichment`, and `appPrivate`. Top-level or typed-container checks separately reject known local evidence such as requesting-thread-title, project/repository roots, Git discovery records, and session paths or ancestry. |

All canonical UTC instants use JavaScript's canonical millisecond ISO form (`new Date(value).toISOString() === value`). Creation sets `createdAt`, `updatedAt`, and `attentionRequestedAt` equal. Timestamp ordering is validated wherever the transition supplies enough context; the decoder does not invent missing history.

## Identity, lifecycle, and private-data boundaries

The review target is the tuple of `review.id`, `sourceDocument.content`, and `sourceDocument.checksum`. Node IDs locate annotations within that immutable tree and make no claim across reviews or reparsed documents. Same paths never imply ancestry. Issue #128 may introduce explicit lineage later if real use justifies it.

Portable opening-time hints answer “what did the requester report when this review was created?” They are not Markover's current machine-local knowledge. Issue #131 may maintain canonical source paths, checkout/common-Git-directory evidence, normalized repository identity, project keys, and current requesting-thread-title observations outside `review.json`. Requesting-thread-title uses a shared private thread-metadata index when practical, keyed by the best available thread identity: distinct `threadHost.threadId` when present, otherwise `threadHost.provider` plus `agentThread.id`. Updates are event-driven or pushed by a future LastCode integration, not polling or filesystem/database watchers.

Before deriving an app-private project root or favicon from `sourceDocument.path`, Markover reads the live file and verifies it against the portable snapshot checksum. A missing or changed file yields no live repository evidence. Newly created and restored reviews use the same verified private project-root path before their first renderer publication. A managed review with no verified project root remains unassigned; only unmanaged documents may fall back to their current source directory for grouping. Durable enrichment remains #131's responsibility.

`workspace.json` owns Inbox/Projects mode, hierarchy expansion, open and active tabs, selected block, All/Annotated filter, selected/list annotation view, Source pane expansion, block-collapse IDs, and global annotation-pane width. It excludes scroll positions, focus/hover state, attachment previews, active source-edit state, and unsaved drafts. Private workspace writes are prompt, serialized, and atomic; graceful-shutdown flush is only a final safety net. Missing, malformed, or incompatible private state resets presentation without hiding or changing a valid review.

No private workspace, settings, credential, integration, cache, or enrichment field is returned by CLI `get`, clipboard export, or the agent-visible service. Credentials are forbidden from portable JSON. Unknown portable extensions are not an escape hatch for app-private evidence.

## Compatibility rules

Keep version `1` only for an additive change. An additive change adds an optional property whose omission preserves behavior, leaves every existing type/value domain/meaning intact, is safe for an older v1 reader to ignore, and survives its read/edit/write round trip unchanged.

Increment `version` for a breaking change: removing or renaming a field; making an optional field required; changing a type, default, meaning, or identity rule; narrowing a value domain; adding a must-understand node, attachment, or lifecycle variant; or moving annotations/proposals. A validator correction that rejects data already outside the published contract does not bump the version.

Open-string domains such as `origin`, `threadHost.kind`, `threadHost.provider`, and `pullRequest.statusSource` allow new producer labels without a version bump because unknown values remain valid and neutral. Closed domains such as `review.status`, pull-request `status`, and `ReviewNode.type` require a new version for a new value. Changing guidance text, recognizing Markdown through existing node shapes, or extending optional metadata does not itself bump the schema.

`format` changes only for a different artifact family. Versions are positive integers rather than SemVer. Portable v1 has no independently versioned subobjects; app-private objects are separate families with their own policy.

## Released-version migration policy

Compatibility support begins with released schema versions. Prototype or unmerged shapes are not supported predecessors. Every breaking release must include an executable in-app converter from every released predecessor Markover supports; a documented older-app/manual-export path is an emergency recovery aid, not fulfillment of this guarantee.

Migration happens automatically on load. Before modifying an artifact, Markover creates a restorable byte-for-byte backup of the original review directory, including JSON and attachments. It migrates a separate working copy, validates the complete result with the destination decoder, and atomically replaces the active artifact only after validation succeeds. Failure leaves the active artifact and backup untouched. Backup metadata records source schema version, Markover version, timestamp, and integrity information. Backups remain available for recovery or downgrade until the user explicitly removes them.

An unknown future version is never guessed at. Markover fails closed, preserves its bytes, keeps the item visible as incompatible, and consults an official compatibility catalog using only the format/version header. If recognized, the diagnostic names and links the Markover release required to open it; otherwise it recommends updating Markover and provides raw artifact-location/export recovery information without interpreting the body.

## Reader-boundary design

Add one platform-neutral v1 decoder and error classifier, `src/review-format.ts`. It checks `format` and `version` before v1 fields, validates all known invariants, permits unknown properties, and returns the original complete value rather than a lossy projection. `ReviewStore`, IPC, and the CLI handoff response share that contract.

| Boundary | Required behavior |
| --- | --- |
| CLI `open` → local service | Decode the submitted artifact/tree before storage. Malformed or incompatible input creates no review. Agent-supplied identity metadata is validated when the managed envelope is created. |
| Managed `review.json` → `ReviewStore` | Inspect the header before listing, restoration, activation, handoff, edit, deletion, or cleanup. A recognized released predecessor follows backed-up automatic migration; v1 decodes directly. Unknown versions produce `UNSUPPORTED_REVIEW_VERSION`; listing records `incompatible` without rewriting bytes. |
| Store → service → CLI `get` | Store decodes before response; CLI independently decodes successful JSON before stdout. Incompatibility exits nonzero with stderr diagnostic and no handoff JSON on stdout. |
| Main ↔ renderer IPC | Reuse the shared predicate for review-bearing documents, snapshots, autosaves, attachment removal, and workspace-independent clipboard data. Reject incompatible input before renderer or persistence changes. IPC envelopes remain separately validated. |
| Renderer → clipboard | Export the complete already-decoded artifact, preserving additive fields. Clipboard is an output boundary, not a second concise schema. |
| Agent consumer | Inspect header before fields. Accept v1, ignore/preserve additive properties, follow both guidance strings, and stop with a clear compatibility report for any other format/version. Guidance encourages truthful `agentThread` metadata, attempts local `hostname` for optional `machine`, and requires omission/null rather than guesses. |

The decoder must not normalize, default, strip, or migrate valid v1 data. Store updates clone the complete decoded artifact and mutate only owned fields so additive properties survive. Schema migration is a separate pre-decode operation selected only by a recognized released header.

## Error behavior

Detection order is deliberate:

1. A non-object or missing/malformed header is `INVALID_REVIEW`.
2. A different string `format` is `UNSUPPORTED_REVIEW_FORMAT`.
3. A positive integer `version` unknown to this build is `UNSUPPORTED_REVIEW_VERSION`, without v1-body validation.
4. A recognized v1 header with an invalid body is `INVALID_REVIEW`.

The local service maps unsupported format/version to HTTP `409`; the CLI preserves the structured code, emits no successful JSON, and exits nonzero. Listing isolates an incompatible review and continues loading compatible reviews. Direct activation, `get`, edit, lifecycle mutation, deletion, attachment cleanup, and orphan cleanup fail closed against it.

## Verification inventory

- Add `test/fixtures/review-handoff-v1.json` with every current node, annotation, attachment, metadata, guidance, and lifecycle-relevant field, excluding `node.collapsed`.
- Test both known origins plus an unknown open-string origin; agent-without-thread and Local-with-Git; attention timestamp invariants; all four lifecycle states; conditional PR observations; `done`/merged; typed Git and thread-host packets; duplicate thread ID rejection; optional machine; canonical timestamps/checksum; unique node IDs; type-specific node invariants; and source edits.
- Test additive properties at every object level and prove create/load/autosave/status/edit/PR-observation/clipboard round trips preserve them.
- Test direct-provider packets with no duplicate `threadHost.threadId`, a T3-style distinct thread ID, truthful null fallback, and absence of any portable requesting-thread-title observation.
- Test trees with no `collapsed` field across parse, render, autosave, handoff, restore, service, IPC, and clipboard. Test that private workspace and enrichment fields never enter agent-visible output and that invalid private state cannot invalidate a review.
- Test unknown formats/versions at store listing and direct operations, every review-bearing IPC route, local service, and CLI; prove review JSON and attachments remain byte-for-byte unchanged.
- Add bounded deterministic conformance cases for agent metadata guidance. Issue #136 owns expanding live thread-host/provider exercises.
- Before the first post-v1 breaking release, add migration fixtures covering backup, working-copy validation, atomic replacement, rollback, attachments, downgrade recovery, and compatibility-catalog diagnostics. V1 has no prototype migration fixture.
- Keep the #114 prototype-cleanup guard so deleted readers and migration paths are not reintroduced.

Run focused tests first, then `npm run ci:local`.

## Documentation changes

Publish the durable contract in `docs/developer/review-handoff-format.md`. Add a short triggered pointer from agent-facing workflow and extend machine-readable `markover help` so agents validate the header and supply truthful request metadata. Update user-facing agent/limitation documentation with fail-closed behavior without duplicating the full schema table.

Record the format/version and released-version migration decision in `DECISIONS.md` against current `main`. Replace pre-release guidance that treats backward compatibility as always unnecessary with the narrower rule: unreleased prototypes receive no compatibility layer; released older versions migrate automatically through backed-up validated converters; unknown future versions fail closed and receive a compatible-release recommendation when known.

## Completion criteria

Issue #99 is complete when the v1 contract is published; PR #138's private collapse boundary is its base; #97 and landed PR #129 requirements are covered; every surviving managed reader uses one decoder; additive fields survive all mutations; unknown formats/future versions fail consistently at storage, service, CLI, IPC, clipboard, and agent boundaries; deterministic fixtures and bounded guidance evals protect the schema; and repository guidance records released-version migration policy. Because v1 has no released predecessor, this PR establishes the migration boundary without rewriting prototype artifacts.

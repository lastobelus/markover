# App-private review enrichment storage

Issue: [#131](https://github.com/lastobelus/markover/issues/131)  
Coordinates with: [#97](https://github.com/lastobelus/markover/issues/97), [#134](https://github.com/lastobelus/markover/issues/134)  
Portable-format boundary: merged [PR #139](https://github.com/lastobelus/markover/pull/139)

## Outcome

Add a small, independently versioned private storage foundation for local facts
that improve Inbox and Projects but do not belong in the portable
`markover-review` artifact. The foundation persists one coherent source and
repository snapshot per review and one shared set of requesting-thread-title
observations per requesting thread.

The portable review remains authoritative for review content, lifecycle,
opening-time request metadata, annotations, and agent handoff. Enrichment is
secondary: its absence, corruption, incompatibility, or write failure never
invalidates a review, blocks `get`, or prevents annotation and lifecycle work.

## Ownership boundaries

Markover has four intentionally separate state domains:

| State | Owner | Purpose |
| --- | --- | --- |
| `reviews/<review-id>/review.json` | Portable `markover-review` v1 | Source snapshot, feedback, lifecycle, opening-time request metadata, and agent handoff. |
| `workspace.json` | Private `markover-workspace` v1 | Navigation mode, expansion, tabs, pane state, selection, filters, and collapsed block IDs. |
| `reviews/<review-id>/enrichment.json` | Private `markover-review-enrichment` v1 | Last verified source/repository/project snapshot and a narrow review-specific validation error. |
| `threads/<thread-key>/enrichment.json` | Private `markover-thread-enrichment` v1 | Latest requesting-thread-title observation from each known source. |

Settings continue to own user preferences and enabled integration
configuration. No enrichment file contains credentials, integration paths,
polling state, or UI workspace state.

Only the main process reads and writes enrichment files. The renderer receives
an exact, purpose-built projection; the local service and CLI never receive
the private objects.

## Storage layout

Both private formats live beneath the addressed Markover instance's existing
user-data directory:

```text
reviews/
  <review-id>/
    review.json
    enrichment.json
    attachments/

threads/
  <thread-key>/
    enrichment.json
```

The review sidecar follows the managed review directory automatically when
that directory moves to Trash. The shared thread file is outside any one
review because several reviews may have been requested by the same thread.

`thread-key` is a filesystem-safe SHA-256 digest of a canonical encoding of
the stable thread identity. The identity is also stored inside the file, so a
mismatched path or theoretical digest collision fails validation rather than
returning another thread's title.

Files are written with user-only permissions where the platform supports them.
Each entity has its own serialized write queue. A write uses a same-directory
temporary file, flushes the complete JSON bytes, and atomically renames the
temporary file over the destination. A changed projection is published to the
renderer only after that rename succeeds.

## Stable requesting-thread identity

Issue #134 supplies the normative identity rule. #131 applies it without
classifying products, normalizing aliases, or inventing provider mappings.

```text
effectiveThreadId =
  agentThread.threadHost.threadId  when present
  agentThread.id                   otherwise

stableThreadIdentity = [agentThread.threadHost.kind, effectiveThreadId]
```

`agentThread.id` is the best observable requesting-thread or session ID. It is
not assumed to be provider-owned. Provider, machine, thread-title, product
aliases, runtime values, and discovery paths never participate in stable
identity, equality, or the directory key.

`agentThread.id` and `threadHost.threadId` are independently reported
best-known identifiers and may be equal. #131 does not compare them or require
one to be omitted. Supplying the equal host ID and omitting it therefore derive
the same stable identity. #134 owns removing the current portable-reader and
guidance rule that rejects equality; #131 adds no workaround or compatibility
path for that temporary upstream restriction.

The canonical digest input is the UTF-8 JSON encoding of the two-element array
above. Both values must already satisfy the portable v1 nonblank-string
contract. A review with `agentThread: null` has no shared thread enrichment.

## Review-enrichment v1

A valid review-enrichment file has this complete shape:

```yaml
format: markover-review-enrichment
version: 1
reviewId: mko_...

snapshot:
  observedAt: 2026-08-12T12:34:56.789Z
  source:
    canonicalPath: /absolute/path/to/document.md
    verifiedChecksum: sha256:...
  repository:                       # null when no Git repository was verified
    identityKind: remote            # remote | common-git-directory | checkout-root
    identity: https://github.com/lastobelus/markover.git
    checkoutRoot: /absolute/path/to/checkout
    repositoryRelativePath: doc/plan.md
    projectKey: remote:https://github.com/lastobelus/markover
    projectName: markover

error: null                         # or the error object below
```

The non-null error shape is:

```yaml
error:
  code: source-missing              # source-missing | source-changed | repository-unavailable
  observedAt: 2026-08-12T13:00:00.000Z
  detail: The previously verified source path no longer exists.
```

### Review snapshot invariants

- `format`, `version`, `reviewId`, `snapshot`, and `error` are exact required
  fields. Unknown fields are rejected because this private reader supports
  only its current format.
- All timestamps use canonical UTC millisecond ISO form.
- `canonicalPath` and local repository paths are absolute normalized paths.
- `verifiedChecksum` equals the associated portable
  `sourceDocument.checksum`; the current bytes at `canonicalPath` produced that
  checksum when the snapshot was accepted.
- `repository` is either one complete object or `null`. Partial repository
  evidence never becomes visible or durable.
- Repository identity prefers a sanitized normalized remote, then a common Git
  directory for local-only linked worktrees, then the checkout root. Distinct
  remote identities remain distinct projects. #131 stores a supplied coherent
  result; #97 owns the discovery and normalization policy that produces it.
- `repositoryRelativePath` is relative, normalized, and cannot escape the
  checkout root.
- `projectKey` is identity-bearing and must not be derived from mutable display
  text. `projectName` is display-only.
- A valid file always contains a previously successful snapshot. If initial
  discovery fails before any snapshot exists, Markover keeps a runtime error
  only and does not manufacture a private file containing partial evidence.
- A successful validation atomically replaces the complete snapshot and sets
  `error` to `null`. The store keeps no per-field or historical observations.
- A failed validation retains the complete prior snapshot and replaces only
  `error`. Existing project and path display therefore remains unchanged.

For a checksum-verified non-Git source, `repository` is `null`. A consumer may
derive a non-Git display grouping from the verified canonical path at runtime;
that derived display does not create a second durable identity field.

## Thread-enrichment v1

A valid thread-enrichment file has this complete shape:

```yaml
format: markover-thread-enrichment
version: 1

identity:
  threadHostKind: t3code
  threadId: 018f...

titleObservations:
  - sourceKey: t3code
    authority: thread-host           # thread-host | provider
    title: Improve inbox / review management
    observedAt: 2026-08-12T12:34:56.789Z
```

### Thread observation invariants

- `identity` stores exactly the two stable identity inputs used to derive the
  directory key. It contains no provider, machine, alias, or runtime field.
- #134 owns product classification, canonical `sourceKey` values, aliases, and
  registry semantics. #131 treats `sourceKey` as an opaque nonblank key.
- There is at most one observation per `sourceKey`.
- An observation older than the stored observation for the same source is
  ignored. An identical observation at the same time is idempotent. A
  same-source, same-time observation with different content is rejected as a
  conflict rather than resolved arbitrarily.
- A source update replaces only that source's observation through one atomic
  whole-file write.
- Thread-host authority outranks provider authority regardless of recency.
  Within one authority, newer `observedAt` wins. Equal-time candidates use
  ascending `sourceKey` as a deterministic final tie-break.
- The resolved display title is a runtime projection and is never written to
  this file. If there is no valid observation, #97 falls back to the effective
  thread ID, `contextSummary`, or document name according to its display
  preference and row variant.
- Discovery failure never deletes a prior observation and never marks each
  associated review as erroneous. It is integration health, not review
  corruption.

The file excludes evidence paths, review IDs, errors, resolved titles, favicon
data, and integration settings. A future LastCode integration can submit an
observation through the same main-process operation without adding polling or
filesystem/database watchers.

## Error and recovery behavior

Markover is a secondary tool and does not own or repair the user's projects.
The recovery model is deliberately small:

| Condition | Behavior |
| --- | --- |
| Enrichment file is missing | Treat it as empty private state. This is not an error. |
| Review file is malformed, mismatched, or unsupported | Ignore it as a whole, leave it untouched, keep the portable review usable, and expose a non-blocking review error. |
| Thread file is malformed, mismatched, or unsupported | Ignore it as a whole, leave it untouched, use portable title fallbacks, and expose integration health rather than a review error. |
| Previously verified source is missing or changed | Retain the last successful snapshot and display; persist `source-missing` or `source-changed`. |
| Previously verified repository cannot be inspected | Retain the last successful snapshot and display; persist `repository-unavailable`. |
| Atomic write fails | Keep the durable and visible pre-write value; expose a runtime error because the failing file cannot safely record its own failure. |
| A later validation succeeds | Atomically replace the snapshot, clear its error, then publish the new projection. |

Review errors are limited to failures of previously verified review-specific
source or repository evidence. Disabled or unavailable optional title/favicon
integrations do not mark reviews erroneous.

There is no partial salvage, automatic overwrite of invalid files, backward
reader, migration, dual writer, relocation UI, field editor, or repair API.
The supported repair for inconsistent review information is to delete the old
review and create a new review with correct information.

Agents can still retrieve a review whose local paths are broken. `get` returns
the unchanged portable packet; the agent decides how to handle its potentially
stale opening-time information.

## Creation, refresh, restart, and deletion

Portable review creation commits first and is never rolled back because
enrichment discovery or persistence failed. Enrichment is attempted only after
the portable review succeeds. Failure keeps the review available with portable
fallbacks and a non-modal local error.

On restart, Markover loads portable reviews independently. Missing or invalid
private state cannot hide them. #97 owns the explicit refresh triggers—review
arrival, launch/foreground, Inbox or Projects opening, and manual refresh—and
may call the #131 store operations. #131 adds no polling or watchers.

The workspace continues to reference review IDs and stable projection keys. It
does not duplicate paths, repository evidence, title observations, or errors.
Requesting-thread-title changes therefore update every linked review without
rewriting `workspace.json` or each review sidecar.

Deleting a review moves its complete managed directory, including review
enrichment, to Trash through #15's existing review-deletion path. After that
succeeds, Markover scans the remaining loaded portable reviews for the same
stable thread identity. It removes the shared thread file only when no review
still references it. This cleanup is best-effort: failure logs a redacted
diagnostic and leaves a harmless orphan without rolling back deletion.

There is no persisted reference count and no startup thread-file garbage
collector in #131.

## Renderer projection and visible error contract

The main process may send only the fields required by local presentation:

```ts
interface ReviewEnrichmentProjection {
  project: null | {
    key: string
    name: string
    root: string | null
    repositoryRelativePath: string | null
  }
  requestingThreadTitle: null | {
    title: string
    sourceKey: string
    authority: 'thread-host' | 'provider'
    observedAt: string
  }
  error: null | {
    code: 'source-missing' | 'source-changed' | 'repository-unavailable' | 'invalid-private-state' | 'private-write-failed'
    observedAt: string
    detail: string
  }
}
```

#131 defines and validates this projection but does not render it. #97 will
show only the error state non-modally in Inbox/Projects and the loaded document
tree; the explicit info popover may show detailed local paths and messages.

Default logs contain the error code and review ID only. They omit paths,
thread-titles, source contents, repository details, and the full error detail.

## Privacy invariants

- `review.json`, attachments, and their portable versioning remain unchanged.
- CLI `get`, clipboard handoff/export, review URLs, and agent-visible local
  service responses contain no enrichment object or field.
- Main/renderer IPC uses the dedicated exact projection rather than passing
  private files or generic metadata bags.
- No renderer API accepts an enrichment file, path, title observation, or
  repository snapshot for persistence.
- Default logs are redacted as described above. The info popover is explicit
  local UI and may show detailed private context.
- Loss or corruption of all enrichment files leaves every portable review
  valid and retrievable.

## Private compatibility policy

`markover-review-enrichment` and `markover-thread-enrichment` are distinct
private format families, each independently versioned at `1`. A reader accepts
only the exact current format and version.

These formats make no backward-compatibility promise. An unsupported version
is ignored whole and left untouched under the error rules above. Markover adds
no fallback reader, migration, dual writer, or historical rewrite. A future
format can replace rediscoverable private state cleanly after an explicit new
design decision.

## Implementation boundary

One focused #131 pull request branches from current `main` and owns:

1. Exact v1 TypeScript contracts, validators, cloning, and redacted error
   classification for both private formats.
2. Stable thread-identity derivation and filesystem-safe digest generation
   using #134's settled identity rule.
3. Main-process review and thread stores with per-entity serialized atomic
   writes and commit-before-display results.
4. Same-source observation arbitration and pure authority-ranked title
   resolution.
5. Review snapshot/error operations and pure projection construction.
6. Portable-review-independent lifecycle hooks and best-effort final-reference
   thread cleanup after review deletion.
7. Exact renderer projection contracts and boundary validation, without visible
   UI changes.
8. Developer documentation and the focused automated tests below.

The pull request does not own:

- T3 Code, Codex, Claude, LastCode, or other discovery adapters;
- refresh triggers or integration settings;
- sidebar, document-tree, or info-popover rendering;
- product classification, canonical aliases, registry semantics, icon
  registries, or favicon caching;
- polling, watchers, relocation, piecemeal repair, or cleanup UI;
- migrations, compatibility layers, persisted reference counts, or startup
  orphan collection.

## Test matrix

### Contracts and identity

- Accept exact review/thread v1 fixtures and reject missing, extra, malformed,
  mismatched, and unsupported fields without modifying bytes.
- Prove the stable key uses `threadHost.kind` plus `threadHost.threadId`
  whenever present, otherwise `agentThread.id`; cover omitted, distinct, and
  equal duplicated ID cases.
- Prove provider, machine, title, aliases, and runtime inputs cannot change the
  key and cannot collide through delimiter ambiguity.
- Validate canonical timestamps, checksums, absolute paths, repository-relative
  containment, unique source keys, and exact error domains.

### Durability and concurrency

- Prove atomic replacement, user-only mode, temporary-file cleanup, and
  per-entity serialization.
- Prove accepted values become projectable only after the write resolves.
- Prove failed writes leave both durable and published values unchanged.
- Prove an older same-source title cannot overwrite a newer one; exact replay
  is idempotent and equal-time conflict is rejected.
- Prove unrelated review and thread entities can progress independently.

### Failure isolation

- Missing private files load as empty without errors.
- Malformed, mismatched, and unsupported files remain byte-for-byte untouched
  and produce only their scoped local error.
- Source-missing, source-changed, and repository-unavailable retain the complete
  previous snapshot and display.
- A later successful snapshot clears the persisted review error.
- Private-state loss or corruption cannot hide, mutate, invalidate, or block
  `get` for a portable review.

### Lifecycle and privacy

- Portable creation succeeds when initial enrichment discovery or write fails.
- Restart restores successful snapshots and shared title observations without
  rewriting portable review bytes.
- Deleting one of several linked reviews retains the shared thread file;
  deleting the last reference removes it best-effort.
- Shared-file cleanup failure does not roll back review deletion.
- Review JSON, CLI output, clipboard handoff, review URLs, service responses,
  and default logs contain no private enrichment or unredacted details.
- IPC accepts only the exact purpose-built projection and rejects raw private
  objects.

Run focused tests throughout, then `npm run ci:local`. Visible Inbox/Projects
and error-indicator QA belongs to the later #97 consumer PR.

## Acceptance criteria

- Every private field has one owner and one exact v1 schema.
- Reviews remain valid, visible, retrievable, and mutable according to their
  portable lifecycle when enrichment is absent, invalid, incompatible, or
  unwritable.
- Stable thread identity follows #134 and never includes provider.
- Multiple reviews linked to one thread share title observations without
  duplication or divergent copies.
- Accepted enrichment is durable before it changes visible projections; stale
  observations cannot overwrite newer same-source data.
- Broken project paths preserve the prior display, expose a narrow non-modal
  local error, and require delete-and-recreate rather than repair machinery.
- Deletion removes review enrichment and best-effort removes an unreferenced
  shared thread file without adding reference indexes or startup collection.
- Portable and agent-visible surfaces remain demonstrably free of private
  enrichment.
- The implementation remains a storage-and-projection foundation; #97 and
  #134 retain their product, adapter, settings, registry, and UI ownership.

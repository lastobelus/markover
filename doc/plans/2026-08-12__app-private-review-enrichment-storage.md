# App-private review enrichment storage

Issue: [#131](https://github.com/lastobelus/markover/issues/131)  
Coordinates with: [#97](https://github.com/lastobelus/markover/issues/97), [#126](https://github.com/lastobelus/markover/issues/126), [#132](https://github.com/lastobelus/markover/issues/132), [#134](https://github.com/lastobelus/markover/issues/134)
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

Only the main process reads and writes enrichment files. #131 defines an
exact, purpose-built projection for #97 to consume, but does not activate a
second renderer channel while the shipped `projectRoot` pathway remains in
use. The local service and CLI never receive the private objects.

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

`thread-key` is the lowercase hexadecimal SHA-256 digest of the UTF-8 bytes
produced by `JSON.stringify([threadHostKind, effectiveThreadId])`. There is no
whitespace or alternate serializer. The identity is also stored inside the
file, so a mismatched path or theoretical digest collision fails validation
rather than returning another thread's title.

Files are written with user-only permissions where the platform supports them.
Each entity has its own serialized write queue. A #131-scoped private JSON
writer shared by the two new stores uses a same-directory `wx` temporary file,
user-only mode, a complete-byte flush, atomic rename, and best-effort temporary
cleanup. #131 does not refactor the existing review, workspace, settings, or
service-endpoint writers. An accepted operation returns a changed projection
only after the rename succeeds.

## Stable requesting-thread identity

Issue #134's [canonical work-intent
decision](https://github.com/lastobelus/markover/issues/134#issuecomment-5271825306)
supplies the identity rule. #131 applies it without classifying products,
normalizing aliases, or inventing provider mappings.

```text
effectiveThreadId =
  agentThread.threadHost.threadId  when present
  agentThread.id                   otherwise

stableThreadIdentity = [agentThread.threadHost.kind, effectiveThreadId]

threadDigest = sha256(JSON.stringify(stableThreadIdentity))
nonLocalInboxThreadKey = `agent:${threadDigest}`
```

`agentThread.id` is the best observable requesting-thread or session ID. It is
not assumed to be provider-owned. Provider, machine, thread-title, product
aliases, runtime values, and discovery paths never participate in stable
identity, equality, or the directory key. The merged portable documentation
still calls the ID provider-owned; #134 owns that wording correction.

`agentThread.id` and `threadHost.threadId` are independently reported
best-known identifiers and may be equal. #131 does not compare them or require
one to be omitted. Supplying the equal host ID and omitting it therefore derive
the same stable identity. #134 owns removing the current portable-reader and
guidance rule that rejects equality; #131 adds no workaround or compatibility
path for that temporary upstream restriction.

Both digest inputs must already satisfy the portable v1 nonblank-string
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
    identity: https://github.com/lastobelus/markover
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
  result; #97 owns the discovery and normalization policy and the producer that
  computes it.
- `repositoryRelativePath` is relative, normalized, and cannot escape the
  checkout root.
- `projectKey` is identity-bearing and must not be derived from mutable display
  text. It is the literal `<identityKind>:<identity>` using the accepted
  repository identity; consumers split only at the first colon. `projectName`
  is display-only.
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

### Producer and projection transition

#131 has no source/repository discovery adapter. It exposes an operation that
accepts one complete, already verified snapshot and rejects partial evidence;
without a #97 producer, no review-enrichment file is created. Portable review
creation therefore has no new discovery side effect in the #131 pull request.

The shipped Inbox/Projects projection currently uses an absolute checkout root
as `projectKey`, and private workspace v1 persists that key for project and
thread expansion. When #97 starts supplying the normalized repository
`projectKey`, old expansion entries may no longer match and are safely pruned;
the affected groups return to their default expansion state. #131 adds no
migration or path-key alias because this is disposable private presentation
state. Review visibility, open tabs, active review, and per-review view state
remain keyed by review ID and are unaffected.

#131 does update the non-Local Inbox/Projects `threadKey` consumer to use the
stable identity defined above instead of the shipped provider-plus-thread-ID
fallback. Existing thread-expansion entries whose keys change are likewise
ignored or pruned without affecting reviews. Local-review grouping remains
owned by #97's project identity.

The shipped `reviewProjectRoots` map and `MarkoverDocument.projectRoot` field
remain the only active renderer pathway until #97 consumes enrichment. #131
defines a pure projection builder but does not send its `project.root` beside
that existing field. #97 must replace the map/field and switch consumers in one
change rather than let two independently refreshed roots coexist.

#126 may read the accepted main-process repository projection when it needs
current local association, while portable PR/repository identity remains its
normal lookup input. It does not rediscover or persist a competing repository
identity in another private store; credentials and network state remain owned
by #126 settings/integration code.

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
  typed integration conflict rather than resolved arbitrarily. The operation
  returns that conflict to its integration caller, leaves durable/projected
  state unchanged, and reports integration health; it is not a review error.
- A source update replaces only that source's observation through one atomic
  whole-file write.
- Thread-host authority outranks provider authority regardless of recency.
  Within one authority, newer `observedAt` wins. Equal-time candidates use
  ascending `sourceKey` as a deterministic final tie-break.
- The resolved display title is a runtime projection and is never written to
  this file. The accepted #97 Projects behavior already falls back from an
  authoritative requesting-thread-title to the effective thread ID, and the
  shipped projection has a regression test for that behavior. Inbox primary
  text then follows #97's Review-purpose versus Thread-title preference and
  uses `contextSummary` or document name where applicable. #131 supplies the
  title observation and effective ID; it does not redefine those UI choices.
- Discovery failure never deletes a prior observation and never marks each
  associated review as erroneous. It is integration health, not review
  corruption.

The file excludes evidence paths, review IDs, errors, resolved titles, favicon
data, and integration settings. A future LastCode integration can submit an
observation through the same main-process operation without adding polling or
filesystem/database watchers.

No production title source writes this file in #131. #134 must settle source
keys before adapters begin writing observations. If a later #134 decision
changes a persisted source-key or stable-key interpretation, Markover may bump
the private format and discard the rediscoverable observations without a
migration; an old shared-thread directory may remain as a harmless orphan.

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

The projection has one error slot. `invalid-private-state` has highest
precedence, followed by the latest `private-write-failed`, followed by the
persisted `source-missing`, `source-changed`, or `repository-unavailable`
error. A runtime error does not erase the persisted evidence error; after a
successful relevant load or write clears the runtime error, the persisted
error becomes visible again. Runtime errors use the time the failing operation
was observed.

There is no partial salvage, automatic overwrite of invalid files, backward
reader, migration, dual writer, relocation UI, field editor, or repair API.
The supported repair for inconsistent review information is to delete the old
review and create a new review with correct information.

Agents can still retrieve a review whose local paths are broken. `get` returns
the unchanged portable packet; the agent decides how to handle its potentially
stale opening-time information.

## Creation, refresh, restart, and deletion

Portable review creation commits first. A future producer may submit
enrichment only after that commit and can never roll the portable review back.
#131 itself wires no discovery producer, so review creation behavior is
unchanged. A later producer failure keeps the review available with portable
fallbacks and a non-modal local error.

On restart, Markover loads portable reviews independently. Missing or invalid
private state cannot hide them. #97 owns the explicit refresh triggers—review
arrival, launch/foreground, Inbox or Projects opening, and manual refresh—and
may call the #131 store operations. #131 adds no polling or watchers.

The workspace continues to reference review IDs and opaque current projection
keys. It does not duplicate paths, repository evidence, title observations, or
errors. A project/thread key-format transition may reset only the corresponding
expansion entries as described above. Requesting-thread-title changes update
every linked review without rewriting `workspace.json` or each review sidecar.

Deleting a review moves its complete managed directory, including review
enrichment, to Trash through the `ReviewStore.trashReview` path shipped in PR
#106. #131 adds an explicit post-trash hook beside the current main-process
deletion orchestration; it does not introduce a generic deletion-hook registry.
After Trash succeeds, Markover scans the remaining successfully loaded portable
reviews for the same stable thread identity. It removes the shared thread file
only when no loaded review still references it. This cleanup is best-effort:
failure logs a redacted diagnostic and leaves a harmless orphan without rolling
back deletion.

A present but unloadable review directory does not protect a shared thread file
from cleanup. Losing that rediscoverable title state is acceptable because the
portable review is already unavailable to normal review loading; #131 does not
add a second raw-directory parser for cleanup.

There is no persisted reference count and no startup thread-file garbage
collector in #131. During graceful shutdown, the store awaits operations
already queued; it does not retry failed writes or enqueue a fresh snapshot.
An operation acknowledged to its caller was already durable before returning.

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

#131 introduces and validates this projection as new infrastructure and a pure
main-process result; there is no existing purpose-built channel to reuse. It
does not attach the projection to `MarkoverDocument` or send it over IPC. #97
will activate the exact IPC channel while replacing the old project-root path,
then show only the error state non-modally in Inbox/Projects and the loaded
document tree; the explicit info popover may show detailed local paths and
messages.

Default logs contain the error code and review ID only. They omit paths,
thread-titles, source contents, repository details, and the full error detail.

## Privacy invariants

- `review.json`, attachments, and their portable versioning remain unchanged.
- Every agent-visible surface, including current CLI `get`, clipboard
  handoff/export, review URLs, local-service responses, and future surfaces
  such as #132's reviewer commands, contains no enrichment object or field
  unless a later portable-schema decision explicitly owns that data.
- When #97 activates main/renderer IPC, it uses the dedicated exact projection
  rather than passing private files or generic metadata bags.
- No renderer API accepts an enrichment file, path, title observation, or
  repository snapshot for persistence.
- The portable validator's existing recursive private-evidence guard remains
  the central fail-closed defense. #131 adds distinctive local evidence names
  such as `canonicalPath`, `checkoutRoot`, `repositoryRelativePath`,
  `projectKey`, and `titleObservations` to that guard, while avoiding generic
  names such as `sourceKey`, `authority`, or `identity` that could be valid
  additive portable data. Boundary tests still inspect every current and
  future-facing agent output rather than treating the denylist as sufficient
  by itself.
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
design decision. A changed stable-key or canonical source-key rule may make old
thread files unreachable or require a private-format reset; the loss is
accepted because requesting-thread-titles are rediscoverable, and orphan
collection remains outside #131.

## Implementation boundary

One focused #131 pull request branches from current `main` and owns:

1. Exact v1 TypeScript contracts, validators, cloning, and redacted error
   classification for both private formats.
2. Stable thread-identity derivation and filesystem-safe digest generation
   using #134's settled identity rule, plus replacement of the provider-based
   non-Local `threadKey` fallback in the shipped Inbox/Projects projection.
3. Main-process review and thread stores with a #131-scoped strict private JSON
   writer, per-entity serialization, commit-before-result behavior, and
   graceful-shutdown waiting for already queued operations.
4. Same-source observation arbitration and pure authority-ranked title
   resolution.
5. Review snapshot/error operations and pure projection construction.
6. A focused post-trash lifecycle hook and best-effort final-loaded-reference
   thread cleanup after review deletion.
7. Exact future renderer projection contracts and boundary validation, without
   activating IPC or making visible UI changes.
8. Extension of the existing portable private-evidence denylist with safe,
   distinctive enrichment fields.
9. Developer documentation and the focused automated tests below.

The pull request does not own:

- T3 Code, Codex, Claude, LastCode, or other discovery adapters;
- source/repository discovery, remote normalization, or any producer for the
  review snapshot;
- refresh triggers or integration settings;
- sidebar, document-tree, or info-popover rendering;
- activation of the enrichment IPC projection or replacement of the shipped
  `reviewProjectRoots`/`MarkoverDocument.projectRoot` pathway;
- product classification, canonical aliases, registry semantics, icon
  registries, or favicon caching;
- polling, watchers, relocation, piecemeal repair, or cleanup UI;
- a repository-wide atomic-write refactor or generic deletion-hook registry;
- migrations, compatibility layers, persisted reference counts, or startup
  orphan collection.

## Test matrix

### Contracts and identity

- Accept exact review/thread v1 fixtures and reject missing, extra, malformed,
  mismatched, and unsupported fields without modifying bytes.
- Prove the stable key uses `threadHost.kind` plus `threadHost.threadId`
  whenever present, otherwise `agentThread.id`; cover omitted, distinct, and
  equal duplicated ID cases.
- Prove the digest is SHA-256 over the exact no-whitespace
  `JSON.stringify([kind, effectiveThreadId])` UTF-8 bytes.
- Prove provider, machine, title, aliases, and runtime inputs cannot change the
  key and cannot collide through delimiter ambiguity.
- Prove the shipped non-Local Inbox/Projects `threadKey` uses that identity and
  never provider, while Local grouping remains unchanged. Old provider-based
  expansion keys are ignored/pruned without affecting review-ID state.
- Validate canonical timestamps, checksums, absolute paths, repository-relative
  containment, unique source keys, and exact error domains.
- Fixtures include the complete portable `threadHost` shape, including its
  required nonblank provider even though provider is excluded from identity.

### Durability and concurrency

- Prove `wx` temporary creation, flush-before-rename atomic replacement,
  temporary-file cleanup, and per-entity serialization. Assert user-only mode
  only on platforms that expose POSIX permission semantics.
- Prove accepted values become projectable only after the write resolves.
- Prove failed writes leave both durable and published values unchanged.
- Prove an older same-source title cannot overwrite a newer one; exact replay
  is idempotent and an equal-time conflict returns integration health without
  changing durable or projected state.
- Prove unrelated review and thread entities can progress independently.
- Prove graceful shutdown awaits queued operations but does not retry a failed
  write or create a new write.

### Failure isolation

- Missing private files load as empty without errors.
- Malformed, mismatched, and unsupported files remain byte-for-byte untouched
  and produce only their scoped local error.
- Source-missing, source-changed, and repository-unavailable retain the complete
  previous snapshot and display.
- A later successful snapshot clears the persisted review error.
- Runtime error precedence is deterministic and clearing a runtime error
  reveals any retained persisted evidence error.
- Private-state loss or corruption cannot hide, mutate, invalidate, or block
  `get` for a portable review.

### Lifecycle and privacy

- Portable creation remains unchanged and succeeds without an enrichment
  producer; later failed producer submissions cannot roll it back.
- Restart restores successful snapshots and shared title observations without
  rewriting portable review bytes.
- Deleting one of several linked reviews retains the shared thread file;
  deleting the last reference removes it best-effort.
- An unloadable remaining review does not protect rediscoverable shared title
  state from cleanup.
- Shared-file cleanup failure does not roll back review deletion.
- Review JSON, CLI output, clipboard handoff, review URLs, service responses,
  #132-style future agent surfaces, and default logs contain no private
  enrichment or unredacted details. The recursive portable denylist rejects
  the new distinctive private evidence names at any depth.
- Pure projection construction exposes only the exact purpose-built contract;
  no renderer IPC channel is activated in #131.

Run focused tests throughout, then `npm run ci:local`. Visible Inbox/Projects
and error-indicator QA belongs to the later #97 consumer PR.

## Acceptance criteria

- Every private field has one owner and one exact v1 schema.
- Reviews remain valid, visible, retrievable, and mutable according to their
  portable lifecycle when enrichment is absent, invalid, incompatible, or
  unwritable.
- Stable thread identity follows #134 and never includes provider.
- The shipped non-Local Inbox/Projects thread key uses the same identity;
  disposable expansion state may reset when thread/project key formats change,
  without affecting review-ID-keyed workspace state.
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
- The implementation remains a storage-and-pure-projection foundation with no
  discovery producer or active renderer channel; #97, #126, and #134 retain
  their adapter, settings, registry, connected-GitHub, and UI ownership.

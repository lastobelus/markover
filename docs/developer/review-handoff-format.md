# Review handoff format

This is the authoritative contract for the portable JSON artifact exchanged by
Markover, its command-line client, and an agent. The current artifact family is
`markover-review`; its current version is `1`.

The format version covers the whole portable object: source snapshot, review
tree, feedback, attachments, source-edit proposals, lifecycle envelope,
portable request metadata, pull-request observation, and agent guidance. It
does not version Markdown parsing behavior, the local-service protocol, CLI
help, app-private workspace or enrichment state, or source-document revisions.

## Reader contract

A reader must inspect `format` and `version` before interpreting the rest of the
object. It accepts valid v1 artifacts, ignores unknown additive properties, and
preserves those properties unchanged through every read/edit/write round trip.
It rejects a different format or unknown future version before displaying,
mutating, handing off, or rewriting the artifact.

Rejection leaves the review JSON and attachments untouched. The diagnostic
reports both supported and received headers and points to the
[official compatibility catalog](https://lastobelus.github.io/markover/compatibility/),
which maps released schema versions to compatible Markover releases.

## Portable v1 inventory

Every object may contain unknown additive properties unless a stated invariant
makes a property invalid. Known properties have this contract.

| Path | v1 contract |
| --- | --- |
| `format` | Required literal `markover-review`. |
| `version` | Required integer `1`. It versions the complete portable object. |
| `sourceDocument` | Required object with required `name`, `path`, `content`, and `checksum`. `name` and `path` are nullable strings. `content` is the exact immutable opening-time source. `checksum` is `sha256:` plus 64 lowercase hexadecimal characters and must match `content`. |
| `sourceDocument.path` | Immutable opening-time locator when known. It may be absolute, stale, or machine-specific. It is not current path evidence, review identity, ancestry, repository identity, or a Local-review deduplication key. |
| `unsupported` | Required array. Each entry has positive integer `line` and string `text`. Empty means no omitted source lines were recorded. |
| `root` and every node | Required tree. Every node has `id`, `type`, `raw`, `text`, positive `lineStart` and `lineEnd`, `feedback`, and `children`. IDs are unique only inside this artifact. Portable nodes have no `collapsed` field. |
| Type-specific node fields | Headings require `level`; code requires `language`; frontmatter entries require `key`; list items require `marker`, `listId`, `listPosition`, and nullable `listLength`, and may have `task` and `checked`; frontmatter requires `sourceEditable: false`. |
| `node.feedback` | Required string. It may be blank or mix revision requests, questions, discussion, and context. |
| `node.attachments` | Optional array. Each attachment requires `id`. Known image fields are optional `type`, `label`, `path`, `mimeType`, `url`, `checksum`, `width`, and `height`; bytes remain outside JSON. A future must-understand attachment variant is breaking. |
| `node.sourceEdit` | Optional object requiring `original` and `current` strings. `original` equals immutable `raw`; `current` is nonblank and different. It is a proposal, not an instruction to apply blindly. |
| `node.sourceEditable` | Optional boolean. `false` forbids `sourceEdit`; omission uses the node type's normal rule. |
| `review` | Required envelope with `id`, `status`, `origin`, `createdAt`, `updatedAt`, `attentionRequestedAt`, `contextSummary`, `agentThread`, `git`, `pullRequest`, and `agentGuidance`. Lifecycle-conditional `agentReviewer` is defined below. Known app-private session, checkout, and requesting-thread-title evidence is forbidden on the envelope as well as inside agent-thread metadata. |
| `review.id` | Required opaque `mko_...` ID. Together with source content and checksum it identifies this review target. |
| `review.status` | Exactly `editing`, `pending-agent`, `agent-reviewing`, `reviewed`, `revised`, or `done`. `editing` is mutable; the other states are read-only. Human handoff is `editing → pending-agent → revised`. Agent review is `editing → agent-reviewing → reviewed`. Both inflight states may return to `editing`; completed states cannot. `done` is terminal and requires a non-null pull request with a stored `merged` observation. PR completion skips `agent-reviewing` and may archive `reviewed`. Another feedback round creates an independent review. |
| `review.origin` | Required nonblank open string, immutable for the review lifetime. v1 defines `agent` and `local`. Unknown values are valid, preserved, and lifecycle-neutral. `local` requires `agentThread: null`; `agent` may also use null when reliable identity is unavailable. |
| `review.createdAt` | Required canonical UTC instant. It never changes. |
| `review.updatedAt` | Required canonical UTC instant for the latest persisted portable change, including feedback, lifecycle, metadata, or pull-request observation. It does not control Inbox actionability. |
| `review.attentionRequestedAt` | Required app-owned canonical UTC instant. Creation sets it to `createdAt`; only a transition from a non-`editing` status into `editing` advances it. Autosaves, views, metadata refresh, tab actions, and transitions away from `editing` do not. |
| `review.contextSummary` | Required nonblank review purpose. It is neither a requesting-thread-title nor an identity field. |
| `review.agentThread` | Required nullable request snapshot. When non-null it requires nonblank `id` containing the best observable requesting-thread or session ID and a `threadHost` object. App-private local evidence is forbidden at both levels: session paths/discovery/ancestry, checkout roots/sources, and requesting-thread-title aliases. |
| `review.agentThread.threadHost` | Requires nonblank open-string `kind` and `provider`. `kind` identifies the user-facing product or lookup namespace where the user would look for the thread. `provider` identifies the truthfully reported LLM provider or model family, not an intermediate harness. The values name separate dimensions but may be equal. The object enforces the same app-private session-field boundary as `review.agentThread`. |
| `review.agentThread.threadHost.threadId` | Optional nonblank best observable thread-host-owned identifier. Agent guidance recommends including it only when it differs from `agentThread.id`, but equal values remain valid. Consumers use it when present and otherwise fall back to `agentThread.id`; they never rely on inequality. |
| `review.agentThread.threadHost.machine` | Optional nonblank agent-reported hostname snapshot, normally obtained from local `hostname` when available. It is descriptive and never stable or identity-bearing. |
| `review.git` | Required nullable opening-time snapshot. When non-null, known optional fields are sanitized nonblank network/scp-like `repositoryUrl`, nonblank `branch`, and nonblank `commit`. These hints are immutable, may become stale, and are not current Git truth, identity, or grouping keys. Credentials, `file:` URLs, and absolute or relative filesystem remotes are forbidden. |
| `review.pullRequest` | Required nullable association. When non-null it requires a canonical GitHub `url` and matching positive integer `number`. Its optional observation tuple is all-or-none: `status` is `draft`, `open`, `merged`, or `closed`; `statusObservedAt` is canonical UTC no later than `review.updatedAt`; and `statusSource` is a nonblank open string. The latest successful observation is retained when a refresh fails. |
| `review.agentGuidance` | Required object with string `fixedContract` and `interpretationPolicy`. It governs an author-agent receiving human feedback through `get`; it does not govern a reviewer agent. |
| `review.agentReviewer` | Lifecycle-conditional object. It is required for `agent-reviewing` and `reviewed`, preserved when either completed agent review becomes `done`, and forbidden for `editing`, `pending-agent`, and `revised`. Required known fields are `mode`, `claimId`, `agentThread`, `startedAt`, `completedAt`, and `agentGuidance`. |
| `review.agentReviewer.mode` | Required closed value `annotation-only` or `annotations-and-source-proposals`, snapshotted from the global setting when claimed. A later settings change cannot alter an inflight claim. |
| `review.agentReviewer.claimId` | Required opaque `mko_claim_...` value generated uniquely for every claim. It rejects artifacts from cancelled claims even when timestamps and identity repeat. |
| `review.agentReviewer.agentThread` | Required nullable reviewer-request snapshot using exactly the `review.agentThread` shape and private-data boundary. It is provenance, not authenticated identity, and is independent of the requesting-agent snapshot. |
| `review.agentReviewer.startedAt` | Required canonical UTC claim time no later than `review.updatedAt`. |
| `review.agentReviewer.completedAt` | Required null in `agent-reviewing`; required canonical UTC instant from `startedAt` through `review.updatedAt` in `reviewed` and its `done` descendant. |
| `review.agentReviewer.agentGuidance` | Required reviewer-role `fixedContract` and `interpretationPolicy`. A `get-for-review` consumer follows these strings. They require a complete artifact return, permit feedback plus mode-authorized source proposals, preserve every other field, forbid attachments and source application, and direct the agent to review rather than revise the source. |
| Unknown properties | Additive extension data. Readers ignore unknown properties and preserve them unchanged, including inside typed metadata containers. Unknown fields do not bypass privacy boundaries or override known-field invariants. Reserved private namespaces and known local-evidence fields are rejected at any depth, so relocation into an additive container cannot expose workspace/settings/credentials/cache/enrichment, requesting-thread-title, project/repository roots, Git discovery records, or session paths/ancestry. |

Canonical UTC instants use JavaScript's canonical millisecond ISO form:
`new Date(value).toISOString() === value`. Creation sets `createdAt`,
`updatedAt`, and `attentionRequestedAt` equal.

## Agent-review claim and submission

`get-for-review <review-id>` is the sole entry into reviewer-agent ownership.
Before claiming an `editing` review, Markover requests the latest renderer
snapshot, validates it, and persists any existing UI edits. It then requires
every feedback string to be blank and every attachment and source proposal to
be absent. A failed pristine check makes no claim mutation, although the
preceding barrier may persist the human's already-existing edits and advance
`updatedAt`. There is no force or overwrite form.

The first successful claim atomically snapshots the global review mode and
reviewer metadata, generates a unique `claimId`, sets `startedAt`, and moves
the review to `agent-reviewing`. A repeated `get-for-review` while already
`agent-reviewing` is an idempotent recovery read: it returns the frozen
artifact and republishes it to an active renderer without changing any portable
field. It never reruns handoff-key discovery. Explicit retry identity must be
omitted or structurally equal to the frozen snapshot. Pull-request observation
uses the same optional live-observation contract as `get`.

`submit <review-id> --input <path|->` accepts one complete v1 artifact. The
submitted artifact must be recursively structurally equal to the frozen claim
except for `node.feedback` and, in
`annotations-and-source-proposals`, valid `node.sourceEdit` values. Object key
order is irrelevant; array order and primitive types and values are
significant. Unknown additive properties must remain structurally equal.
Attachments, source/tree identity, lifecycle, attribution, guidance, request
metadata, Git, and PR fields are immutable. `annotation-only` rejects any
source proposal. Every failure rejects the whole artifact.

On acceptance Markover reconstructs the completed artifact from the frozen
claim and permitted content, sets server-owned `status: reviewed`,
`completedAt`, and `updatedAt`, and atomically replaces `review.json`. The
submitted completion fields are never trusted. An exact retry after acceptance
compares the original submitted shape with the completed content, republishes
the complete accepted artifact, and returns the original receipt. Different
content conflicts and cannot overwrite the completed review.

If PR-driven `done` archives the accepted review before a response-uncertain
retry, the exact submission still returns the original `reviewed` receipt and
republishes the immutable `done` artifact. The retry comparison ignores only
the terminal lifecycle fields and pull-request observation changed by `done`;
the pull-request identity, claim identity, review content, and every preserved
additive field must still match. No retry can reopen or mutate the archived
artifact.

`edit` cancels a still-pristine `agent-reviewing` claim, removes
`agentReviewer`, and returns to `editing`. A later claim always receives a new
claim ID. `reviewed` is immutable; another human or agent feedback cycle opens
as a new review.

## Identity and private-data boundaries

The review target is the tuple of `review.id`, `sourceDocument.content`, and
`sourceDocument.checksum`. Node IDs locate feedback within that immutable tree;
they make no claim across reviews or reparsed documents. Matching source paths
never imply ancestry.

Portable metadata records what the requester reported at opening time. Current
machine-local knowledge belongs in app-private state. This includes canonical
source and repository evidence, grouping keys, discovery records, credentials,
integration state, and requesting-thread-title observations.

Stable requesting-thread identity is the two-element tuple of
`threadHost.kind` and `threadHost.threadId` when the latter is present, or
`threadHost.kind` and `agentThread.id` otherwise. `threadHost.provider`,
`threadHost.machine`, aliases, titles, runtime details, and discovery paths do
not participate. Equal agent and host IDs produce the same identity and require
no special handling.

Before deriving an app-private project root or favicon from a portable
`sourceDocument.path`, Markover must read the live file and verify it against
the snapshot checksum. A missing or changed file yields no live repository
evidence. Newly created and restored reviews use the same verified private
project-root path before their first renderer publication. A managed review
with no verified project root remains unassigned; only unmanaged documents may
fall back to their current source directory for grouping.

`workspace.json` is the separate private `markover-workspace` family. It owns
navigation and presentation state, including collapsed block IDs. Missing,
malformed, or incompatible workspace state may reset presentation but must not
hide, mutate, or invalidate a portable review. No workspace, settings,
credential, cache, or private enrichment property is returned by `get`, copied
as a handoff, or accepted through an unknown portable extension.

Private enrichment uses two independently versioned, strict JSON families:
`enrichment.json` beside a managed review records a verified live-source and
repository snapshot plus its current validation error, while
`threads/<identity-digest>/enrichment.json` records requesting-thread-title
observations shared by reviews with the same stable thread identity. The stable
identity is `threadHost.kind` plus `threadHost.threadId` when the latter is
present, otherwise `threadHost.kind` plus `agentThread.id`; provider never
participates. The directory digest is SHA-256 of the UTF-8 bytes produced by
`JSON.stringify([threadHostKind, threadId])` with no added whitespace.

These files are app-private caches, not portable truth. Their validators reject
unknown fields and unsupported versions. Missing state means no enrichment;
malformed or incompatible bytes remain untouched and cannot invalidate or hide
the portable review. Accepted writes use a same-directory temporary file,
flush, and atomic replacement with user-only POSIX permissions where supported.
Review snapshot writes are admitted only when the live canonical source still
matches the portable checksum and any repository-relative path resolves to that
same source. Equal-time conflicting observations are rejected rather than
silently choosing a winner.

Private mutation admission is paused and drained before Trash or managed
shutdown. Deleting a review moves its review-local sidecar with the review
directory. Shared thread enrichment is removed only after every remaining
review can be read and none has the same stable thread identity; unreadable or
incompatible remaining reviews make cleanup retain the file conservatively.
Private write failures and invalid private state may appear in app-only
projections, but their details never enter `review.json`, CLI output, clipboard
handoffs, local-service responses, or future agent-visible surfaces.

## Compatibility rules

Keep version `1` only for an additive change. An additive change adds an
optional property whose omission preserves behavior, leaves every existing
type, value domain, and meaning intact, is safe for an older v1 reader to
ignore, and survives its round trips unchanged.

Increment `version` for any breaking change, including:

- removing or renaming a field;
- making an optional field required;
- changing a type, default, meaning, or identity rule;
- narrowing a value domain;
- adding a must-understand node, attachment, or lifecycle variant; or
- moving feedback or source-edit proposals.

A validator correction that rejects data already outside the published
contract does not bump the version. Open-string domains such as `origin`,
`threadHost.kind`, `threadHost.provider`, and `pullRequest.statusSource` accept
new labels without a bump because unknown values remain valid and neutral.
Closed domains such as lifecycle status, pull-request status, and node type
normally require a new version for a new value. The `agent-reviewing` and
`reviewed` values and lifecycle-conditional `agentReviewer` shape were folded
into v1 before v1 appeared in any release; no released predecessor or migration
exists.

Changing guidance text, recognizing more Markdown through existing node
shapes, or extending optional metadata does not itself bump the schema.
`format` changes only for a different artifact family. Versions are positive
integers, not SemVer, and v1 has no independently versioned portable subobjects.

## Released-version migration

Compatibility support begins with released schema versions. Prototype and
unmerged shapes are not supported predecessors. Every breaking release must
include an executable in-app converter from every released predecessor it
claims to support.

Migration runs automatically on load. Before changing an artifact, Markover
creates a restorable byte-for-byte backup of its original review directory,
including JSON and attachments. It migrates a separate working copy, validates
the complete result with the destination decoder, and atomically replaces the
active artifact only after validation succeeds. Failure leaves the active
artifact and backup untouched. Backup metadata records the source schema,
Markover version, time, and integrity information. Backups remain available for
recovery or downgrade until the user explicitly removes them.

An unknown future version is never guessed at. Markover preserves its bytes,
keeps it visible as incompatible, and uses only its header to point at the
official compatibility catalog. A recognized entry names the Markover release
needed to open it; an unrecognized entry recommends updating Markover without
interpreting the body.

## Reader boundaries and errors

`src/review-format.ts` is the platform-neutral decoder and error classifier.
It validates known invariants and returns the original complete value rather
than a lossy projection.

| Boundary | Required behavior |
| --- | --- |
| CLI `open` to local service | Decode submitted review-tree data before storage. Malformed or incompatible input creates no review. Validate agent-supplied identity when creating the managed envelope. |
| Managed `review.json` to store | Inspect the header before listing, restoration, activation, handoff, edit, deletion, or cleanup. v1 decodes directly. A recognized released predecessor migrates through the backed-up path. An unknown version is listed as incompatible without rewriting bytes. |
| Store to service to CLI `get` | Decode before the service response; the CLI independently decodes successful JSON before stdout. Incompatibility exits nonzero, reports on stderr, and emits no handoff JSON on stdout. |
| Main and renderer IPC | Reuse the shared predicate for review-bearing documents, snapshots, autosaves, attachment operations, and portable exports. Pass an incompatible review only as a separately typed, non-activatable header listing with its compatibility-catalog URL; never pass its body. IPC envelopes remain separately validated. |
| Agent consumer | Inspect the header before fields and accept only v1. An author-agent receiving `get` follows `review.agentGuidance`. A reviewer agent receiving `get-for-review` follows `review.agentReviewer.agentGuidance` and its snapshotted mode. Both ignore and preserve additive properties and stop with a clear compatibility report for any other header. |

Error classification is ordered:

1. A non-object or missing or malformed header is `INVALID_REVIEW`.
2. A different string `format` is `UNSUPPORTED_REVIEW_FORMAT`.
3. An unknown positive integer `version` is `UNSUPPORTED_REVIEW_VERSION`,
   without v1-body validation.
4. A recognized v1 header with an invalid body is `INVALID_REVIEW`.

The local service maps unsupported format or version to HTTP `409`. Listing
isolates an incompatible review and continues loading compatible reviews.
Direct activation, retrieval, mutation, deletion, and attachment or orphan
cleanup fail closed against it.

## Maintainer evidence

The representative fixture is
[`test/fixtures/review-handoff-v1.json`](../../test/fixtures/review-handoff-v1.json).
Decoder, compatibility, extension-preservation, reader-boundary, and metadata
guidance coverage lives in `test/review-format.test.ts`,
`test/review-store.test.ts`, `test/ipc-security.test.ts`,
`test/local-service.test.ts`, `test/markover-cli.test.ts`, and
`test/review-metadata-evals.test.ts`.

Before the first post-v1 breaking release, add migration fixtures for backup,
working-copy validation, atomic replacement, rollback, attachment preservation,
downgrade recovery, and compatibility-catalog diagnostics. V1 has no prototype
migration fixture.

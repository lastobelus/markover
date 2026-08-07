# Prototype decisions

These choices optimize for proving the happy path. They are not intended as a
foundation for a production architecture.

## Data and parsing

1. **The tree is the review artifact.** Its `sourceDocument` contains the exact
   Markdown content, its SHA-256 checksum, name, and path when known. Structural
   nodes store reviewer comments in a plainly named `feedback` field.
2. **Node IDs are document-order IDs.** IDs such as `block-7` are deterministic
   for an exact document. No attempt is made to preserve annotations across
   edits; a changed checksum means a different review target.
3. **Parsing is delegated to the third-party `markdown-it` parser using its
   CommonMark preset.** Markover does not maintain a Markdown grammar. It maps
   `markdown-it`'s token stream and source ranges into review blocks, gaining
   proven block parsing, exact line ranges, hard-wrapped list-item content, and
   room for extensions. Markover currently turns paragraphs, headings, ordered
   and unordered list items, thematic breaks, and code blocks into selectable
   nodes. The built-in table rule is enabled explicitly.
4. **Heading and list structure share one tree.** Lower-level headings become
   children of the nearest higher-level heading. Nested list items become
   children of the preceding less-indented list item.
5. **Block quotes and tables are deliberately opaque nodes.** Their complete
   source ranges are selectable and their contents render, but markdown-it's
   nested quote tokens and table rows/cells are not copied into the review tree.
   This tests useful review granularity before adding more navigation levels.
6. **Tasks decorate ordinary list-item nodes.** A leading `[ ]`, `[x]`, or `[X]`
   adds `task` and `checked` fields and is removed from the displayed item text.
   The original marker remains present in the node's raw source.

   Example task nodes:

   - [ ] Review the pending decision
   - [x] Preserve the accepted behavior
7. **Inline Markdown is rendered inside supported blocks.** Bold, italic,
   inline code, link labels, and image labels appear in the left pane. Links
   remain inert. Image pills open the source image in the same labeled preview
   modal used for screenshot attachments; relative paths resolve from the
   reviewed Markdown file.
8. **Unrecognized extensions degrade through CommonMark.** With raw HTML and
   extensions disabled, syntax such as definition lists, footnotes,
   strikethrough, and HTML may appear as literal paragraph content, resolve as
   ordinary reference syntax, or have definition lines absent from the block
   tree. The exact input remains in `sourceDocument.content`; the sampler keeps
   these cases visible for a later unsupported-syntax design.

## Interaction

1. **Selection is always a block, never the invisible document root.**
2. **Arrow navigation operates structurally.** Left selects a parent; right
   selects a child or searches outward for the next sibling; up/down move among
   siblings and climb outward at boundaries.
3. **Tab and Shift-Tab cycle review panes.** When the documents list sidebar is
   expanded, focus cycles through Documents, Document tree, and Annotation.
   A collapsed or absent documents list is skipped. Control-Tab remains reserved
   for switching review sessions.
4. **Managed reviews are durable sessions.** Each `markover open` call creates a
   distinct review ID and atomically writes its complete artifact after every
   mutation to Markover's per-user application-data `reviews` directory.
   Restarting the single application instance restores every managed review and
   its collapse, feedback, status, and attachment state. Selection is retained
   while switching tabs during an application run and resets to the first block
   after restart. The first upgraded checkout imports managed reviews from its
   former `.markover/reviews` directory without overwriting user-data copies.
5. **Structural labels do not repeat source markers.** Headings use `H1`, `H2`,
   and so on; ordered items use their actual index; unordered items use an open
   bullet. The block text contains only the item's content.
6. **Ancestors reveal feedback below them.** A block with feedback has a solid
   marker. An ancestor of a block with feedback has a separate, partially
   transparent marker, so collapsed branches do not hide review state. The
   indicator order is own annotation, descendant annotation, then attached
   image. Image indicators propagate through descendants without distinguishing
   where in the subtree the image lives. All three columns remain fixed at the
   right edge; nesting indents only the disclosure and content columns.
7. **The annotation pane includes compact raw source.** Its header contains the
   node type and source line span; list items also show their position and list
   length. A collapsible source panel preserves the selected block's original
   Markdown without hard-wrapping and uses a small monospace font. An explicit
   Edit action creates a proposal in `sourceEdit: { original, current }`; it
   never writes the source document or changes its checksum, `raw`, IDs, or
   structure. Saved proposals render through Pierre Diffs, show line counts in
   the source header and tree row, and replace the tree block's visible content
   while retaining the immutable original for handoff. Revert removes only the
   proposal.
8. **The selection remains visible while reading forward.** Once the selected
   row scrolls above the document viewport, a non-interactive mirror stays
   pinned at the top. Content scrolls beneath its opaque background and shadow;
   a small centered accent triangle distinguishes the pinned state. The pinned
   row's top hairline replaces the document header's bottom hairline rather than
   rendering as a fuzzy pair.
9. **Hover and selection bands are square and full-bleed.** Rows retain content
   indentation but their backgrounds and top/bottom borders reach the left edge
   of the pane. There are no side borders or rounded corners. A small,
   pointer-inert overlay completes the active band over the native scrollbar;
   pinned rows sit above the entire scroll surface. The document pane's right
   divider uses the same hairline color as selected rows.
10. **Pane headers are compact and geometrically shared.** Both use the same
    fixed 40-pixel height and aligned bottom border. Their pane labels sit in
    the top-left corner, the selected block descriptor is centered, and status
    pills remain right-aligned.
11. **Pane focus is an external top-edge signal.** The focused pane replaces
    its one-pixel header-top hairline with a four-pixel accent line extending
    upward, so its bottom edge remains aligned with the other pane's hairline.
    No green outline surrounds the pane.
12. **Navigation help is inset from the scrollbar.** Its right-side gap from
    the scrollbar visually matches its bottom gap from the window.
13. **Annotation typing does not rebuild the tree per character.** The document
    tree only rerenders when a block crosses the annotated/unannotated boundary,
    and that rerender preserves `scrollTop`. Browser scroll anchoring is disabled
    for the tree so feedback entry cannot walk the document one block at a time.

## Screenshot attachments

1. **Pasted screenshots are workspace files, not JSON payloads.** Managed
   reviews store them under each review in Markover's per-user application-data
   directory. Legacy blocking reviews retain their gitignored
   `.markover/attachments/` directory and optional `--attachments-dir <path>`
   override. Emitted paths are absolute so a same-machine agent can inspect them
   directly.
2. **Attachments and prose remain separate data.** A node gains an ordered
   `attachments` array only when an image is pasted. Each entry contains an ID,
   type, MIME type, absolute path, byte checksum, pixel dimensions, and optional
   short label. The original pasted PNG or JPEG bytes are written unchanged.
3. **Pasting also inserts a convenient textual reference.** Markover inserts
   `[!img-N]` at the feedback cursor after saving an image. The attachment array
   is authoritative: deleting or editing the marker does not affect the image.
   Removing an attachment through the UI also removes exact matching markers.
   If the browser paste event exposes no image item, Markover falls back to
   Electron's native clipboard image so copies from Preview and Finder work.
4. **The first-cut UI supports ordered multiple images.** Thumbnails appear
   below feedback in paste order and wrap into rows without horizontal
   scrolling. Each card places a 78-by-42-pixel thumbnail above its short label
   and delete button. A normal click opens a large preview; Control-click
   anywhere on the attachment card replaces its label with an inline editor.
   On macOS the equivalent context-menu event follows the same path because a
   physical Control-click may not retain `ctrlKey` on the pointer event.
   Enter or blur commits, while Escape cancels. Holding Control suppresses the
   delete hover/action. Relabeling replaces matching `[!img-N]` references with
   `[!label]` in the feedback. A small `▧` after the annotation markers shows
   which document subtrees contain images.
5. **There is no image editor or dedicated caption field.** Pasted images are
   not cropped, drawn on, highlighted, or recompressed. Short thumbnail labels
   aid reference; explanatory prose remains in `feedback`.
6. **Attachment files have no automatic cleanup.** Removing an attachment from
   a node leaves its bytes on disk. Review-history retention and cleanup remain
   future work.

## Agent handoff

1. **The primary integration is non-blocking `open` plus one-shot `get`.**
   `markover open <path> --summary <text>` registers the exact source in the
   existing application instance, returns a review ID, and exits. After the user
   says “Check Markover,” `markover get <id>` returns the complete review
   without agent polling or clipboard transfer.
2. **A review ID represents one review session.** Opening the same source twice
   creates distinct IDs because branch, pull request, agent thread, purpose, and
   annotations may differ. Source checksums identify the exact Markdown target;
   review ID plus block ID identifies one annotation.
3. **Handoff is atomic and idempotent.** `get` freezes the renderer before
   capturing its latest state, waits for active attachment mutations, persists
   the snapshot, transitions to `pending-agent`, and acknowledges the read-only
   UI before returning. Per-review action serialization prevents concurrent
   `get` and `edit` from interleaving.
4. **The user can reopen editing.** `markover edit <id>` idempotently returns a
   pending review to `editing`. It cannot recall work an agent already performed
   from an older snapshot, so the user must also tell that agent to pause.
5. **Stdout is a strict machine interface.** Agent-facing commands emit exactly
   one JSON value on success. Diagnostics belong on stderr, and failures exit
   non-zero without contaminating stdout.
6. **Clipboard export remains an escape hatch.** `Copy feedback JSON` copies the
   same complete tree. A concise-feedback format remains omitted because
   annotations are substantially less useful without their source and tree
   context.
7. **Image handoff uses ordinary paths.** Full-tree JSON includes attachment
   metadata directly on annotated nodes; image bytes remain outside JSON.
8. **Legacy commands remain temporarily available for comparison.** The
   blocking `review` command and older durable `review:open`/`--resume` path are
   not the primary multi-thread workflow.

## Multi-document application state

1. **One Markover application instance owns a review inbox.** A shared per-user
   endpoint record points agent CLIs from any checkout to its small loopback JSON
   API. Electron's single-instance lock prevents duplicate owners. Startup retry
   stays inside the CLI process and does not spend agent turns polling.
2. **Every managed review has an independent tab.** Switching tabs preserves
   selection, collapsed blocks, annotations, and attachment previews.
   Control-Tab and Control-Shift-Tab cycle reviews.
3. **Pending reviews are localized read-only state.** Tabs show `WITH AGENT`,
   the annotation pane shows `WITH AGENT · READ ONLY`, feedback renders as
   Markdown rather than a textarea, and mutation controls disappear. Document
   navigation, collapsing, source, thumbnails, and image preview remain.
4. **The main process owns the latest persisted snapshot.** Renderer snapshot
   and status acknowledgements form explicit barriers around handoff. Incomplete
   or legacy review directories are left untouched rather than silently
   migrated into the managed registry.

## Review metadata

1. **Metadata belongs to the review envelope, not the deterministic tree
   structure.** A short Markdown `contextSummary` is required. Git, pull-request,
   and agent-thread fields may be absent without blocking review creation.
2. **Explicit metadata wins.** `--branch`, `--pr`, and `--thread-id` supply
   values known by the launching agent. Provenance is stored with the values.
3. **Git discovery is best effort.** Markover uses the source directory to
   discover repository root, origin, branch, and commit. Remote URL userinfo,
   query strings, and fragments are removed before persistence.
4. **Codex discovery uses a bounded exact marker search.** A
   `mko_handoff_<high-entropy>` key can identify the launching session when the
   shell lacks its thread ID. Markover examines only a fixed number of recent
   session-log tails within a fixed byte budget. Missing, unreadable, invalid,
   substring-only, or ambiguous matches degrade to unknown metadata.
5. **Metadata stays discoverable rather than crowded into the main UI.** Tabs
   show only document, review ID suffix, and status. An information button opens
   a drawer containing the summary, paths, Git details, pull request, thread,
   and discovery provenance.

## macOS release trust

1. **The current trust mode is explicit hardened ad-hoc signing.** Packaging
   requires `--trust-mode=ad-hoc`; missing and unknown modes fail closed.
   `@electron/osx-sign` signs inside-out after all bundle mutations. Identity
   lookup, timestamping, entitlement automation, and provisioning-profile
   embedding are disabled for the `-` identity.
2. **Entitlements are checked-in, component-specific, and minimal.** The main,
   generic helper, GPU helper, and renderer helper receive only
   `com.apple.security.cs.allow-jit`. The unused plugin helper and other signed
   code receive an empty profile. Device, personal-information, unsigned-memory,
   and disabled-library-validation grants are rejected by tests and final
   artifact verification.
3. **The release contract starts at macOS 14 Sonoma.** Apple Silicon and Intel
   remain separate native ZIPs. Packaging writes
   `LSMinimumSystemVersion = 14.0`, and both the release preflight and
   bootstrap require the declared architecture and floor.
4. **The exact final ZIP is the release-verification boundary.** Native
   preflight verifies its checksum, safe extraction, app and helper IDs,
   version, architecture, strict code seal, hardened-runtime flags, exact
   entitlements, ad-hoc signature, absent Team ID, and expected Gatekeeper
   rejection before upload.
5. **First installation validates before cache promotion.** The dependency-free
   bootstrap checks the downloaded digest, metadata, architecture, strict seal,
   hardened runtime, and ad-hoc trust mode while the app is in staging. A
   mismatch cleans staging and prevents cache or launch. Atomic promotion
   includes a validation marker; an unmarked cache never bypasses installation
   checks. A successful install warns on stderr that Markover is not
   Apple-verified; JSON stdout remains reserved for agent protocol results.
6. **Apple verification remains a separate blocked transition.** Developer ID
   signing, notarization, stapling, and successful Gatekeeper assessment require
   Apple Developer Program access and a separately reviewed explicit trust-mode
   change. Credentials alone never activate or downgrade a release path.

## Release provenance and rollback

1. **Official releases are draft-first and all-or-nothing.** Separate
   unprivileged native jobs build Apple Silicon and Intel apps while another
   job builds the matching CLI. A staging job requires the exact six payload
   and checksum files before it can create a complete draft.
2. **Draft staging and publication are distinct protected operations.** The
   `release` environment gates both jobs. The first approval admits the oldest
   pending tag to rollback selection and complete draft assembly; the second
   follows clean-machine evidence and admits publication. This retains every
   pending release without Actions concurrency's replaceable pending slot. The
   final transition refetches the mutable draft by release ID and proves every
   byte, release-note field, asset name, and rollback target is still unchanged
   immediately before publishing.
3. **GitHub attestations and SHA-256 sidecars have separate jobs.** Sidecars
   provide simple byte checks. GitHub build-provenance attestations identify
   the source repository and release workflow. Neither is a claim of
   bit-for-bit reproducibility.
4. **Stable version tags only move forward and never move in place.** The
   release workflow accepts stable SemVer tags whose matching package versions
   are newer than every preserved stable tag, contained in protected `main`,
   and already green on both required CI checks. Repository rules restrict
   `v*` creation and separately prohibit updates and deletion without bypass.
5. **Each release carries its own rollback contract.** Generated notes name one
   stable release explicitly designated `latest` as the known-good version and
   provide its exact version-pinned launcher. Monotonic version checks still
   compare against every preserved stable tag, including withdrawals. Users
   quit Markover and back up the complete Application Support directory first;
   rollback is promised only within one review-data format.
6. **Published bytes are withdrawn, never replaced.** A defective version is
   marked withdrawn, `latest` returns to the named known-good release, and a
   fix receives a new version. Deleting an actively dangerous immutable release
   is an exceptional documented incident action; its tag is never reused.

## Local service authorization

1. **The first authorization boundary is the local OS account.** Markover
   denies loopback callers that cannot read a protected per-process capability.
   A malicious process running as the same user and a privileged or root
   process are explicitly outside this boundary.
2. **The service remains plain HTTP on `127.0.0.1`.** Local TLS, browser-client
   support, CORS, and `Host`/`Origin` policy do not strengthen the selected
   account boundary and are not part of protocol 2.
3. **Each service process gets one full-access identity.** Startup generates a
   random UUID instance ID and a 256-bit capability with
   `randomBytes(32).toString('base64url')`. Restarting rotates both values; no
   later process reuses an expired capability.
4. **Discovery and credentials are fixed sibling records.** `service.json`
   protocol 2 contains only `version`, `instanceId`, `port`, and `pid`.
   `service.token` protocol 1 contains `version`, the matching `instanceId`, and
   the capability. Endpoint metadata cannot redirect a client to another
   credential path.
5. **POSIX filesystem modes enforce the account boundary.** Startup hardens the
   Markover application-data directory to `0700` before imports, settings,
   windows, or service work. Both records and their atomic temporary files use
   `0600`. Publication writes the credential first and the endpoint last; a
   publication failure closes the listener and fails startup. Windows ACL
   support and Windows security claims are deferred.
6. **Shutdown leaves one coherent stale pair.** Neither record is deleted on
   graceful shutdown. Stale records are useful to startup recovery and reveal
   no live credential once their owning process has stopped.
7. **Only exact `GET /health` is public.** It returns `status`, protocol version
   2, and the service's non-secret instance ID. Every other request must
   authenticate before route matching or body reading with exactly one
   Authorization field. The Bearer scheme is case-insensitive and permits one
   or more spaces as HTTP specifies; the capability retains its exact
   43-character base64url shape, and the client emits the canonical form.
8. **Authorization failures do not become an oracle.** Missing, malformed,
   duplicated, and incorrect credentials all return the same structured
   `401 UNAUTHORIZED` response and Bearer challenge. Validly shaped tokens use
   a constant-time comparison. Unknown routes are also gated before their
   `404`, and unauthorized bodies never reach JSON parsing or state mutation.
9. **The shared client owns credential propagation and preflight.** For every
   non-health request it reads fresh endpoint metadata and credentials, requires
   matching record IDs, then calls public health without a token and requires
   the listener's instance ID to match. Only then does it send the Bearer
   capability and application request. Callers neither pass nor receive tokens,
   and successful preflight is not cached.
10. **Client failures have stable, non-secret categories.** Invalid discovery
    metadata is `INVALID_ENDPOINT`; missing or malformed credentials are
    `INVALID_CREDENTIAL`; mismatched record or health IDs are `STALE_SERVICE`;
    an identity-matched request rejected by the server is `UNAUTHORIZED`;
    preflight network failure is `SERVICE_UNAVAILABLE`; and an application
    transport failure is `REQUEST_UNCERTAIN`.
11. **Rejected-request diagnostics are explicit and redacted.** They are off by
    default and controlled by the live persisted “Log rejected API requests”
    setting. Enabled lines contain only method, query-free pathname, and
    `missing`, `malformed`, or `mismatch`; they never contain credentials,
    fingerprints, queries, bodies, other headers, or remote addresses.
12. **Protocol 2 is a clean pre-preview break.** There is no protocol-1
    fallback, dual protocol, optional authentication, or historical-review
    migration. Existing review JSON and attachments remain untouched and need
    not be openable by the latest app. Restarts do not require draining review
    handoffs; issue 39 independently owns bounded-loss restart durability.
13. **Issue 12 remains a three-PR stack.** PR 1 established capability
    generation, protected publication, server enforcement, minimum client
    propagation, and the reusable development smoke fixture. PR 2 owns bounded
    record convergence, ordinary stale-instance detection, in-place record
    repair, and deterministic client recovery. PR 3 owns exhaustive adversarial
    verification and public privacy/data claims.
14. **Publication recovery is bounded and non-destructive.** Record reads retry
    missing, malformed, or mismatched pairs for a short fixed convergence
    window. When complete probing still fails, the CLI invokes one normal
    launch-or-notify operation. A stopped primary starts normally; a ready
    primary serially republishes the same in-memory identity and listener. The
    CLI never deletes records, kills a PID, or forcibly replaces a process.
15. **The health instance ID is a consistency name tag, not authentication.**
    It prevents an ordinary unrelated stale-port listener from receiving the
    capability or review request. A malicious process that observes the public
    ID and deliberately impersonates the stale listener remains outside the
    implemented protection; HMAC handshakes, connection pinning, local TLS, and
    Unix-domain sockets are deferred until real deployment evidence justifies
    them.
16. **Ambiguous application requests are never replayed automatically.**
    Recovery completes before transmission. Once an application request may
    have reached a listener, transport failure tells the user to inspect
    Markover before retrying. Automatic retries require a separately designed
    idempotency contract.
17. **Authorization evidence uses a layered real-HTTP matrix.** Every current
    protected route is denied with missing and validly-shaped incorrect
    credentials, while every hostile credential class is exercised against a
    representative mutation. Unauthorized requests stop before routing, body
    parsing, callbacks, or state changes. Unknown routes authenticate before
    `404`; tests do not invent attachment or deletion APIs that do not exist.
18. **Local session discovery is visible and controllable.** The default-on
    “Discover agent thread from local session logs” setting controls only
    handoff-key-based Codex session scanning. Explicit thread IDs and Git
    provenance remain available. The CLI reads the shared per-user setting
    without adding a service route; a missing file uses the default, while an
    existing malformed or unreadable file skips scanning. Opt-out is silent and
    never prevents a review from opening.
19. **Public privacy claims distinguish local storage from safe sharing.** The
    public page names stored review content, attachments, local paths, Git and
    agent provenance, storage locations, indefinite retention, and the current
    quit-then-delete procedure. Source-edit proposals do not mutate original
    Markdown. Reviews remain local to the macOS account, but same-user and
    privileged processes remain inside the trust boundary.
20. **Network and handoff boundaries are explicit.** Ordinary review handling
    has no telemetry, analytics, cloud sync, or automatic review upload.
    Installation can contact npm or GitHub, and explicitly previewing a remote
    Markdown image contacts its host; the image remains inert before that
    action. After an authenticated agent retrieves a handoff, the recipient's
    storage, logging, and network behavior is outside Markover's control.
21. **Issue 12 closes at the verified authorization boundary.** Issue 39 owns
    bounded-loss durability, issue 13 owns packaged happy-path smoke, issue 9
    owns broader preview documentation and cleanup guidance, issue 15 owns
    deletion, and issue 64 owns the future in-app privacy link. The final slice
    does not absorb those roadmapped responsibilities.

## Deliberately deferred

- Drill-down into block-quote contents or table rows and cells
- Footnote, definition-list, strikethrough, container, and other extension nodes
- Explicit warnings and selectable fallback nodes for unsupported syntax
- Annotation import, merge, or migration across document revisions
- Matching annotations across document edits
- Manual File > Open with a colocated Markover save artifact
- `markover://review/<id>` deep links
- Agent result writeback, per-annotation outcomes, and addressed state
- Organized review history, revisions, retention, and cleanup
- Automatic pull-request discovery
- Same-user and privileged-process isolation, stale-port impersonation
  protection, accessibility, Developer ID signing/notarization, App Sandbox,
  and auto-update
- Compatibility guarantees for the tree format
